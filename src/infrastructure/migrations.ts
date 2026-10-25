/**
 * Migración v1 → v2 con commit atómico (semana 08). Ver docs/data-model.md.
 *
 * Esquema v1: dos claves (`campusops.incidents`, `campusops.queue`).
 * Esquema v2: UNA clave (`campusops.db.v2`) con documento versionado.
 *
 * Reglas de integridad:
 *  1. Los datos v1 NO se tocan hasta que el documento v2 está escrito y se
 *     relee íntegro. La clave v2 es el punto de confirmación (commit).
 *  2. Una falla antes del commit deja sólo v1 (rollback implícito y completo).
 *  3. Una falla después del commit deja v2 íntegro + restos v1; al reabrir se
 *     detecta v2 válido y se limpian los restos (recuperación hacia adelante).
 *  4. Un v2 ilegible con v1 presente se descarta y se vuelve a migrar; un v2
 *     ilegible SIN v1 nunca se borra: se informa el error.
 */
import {
  SCHEMA_VERSION,
  parseDocumentV2,
  type LegacyIncidentV1,
  type LegacyQueueItemV1,
  type LocalDocumentV2,
  type PendingOperation,
  type QueuedAction,
  type StoredIncident,
} from '../domain/offlineModel';
import type { KeyValueStorage } from './keyValueStorage';

export const STORAGE_KEYS = {
  legacyIncidents: 'campusops.incidents',
  legacyQueue: 'campusops.queue',
  documentV2: 'campusops.db.v2',
} as const;

/** Puntos donde las pruebas inyectan una falla. */
export type MigrationFaultPoint = 'mid-transform' | 'before-commit' | 'after-commit';

export type MigrationOutcome =
  | 'fresh' // no había datos: se creó un documento v2 vacío
  | 'already-current' // ya estaba en v2
  | 'migrated' // v1 → v2 completado
  | 'cleaned-after-commit' // v2 íntegro; se limpiaron restos v1 de una falla posterior al commit
  | 'discarded-unreadable-v2'; // v2 dañado con v1 disponible: se migró de nuevo desde v1

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly code: 'injected_fault' | 'legacy_unreadable' | 'unrecoverable_store',
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export type MigrationOptions = Readonly<{ faultAt?: MigrationFaultPoint }>;

function fail(point: MigrationFaultPoint): never {
  throw new MigrationError(`Falla inyectada: ${point}`, 'injected_fault');
}

const ACTION_BY_KIND: Record<LegacyQueueItemV1['kind'], QueuedAction> = {
  start: 'start',
  note: 'comment',
  photo: 'add_evidence',
  resolve: 'resolve',
};

function parseLegacyArray<T>(raw: string | null, key: string): T[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return value as T[];
  } catch {
    // cae al error de abajo
  }
  throw new MigrationError(`Datos v1 ilegibles en ${key}`, 'legacy_unreadable');
}

/** Transformación pura v1 → v2. Conserva ids de operación e incidencias. */
export function transformV1ToV2(
  incidents: readonly LegacyIncidentV1[],
  queue: readonly LegacyQueueItemV1[],
  options: MigrationOptions = {},
  now: () => string = () => new Date().toISOString(),
): LocalDocumentV2 {
  const versionById = new Map<string, number>();
  const migratedIncidents: StoredIncident[] = incidents.map((incident) => {
    const version = Number.isInteger(incident.version) ? (incident.version as number) : 1;
    versionById.set(incident.id, version);
    return {
      id: incident.id,
      version,
      category: incident.category,
      description: incident.description,
      location: incident.location,
      status: incident.status,
      reporterId: incident.reporterId,
      assignedTechnicianId: incident.assignedTechnicianId,
    };
  });

  const migratedQueue: PendingOperation[] = [];
  queue.forEach((item, index) => {
    if (options.faultAt === 'mid-transform' && index === Math.ceil(queue.length / 2)) {
      fail('mid-transform'); // a medias: parte de la cola ya está transformada en memoria
    }
    const action = ACTION_BY_KIND[item.kind];
    const payload: Record<string, unknown> =
      item.kind === 'note'
        ? { text: item.text ?? '' }
        : item.kind === 'photo'
          ? { evidenceId: `pending:${item.id}`, localUri: item.photoUri ?? '', uploaded: false }
          : item.kind === 'resolve'
            ? { diagnosis: item.text ?? '' }
            : {};
    migratedQueue.push({
      operationId: item.id,
      incidentId: item.incidentId,
      baseVersion: item.baseVersion ?? versionById.get(item.incidentId) ?? 1,
      actorId: item.author,
      action,
      payload,
      createdAt: item.createdAt ?? now(),
      status: 'pending',
    });
  });

  if (options.faultAt === 'mid-transform' && queue.length === 0) fail('mid-transform');
  return { schemaVersion: SCHEMA_VERSION, incidents: migratedIncidents, queue: migratedQueue };
}

export async function ensureCurrentSchema(
  storage: KeyValueStorage,
  options: MigrationOptions = {},
): Promise<{ outcome: MigrationOutcome; document: LocalDocumentV2 }> {
  const rawV2 = await storage.getItem(STORAGE_KEYS.documentV2);
  const rawIncidents = await storage.getItem(STORAGE_KEYS.legacyIncidents);
  const rawQueue = await storage.getItem(STORAGE_KEYS.legacyQueue);
  const hasLegacy = rawIncidents !== null || rawQueue !== null;

  const current = parseDocumentV2(rawV2);
  if (current) {
    if (!hasLegacy) return { outcome: 'already-current', document: current };
    // Falla posterior al commit: v2 íntegro, sólo faltaba limpiar v1.
    await storage.removeItem(STORAGE_KEYS.legacyIncidents);
    await storage.removeItem(STORAGE_KEYS.legacyQueue);
    return { outcome: 'cleaned-after-commit', document: current };
  }

  if (rawV2 !== null && !hasLegacy) {
    throw new MigrationError(
      'El documento v2 es ilegible y no hay copia v1: se conserva sin borrar',
      'unrecoverable_store',
    );
  }

  if (!hasLegacy) {
    const empty: LocalDocumentV2 = { schemaVersion: SCHEMA_VERSION, incidents: [], queue: [] };
    await storage.setItem(STORAGE_KEYS.documentV2, JSON.stringify(empty));
    return { outcome: 'fresh', document: empty };
  }

  const incidents = parseLegacyArray<LegacyIncidentV1>(rawIncidents, STORAGE_KEYS.legacyIncidents);
  const queue = parseLegacyArray<LegacyQueueItemV1>(rawQueue, STORAGE_KEYS.legacyQueue);
  const document = transformV1ToV2(incidents, queue, options);

  if (options.faultAt === 'before-commit') fail('before-commit');
  await storage.setItem(STORAGE_KEYS.documentV2, JSON.stringify(document)); // COMMIT
  const verified = parseDocumentV2(await storage.getItem(STORAGE_KEYS.documentV2));
  if (!verified || verified.queue.length !== queue.length || verified.incidents.length !== incidents.length) {
    // La verificación falló: se deshace el commit y v1 queda como fuente de verdad.
    await storage.removeItem(STORAGE_KEYS.documentV2);
    throw new MigrationError('Verificación posterior al commit fallida; se revirtió', 'unrecoverable_store');
  }
  if (options.faultAt === 'after-commit') fail('after-commit');

  await storage.removeItem(STORAGE_KEYS.legacyIncidents);
  await storage.removeItem(STORAGE_KEYS.legacyQueue);
  return {
    outcome: rawV2 !== null ? 'discarded-unreadable-v2' : 'migrated',
    document: verified,
  };
}
