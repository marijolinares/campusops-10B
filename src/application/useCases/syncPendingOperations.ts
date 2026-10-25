/**
 * Sincronización de la cola persistente (semana 08, pasos 4 y 5).
 *
 * Conecta la lógica pura de `resolveSync` / `deduplicateOperations` con la base
 * local de Germán (`LocalDatabase`): al recuperar la red recorre la cola
 * guardada en disco y, por cada operación pendiente, decide una de estas cosas:
 *
 *  - applied  : el servidor la aceptó -> se retira de la cola y se actualiza la copia local.
 *  - conflict : servidor y dispositivo cambiaron lo mismo de forma distinta ->
 *               la operación se CONSERVA en la cola marcada como `conflict`
 *               y NO se envía nada al servidor (no se pisa lo remoto).
 *  - blocked  : hay una operación anterior de la misma incidencia sin resolver;
 *               se respeta el orden y se deja pendiente.
 *  - failed   : error de red u otro; se deja pendiente para reintentar con el mismo operationId.
 *
 * La política completa está en docs/sync-policy.md.
 */
import type { PendingOperation, StoredIncident } from '../../domain/offlineModel';
import type { LocalDatabase } from '../../infrastructure/localDatabase';
import { deduplicateOperations, resolveSync } from '../../course-evaluation';
import type { SyncRecord } from '../../course-evaluation/contracts';

/** Puerto hacia el servidor. Se inyecta: en pruebas es un doble, en la app el cliente HTTP. */
export interface SyncRemote {
  getIncident(incidentId: string): Promise<StoredIncident>;
  /** Debe ser idempotente por `operation.operationId` (un reintento no repite el efecto). */
  applyOperation(operation: PendingOperation): Promise<StoredIncident>;
}

/** El servidor puede rechazar con 409 aunque la comparación previa dijera "sin conflicto" (carrera). */
export class RemoteConflictError extends Error {
  constructor(
    readonly fields: readonly string[],
    readonly remoteVersion: number,
  ) {
    super('El servidor reportó un conflicto');
    this.name = 'RemoteConflictError';
  }
}

export type SyncOutcome =
  | Readonly<{ operationId: string; result: 'applied' }>
  | Readonly<{ operationId: string; result: 'conflict'; fields: readonly string[]; remoteVersion: number }>
  | Readonly<{ operationId: string; result: 'blocked' }>
  | Readonly<{ operationId: string; result: 'failed'; reason: string }>;

export type SyncReport = Readonly<{ outcomes: readonly SyncOutcome[] }>;

type Work = Readonly<{ status: StoredIncident['status']; assignedTechnicianId: string | null }>;

/** `status` y técnico asignado viajan juntos en el campo `work` (ver docs/sync-policy.md §3). */
function toRecord(incident: StoredIncident): SyncRecord {
  const work: Work = { status: incident.status, assignedTechnicianId: incident.assignedTechnicianId };
  return {
    id: incident.id,
    version: incident.version,
    fields: {
      work,
      category: incident.category,
      description: incident.description,
      location: incident.location,
    },
  };
}

/** Versión "local" del registro: la base más el efecto que la operación pretende. */
function withLocalIntent(base: SyncRecord, operation: PendingOperation): SyncRecord {
  const work = base.fields.work as Work;
  switch (operation.action) {
    case 'start':
      return { ...base, fields: { ...base.fields, work: { ...work, status: 'in_progress' } } };
    case 'resolve':
      return {
        ...base,
        fields: {
          ...base.fields,
          work: { ...work, status: 'resolved' },
          diagnosis: operation.payload.diagnosis,
        },
      };
    default:
      return base; // comment / add_evidence no cambian `work`
  }
}

async function decide(
  db: LocalDatabase,
  operation: PendingOperation,
  remote: StoredIncident,
): Promise<{ conflict: false } | { conflict: true; fields: readonly string[] }> {
  // Nadie tocó la incidencia en el servidor desde que el técnico la descargó.
  if (remote.version === operation.baseVersion) return { conflict: false };

  // La base es la copia local tal como estaba al encolar: `saveIncidents` no se llama
  // hasta confirmar, así que sigue en `baseVersion`. Si ya no coincide, no hay base fiable.
  const stored = await db.getIncident(operation.incidentId);
  if (!stored || stored.version !== operation.baseVersion) {
    return { conflict: true, fields: ['base'] };
  }

  const base = toRecord(stored);
  const merged = resolveSync(base, withLocalIntent(base, operation), toRecord(remote));
  if (merged.kind === 'conflict') return { conflict: true, fields: merged.fields };

  // Aunque no choquen campos, un técnico no puede actuar sobre una incidencia
  // que el servidor ya reasignó a otra persona.
  if (remote.assignedTechnicianId !== operation.actorId) {
    return { conflict: true, fields: ['work'] };
  }
  return { conflict: false };
}

export async function syncPendingOperations(db: LocalDatabase, remote: SyncRemote): Promise<SyncReport> {
  const queue = deduplicateOperations(await db.listQueue());
  const outcomes: SyncOutcome[] = [];
  // Incidencias con una operación sin resolver: sus operaciones posteriores esperan (orden).
  const held = new Set<string>(queue.filter((op) => op.status === 'conflict').map((op) => op.incidentId));

  for (const operation of queue) {
    if (operation.status === 'conflict') continue; // espera decisión humana; no se reenvía
    if (held.has(operation.incidentId)) {
      outcomes.push({ operationId: operation.operationId, result: 'blocked' });
      continue;
    }

    const recordConflict = async (fields: readonly string[], remoteVersion: number) => {
      await db.markConflict(operation.operationId, { fields, remoteVersion });
      held.add(operation.incidentId);
      outcomes.push({ operationId: operation.operationId, result: 'conflict', fields, remoteVersion });
    };

    try {
      const current = await remote.getIncident(operation.incidentId);
      const verdict = await decide(db, operation, current);
      if (verdict.conflict) {
        await recordConflict(verdict.fields, current.version);
        continue;
      }
      const updated = await remote.applyOperation(operation);
      await db.removeConfirmed([operation.operationId]); // sólo lo confirmado sale de la cola
      await db.saveIncidents([updated]);
      outcomes.push({ operationId: operation.operationId, result: 'applied' });
    } catch (error) {
      if (error instanceof RemoteConflictError) {
        await recordConflict(error.fields, error.remoteVersion);
      } else {
        held.add(operation.incidentId);
        outcomes.push({
          operationId: operation.operationId,
          result: 'failed',
          reason: error instanceof Error ? error.message : 'error desconocido',
        });
      }
    }
  }
  return { outcomes };
}