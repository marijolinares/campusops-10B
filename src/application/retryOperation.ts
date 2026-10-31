import { decideRetry, DEFAULT_RETRY_POLICY, type RetryPolicy } from '../domain/retry';

export type AttemptResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; status: number | 'timeout'; retryAfterMs?: number }>;

export type RetryLogEntry = Readonly<{
  attempt: number;
  outcome: 'ok' | 'retry' | 'gave_up';
  status?: number | 'timeout';
  delayMs?: number;
}>;

export type RetryOptions = Readonly<{
  method: 'GET' | 'POST';
  idempotencyKey?: string;
  policy?: RetryPolicy;
  sleep: (ms: number) => Promise<void>; // inyectado: las pruebas no esperan de verdad
  onAttempt?: (entry: RetryLogEntry) => void; // sólo datos sanitizados, sin cuerpos ni tokens
}>;

/**
 * Ejecuta `operation` y la repite según `decideRetry`.
 * La misma `idempotencyKey` se usa en todos los intentos; el contenido no cambia.
 * Termina siempre: el límite de intentos viene de la política.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<AttemptResult<T>>,
  options: RetryOptions,
): Promise<AttemptResult<T>> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  for (let attempt = 1; ; attempt += 1) {
    const result = await operation(attempt);
    if (result.ok) {
      options.onAttempt?.({ attempt, outcome: 'ok' });
      return result;
    }
    const decision = decideRetry(
      {
        method: options.method,
        status: result.status,
        attempt,
        ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      },
      policy,
    );
    if (!decision.retry) {
      options.onAttempt?.({ attempt, outcome: 'gave_up', status: result.status });
      return result;
    }
    options.onAttempt?.({ attempt, outcome: 'retry', status: result.status, delayMs: decision.delayMs });
    await options.sleep(decision.delayMs);
  }
}