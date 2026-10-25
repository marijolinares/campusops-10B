/**
 * Base local de CampusOps: incidencias almacenadas + cola persistente de
 * operaciones pendientes (semana 08). Ver docs/data-model.md.
 *
 * Cada mutación lee el documento, aplica el cambio y lo escribe en UNA sola
 * clave (atómico). Las mutaciones se serializan para no perder escrituras.
 */
import {
  canonicalJson,
  parseDocumentV2,
  type LocalDocumentV2,
  type PendingOperation,
  type QueuedAction,
  type StoredIncident,
} from '../domain/offlineModel';
import { canPerform, type Actor } from '../domain/authorization';
import type { KeyValueStorage } from './keyValueStorage';
import {
  STORAGE_KEYS,
  ensureCurrentSchema,
  type MigrationOptions,
  type MigrationOutcome,
} from './migrations';

export type EnqueueInput = Readonly<{
  /** Si se omite se genera uno. Un reintento DEBE reutilizar el mismo. */
  operationId?: string;
  incidentId: string;
  action: QueuedAction;
  payload?: Readonly<Record<string, unknown>>;
}>;

export type EnqueueResult = Readonly<{ operation: PendingOperation; created: boolean }>;

export class QueueError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'forbidden'
      | 'unknown_incident'
      | 'invalid_payload'
      | 'operation_id_reuse'
      | 'corrupt_store',
  ) {
    super(message);
    this.name = 'QueueError';
  }
}

let counter = 0;
export function generateOperationId(now: () => number = Date.now): string {
  counter += 1;
  return `op-${now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePayload(
  action: QueuedAction,
  payload: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const text = (value: unknown) => typeof value === 'string' && value.trim() !== '';
  switch (action) {
    case 'start':
      return {};
    case 'comment':
      if (!text(payload.text)) throw new QueueError('La nota no puede estar vacía', 'invalid_payload');
      return { text: payload.text };
    case 'resolve':
      if (!text(payload.diagnosis)) throw new QueueError('Falta el diagnóstico', 'invalid_payload');
      return { diagnosis: payload.diagnosis };
    case 'add_evidence':
      if (!text(payload.localUri) || !text(payload.evidenceId)) {
        throw new QueueError('Falta la referencia de la fotografía pendiente', 'invalid_payload');
      }
      // Una referencia local identifica un recurso PENDIENTE; nunca se marca como subido aquí.
      return { evidenceId: payload.evidenceId, localUri: payload.localUri, uploaded: false };
  }
}

function contentKey(operation: Pick<PendingOperation, 'incidentId' | 'actorId' | 'action' | 'payload'>) {
  return canonicalJson({
    incidentId: operation.incidentId,
    actorId: operation.actorId,
    action: operation.action,
    payload: operation.payload,
  });
}

export type LocalDatabase = Awaited<ReturnType<typeof openLocalDatabase>>;

export async function openLocalDatabase(
  storage: KeyValueStorage,
  options: MigrationOptions & { now?: () => string } = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  const { outcome, document: initial } = await ensureCurrentSchema(storage, options);
  let current: LocalDocumentV2 = initial;
  let chain: Promise<unknown> = Promise.resolve();

  async function mutate<T>(change: (doc: LocalDocumentV2) => { doc: LocalDocumentV2; result: T }) {
    const run = chain.then(async () => {
      const doc = parseDocumentV2(await storage.getItem(STORAGE_KEYS.documentV2));
      if (!doc) throw new QueueError('El almacenamiento local está dañado', 'corrupt_store');
      const { doc: next, result } = change(doc);
      if (next !== doc) {
        await storage.setItem(STORAGE_KEYS.documentV2, JSON.stringify(next)); // atómico
        current = next;
      }
      return result;
    });
    chain = run.catch(() => undefined);
    return run;
  }

  async function read(): Promise<LocalDocumentV2> {
    await chain;
    return parseDocumentV2(await storage.getItem(STORAGE_KEYS.documentV2)) ?? current;
  }

  return {
    /** Resultado de la apertura: migración o recuperación realizada. */
    migrationOutcome: outcome as MigrationOutcome,

    async getIncidents(): Promise<readonly StoredIncident[]> {
      return (await read()).incidents;
    },

    async getIncident(id: string): Promise<StoredIncident | null> {
      return (await read()).incidents.find((incident) => incident.id === id) ?? null;
    },

    /** Guarda la copia del servidor. Nunca toca la cola. */
    async saveIncidents(incidents: readonly StoredIncident[]): Promise<void> {
      await mutate((doc) => {
        const byId = new Map(doc.incidents.map((incident) => [incident.id, incident]));
        for (const incident of incidents) byId.set(incident.id, incident);
        return { doc: { ...doc, incidents: [...byId.values()] }, result: undefined };
      });
    },

    async listQueue(): Promise<readonly PendingOperation[]> {
      return (await read()).queue;
    },

    /**
     * Agrega una operación pendiente. Comprueba permisos por perfil con la
     * misma regla de la semana 6 (`canPerform`): un técnico sólo encola sobre
     * incidencias asignadas a él. Reusar un operationId con contenido
     * distinto es error; con el mismo contenido es un reintento sin efecto.
     */
    async enqueue(actor: Actor, input: EnqueueInput): Promise<EnqueueResult> {
      const payload = normalizePayload(input.action, input.payload);
      return mutate<EnqueueResult>((doc) => {
        const incident = doc.incidents.find((item) => item.id === input.incidentId);
        if (!incident) throw new QueueError('Incidencia desconocida localmente', 'unknown_incident');
        if (!canPerform(actor, input.action, incident)) {
          throw new QueueError('Perfil o asignación sin permiso para esta acción', 'forbidden');
        }
        const operationId = input.operationId ?? generateOperationId();
        const candidate: PendingOperation = {
          operationId,
          incidentId: input.incidentId,
          baseVersion: incident.version,
          actorId: actor.actorId,
          action: input.action,
          payload,
          createdAt: now(),
          status: 'pending',
        };
        const existing = doc.queue.find((item) => item.operationId === operationId);
        if (existing) {
          if (contentKey(existing) !== contentKey(candidate)) {
            throw new QueueError('operationId reutilizado con otro contenido', 'operation_id_reuse');
          }
          return { doc, result: { operation: existing, created: false } };
        }
        return {
          doc: { ...doc, queue: [...doc.queue, candidate] },
          result: { operation: candidate, created: true },
        };
      });
    },

    /** Marca la operación como conflictiva. La intención local se conserva íntegra. */
    async markConflict(
      operationId: string,
      conflict: Readonly<{ fields: readonly string[]; remoteVersion: number }>,
    ): Promise<void> {
      await mutate((doc) => ({
        doc: {
          ...doc,
          queue: doc.queue.map((item) =>
            item.operationId === operationId
              ? {
                  ...item,
                  status: 'conflict' as const,
                  conflict: { ...conflict, detectedAt: now() },
                }
              : item,
          ),
        },
        result: undefined,
      }));
    },

    /** Retira de la cola SÓLO operaciones confirmadas. Devuelve cuántas retiró. */
    async removeConfirmed(operationIds: readonly string[]): Promise<number> {
      const confirmed = new Set(operationIds);
      return mutate((doc) => {
        const queue = doc.queue.filter((item) => !confirmed.has(item.operationId));
        const removed = doc.queue.length - queue.length;
        return { doc: removed === 0 ? doc : { ...doc, queue }, result: removed };
      });
    },
  };
}
