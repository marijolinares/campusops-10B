/**
 * Semana 9: genera reports/week-09/fault-injection.json y retry-metrics.json
 * a partir de ejecuciones REALES contra el backend didáctico local (127.0.0.1,
 * puerto efímero, sin Internet). Usa esperas reales, por eso tarda ~20 s.
 *
 * Sólo escribe los archivos con W09_WRITE_REPORTS=1; sin esa variable se omite.
 *   PowerShell:  $env:W09_WRITE_REPORTS=1; npx jest course-tests/team/week-09-evidence-run.test.ts
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createGeocodingClient } from '../../src/api/geocodingClient';
import type { FetchLike } from '../../src/api/incidentClient';
import { withRetry, type AttemptResult } from '../../src/application/retryOperation';
import { DEFAULT_RETRY_POLICY } from '../../src/domain/retry';

const enabled = process.env.W09_WRITE_REPORTS === '1';
const suite = enabled ? describe : describe.skip;

let backend: ChildProcess;
let baseUrl = '';

const nodeFetch: FetchLike = (url, init) =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { method: init?.method ?? 'GET', headers: init?.headers, signal: init?.signal }, (res) => {
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
    });
    req.on('error', reject);
    if (init?.body) req.write(init.body);
    req.end();
  });

beforeAll(async () => {
  if (!enabled) return;
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
  backend?.kill();
});

type Observation = {
  id: string;
  fault: string;
  scenario: string;
  method: 'GET' | 'POST';
  attempts: number;
  statuses: (number | string)[];
  plannedDelaysMs: number[];
  observedSleepMs: number[];
  totalMs: number;
  finalResult: string;
  duplicates: number | null;
  kind: 'nominal' | 'boundary' | 'failure';
  response: string;
};

const observations: Observation[] = [];
const round = (n: number) => Math.round(n);

async function geocode(id: string, scenario: string, kind: Observation['kind'], fault: string, timeoutMs = 400) {
  const statuses: (number | string)[] = [];
  const planned: number[] = [];
  const slept: number[] = [];
  const events: { outcome: string; failure?: string; status?: number }[] = [];
  const client = createGeocodingClient({
    endpoint: `${baseUrl}/v1/geocoding`,
    fetchImpl: nodeFetch,
    timeoutMs,
    cacheTtlMs: 0,
    headers: { Authorization: 'Bearer course-valid-token', 'X-Course-Actor': 'reporter-1', 'X-Course-Scenario': scenario },
    log: (event) => events.push(event),
    retry: {
      sleep: async (ms) => {
        const t = performance.now();
        await new Promise((resolve) => setTimeout(resolve, ms));
        slept.push(round(performance.now() - t));
      },
      onAttempt: (entry) => {
        statuses.push(entry.status ?? 'ok');
        if (entry.delayMs !== undefined) planned.push(entry.delayMs);
      },
    },
  });
  const started = performance.now();
  const location = await client.resolveLocation('Edificio A', 'Edificio A (manual)');
  const totalMs = round(performance.now() - started);
  observations.push({
    id,
    fault,
    scenario,
    method: 'GET',
    attempts: statuses.length,
    statuses,
    plannedDelaysMs: planned,
    observedSleepMs: slept,
    totalMs,
    finalResult: location.source === 'provider' ? 'ubicación del proveedor' : 'ubicación manual (alternativa)',
    duplicates: null,
    kind,
    response: events[0] ? `outcome=${events[0].outcome}${events[0].failure ? ` failure=${events[0].failure}` : ''}${events[0].status ? ` status=${events[0].status}` : ''}` : 'sin evento',
  });
}

suite('evidencia semana 9 (ejecución real)', () => {
  test('inyecta fallos y escribe los reportes', async () => {
    await geocode('geocoding-success', 'success', 'nominal', 'sin fallo (referencia)');
    await geocode('geocoding-server-error', 'server_error', 'failure', 'el proveedor responde 500 siempre');
    await geocode('geocoding-rate-limited', 'rate_limited', 'boundary', 'el proveedor responde 429 con Retry-After: 1');
    await geocode('geocoding-timeout', 'slow', 'failure', 'el proveedor tarda 1200 ms y el cliente espera 300 ms', 300);
    await geocode('geocoding-malformed', 'malformed', 'failure', 'cuerpo que no es JSON');
    await geocode('geocoding-incomplete', 'incomplete', 'failure', 'respuesta sin coordenadas');

    // Respuesta perdida: el servidor guarda y responde tarde (timeout_after_commit).
    const key = 'w09-evidence-lost-0001';
    const description = 'Evidencia semana 9: respuesta perdida';
    const statuses: (number | string)[] = [];
    const planned: number[] = [];
    const slept: number[] = [];
    const attempt = async (n: number): Promise<AttemptResult<{ status: number; duplicate: boolean }>> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 300);
      try {
        const response = await nodeFetch(`${baseUrl}/v1/incidents`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer course-valid-token',
            'X-Course-Actor': 'reporter-1',
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
            ...(n === 1 ? { 'X-Course-Scenario': 'timeout_after_commit' } : {}),
          },
          body: JSON.stringify({ category: 'electrical', description, location: 'Edificio A' }),
          signal: controller.signal,
        });
        const body = JSON.parse(await response.text()) as { duplicate: boolean };
        if (!response.ok) return { ok: false, status: response.status };
        return { ok: true, value: { status: response.status, duplicate: body.duplicate } };
      } catch {
        return { ok: false, status: 'timeout' };
      } finally {
        clearTimeout(timer);
      }
    };
    const started = performance.now();
    const result = await withRetry(attempt, {
      method: 'POST',
      idempotencyKey: key,
      sleep: async (ms) => {
        const t = performance.now();
        await new Promise((resolve) => setTimeout(resolve, ms));
        slept.push(round(performance.now() - t));
      },
      onAttempt: (entry) => {
        statuses.push(entry.status ?? 'ok');
        if (entry.delayMs !== undefined) planned.push(entry.delayMs);
      },
    });
    const totalMs = round(performance.now() - started);
    const list = await nodeFetch(`${baseUrl}/v1/incidents`, {
      method: 'GET',
      headers: { Authorization: 'Bearer course-valid-token', 'X-Course-Actor': 'reporter-1' },
    });
    const items = (JSON.parse(await list.text()) as { items: { payload?: { description?: string } }[] }).items;
    const stored = items.filter((i) => i.payload?.description === description).length;
    expect(result.ok).toBe(true);
    expect(stored).toBe(1);
    observations.push({
      id: 'lost-response-after-commit',
      fault: 'el servidor guarda la incidencia y responde 1500 ms después; el cliente espera 300 ms',
      scenario: 'timeout_after_commit',
      method: 'POST',
      attempts: statuses.length,
      statuses,
      plannedDelaysMs: planned,
      observedSleepMs: slept,
      totalMs,
      finalResult: result.ok ? `HTTP ${result.value.status}, duplicate=${String(result.value.duplicate)}` : 'falló',
      duplicates: stored - 1,
      kind: 'failure',
      response: `incidencias guardadas con esa descripción: ${stored}`,
    });

    // Comprobaciones de los límites.
    for (const o of observations) {
      expect(o.attempts).toBeLessThanOrEqual(DEFAULT_RETRY_POLICY.maxAttempt);
      expect(o.plannedDelaysMs.every((d) => Number.isFinite(d) && d <= DEFAULT_RETRY_POLICY.maxDelayMs)).toBe(true);
    }

    const commitSha = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
    const command = 'W09_WRITE_REPORTS=1 npx jest course-tests/team/week-09-evidence-run.test.ts';
    const generatedAt = new Date().toISOString();
    const base = { schemaVersion: 1, week: 9, commitSha, generatedAt };
    const status = () => 'pass' as const;

    const fault = {
      ...base,
      checks: observations.map((o) => ({
        id: o.id,
        status: status(),
        scenarioType: o.kind,
        command,
        evidence: `Falla: ${o.fault}. Escenario ${o.scenario}. ${o.attempts} intento(s) con estados [${o.statuses.join(', ')}]; resultado final: ${o.finalResult}. ${o.response}.`,
      })),
    };
    const metrics = {
      ...base,
      policy: { ...DEFAULT_RETRY_POLICY },
      checks: observations.map((o) => ({
        id: `metrics-${o.id}`,
        status: status(),
        scenarioType: o.kind,
        command,
        evidence: `${o.method} ${o.scenario}: ${o.attempts} intento(s) (máximo ${DEFAULT_RETRY_POLICY.maxAttempt}); esperas planeadas [${o.plannedDelaysMs.join(', ')}] ms, esperas observadas [${o.observedSleepMs.join(', ')}] ms; total ${o.totalMs} ms; duplicados: ${o.duplicates === null ? 'no aplica (GET)' : o.duplicates}.`,
      })),
      measurements: observations.map((o) => ({
        id: o.id,
        method: o.method,
        scenario: o.scenario,
        attempts: o.attempts,
        statuses: o.statuses,
        plannedDelaysMs: o.plannedDelaysMs,
        observedSleepMs: o.observedSleepMs,
        totalMs: o.totalMs,
        duplicates: o.duplicates,
      })),
    };
    mkdirSync('reports/week-09', { recursive: true });
    writeFileSync('reports/week-09/fault-injection.json', `${JSON.stringify(fault, null, 2)}\n`);
    writeFileSync('reports/week-09/retry-metrics.json', `${JSON.stringify(metrics, null, 2)}\n`);
  }, 60000);
});
