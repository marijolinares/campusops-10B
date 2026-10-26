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

function parse(text: string): any {
  return JSON.parse(text);
}

const START = { action: 'start', baseVersion: 1 };

describe('paso 6: la misma operación no se aplica dos veces', () => {
  test('repetir la misma operación con la misma clave no repite el efecto', async () => {
    const first = await call('technician-1', 'POST', `/v1/incidents/${INCIDENT_ID}/actions`, START, 'w08-start-0001');
    expect(first.status).toBe(201);
    expect(parse(first.text).duplicate).toBe(false);

    const retry = await call('technician-1', 'POST', `/v1/incidents/${INCIDENT_ID}/actions`, START, 'w08-start-0001');
    expect(retry.status).toBe(200);
    expect(parse(retry.text).duplicate).toBe(true);
    expect(parse(retry.text).incident.version).toBe(parse(first.text).incident.version);

    const current = parse((await call('technician-1', 'GET', `/v1/incidents/${INCIDENT_ID}`)).text);
    expect(current.version).toBe(2); // una sola vez, no 3
    const applied = current.payload.history.filter((h: { operationId: string }) => h.operationId === 'w08-start-0001');
    expect(applied).toHaveLength(1);
  });

  test('la misma clave con contenido distinto es error y no cambia nada', async () => {
    const reused = await call(
      'technician-1',
      'POST',
      `/v1/incidents/${INCIDENT_ID}/actions`,
      { action: 'comment', text: 'otra cosa', baseVersion: 2 },
      'w08-start-0001',
    );
    expect(reused.status).toBe(409);
    expect(parse(reused.text).code).toBe('idempotency_key_reused');
    const current = parse((await call('technician-1', 'GET', `/v1/incidents/${INCIDENT_ID}`)).text);
    expect(current.version).toBe(2);
  });

  test('sin clave de idempotencia, o con una demasiado corta, se rechaza', async () => {
    const body = { action: 'comment', text: 'nota', baseVersion: 2 };
    const missing = await call('technician-1', 'POST', `/v1/incidents/${INCIDENT_ID}/actions`, body);
    const short = await call('technician-1', 'POST', `/v1/incidents/${INCIDENT_ID}/actions`, body, 'corta');
    expect(missing.status).toBe(400);
    expect(short.status).toBe(400);
  });
});

describe('paso 4 contra el servidor real: reasignación mientras el técnico estaba sin conexión', () => {
  test('el servidor rechaza la operación vieja y conserva la asignación remota', async () => {
    const reassign = await call(
      'coordinator-1',
      'POST',
      `/v1/incidents/${INCIDENT_ID}/actions`,
      { action: 'assign', technicianId: 'technician-2', baseVersion: 2 },
      'w08-assign-0001',
    );
    expect(reassign.status).toBe(201);

    const stale = await call(
      'technician-1',
      'POST',
      `/v1/incidents/${INCIDENT_ID}/actions`,
      { action: 'start', baseVersion: 2 },
      'w08-start-0002',
    );
    expect([403, 409]).toContain(stale.status); // ya no es su incidencia: no se aplica

    const current = parse((await call('coordinator-1', 'GET', `/v1/incidents/${INCIDENT_ID}`)).text);
    expect(current.payload.assignedTechnicianId).toBe('technician-2');
    expect(current.version).toBe(3);
  });
});
