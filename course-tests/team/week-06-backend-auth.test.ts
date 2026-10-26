/**
 * Semana 06 — autorización real contra el backend didáctico local
 * (127.0.0.1, puerto efímero, sin Internet). Cubre los 3 roles:
 * reportante, técnico y coordinador. Los actores son fixtures públicos.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { FetchLike } from '../../src/api/incidentClient';

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

const INCIDENT_ID = 'campus-inc-001';

async function call(
  actor: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = {
    Authorization: 'Bearer course-valid-token',
    'X-Course-Actor': actor,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await nodeFetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, text: await response.text() };
}

function sees(text: string): boolean {
  return text.includes(INCIDENT_ID);
}

describe('login sintético', () => {
  test('el login devuelve una sesión para un actor público', async () => {
    const response = await nodeFetch(`${baseUrl}/v1/session/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorId: 'technician-1' }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('accessToken');
  });
});

describe('visibilidad por rol (nominal)', () => {
  test('el reportante dueño ve su incidencia', async () => {
    const res = await call('reporter-1', 'GET', '/v1/incidents');
    expect(res.status).toBe(200);
    expect(sees(res.text)).toBe(true);
  });

  test('el técnico asignado ve su asignación', async () => {
    const res = await call('technician-1', 'GET', '/v1/incidents');
    expect(res.status).toBe(200);
    expect(sees(res.text)).toBe(true);
  });

  test('el coordinador ve todas las incidencias', async () => {
    const res = await call('coordinator-1', 'GET', '/v1/incidents');
    expect(res.status).toBe(200);
    expect(sees(res.text)).toBe(true);
  });
});

describe('aislamiento entre actores del mismo rol (límite)', () => {
  test('otro reportante no ve la incidencia ajena en la lista', async () => {
    const res = await call('reporter-2', 'GET', '/v1/incidents');
    expect(res.status).toBe(200);
    expect(sees(res.text)).toBe(false);
  });

  test('otro técnico no ve una asignación ajena en la lista', async () => {
    const res = await call('technician-2', 'GET', '/v1/incidents');
    expect(res.status).toBe(200);
    expect(sees(res.text)).toBe(false);
  });

  test('otro reportante no puede leer el detalle ajeno', async () => {
    const res = await call('reporter-2', 'GET', `/v1/incidents/${INCIDENT_ID}`);
    expect([403, 404]).toContain(res.status);
    expect(sees(res.text)).toBe(false);
  });
});

describe('acciones rechazadas con 403 no modifican el recurso (falla)', () => {
  test('un reportante no puede priorizar y el recurso queda igual', async () => {
    const before = await call('coordinator-1', 'GET', `/v1/incidents/${INCIDENT_ID}`);
    const res = await call(
      'reporter-1',
      'POST',
      `/v1/incidents/${INCIDENT_ID}/actions`,
      { action: 'prioritize', baseVersion: 1, priority: 'high' },
      'w06-reporter-prioritize',
    );
    expect(res.status).toBe(403);
    const after = await call('coordinator-1', 'GET', `/v1/incidents/${INCIDENT_ID}`);
    expect(after.text).toBe(before.text);
  });

  test('un técnico no asignado no puede iniciar la incidencia', async () => {
    const before = await call('coordinator-1', 'GET', `/v1/incidents/${INCIDENT_ID}`);
    const res = await call(
      'technician-2',
      'POST',
      `/v1/incidents/${INCIDENT_ID}/actions`,
      { action: 'start', baseVersion: 1 },
      'w06-tech2-start',
    );
    expect(res.status).toBe(403);
    const after = await call('coordinator-1', 'GET', `/v1/incidents/${INCIDENT_ID}`);
    expect(after.text).toBe(before.text);
  });

  test('un técnico no puede cerrar (solo coordinación)', async () => {
    const res = await call(
      'technician-1',
      'POST',
      `/v1/incidents/${INCIDENT_ID}/actions`,
      { action: 'close', baseVersion: 1 },
      'w06-tech1-close',
    );
    expect(res.status).toBe(403);
  });
});

describe('acción permitida y versión obsoleta', () => {
  test('el técnico asignado inicia y luego una versión obsoleta da 409', async () => {
    const started = await call(
      'technician-1',
      'POST',
      `/v1/incidents/${INCIDENT_ID}/actions`,
      { action: 'start', baseVersion: 1 },
      'w06-tech1-start',
    );
     expect(started.status).toBe(201);

    const stale = await call(
      'technician-1',
      'POST',
      `/v1/incidents/${INCIDENT_ID}/actions`,
      { action: 'start', baseVersion: 1 },
      'w06-tech1-start-stale',
    );
    expect(stale.status).toBe(409);
  });
});