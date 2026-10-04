import { createIncidentClient, type FetchLike } from '../../src/api/incidentClient';
import { mapIncidentDto } from '../../src/api/incidentMapper';
import { IncidentClientError } from '../../src/api/clientErrors';
import { createRemoteIncidentRepository } from '../../src/infrastructure/remoteIncidentRepository';

type Reply = { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> };

const VALID_PAYLOAD = {
  category: 'connectivity',
  description: 'Sin conexión ficticia',
  location: 'Edificio de prueba A',
  reporterId: 'reporter-1',
  assignedTechnicianId: 'technician-1',
};
const VALID_DTO = { id: 'campus-inc-001', version: 1, status: 'assigned', payload: VALID_PAYLOAD };

/** Doble de fetch predecible: responde según la ruta; nunca toca la red. */
function stubFetch(routes: Record<string, Reply | (() => Promise<never>)>) {
  const calls: { url: string; init?: Parameters<FetchLike>[1] }[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const path = url.replace('http://stub', '');
    const key = `${init?.method ?? 'GET'} ${path}`;
    const route = routes[key];
    if (!route) throw new Error(`unrouted ${key}`);
    if (typeof route === 'function') return route();
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => route.headers?.[name.toLowerCase()] ?? null },
      text: async () => route.raw ?? JSON.stringify(route.body),
    };
  };
  return { impl, calls };
}

const LOGIN: Reply = {
  body: { actorId: 'reporter-1', role: 'reporter', accessToken: 'course-valid-token' },
};

async function loggedIn(routes: Record<string, Reply | (() => Promise<never>)>, extra = {}) {
  const stub = stubFetch({ 'POST /v1/session/login': LOGIN, ...routes });
  const client = createIncidentClient({
    baseUrl: 'http://stub',
    fetchImpl: stub.impl,
    timeoutMs: 50,
    ...extra,
  });
  await client.login('reporter-1');
  return { client, stub };
}

describe('contrato: lista, detalle y creación', () => {
  test('lista válida: el DTO se convierte en objetos de dominio', async () => {
    const { client } = await loggedIn({ 'GET /v1/incidents': { body: { items: [VALID_DTO] } } });
    const result = await client.listIncidents();
    expect(result).toEqual({
      ok: true,
      value: {
        emptyCount: 0,
        incidents: [
          {
            id: 'campus-inc-001',
            category: 'connectivity',
            description: 'Sin conexión ficticia',
            location: 'Edificio de prueba A',
            status: 'assigned',
            reporterId: 'reporter-1',
            assignedTechnicianId: 'technician-1',
          },
        ],
      },
    });
    // Los campos del sobre remoto (version, payload) no se filtran al dominio.
    if (result.ok) expect(result.value.incidents[0]).not.toHaveProperty('payload');
  });

  test('detalle válido envía las credenciales por cabecera', async () => {
    const { client, stub } = await loggedIn({
      'GET /v1/incidents/campus-inc-001': { body: VALID_DTO },
    });
    const result = await client.getIncident('campus-inc-001');
    expect(result.ok && result.value?.id).toBe('campus-inc-001');
    const headers = stub.calls[stub.calls.length - 1]?.init?.headers;
    expect(headers?.authorization).toBe('Bearer course-valid-token');
    expect(headers?.['x-course-actor']).toBe('reporter-1');
  });

  test('crear incidencia envía Idempotency-Key estable y valida la respuesta', async () => {
    const { client, stub } = await loggedIn({
      'POST /v1/incidents': {
        status: 201,
        body: { incident: VALID_DTO, operationId: 'op-12345678', duplicate: false },
      },
    });
    const input = {
      category: 'connectivity' as const,
      description: 'Sin conexión ficticia',
      location: 'Edificio de prueba A',
    };
    const result = await client.createIncident(input, 'op-12345678');
    expect(result.ok && result.value.duplicate).toBe(false);
    const last = stub.calls[stub.calls.length - 1];
    expect(last?.init?.headers?.['idempotency-key']).toBe('op-12345678');
    expect(JSON.parse(last?.init?.body ?? '{}')).toEqual(input);
  });

  test('sin sesión no se hace ninguna llamada y el error es unauthorized', async () => {
    const stub = stubFetch({});
    const client = createIncidentClient({ baseUrl: 'http://stub', fetchImpl: stub.impl });
    const result = await client.listIncidents();
    expect(result).toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
    expect(stub.calls).toHaveLength(0);
  });
});

