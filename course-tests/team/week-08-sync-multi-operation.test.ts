/**
 * Semana 08: varias operaciones sin conexión sobre la MISMA incidencia
 * (inicio de atención + nota + referencia de fotografía pendiente).
 * Al sincronizar, cada operación confirmada sube la versión de la incidencia;
 * las siguientes deben tomar esa versión como base y no declararse conflicto.
 * El servidor falso rechaza con 409 si la versión base no coincide, como el real.
 * Datos ficticios.
 */
import type { StoredIncident, PendingOperation } from '../../src/domain/offlineModel';
import type { Actor } from '../../src/domain/authorization';
import type { KeyValueStorage } from '../../src/infrastructure/keyValueStorage';
import { openLocalDatabase } from '../../src/infrastructure/localDatabase';
import {
  RemoteConflictError,
  syncPendingOperations,
  type SyncRemote,
} from '../../src/application/useCases/syncPendingOperations';

const technician1: Actor = { role: 'technician', actorId: 'technician-1' };

const assignedV1: StoredIncident = {
  id: 'campus-inc-001',
  version: 1,
  category: 'electrical',
  description: 'Falla de luz en laboratorio 3',
  location: 'Edificio B',
  status: 'assigned',
  reporterId: 'reporter-1',
  assignedTechnicianId: 'technician-1',
};

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => void data.set(key, value),
    removeItem: async (key: string) => void data.delete(key),
  } as unknown as KeyValueStorage;
}

/** Servidor estricto: sólo acepta una operación si su versión base es la versión actual. */
function strictServer(initial: StoredIncident) {
  let current = initial;
  const received: { operationId: string; baseVersion: number }[] = [];
  const control: { failOnCall?: number; calls: number } = { calls: 0 };
  const remote: SyncRemote = {
    async getIncident() {
      return current;
    },
    async applyOperation(operation: PendingOperation) {
      control.calls += 1;
      if (control.failOnCall === control.calls) throw new Error('sin red');
      if (operation.baseVersion !== current.version) {
        throw new RemoteConflictError(['base'], current.version);
      }
      received.push({ operationId: operation.operationId, baseVersion: operation.baseVersion });
      const status = operation.action === 'start' ? 'in_progress' : current.status;
      current = { ...current, status, version: current.version + 1 };
      return current;
    },
  };
  return { remote, received, control, get current() { return current; } };
}

async function queueThreeOperations(storage: KeyValueStorage) {
  const db = await openLocalDatabase(storage);
  await db.saveIncidents([assignedV1]);
  const start = await db.enqueue(technician1, { incidentId: 'campus-inc-001', action: 'start' });
  const note = await db.enqueue(technician1, {
    incidentId: 'campus-inc-001',
    action: 'comment',
    payload: { text: 'Tablero sin energía' },
  });
  const photo = await db.enqueue(technician1, {
    incidentId: 'campus-inc-001',
    action: 'add_evidence',
    payload: { evidenceId: 'pending:foto-1', localUri: 'file:///cache/foto-1.jpg' },
  });
  return { db, ids: [start.operation.operationId, note.operation.operationId, photo.operation.operationId] };
}

describe('varias operaciones sin conexión sobre la misma incidencia', () => {
  test('inicio + nota + foto pendiente se aplican en orden, sin conflicto falso', async () => {
    const storage = memoryStorage();
    const { db, ids } = await queueThreeOperations(storage);
    const server = strictServer(assignedV1);

    const report = await syncPendingOperations(db, server.remote);

    expect(report.outcomes.map((o) => o.result)).toEqual(['applied', 'applied', 'applied']);
    expect(server.received.map((r) => r.operationId)).toEqual(ids); // misma identidad y orden
    expect(server.received.map((r) => r.baseVersion)).toEqual([1, 2, 3]);
    expect(await db.listQueue()).toEqual([]);
    expect(await db.getIncident('campus-inc-001')).toMatchObject({ status: 'in_progress', version: 4 });
  });

  test('si falla la red a la mitad, la versión base reubicada sobrevive al reinicio', async () => {
    const storage = memoryStorage();
    const { db, ids } = await queueThreeOperations(storage);
    const server = strictServer(assignedV1);
    server.control.failOnCall = 2; // la nota falla por red

    const first = await syncPendingOperations(db, server.remote);
    expect(first.outcomes.map((o) => o.result)).toEqual(['applied', 'failed', 'blocked']);

    // reinicio: se reabre la misma base y se reintenta con la MISMA identidad
    const reopened = await openLocalDatabase(storage);
    const pending = await reopened.listQueue();
    expect(pending.map((op) => op.operationId)).toEqual([ids[1], ids[2]]);
    expect(pending.map((op) => op.baseVersion)).toEqual([2, 2]);
    expect(pending.every((op) => op.status === 'pending')).toBe(true);

    const second = await syncPendingOperations(reopened, server.remote);
    expect(second.outcomes.map((o) => o.result)).toEqual(['applied', 'applied']);
    expect(await reopened.listQueue()).toEqual([]);
    expect(server.received.map((r) => r.operationId)).toEqual(ids);
  });

  test('un conflicto real en la primera operación no reubica ni descarta las siguientes', async () => {
    const storage = memoryStorage();
    const { db, ids } = await queueThreeOperations(storage);
    const reassigned: StoredIncident = { ...assignedV1, version: 2, assignedTechnicianId: 'technician-2' };
    const server = strictServer(reassigned);

    const report = await syncPendingOperations(db, server.remote);

    expect(report.outcomes.map((o) => o.result)).toEqual(['conflict', 'blocked', 'blocked']);
    expect(server.received).toEqual([]); // nada se envió: no se pisa lo remoto
    const queue = await db.listQueue();
    expect(queue.map((op) => op.operationId)).toEqual(ids); // ninguna se perdió
    expect(queue.map((op) => op.baseVersion)).toEqual([1, 1, 1]);
    expect(queue[0]?.status).toBe('conflict');
  });
});
