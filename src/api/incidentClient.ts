import { parseRemoteResource, redactForTelemetry } from '../course-evaluation';
import type { Incident } from '../domain/incident';
import type { IncidentCategory } from '../campusops/contracts';
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

type Session = { actorId: string; accessToken: string };

const DEFAULT_TIMEOUT_MS = 5000;

type Raw = { ok: true; status: number; body: unknown } | { ok: false; result: ClientResult<never> };

export function createIncidentClient(config: IncidentClientConfig) {
  const doFetch: FetchLike = config.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let session: Session | null = null;

  function record(event: Record<string, unknown>) {
    config.log?.(redactForTelemetry(event) as Record<string, unknown>);
  }

  async function request(
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
      const raw = await request('login', 'POST', '/v1/session/login', {
        body: { actorId },
        authenticated: false,
      });
      if (!raw.ok) return raw.result;
      const body = raw.body as Record<string, unknown> | null;
      if (
        !body ||
        typeof body !== 'object' ||
        typeof body.accessToken !== 'string' ||
        typeof body.actorId !== 'string'
      ) {
        return fail('contract');
      }
      session = { actorId: body.actorId, accessToken: body.accessToken };
      return { ok: true, value: { actorId: body.actorId } };
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
