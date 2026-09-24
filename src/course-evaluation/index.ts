import type {
  AuthEvent,
  JsonObject,
  ParseResult,
  PermissionEvent,
  RemoteResponse,
  SyncRecord,
} from './contracts';
import type { IncidentLocation } from '../campusops/contracts';

function pending(name: string): never {
  throw new Error(`${name} must be implemented in the assigned week`);
}

const SENSITIVE_KEYS = new Set([
  'authorization',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'email',
  'displayName',
  'name',
  'userId',
  'reporterId',
  'technicianId',
  'assignedTechnicianId',
  'location',
  'latitude',
  'longitude',
  'photos',
  'evidence',
  'internalComments',
  'assignmentHistory',
]);

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (
      typeof obj[key] === 'object' &&
      obj[key] !== null &&
      !Array.isArray(obj[key])
    ) {
      result[key] = redactObject(obj[key] as Record<string, unknown>);
    } else if (Array.isArray(obj[key])) {
      result[key] = (obj[key] as unknown[]).map((item) =>
        typeof item === 'object' && item !== null && !Array.isArray(item)
          ? redactObject(item as Record<string, unknown>)
          : item,
      );
    } else {
      result[key] = obj[key];
    }
  }
  return result;
}

export function redactForTelemetry(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactForTelemetry(item));
  }
  return redactObject(input as Record<string, unknown>);
}

export function parseRemoteResource(_input: unknown): ParseResult {
  return pending('parseRemoteResource');
}

export function coordinateRefresh(_events: readonly AuthEvent[]): Readonly<{
  status: 'anonymous' | 'authenticated';
  activeGeneration: number | null;
  refreshCalls: number;
  retriedRequestIds: readonly string[];
  persistedToken: string | null;
}> {
  return pending('coordinateRefresh');
}

export function resolveSync(
  _base: SyncRecord,
  _local: SyncRecord,
  _remote: SyncRecord,
): Readonly<{ kind: 'merged'; fields: JsonObject } | { kind: 'conflict'; fields: readonly string[] }> {
  return pending('resolveSync');
}

export function deduplicateOperations<T extends Readonly<{ operationId: string }>>(
  _operations: readonly T[],
): readonly T[] {
  return pending('deduplicateOperations');
}

export function planRetry(_input: Readonly<{
  method: 'GET' | 'POST';
  status: number | 'timeout';
  attempt: number;
  retryAfterMs?: number;
  idempotencyKey?: string;
}>): Readonly<{ retry: boolean; delayMs: number; requiresStableIdempotencyKey: boolean }> {
  return pending('planRetry');
}

export function reduceRemoteResponses(_input: Readonly<{
  activeRequestId: string;
  responses: readonly RemoteResponse[];
}>): Readonly<{ state: 'success' | 'error' | 'loading'; value?: unknown; error?: string }> {
  return pending('reduceRemoteResponses');
}

export function reducePermissionLifecycle(
  _events: readonly PermissionEvent[],
): Readonly<{ status: 'available' | 'denied' | 'blocked'; resourceActive: boolean }> {
  return pending('reducePermissionLifecycle');
}

/** Week 09: see docs/CAMPUSOPS_API.md; this is not a completed solution. */
export function selectIncidentLocation(_provider: unknown, _manualLabel: string): IncidentLocation {
  return pending('selectIncidentLocation');
}
