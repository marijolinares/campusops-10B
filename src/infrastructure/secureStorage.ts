/**
 * Secure storage adapter for CampusOps.
 *
 * Wraps expo-secure-store for sensitive data (tokens, session info)
 * and provides a sanitized logging layer to prevent data leakage.
 *
 * Design decisions (linked to threat model T-03, T-04):
 * - Tokens and credentials → SecureStore (encrypted, keychain-backed)
 * - Non-sensitive app state → AsyncStorage (faster, not encrypted)
 * - All error reporting passes through redactForTelemetry before logging
 *
 * Risk: SecureStore is unavailable on Expo Go for web; fallback is
 * in-memory only (acceptable for dev, not production).
 */

import { redactForTelemetry } from '../course-evaluation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecureStoragePort {
  /** Store a value securely. */
  setItem(key: string, value: string): Promise<void>;
  /** Retrieve a securely stored value. */
  getItem(key: string): Promise<string | null>;
  /** Remove a securely stored value. */
  deleteItem(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory fallback (for testing / environments without SecureStore)
// ---------------------------------------------------------------------------

const memoryStore = new Map<string, string>();

export function createInMemorySecureStorage(): SecureStoragePort {
  return {
    async setItem(key: string, value: string) {
      memoryStore.set(key, value);
    },
    async getItem(key: string) {
      return memoryStore.get(key) ?? null;
    },
    async deleteItem(key: string) {
      memoryStore.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Sanitized logger — prevents sensitive data from reaching logs/telemetry
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log a message with automatic sanitization of context data.
 * Sensitive fields are replaced with [REDACTED] per CAMPUSOPS_API.md contract.
 *
 * @param level - Severity level
 * @param message - Human-readable description (must not contain PII)
 * @param context - Optional object that will be deep-redacted before logging
 */
export function sanitizedLog(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  const safeContext = context ? redactForTelemetry(context) : undefined;

  // In production, this would send to a telemetry service.
  // In development, we write to console with the redacted context.
  if (__DEV__) {
    const fn = level === 'error' ? console.error
      : level === 'warn' ? console.warn
      : console.log;
    fn(`[CampusOps:${level}] ${message}`, safeContext ?? '');
  }
}

// ---------------------------------------------------------------------------
// Secure error reporter — wraps errors without leaking sensitive info
// ---------------------------------------------------------------------------

/**
 * Report an error safely. The error message is kept but any context
 * attached to it is sanitized through redactForTelemetry.
 *
 * Connected to T-03: logs must not become a copy of sensitive data.
 */
export function reportErrorSafely(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const errorMessage =
    error instanceof Error ? error.message : 'Unknown error';

  sanitizedLog('error', errorMessage, {
    ...context,
    // Only technical fields — no tokens, names, locations
    timestamp: new Date().toISOString(),
  });
}
