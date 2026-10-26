/**
 * Modelo local sin conexión (semana 08). Dominio puro: sin almacenamiento ni red.
 *
 * Esquema v1 (anterior): dos claves separadas (incidencias y cola) con nombres
 * de campo antiguos. Esquema v2 (actual): un solo documento versionado.
 * Ver docs/data-model.md.
 */
import type { IncidentCategory, IncidentStatus } from '../campusops/contracts';

export const SCHEMA_VERSION = 2 as const;

export type StoredIncident = Readonly<{
  id: string;
  version: number;
  category: IncidentCategory;
  description: string;
  location: string;
  status: IncidentStatus;
  reporterId: string;
  assignedTechnicianId: string | null;
}>;

/** Acciones que un técnico puede dejar pendientes sin conexión. */
export type QueuedAction = 'start' | 'comment' | 'add_evidence' | 'resolve';

export type OperationStatus = 'pending' | 'conflict';

export type PendingOperation = Readonly<{
  /** Identidad estable: se crea una vez y no cambia al reintentar ni al reiniciar. */
  operationId: string;
  incidentId: string;
  /** Versión de la incidencia que el autor conocía al crear la operación. */
  baseVersion: number;
  actorId: string;
  action: QueuedAction;
  /** Contenido: notas, diagnóstico o referencia a una fotografía pendiente. */
  payload: Readonly<Record<string, unknown>>;
  createdAt: string;
  status: OperationStatus;
  /** Sólo si status === 'conflict': por qué no se pudo aplicar. */
  conflict?: Readonly<{ fields: readonly string[]; remoteVersion: number; detectedAt: string }>;
}>;

export type LocalDocumentV2 = Readonly<{
  schemaVersion: typeof SCHEMA_VERSION;
  incidents: readonly StoredIncident[];
  queue: readonly PendingOperation[];
}>;

// --- Esquema anterior (v1) -------------------------------------------------

export type LegacyIncidentV1 = Readonly<{
  id: string;
  category: IncidentCategory;
  description: string;
  location: string;
  status: IncidentStatus;
  reporterId: string;
  assignedTechnicianId: string | null;
  version?: number;
}>;

export type LegacyQueueItemV1 = Readonly<{
  id: string;
  incidentId: string;
  author: string;
  kind: 'start' | 'note' | 'photo' | 'resolve';
  text?: string;
  photoUri?: string;
  baseVersion?: number;
  createdAt?: string;
}>;

// --- Validación -------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function isStoredIncident(value: unknown): value is StoredIncident {
  return (
    isObject(value) &&
    isText(value.id) &&
    Number.isInteger(value.version) &&
    (value.version as number) >= 0 &&
    isText(value.status) &&
    isText(value.reporterId) &&
    (value.assignedTechnicianId === null || isText(value.assignedTechnicianId))
  );
}

export function isPendingOperation(value: unknown): value is PendingOperation {
  return (
    isObject(value) &&
    isText(value.operationId) &&
    isText(value.incidentId) &&
    isText(value.actorId) &&
    isText(value.action) &&
    Number.isInteger(value.baseVersion) &&
    isObject(value.payload) &&
    (value.status === 'pending' || value.status === 'conflict')
  );
}

/** Devuelve el documento v2 sólo si es íntegro; nunca repara en silencio. */
export function parseDocumentV2(raw: string | null): LocalDocumentV2 | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(value) || value.schemaVersion !== SCHEMA_VERSION) return null;
  if (!Array.isArray(value.incidents) || !Array.isArray(value.queue)) return null;
  if (!value.incidents.every(isStoredIncident) || !value.queue.every(isPendingOperation)) {
    return null;
  }
  const ids = new Set<string>();
  for (const operation of value.queue as PendingOperation[]) {
    if (ids.has(operation.operationId)) return null; // operationId duplicado = documento dañado
    ids.add(operation.operationId);
  }
  return value as unknown as LocalDocumentV2;
}

/** Igualdad por contenido JSON con claves ordenadas (sin importar el orden de propiedades). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
