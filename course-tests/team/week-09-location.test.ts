/**
 * Semana 09 — ubicación con alternativa manual contra el backend didáctico local
 * (127.0.0.1, puerto efímero, sin Internet). Cubre éxito, datos incompletos o inválidos,
 * timeout real, 429, 5xx y desconexión, además de caché y el doble controlado del proveedor.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { createGeocodingClient, normalizeNominatim, type GeocodingEvent } from '../../src/api/geocodingClient';
import type { FetchLike } from '../../src/api/incidentClient';
import { selectIncidentLocation } from '../../src/course-evaluation';

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

function clientFor(scenario: string, extra: { timeoutMs?: number; cacheTtlMs?: number; now?: () => number; log?: (e: GeocodingEvent) => void; endpoint?: string } = {}) {
  let calls = 0;
  const counting: FetchLike = (url, init) => {
    calls += 1;
    return nodeFetch(url, init);
  };
  const client = createGeocodingClient({
    endpoint: extra.endpoint ?? `${baseUrl}/v1/geocoding`,
    fetchImpl: counting,
    headers: { Authorization: 'Bearer course-valid-token', 'X-Course-Actor': 'reporter-1', 'X-Course-Scenario': scenario },
    timeoutMs: extra.timeoutMs ?? 2000,
    ...(extra.cacheTtlMs !== undefined ? { cacheTtlMs: extra.cacheTtlMs } : {}),
    ...(extra.now ? { now: extra.now } : {}),
    ...(extra.log ? { log: extra.log } : {}),
  });
  return { client, calls: () => calls };
}

describe('selectIncidentLocation (reglas del contrato)', () => {
  const manual = 'Edificio manual';
  test('acepta proveedor válido, incluidos los límites y el cero', () => {
    expect(selectIncidentLocation({ label: 'Polo', latitude: -90, longitude: 180 }, manual)).toEqual({ source: 'provider', label: 'Polo', latitude: -90, longitude: 180 });
    expect(selectIncidentLocation({ label: 'Cero', latitude: 0, longitude: 0 }, manual).source).toBe('provider');
  });
  test.each([
    ['null', null],
    ['indefinido', undefined],
    ['arreglo', []],
    ['texto', 'Zona'],
    ['error como dato', { status: 429 }],
    ['sin coordenadas', { label: 'Incompleta' }],
    ['latitud fuera de rango', { label: 'X', latitude: 90.0001, longitude: 0 }],
    ['longitud fuera de rango', { label: 'X', latitude: 0, longitude: -180.5 }],
    ['coordenada NaN', { label: 'X', latitude: NaN, longitude: 0 }],
    ['coordenada Infinity', { label: 'X', latitude: 0, longitude: Infinity }],
    ['coordenada como texto', { label: 'X', latitude: '19.4', longitude: '-99.1' }],
    ['etiqueta vacía', { label: '   ', latitude: 1, longitude: 1 }],
    ['etiqueta no textual', { label: 7, latitude: 1, longitude: 1 }],
  ])('cae a manual sin inventar coordenadas: %s', (_name, value) => {
    const result = selectIncidentLocation(value, manual);
    expect(result).toEqual({ source: 'manual', label: manual });
    expect('latitude' in result).toBe(false);
  });
});

describe('adaptador de geocodificación contra el doble controlado', () => {
  test('éxito: devuelve la ubicación del proveedor y registra evento sanitizado', async () => {
    const events: GeocodingEvent[] = [];
    const { client } = clientFor('success', { log: (e) => events.push(e) });
    const location = await client.resolveLocation('Edificio de prueba A', 'Edificio manual');
    expect(location).toEqual({ source: 'provider', label: 'Edificio de prueba A', latitude: 0, longitude: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'provider', status: 200 });
    expect(JSON.stringify(events)).not.toContain('Edificio');
  });

  test.each(['incomplete', 'nullable', 'invalid_coordinates'])('datos incompletos o inválidos (%s) caen a manual', async (scenario) => {
    const { client } = clientFor(scenario);
    expect(await client.resolveLocation('Edificio de prueba A', 'Edificio manual')).toEqual({ source: 'manual', label: 'Edificio manual' });
  });

  test('cuerpo malformado cae a manual', async () => {
    const { client } = clientFor('malformed');
    expect(await client.resolveLocation('Edificio de prueba A', 'Edificio manual')).toEqual({ source: 'manual', label: 'Edificio manual' });
  });

  test('429 cae a manual y registra rate_limited', async () => {
    const events: GeocodingEvent[] = [];
    const { client } = clientFor('rate_limited', { log: (e) => events.push(e) });
    expect(await client.resolveLocation('Edificio de prueba A', 'Edificio manual')).toEqual({ source: 'manual', label: 'Edificio manual' });
    expect(events[0]).toMatchObject({ outcome: 'manual', failure: 'rate_limited', status: 429 });
  });

  test('500 cae a manual y registra server_error', async () => {
    const events: GeocodingEvent[] = [];
    const { client } = clientFor('server_error', { log: (e) => events.push(e) });
    expect(await client.resolveLocation('Edificio de prueba A', 'Edificio manual')).toEqual({ source: 'manual', label: 'Edificio manual' });
    expect(events[0]).toMatchObject({ failure: 'server_error', status: 500 });
  });

  test('timeout real: aborta a los 300 ms (el doble tarda 1200 ms) y cae a manual', async () => {
    const events: GeocodingEvent[] = [];
    const { client } = clientFor('slow', { timeoutMs: 300, log: (e) => events.push(e) });
    const started = Date.now();
    expect(await client.resolveLocation('Edificio de prueba A', 'Edificio manual')).toEqual({ source: 'manual', label: 'Edificio manual' });
    expect(Date.now() - started).toBeLessThan(1100);
    expect(events[0]).toMatchObject({ failure: 'timeout' });
  });

  test('desconexión: puerto cerrado cae a manual y registra network', async () => {
    const events: GeocodingEvent[] = [];
    const { client } = clientFor('success', { endpoint: 'http://127.0.0.1:1/v1/geocoding', log: (e) => events.push(e) });
    expect(await client.resolveLocation('Edificio de prueba A', 'Edificio manual')).toEqual({ source: 'manual', label: 'Edificio manual' });
    expect(events[0]).toMatchObject({ failure: 'network' });
  });

  test('consulta vacía no llama al proveedor', async () => {
    const { client, calls } = clientFor('success');
    expect(await client.resolveLocation('   ', 'Edificio manual')).toEqual({ source: 'manual', label: 'Edificio manual' });
    expect(calls()).toBe(0);
  });
});

describe('caché', () => {
  test('la segunda consulta igual usa caché y no llama al proveedor', async () => {
    const events: GeocodingEvent[] = [];
    const { client, calls } = clientFor('success', { log: (e) => events.push(e) });
    await client.resolveLocation('Edificio de prueba A', 'm');
    const second = await client.resolveLocation('  edificio DE prueba a ', 'm');
    expect(second.source).toBe('provider');
    expect(calls()).toBe(1);
    expect(events.map((e) => e.outcome)).toEqual(['provider', 'cache_hit']);
  });

  test('una entrada vencida se vuelve a consultar', async () => {
    let clock = 1000;
    const { client, calls } = clientFor('success', { cacheTtlMs: 5000, now: () => clock });
    await client.resolveLocation('Zona 1', 'm');
    clock += 4999;
    await client.resolveLocation('Zona 1', 'm');
    expect(calls()).toBe(1);
    clock += 2;
    await client.resolveLocation('Zona 1', 'm');
    expect(calls()).toBe(2);
  });

  test('los fallos no se cachean: tras un 429 se puede volver a intentar', async () => {
    const { client, calls } = clientFor('rate_limited');
    await client.resolveLocation('Zona 1', 'm');
    await client.resolveLocation('Zona 1', 'm');
    expect(calls()).toBe(2);
    expect(client.cacheSize()).toBe(0);
  });

  test('las respuestas incompletas tampoco se cachean y la caché se puede limpiar', async () => {
    const incomplete = clientFor('incomplete');
    await incomplete.client.resolveLocation('Zona 1', 'm');
    expect(incomplete.client.cacheSize()).toBe(0);
    const ok = clientFor('success');
    await ok.client.resolveLocation('Zona 1', 'm');
    expect(ok.client.cacheSize()).toBe(1);
    ok.client.clearCache();
    expect(ok.client.cacheSize()).toBe(0);
  });

  test('cacheTtlMs 0 desactiva la caché', async () => {
    const { client, calls } = clientFor('success', { cacheTtlMs: 0 });
    await client.resolveLocation('Zona 1', 'm');
    await client.resolveLocation('Zona 1', 'm');
    expect(calls()).toBe(2);
  });
});

describe('normalizador de Nominatim', () => {
  test('convierte lat/lon de texto a número', () => {
    const body = [{ display_name: 'Palacio de Bellas Artes', lat: '19.4355009', lon: '-99.1412585' }];
    expect(selectIncidentLocation(normalizeNominatim(body), 'm')).toEqual({
      source: 'provider', label: 'Palacio de Bellas Artes', latitude: 19.4355009, longitude: -99.1412585,
    });
  });
  test.each([[[]], [null], [[null]], [[{ display_name: 'X' }]], [[{ display_name: 'X', lat: '', lon: '1' }]]])('sin resultado utilizable cae a manual: %j', (body) => {
    expect(selectIncidentLocation(normalizeNominatim(body), 'm')).toEqual({ source: 'manual', label: 'm' });
  });
});
