/**
 * Reglas de sincronización (semana 08). Dominio puro: sin red ni almacenamiento.
 *
 * - `mergeRecords` compara base / local / remoto campo por campo (tres vías).
 * - `dedupeByOperationId` descarta operaciones repetidas por su operationId.
 * Ninguna función modifica sus argumentos.
 */

export type SyncRecordLike = Readonly<{
  id: string;
  version: number;
  fields: Readonly<Record<string, unknown>>;
}>;

export type MergeOutcome =
  | Readonly<{ kind: 'merged'; fields: Readonly<Record<string, unknown>> }>
  | Readonly<{ kind: 'conflict'; fields: readonly string[] }>;

/** Igualdad estructural simple para valores JSON (objetos, arreglos y primitivos). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => key in right && sameValue(left[key], right[key]));
}

export function mergeRecords(
  base: SyncRecordLike,
  local: SyncRecordLike,
  remote: SyncRecordLike,
): MergeOutcome {
  const keys = new Set([
    ...Object.keys(base.fields),
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ]);
  const merged: Record<string, unknown> = {};
  const conflicts: string[] = [];

  for (const key of keys) {
    const b = base.fields[key];
    const l = local.fields[key];
    const r = remote.fields[key];
    const localChanged = !sameValue(b, l);
    const remoteChanged = !sameValue(b, r);

    let value: unknown;
    if (localChanged && remoteChanged && !sameValue(l, r)) {
      conflicts.push(key); // los dos lados cambiaron el mismo campo de forma distinta
      continue;
    } else if (localChanged) {
      value = l; // solo cambió local (o ambos cambiaron igual)
    } else if (remoteChanged) {
      value = r; // solo cambió el remoto
    } else {
      value = b;
    }
    if (value !== undefined) merged[key] = value;
  }

  return conflicts.length > 0
    ? { kind: 'conflict', fields: conflicts.sort() }
    : { kind: 'merged', fields: merged };
}

export function dedupeByOperationId<T extends Readonly<{ operationId: string }>>(
  operations: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const operation of operations) {
    if (seen.has(operation.operationId)) continue;
    seen.add(operation.operationId);
    result.push(operation);
  }
  return result;
}