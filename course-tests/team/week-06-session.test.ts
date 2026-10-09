import { createIncidentClient, type FetchLike } from '../../src/api/incidentClient';
import { canRetry, transition, type SessionStatus } from '../../src/domain/session';
import type { SecureStoragePort } from '../../src/infrastructure/secureStorage';

// Pruebas básicas de semana 06 (German): refresh compartido, reintento limitado,
// fallo de renovación, logout y logs sin tokens. Sin red ni esperas reales.

const DTO = {
  id: 'campus-inc-001',
  version: 1,
  status: 'assigned',
  payload: {
    category: 'connectivity',
    description: 'Sin conexion ficticia',
    location: 'Edificio de prueba A',
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
  },
};

function memoryStorage() {
  const data = new Map<string, string>();
  const port: SecureStoragePort = {
    async setItem(key, value) {
      data.set(key, value);
    },
    async getItem(key) {
      return data.get(key) ?? null;
    },
    async deleteItem(key) {
      data.delete(key);
    },
  };
  return { port, data };
}

/** Backend simulado: sólo acepta el token 'access-new'; el login entrega 'access-old'. */
function fakeBackend(options: { refreshOk?: boolean; alwaysUnauthorized?: boolean } = {}) {
  const calls: string[] = [];
  const impl: FetchLike = async (url, init) => {
    const path = url.replace('http://stub', '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    const reply = (status: number, body: unknown) => ({
      ok: status < 300,
      status,
      text: async () => JSON.stringify(body),
    });
    if (path === '/v1/session/login') {
      return reply(200, {
        actorId: 'reporter-1',
        accessToken: 'access-old',
        refreshToken: 'refresh-0',
      });
    }
    if (path === '/v1/session/refresh') {
      return options.refreshOk === false
        ? reply(401, { code: 'invalid_grant' })
        : reply(200, { accessToken: 'access-new', refreshToken: 'refresh-1' });
    }
    const auth = init?.headers?.authorization;
    if (options.alwaysUnauthorized || auth !== 'Bearer access-new') {
      return reply(401, { code: 'unauthorized' });
    }
    return reply(200, DTO);
  };
  return { impl, calls };
}

async function loggedIn(backendOptions?: Parameters<typeof fakeBackend>[0]) {
  const backend = fakeBackend(backendOptions);
  const storage = memoryStorage();
  const logs: Record<string, unknown>[] = [];
  const states: SessionStatus[] = [];
  const client = createIncidentClient({
    baseUrl: 'http://stub',
    fetchImpl: backend.impl,
    storage: storage.port,
    log: (event) => logs.push({ ...event }),
    onSessionChange: (status) => states.push(status),
  });
  expect((await client.login('reporter-1')).ok).toBe(true);
  return { client, backend, storage, logs, states };
}

const refreshCalls = (calls: string[]) =>
  calls.filter((call) => call === 'POST /v1/session/refresh').length;

describe('reglas de sesión (domain/session)', () => {
  test('la renovación fallida regresa a no autenticado', () => {
    let state = transition('unauthenticated', 'loginStarted');
    state = transition(state, 'loginSucceeded');
    state = transition(state, 'unauthorized');
    state = transition(state, 'refreshStarted');
    expect(state).toBe('refreshing');
    expect(transition(state, 'refreshFailed')).toBe('unauthenticated');
  });

  test('eventos inválidos no cambian el estado y el reintento se limita a 1', () => {
    expect(transition('unauthenticated', 'refreshSucceeded')).toBe('unauthenticated');
    expect(canRetry(0)).toBe(true);
    expect(canRetry(1)).toBe(false);
  });
});

describe('cliente con renovación de sesión', () => {
  test('tres 401 simultáneos hacen UNA renovación y cada petición se reintenta una vez', async () => {
    const { client, backend, states } = await loggedIn();
    const results = await Promise.all([
      client.getIncident('a'),
      client.getIncident('b'),
      client.getIncident('c'),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(refreshCalls(backend.calls)).toBe(1);
    const gets = backend.calls.filter((call) => call.startsWith('GET'));
    expect(gets).toHaveLength(6); // 3 intentos fallidos + 3 reintentos
    expect(states[states.length - 1]).toBe('authenticated');
  });

  test('un 401 tardío con token ya renovado no dispara otra renovación', async () => {
    const { client, backend } = await loggedIn();
    await client.getIncident('a'); // renueva
    expect(refreshCalls(backend.calls)).toBe(1);
    expect((await client.getIncident('b')).ok).toBe(true);
    expect(refreshCalls(backend.calls)).toBe(1);
  });

  test('si el reintento vuelve a dar 401 no hay bucle (máximo 1 reintento)', async () => {
    const { client, backend } = await loggedIn({ alwaysUnauthorized: true });
    const result = await client.getIncident('a');
    expect(result.ok).toBe(false);
    expect(refreshCalls(backend.calls)).toBe(1);
    expect(backend.calls.filter((call) => call.startsWith('GET'))).toHaveLength(2);
  });

  test('si la renovación falla borra sesión y tokens y avisa a la app', async () => {
    const { client, backend, storage, states } = await loggedIn({ refreshOk: false });
    expect(storage.data.size).toBeGreaterThan(0);
    const results = await Promise.all([client.getIncident('a'), client.getIncident('b')]);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(refreshCalls(backend.calls)).toBe(1);
    expect(storage.data.size).toBe(0);
    expect(client.getSessionStatus()).toBe('unauthenticated');
    expect(states[states.length - 1]).toBe('unauthenticated');
    // sin sesión no se vuelve a intentar nada contra la red
    const before = backend.calls.length;
    await client.getIncident('c');
    expect(backend.calls).toHaveLength(before);
  });
});

describe('logout y logs', () => {
  test('logout borra los tokens del almacenamiento seguro y de memoria', async () => {
    const { client, backend, storage } = await loggedIn();
    expect(storage.data.get('campusops.accessToken')).toBe('access-old');
    await client.logout();
    expect(storage.data.size).toBe(0);
    expect(client.getSessionStatus()).toBe('unauthenticated');
    const before = backend.calls.length;
    expect((await client.getIncident('a')).ok).toBe(false);
    expect(backend.calls).toHaveLength(before);
  });

  test('los tokens nunca aparecen en los logs', async () => {
    const { client, logs } = await loggedIn();
    await client.getIncident('a');
    await client.logout();
    const dump = JSON.stringify(logs);
    for (const secret of ['access-old', 'access-new', 'refresh-0', 'refresh-1']) {
      expect(dump).not.toContain(secret);
    }
  });
});