describe('datos vacíos vs inválidos', () => {
  test('payload null válido: detalle devuelve null sin inventar datos', async () => {
    const { client } = await loggedIn({
      'GET /v1/incidents/r-1': { body: { id: 'r-1', version: 1, status: 'open', payload: null } },
    });
    expect(await client.getIncident('r-1')).toEqual({ ok: true, value: null });
  });

  test('payload null en lista: se omite y se cuenta, no es un error', async () => {
    const { client } = await loggedIn({
      'GET /v1/incidents': {
        body: { items: [{ id: 'r-1', version: 1, status: 'open', payload: null }, VALID_DTO] },
      },
    });
    const result = await client.listIncidents();
    expect(result.ok && result.value.emptyCount).toBe(1);
    expect(result.ok && result.value.incidents).toHaveLength(1);
  });

  test.each([
    ['sobre sin version', { id: 'x', status: 'open', payload: null }],
    ['version como texto', { ...VALID_DTO, version: '1' }],
    ['payload arreglo', { ...VALID_DTO, payload: [] }],
    ['payload sin category', { ...VALID_DTO, payload: { ...VALID_PAYLOAD, category: undefined } }],
    ['category desconocida', { ...VALID_DTO, payload: { ...VALID_PAYLOAD, category: 'ufo' } }],
    ['description vacía', { ...VALID_DTO, payload: { ...VALID_PAYLOAD, description: '  ' } }],
    ['status desconocido', { ...VALID_DTO, status: 'archived' }],
  ])('objeto malformado (%s) => error de contrato, no datos', async (_name, dto) => {
    const { client } = await loggedIn({ 'GET /v1/incidents/x': { body: dto } });
    expect(await client.getIncident('x')).toMatchObject({ ok: false, error: { kind: 'contract' } });
  });

  test('lista con un elemento corrupto se rechaza completa', async () => {
    const { client } = await loggedIn({
      'GET /v1/incidents': { body: { items: [VALID_DTO, { id: '', version: 1 }] } },
    });
    expect(await client.listIncidents()).toMatchObject({ ok: false, error: { kind: 'contract' } });
  });

  test.each([[{}], [{ items: 'no' }], [null], [[]]])(
    'lista con sobre inválido %p => contract',
    async (body) => {
      const { client } = await loggedIn({ 'GET /v1/incidents': { body } });
      expect(await client.listIncidents()).toMatchObject({
        ok: false,
        error: { kind: 'contract' },
      });
    },
  );

  test('mapIncidentDto distingue empty de invalid', () => {
    expect(mapIncidentDto({ id: 'a', version: 1, status: 'open', payload: null }).kind).toBe(
      'empty',
    );
    expect(mapIncidentDto({ id: 'a', version: 1, status: 'open', payload: {} }).kind).toBe(
      'invalid',
    );
  });
});

describe('errores tipados', () => {
  test('JSON ilegible => malformed', async () => {
    const { client } = await loggedIn({ 'GET /v1/incidents': { raw: '{"items": [}' } });
    expect(await client.listIncidents()).toMatchObject({ ok: false, error: { kind: 'malformed' } });
  });

  test('HTTP 500 => server', async () => {
    const { client } = await loggedIn({
      'GET /v1/incidents': { status: 500, body: { code: 'controlled_failure' } },
    });
    expect(await client.listIncidents()).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'server', status: 500 }),
    });
  });

  test('HTTP 429 conserva Retry-After', async () => {
    const { client } = await loggedIn({
      'GET /v1/incidents': { status: 429, body: {}, headers: { 'retry-after': '1' } },
    });
    expect(await client.listIncidents()).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', retryAfterMs: 1000 },
    });
  });

  test.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'rejected'],
  ])('HTTP %i => %s', async (status, kind) => {
    const { client } = await loggedIn({ 'GET /v1/incidents': { status, body: {} } });
    expect(await client.listIncidents()).toMatchObject({ ok: false, error: { kind } });
  });

  test('timeout: la petición lenta se corta y se aborta la señal', async () => {
    let signal: AbortSignal | undefined;
    // fetch que nunca responde y captura la señal de aborto
    const slow = createIncidentClient({
      baseUrl: 'http://stub',
      timeoutMs: 20,
      fetchImpl: (url, init) => {
        if (url.endsWith('/login')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ actorId: 'reporter-1', accessToken: 't' }),
          });
        }
        signal = init?.signal;
        return new Promise(() => undefined);
      },
    });
    await slow.login('reporter-1');
    expect(await slow.listIncidents()).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'timeout' }),
    });
    expect(signal?.aborted).toBe(true);
  });

  test('fallo de red => network (sin excepción sin controlar)', async () => {
    const { client } = await loggedIn({
      'GET /v1/incidents': () => Promise.reject(new Error('ECONNREFUSED 10.0.0.1 secret')),
    });
    const result = await client.listIncidents();
    expect(result).toMatchObject({ ok: false, error: { kind: 'network' } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  test('login fallido => error y no queda sesión', async () => {
    const stub = stubFetch({ 'POST /v1/session/login': { status: 401, body: {} } });
    const client = createIncidentClient({ baseUrl: 'http://stub', fetchImpl: stub.impl });
    expect(await client.login('intruso')).toMatchObject({
      ok: false,
      error: { kind: 'unauthorized' },
    });
    expect(await client.listIncidents()).toMatchObject({ ok: false });
    expect(stub.calls).toHaveLength(1);
  });
});

describe('logs sanitizados', () => {
  test('los eventos no contienen tokens, cuerpos ni datos de la incidencia', async () => {
    const events: unknown[] = [];
    const { client } = await loggedIn(
      { 'GET /v1/incidents': { body: { items: [VALID_DTO] } } },
      { log: (event: unknown) => events.push(event) },
    );
    await client.listIncidents();
    const text = JSON.stringify(events);
    expect(events.length).toBeGreaterThan(0);
    expect(text).not.toContain('course-valid-token');
    expect(text).not.toContain('Sin conexión ficticia');
    expect(text).not.toContain('reporter-1');
  });
});

describe('repositorio remoto (frontera con el dominio)', () => {
  test('propaga IncidentClientError tipado en vez de datos inventados', async () => {
    const { client } = await loggedIn({
      'GET /v1/incidents': { status: 500, body: {} },
    });
    const repository = createRemoteIncidentRepository(client, 'reporter-1');
    await expect(repository.listIncidents()).rejects.toMatchObject({
      name: 'IncidentClientError',
      kind: 'server',
    });
    await expect(repository.listIncidents()).rejects.toBeInstanceOf(IncidentClientError);
  });

  test('payload null en detalle llega como null al dominio', async () => {
    const { client } = await loggedIn({
      'GET /v1/incidents/r-1': { body: { id: 'r-1', version: 1, status: 'open', payload: null } },
    });
    const repository = createRemoteIncidentRepository(client, 'reporter-1');
    await expect(repository.getIncidentById('r-1')).resolves.toBeNull();
  });
});
