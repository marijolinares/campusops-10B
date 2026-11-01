/**
 * Semana 09 — respuesta perdida contra el backend didáctico local
 * (127.0.0.1, puerto efímero, sin Internet). Escenario `timeout_after_commit`:
 * el servidor guarda la incidencia y responde tarde; el cliente se rinde por
 * timeout y reintenta con la MISMA clave y el MISMO contenido.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { FetchLike } from '../../src/api/incidentClient';
import { withRetry, type AttemptResult, type RetryLogEntry } from '../../src/application/retryOperation';

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


type Created = { incident: { id: string; version: number }; duplicate: boolean };

const NEW_INCIDENT = {
  category: 'electrical',
  description: 'Lampara apagada en pasillo (prueba semana 9)',
  location: 'Edificio A',
};

/** Un intento: POST con clave estable y límite de tiempo propio del cliente. */
async function attemptCreate(
  key: string | undefined,
  scenario: string,
  clientTimeoutMs: number,
): Promise<AttemptResult<{ status: number; body: Created }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clientTimeoutMs);
  try {
    const headers: Record<string, string> = {
      Authorization: 'Bearer course-valid-token',
      'X-Course-Actor': 'reporter-1',
      'Content-Type': 'application/json',
      'X-Course-Scenario': scenario,
    };
    if (key) headers['Idempotency-Key'] = key;
    const response = await nodeFetch(`${baseUrl}/v1/incidents`, {
      method: 'POST',
      headers,
      body: JSON.stringify(NEW_INCIDENT),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, value: { status: response.status, body: JSON.parse(text) as Created } };
  } catch {
    return { ok: false, status: 'timeout' };
  } finally {
    clearTimeout(timer);
  }
}

async function countCreated(): Promise<number> {
  const response = await nodeFetch(`${baseUrl}/v1/incidents`, {
    method: 'GET',
    headers: { Authorization: 'Bearer course-valid-token', 'X-Course-Actor': 'reporter-1' },
  });
  const body = JSON.parse(await response.text()) as { items: { payload?: { description?: string } }[] };
  return body.items.filter((i) => i.payload?.description === NEW_INCIDENT.description).length;
}

describe('semana 9: respuesta perdida (timeout_after_commit)', () => {
  test('el reintento con la misma clave devuelve duplicate:true y no crea otra incidencia', async () => {
    const log: RetryLogEntry[] = [];
    const sleeps: number[] = [];
    const key = 'w09-lost-0001';

    const result = await withRetry(
      (attempt) => attemptCreate(key, attempt === 1 ? 'timeout_after_commit' : 'success', 300),
      {
        method: 'POST',
        idempotencyKey: key,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        onAttempt: (entry) => log.push(entry),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe(200); // 200 = repetición reconocida
    expect(result.value.body.duplicate).toBe(true);
    expect(log.map((e) => e.outcome)).toEqual(['retry', 'ok']);
    expect(log[0]?.status).toBe('timeout');
    expect(sleeps).toEqual([500]); // primera espera de la política
    expect(await countCreated()).toBe(1); // el servidor guardó una sola vez
  }, 10000);

  test('sin clave estable un POST no se reintenta (evita duplicados)', async () => {
    const log: RetryLogEntry[] = [];
    const result = await withRetry(
      () => attemptCreate(undefined, 'server_error', 300),
      { method: 'POST', sleep: async () => undefined, onAttempt: (e) => log.push(e) },
    );
    expect(result.ok).toBe(false);
    expect(log).toEqual([{ attempt: 1, outcome: 'gave_up', status: 500 }]);
  });
});
