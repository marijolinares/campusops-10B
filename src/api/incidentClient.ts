import { parseRemoteResource, redactForTelemetry } from '../course-evaluation';
import type { Incident } from '../domain/incident';
import type { IncidentCategory } from '../campusops/contracts';
import {
  canRetry,
  isStaleGeneration,
  transition,
  type SessionEvent,
  type SessionStatus,
} from '../domain/session';
import type { SecureStoragePort } from '../infrastructure/secureStorage';
import { fail, kindFromStatus, type ClientResult } from './clientErrors';
import { mapIncidentDto, type IncidentDto } from './incidentMapper';

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export type Scenario =
  | 'success'
  | 'nullable'
  | 'malformed'
  | 'server_error'
  | 'rate_limited'
  | 'slow';

export type IncidentClientConfig = Readonly<{
  baseUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Sólo para pruebas/desarrollo contra el backend didáctico (cabecera X-Course-Scenario). */
  scenario?: Scenario;
  /** Recibe eventos ya sanitizados (sin tokens, cuerpos ni datos de la incidencia). */
  log?: (event: Readonly<Record<string, unknown>>) => void;
  /** Almacenamiento seguro para los tokens; sin él la sesión vive sólo en memoria. */
  storage?: SecureStoragePort;
  /** Avisa a la app de cada cambio de estado de sesión (nunca recibe tokens). */
  onSessionChange?: (status: SessionStatus) => void;
}>;

export type NewIncident = Readonly<{
  category: IncidentCategory;
  description: string;
  location: string;
}>;

/** `null` = el servidor respondió con payload nulo (sin datos); no se inventa nada. */
export type IncidentDetail = Incident | null;

export type IncidentList = Readonly<{
  incidents: readonly Incident[];
  /** Entradas válidas del sobre con payload null: se omiten pero se cuentan. */
  emptyCount: number;
}>;

export type CreatedIncident = Readonly<{
  incident: IncidentDetail;
  duplicate: boolean;
}>;

type Session = { actorId: string; accessToken: string; refreshToken: string | null };

const ACCESS_TOKEN_KEY = 'campusops.accessToken';
const REFRESH_TOKEN_KEY = 'campusops.refreshToken';
const ACTOR_KEY = 'campusops.actorId';

const DEFAULT_TIMEOUT_MS = 5000;

type Raw = { ok: true; status: number; body: unknown } | { ok: false; result: ClientResult<never> };

