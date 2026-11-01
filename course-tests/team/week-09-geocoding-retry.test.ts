/** Semana 9: el adaptador de geocodificación aplica la política de reintento (sin esperas reales). */
import { createGeocodingClient } from '../../src/api/geocodingClient';
import type { FetchLike } from '../../src/api/incidentClient';
import type { RetryLogEntry } from '../../src/application/retryOperation';

const GOOD = JSON.stringify({ label: 'Edificio A', latitude: 20.5, longitude: -100.4 });

function reply(status: number, body = '', retryAfter?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null) },
    text: async () => body,
  };
}

function setup(responses: (ReturnType<typeof reply> | 'throw')[]) {
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    const next = responses[Math.min(calls, responses.length - 1)]!;
    calls += 1;
    if (next === 'throw') throw new Error('red');
    return next;
  };
  const sleeps: number[] = [];
  const log: RetryLogEntry[] = [];
  const client = createGeocodingClient({
    endpoint: 'http://doble.local/v1/geocoding',
    fetchImpl,
    retry: { sleep: async (ms) => void sleeps.push(ms), onAttempt: (e) => log.push(e) },
  });
  return { client, sleeps, log, calls: () => calls };
}

describe('geocodificación con reintentos', () => {
  test('503 y luego éxito: reintenta una vez con la primera espera', async () => {
    const t = setup([reply(503), reply(200, GOOD)]);
    const location = await t.client.resolveLocation('edificio a', 'Edificio A');
    expect(location.source).toBe('provider');
    expect(t.calls()).toBe(2);
    expect(t.sleeps).toEqual([500]);
  });

  test('429 con Retry-After válido: espera lo que pide el proveedor', async () => {
    const t = setup([reply(429, '', '2'), reply(200, GOOD)]);
    await t.client.resolveLocation('edificio a', 'Edificio A');
    expect(t.sleeps).toEqual([2000]);
  });

  test('Retry-After por encima del tope: no reintenta y cae a ubicación manual', async () => {
    const t = setup([reply(429, '', '120')]);
    const location = await t.client.resolveLocation('edificio a', 'Edificio A');
    expect(location).toEqual({ source: 'manual', label: 'Edificio A' });
    expect(t.calls()).toBe(1);
  });

  test('fallo permanente (500 siempre): se detiene en el límite y usa la alternativa manual', async () => {
    const t = setup([reply(500)]);
    const location = await t.client.resolveLocation('edificio a', 'Edificio A');
    expect(location.source).toBe('manual');
    expect(t.calls()).toBe(4); // intentos 1..4; desde el 4 ya no se reintenta
    expect(t.sleeps).toEqual([500, 1000, 2000]);
    expect(t.log.at(-1)).toMatchObject({ attempt: 4, outcome: 'gave_up' });
  });

  test('404 y cuerpo ilegible no se reintentan', async () => {
    const a = setup([reply(404)]);
    await a.client.resolveLocation('x', 'Manual');
    expect(a.calls()).toBe(1);
    const b = setup([reply(200, 'no es json')]);
    await b.client.resolveLocation('x', 'Manual');
    expect(b.calls()).toBe(1);
  });

  test('sin la opción retry el comportamiento anterior no cambia (un solo intento)', async () => {
    let calls = 0;
    const client = createGeocodingClient({
      endpoint: 'http://doble.local/v1/geocoding',
      fetchImpl: async () => {
        calls += 1;
        return reply(500);
      },
    });
    await client.resolveLocation('x', 'Manual');
    expect(calls).toBe(1);
  });
});
