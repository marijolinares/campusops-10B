/**
 * Pruebas contra el backend didáctico local (127.0.0.1, puerto efímero, sin Internet).
 * Reproducen las variantes publicadas: success, nullable, malformed, server_error, slow.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { createIncidentClient, type FetchLike, type Scenario } from '../../src/api/incidentClient';

let backend: ChildProcess;
let baseUrl = '';

const nodeFetch: FetchLike = (url, init) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method: init?.method ?? 'GET', headers: init?.headers, signal: init?.signal },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () =>
          resolve({
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            status: res.statusCode ?? 0,
            headers: {
              get: (name: string) => {
                const value = res.headers[name.toLowerCase()];
                return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
              },
            },
            text: async () => data,
          }),
        );
      },
    );
    req.on('error', reject);
    if (init?.body) req.write(init.body);
    req.end();
  });

beforeAll(async () => {
  backend = spawn(process.execPath, ['course-backend/server.mjs'], {
    env: { ...process.env, COURSE_BACKEND_PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  baseUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('backend did not start')), 8000);
    backend.stdout?.on('data', (chunk: Buffer) => {
      const match = /listening at (http:\/\/\S+)/.exec(chunk.toString());
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    backend.on('error', reject);
  });
}, 15000);

afterAll(() => {
  backend.kill();
});

async function clientFor(scenario: Scenario, timeoutMs = 3000) {
  const client = createIncidentClient({ baseUrl, fetchImpl: nodeFetch, timeoutMs, scenario });
  const login = await createIncidentClient({ baseUrl, fetchImpl: nodeFetch }).login('reporter-1');
  expect(login.ok).toBe(true);
  // la sesión se inicia con el mismo cliente para conservar el escenario
  await client.login('reporter-1');
  return client;
}

describe('variantes del backend didáctico', () => {
  test('success: lista y detalle válidos', async () => {
    const client = await clientFor('success');
    const list = await client.listIncidents();
    expect(list.ok && list.value.incidents.map((i) => i.id)).toContain('campus-inc-001');
    const detail = await client.getIncident('campus-inc-001');
    expect(detail.ok && detail.value?.category).toBe('connectivity');
  });

  test('success: crear es idempotente con la misma clave (sin duplicados)', async () => {
    const client = await clientFor('success');
    const input = {
      category: 'water' as const,
      description: 'Fuga ficticia',
      location: 'Edificio de prueba B',
    };
    const first = await client.createIncident(input, 'w5-key-0001');
    const second = await client.createIncident(input, 'w5-key-0001');
    expect(first.ok && first.value.duplicate).toBe(false);
    expect(second.ok && second.value.duplicate).toBe(true);
    expect(first.ok && first.value.incident?.id).toBe(second.ok && second.value.incident?.id);
  });

  test('nullable: el detalle devuelve null y la lista cuenta entradas vacías', async () => {
    const client = await clientFor('nullable');
    expect(await client.getIncident('campus-inc-001')).toEqual({ ok: true, value: null });
    const list = await client.listIncidents();
    expect(list.ok && list.value.emptyCount).toBeGreaterThan(0);
  });

  test('malformed: JSON ilegible => malformed', async () => {
    const client = await clientFor('malformed');
    expect(await client.listIncidents()).toMatchObject({
      ok: false,
      error: { kind: 'malformed' },
    });
  });

  test('server_error: 500 => server', async () => {
    const client = await clientFor('server_error');
    expect(await client.listIncidents()).toMatchObject({
      ok: false,
      error: { kind: 'server', status: 500 },
    });
  });

  test('slow con timeout menor a 1200 ms => timeout', async () => {
    const client = await clientFor('slow', 300);
    expect(await client.listIncidents()).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });

  test('slow con timeout mayor => éxito (el límite es configurable)', async () => {
    const client = await clientFor('slow', 4000);
    expect((await client.listIncidents()).ok).toBe(true);
  });

  test('crear con datos inválidos => rejected (422), sin excepción', async () => {
    const client = await clientFor('success');
    const result = await client.createIncident(
      { category: 'water', description: '   ', location: 'x' },
      'w5-key-0002',
    );
    expect(result).toMatchObject({ ok: false, error: { kind: 'rejected', status: 422 } });
  });
});