export function createIncidentClient(config: IncidentClientConfig) {
  const doFetch: FetchLike = config.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let session: Session | null = null;
  let status: SessionStatus = 'unauthenticated';
  /** Sube con cada sesión nueva, renovación o logout; distingue 401 tardíos. */
  let generation = 0;
  /** Renovación en curso, compartida por todas las peticiones que reciben 401. */
  let refreshing: Promise<boolean> | null = null;

  function record(event: Record<string, unknown>) {
    config.log?.(redactForTelemetry(event) as Record<string, unknown>);
  }

  function dispatch(event: SessionEvent) {
    const next = transition(status, event);
    if (next === status) return;
    status = next;
    record({ event: 'session', state: next });
    config.onSessionChange?.(next);
  }

  async function persist(value: Session) {
    if (!config.storage) return;
    await config.storage.setItem(ACCESS_TOKEN_KEY, value.accessToken);
    await config.storage.setItem(ACTOR_KEY, value.actorId);
    if (value.refreshToken) await config.storage.setItem(REFRESH_TOKEN_KEY, value.refreshToken);
    else await config.storage.deleteItem(REFRESH_TOKEN_KEY);
  }

  async function wipeStorage() {
    if (!config.storage) return;
    for (const key of [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, ACTOR_KEY]) {
      try {
        await config.storage.deleteItem(key);
      } catch {
        record({ event: 'storage', outcome: 'delete_failed' });
      }
    }
  }

  /** Borra memoria y almacenamiento. Invalida cualquier renovación en vuelo. */
  async function clearSession(event: SessionEvent) {
    session = null;
    generation += 1;
    dispatch(event);
    await wipeStorage();
  }

  /** Una sola renovación; los demás 401 esperan la misma promesa. */
  function refreshOnce(): Promise<boolean> {
    if (refreshing) return refreshing;
    const refreshToken = session?.refreshToken;
    const startedGeneration = generation;
    if (!session || !refreshToken) {
      refreshing = clearSession('refreshFailed').then(() => false);
    } else {
      const actorId = session.actorId;
      dispatch('refreshStarted');
      refreshing = (async () => {
        const raw = await request('refresh', 'POST', '/v1/session/refresh', {
          body: { refreshToken },
          authenticated: false,
        });
        // Si hubo logout/otra sesión mientras tanto, el resultado se descarta.
        if (generation !== startedGeneration) return false;
        const body = raw.ok ? (raw.body as Record<string, unknown> | null) : null;
        if (
          !body ||
          typeof body !== 'object' ||
          typeof body.accessToken !== 'string' ||
          typeof body.refreshToken !== 'string'
        ) {
          await clearSession('refreshFailed');
          return false;
        }
        session = { actorId, accessToken: body.accessToken, refreshToken: body.refreshToken };
        generation += 1;
        await persist(session);
        dispatch('refreshSucceeded');
        return true;
      })().catch(async () => {
        await clearSession('refreshFailed');
        return false;
      });
    }
    const current = refreshing;
    void current.finally(() => {
      if (refreshing === current) refreshing = null;
    });
    return current;
  }

  /**
   * Envía la petición; ante 401 espera la renovación compartida y reintenta
   * una sola vez. Un segundo 401 no vuelve a renovar (sin bucles).
   */
  async function request(
    label: string,
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; idempotencyKey?: string; authenticated?: boolean } = {},
  ): Promise<Raw> {
    let attempts = 0;
    for (;;) {
      const usedGeneration = generation;
      const raw = await exchange(label, method, path, options);
      const is401 = !raw.ok && raw.result.ok === false && raw.result.error.kind === 'unauthorized';
      if (!is401 || options.authenticated === false || !canRetry(attempts)) return raw;
      attempts += 1;
      if (isStaleGeneration(usedGeneration, generation)) {
        if (!session) return raw; // logout o renovación fallida: nada que reintentar
        continue; // 401 tardío: ya se renovó, sólo reintenta con el token nuevo
      }
      dispatch('unauthorized');
      if (!(await refreshOnce())) return raw;
    }
  }

  async function exchange(
    label: string,
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; idempotencyKey?: string; authenticated?: boolean } = {},
  ): Promise<Raw> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.authenticated !== false) {
      if (!session) return { ok: false, result: fail('unauthorized') };
      headers.authorization = `Bearer ${session.accessToken}`;
      headers['x-course-actor'] = session.actorId;
    }
    if (config.scenario) headers['x-course-scenario'] = config.scenario;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve('timeout');
      }, timeoutMs);
    });

    try {
      const exchange = (async () => {
        const response = await doFetch(`${config.baseUrl}${path}`, {
          method,
          headers,
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          signal: controller.signal,
        });
        const raw = await response.text();
        return { response, raw };
      })();
      exchange.catch(() => undefined); // evita rechazos no manejados si gana el timeout

      const winner = await Promise.race([exchange, timedOut]);
      if (winner === 'timeout') {
        record({ event: 'request', label, outcome: 'timeout' });
        return { ok: false, result: fail('timeout') };
      }

      const { response, raw } = winner;
      if (!response.ok) {
        const retryAfter = Number(response.headers?.get('retry-after'));
        const extra = {
          status: response.status,
          ...(Number.isFinite(retryAfter) && retryAfter > 0
            ? { retryAfterMs: retryAfter * 1000 }
            : {}),
        };
        record({ event: 'request', label, outcome: 'http_error', status: response.status });
        return { ok: false, result: fail(kindFromStatus(response.status), extra) };
      }

      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        record({ event: 'request', label, outcome: 'malformed', status: response.status });
        return { ok: false, result: fail('malformed', { status: response.status }) };
      }
      record({ event: 'request', label, outcome: 'ok', status: response.status });
      return { ok: true, status: response.status, body };
    } catch {
      record({ event: 'request', label, outcome: 'network' });
      return { ok: false, result: fail('network') };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  function toDomain(dto: IncidentDto): ClientResult<IncidentDetail> {
    const mapped = mapIncidentDto(dto);
    if (mapped.kind === 'invalid') return fail('contract');
    return { ok: true, value: mapped.kind === 'incident' ? mapped.incident : null };
  }

  return {
    /** Inicia sesión con una identidad ficticia del backend didáctico. */
    async login(actorId: string): Promise<ClientResult<{ actorId: string }>> {
      dispatch('loginStarted');
      const raw = await request('login', 'POST', '/v1/session/login', {
        body: { actorId },
        authenticated: false,
      });
      if (!raw.ok) {
        dispatch('loginFailed');
        return raw.result;
      }
      const body = raw.body as Record<string, unknown> | null;
      if (
        !body ||
        typeof body !== 'object' ||
        typeof body.accessToken !== 'string' ||
        typeof body.actorId !== 'string'
      ) {
        dispatch('loginFailed');
        return fail('contract');
      }
      session = {
        actorId: body.actorId,
        accessToken: body.accessToken,
        refreshToken: typeof body.refreshToken === 'string' ? body.refreshToken : null,
      };
      generation += 1;
      await persist(session);
      dispatch('loginSucceeded');
      return { ok: true, value: { actorId: body.actorId } };
    },

    /** Cierra la sesión: borra tokens de memoria y del almacenamiento seguro. */
    async logout(): Promise<void> {
      await clearSession('logout');
    },

    /** Recupera una sesión guardada (p. ej. al abrir la app). */
    async restoreSession(): Promise<boolean> {
      if (!config.storage || session) return session !== null;
      const [accessToken, refreshToken, actorId] = await Promise.all([
        config.storage.getItem(ACCESS_TOKEN_KEY),
        config.storage.getItem(REFRESH_TOKEN_KEY),
        config.storage.getItem(ACTOR_KEY),
      ]);
      if (!accessToken || !actorId) return false;
      session = { actorId, accessToken, refreshToken };
      generation += 1;
      dispatch('loginStarted');
      dispatch('loginSucceeded');
      return true;
    },

    getSessionStatus(): SessionStatus {
      return status;
    },

    async listIncidents(): Promise<ClientResult<IncidentList>> {
      const raw = await request('list', 'GET', '/v1/incidents');
      if (!raw.ok) return raw.result;
      const body = raw.body as { items?: unknown } | null;
      if (!body || typeof body !== 'object' || !Array.isArray(body.items)) return fail('contract');

      const incidents: Incident[] = [];
      let emptyCount = 0;
      for (const item of body.items) {
        const parsed = parseRemoteResource(item);
        if (!parsed.ok) return fail('contract');
        const mapped = toDomain(parsed.value);
        if (!mapped.ok) return mapped;
        if (mapped.value === null) emptyCount += 1;
        else incidents.push(mapped.value);
      }
      return { ok: true, value: { incidents, emptyCount } };
    },

    async getIncident(id: string): Promise<ClientResult<IncidentDetail>> {
      const raw = await request('detail', 'GET', `/v1/incidents/${encodeURIComponent(id)}`);
      if (!raw.ok) return raw.result;
      const parsed = parseRemoteResource(raw.body);
      if (!parsed.ok) return fail('contract');
      return toDomain(parsed.value);
    },

    /** `idempotencyKey` debe ser estable entre reintentos de la misma operación. */
    async createIncident(
      input: NewIncident,
      idempotencyKey: string,
    ): Promise<ClientResult<CreatedIncident>> {
      const raw = await request('create', 'POST', '/v1/incidents', {
        body: input,
        idempotencyKey,
      });
      if (!raw.ok) return raw.result;
      const body = raw.body as { incident?: unknown; duplicate?: unknown } | null;
      if (!body || typeof body !== 'object' || typeof body.duplicate !== 'boolean') {
        return fail('contract');
      }
      const parsed = parseRemoteResource(body.incident);
      if (!parsed.ok) return fail('contract');
      const mapped = toDomain(parsed.value);
      if (!mapped.ok) return mapped;
      return { ok: true, value: { incident: mapped.value, duplicate: body.duplicate } };
    },
  };
}

export type IncidentClient = ReturnType<typeof createIncidentClient>;
