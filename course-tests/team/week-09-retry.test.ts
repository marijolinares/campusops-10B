import { planRetry } from '../../src/course-evaluation';
import { decideRetry } from '../../src/domain/retry';
import { withRetry, type AttemptResult, type RetryLogEntry } from '../../src/application/retryOperation';

describe('planRetry', () => {
  test('espera progresiva y acotada', () => {
    const delays = [1, 2, 3].map((attempt) => planRetry({ method: 'GET', status: 503, attempt }).delayMs);
    expect(delays).toEqual([500, 1000, 2000]);
  });

  test('no reintenta desde el intento 4 ni con intentos inválidos', () => {
    for (const attempt of [4, 5, 0, -1, 1.5, NaN]) {
      expect(planRetry({ method: 'GET', status: 'timeout', attempt }).retry).toBe(false);
    }
  });

  test('respeta Retry-After válido; ignora inválido; no espera sin fin', () => {
    expect(planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs: 800 }).delayMs).toBe(800);
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(planRetry({ method: 'GET', status: 429, attempt: 2, retryAfterMs: bad }).delayMs).toBe(1000);
    }
    expect(planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs: 3_600_000 })).toEqual({
      retry: false, delayMs: 0, requiresStableIdempotencyKey: false,
    });
  });

  test('no reintenta errores definitivos', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(planRetry({ method: 'GET', status, attempt: 1 }).retry).toBe(false);
    }
  });

  test('POST sólo con clave estable', () => {
    expect(planRetry({ method: 'POST', status: 503, attempt: 1 })).toEqual({
      retry: false, delayMs: 0, requiresStableIdempotencyKey: true,
    });
    expect(planRetry({ method: 'POST', status: 503, attempt: 1, idempotencyKey: '  ' }).retry).toBe(false);
    expect(planRetry({ method: 'POST', status: 'timeout', attempt: 1, idempotencyKey: 'k1' }).retry).toBe(true);
  });

  test('límites configurables', () => {
    const policy = { maxAttempt: 2, baseDelayMs: 10, maxDelayMs: 15 };
    expect(decideRetry({ method: 'GET', status: 500, attempt: 1 }, policy).delayMs).toBe(10);
    expect(decideRetry({ method: 'GET', status: 500, attempt: 2 }, policy).retry).toBe(false);
  });
});

describe('withRetry', () => {
  const fail = (status: number | 'timeout', retryAfterMs?: number): AttemptResult<string> => ({
    ok: false, status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });

  test('se detiene tras 4 intentos con fallo persistente (sin bucle infinito)', async () => {
    const sleeps: number[] = [];
    const op = jest.fn(async () => fail(503));
    const result = await withRetry(op, { method: 'GET', sleep: async (ms) => void sleeps.push(ms) });
    expect(result.ok).toBe(false);
    expect(op).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([500, 1000, 2000]);
  });

  test('se recupera y respeta Retry-After', async () => {
    const sleeps: number[] = [];
    const results = [fail(429, 800), { ok: true, value: 'listo' } as const];
    const result = await withRetry(async () => results.shift()!, {
      method: 'GET', sleep: async (ms) => void sleeps.push(ms),
    });
    expect(result).toEqual({ ok: true, value: 'listo' });
    expect(sleeps).toEqual([800]);
  });

  test('POST sin clave no se repite', async () => {
    const op = jest.fn(async () => fail('timeout'));
    await withRetry(op, { method: 'POST', sleep: async () => undefined });
    expect(op).toHaveBeenCalledTimes(1);
  });

  test('registra intentos sanitizados', async () => {
    const log: RetryLogEntry[] = [];
    const results = [fail('timeout'), { ok: true, value: 'x' } as const];
    await withRetry(async () => results.shift()!, {
      method: 'POST', idempotencyKey: 'k1', sleep: async () => undefined, onAttempt: (e) => log.push(e),
    });
    expect(log).toEqual([
      { attempt: 1, outcome: 'retry', status: 'timeout', delayMs: 500 },
      { attempt: 2, outcome: 'ok' },
    ]);
  });
});