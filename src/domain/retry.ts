/**
 * Semana 09 — política de reintentos (función pura).
 * Sin reloj, sin azar y sin I/O: la misma entrada produce siempre la misma decisión.
 */
export type RetryInput = Readonly<{
  method: 'GET' | 'POST';
  status: number | 'timeout';
  attempt: number; // intento que acaba de fallar, empezando en 1
  retryAfterMs?: number;
  idempotencyKey?: string;
}>;

export type RetryDecision = Readonly<{
  retry: boolean;
  delayMs: number;
  requiresStableIdempotencyKey: boolean;
}>;

export type RetryPolicy = Readonly<{
  /** Desde este intento ya no se reintenta (publicado: 4). */
  maxAttempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
}>;

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempt: 4,
  baseDelayMs: 500,
  maxDelayMs: 5000,
};

function isRetryableFailure(status: number | 'timeout'): boolean {
  return status === 'timeout' || status === 429 || (status >= 500 && status <= 599);
}

function isValidRetryAfter(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

const NO_RETRY: RetryDecision = { retry: false, delayMs: 0, requiresStableIdempotencyKey: false };

export function decideRetry(
  input: RetryInput,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): RetryDecision {
  const { method, status, attempt, retryAfterMs, idempotencyKey } = input;

  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= policy.maxAttempt) return NO_RETRY;
  if (!isRetryableFailure(status)) return NO_RETRY;

  // Un POST sólo se repite con identidad estable de operación.
  if (method === 'POST' && (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '')) {
    return { retry: false, delayMs: 0, requiresStableIdempotencyKey: true };
  }

  // Retry-After válido manda; si excede el tope, no se espera indefinidamente: se informa.
  if (isValidRetryAfter(retryAfterMs)) {
    if (retryAfterMs > policy.maxDelayMs) return NO_RETRY;
    return { retry: true, delayMs: retryAfterMs, requiresStableIdempotencyKey: false };
  }

  // Espera progresiva: base * 2^(attempt-1), siempre finita y acotada.
  const delayMs = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  return { retry: true, delayMs, requiresStableIdempotencyKey: false };
}