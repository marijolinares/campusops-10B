/**
 * Semana 08, pasos 4 y 5: resolveSync / deduplicateOperations conectados con la
 * cola persistente real (openLocalDatabase). Incluye el caso obligatorio:
 * el técnico inicia atención sin conexión mientras coordinación reasigna en el servidor.
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

/** Almacenamiento en memoria: sobrevive a "reiniciar" porque se reabre la misma instancia. */
function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => void data.set(key, value),
    removeItem: async (key: string) => void data.delete(key),
  } as unknown as KeyValueStorage;
}

/** Servidor falso. Guarda lo que recibe para comprobar que NO se pisa. */
function fakeServer(initial: StoredIncident) {
  let current = initial;
  const applied: PendingOperation[] = [];
  const remote: SyncRemote & { failWith?: Error | undefined } = {
    async getIncident() {
      if (remote.failWith) throw remote.failWith;
      return current;
    },
    async applyOperation(operation) {
      if (remote.failWith) throw remote.failWith;
      applied.push(operation);
      const status = operation.action === 'start' ? 'in_progress' : current.status;
      current = { ...current, status, version: current.version + 1 };
      return current;
    },
  };
  return {
    remote,
    applied,
    get current() {
      return current;
    },
    set current(value: StoredIncident) {
      current = value;
    },
  };
}

async function setup(serverState: StoredIncident = assignedV1) {
  const storage = memoryStorage();
  const db = await openLocalDatabase(storage);
  await db.saveIncidents([assignedV1]); // copia local descargada (versión 1)
  const server = fakeServer(serverState);
  return { storage, db, server };
}

describe('caso obligatorio: técnico offline vs reasignación en el servidor', () => {
  test('al reconectar se detecta el conflicto sin pisar lo remoto ni borrar la intención local', async () => {
    const { storage, db, server } = await setup();

    // 1) Sin conexión: el técnico inicia la atención y queda en la cola.
    const { operation } = await db.enqueue(technician1, { incidentId: 'campus-inc-001', action: 'start' });
    expect(operation).toMatchObject({ baseVersion: 1, status: 'pending', action: 'start' });

    // 2) Mientras tanto, coordinación reasigna en el servidor (versión 2).
    const reassigned: StoredIncident = { ...assignedV1, version: 2, assignedTechnicianId: 'technician-2' };
    server.current = reassigned;

    // 3) Se cierra y reabre la app (la cola vive en disco) y vuelve la red.
    const reopened = await openLocalDatabase(storage);
    const report = await syncPendingOperations(reopened, server.remote);

    expect(report.outcomes).toEqual([
      { operationId: operation.operationId, result: 'conflict', fields: ['work'], remoteVersion: 2 },
    ]);

    // No se pisa lo remoto: no se envió nada y el servidor sigue con technician-2.
    expect(server.applied).toHaveLength(0);
    expect(server.current).toEqual(reassigned);

    // No se borra la intención local: la operación sigue en la cola, íntegra, marcada como conflicto.
    const queue = await reopened.listQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      operationId: operation.operationId,
      action: 'start',
      actorId: 'technician-1',
      baseVersion: 1,
      status: 'conflict',
      conflict: { fields: ['work'], remoteVersion: 2 },
    });

    // La copia local (base) no se modificó: nada se confirmó.
    expect(await reopened.getIncident('campus-inc-001')).toEqual(assignedV1);
  });

  test('el conflicto sobrevive a otro reinicio y a otra sincronización', async () => {
    const { storage, db, server } = await setup();
    const { operation } = await db.enqueue(technician1, { incidentId: 'campus-inc-001', action: 'start' });
    server.current = { ...assignedV1, version: 2, assignedTechnicianId: 'technician-2' };

    await syncPendingOperations(db, server.remote);
    const again = await openLocalDatabase(storage);
    const second = await syncPendingOperations(again, server.remote);

    expect(second.outcomes).toEqual([]); // nada que reenviar: espera decisión humana
    expect(server.applied).toHaveLength(0);
    expect((await again.listQueue())[0]).toMatchObject({
      operationId: operation.operationId,
      status: 'conflict',
    });
  });

  test('una operación posterior de la misma incidencia espera (no se aplica fuera de orden)', async () => {
    const { db, server } = await setup();
    await db.enqueue(technician1, { incidentId: 'campus-inc-001', action: 'start' });
    const { operation: note } = await db.enqueue(technician1, {
      incidentId: 'campus-inc-001',
      action: 'comment',
      payload: { text: 'Llegué al sitio' },
    });
    server.current = { ...assignedV1, version: 2, assignedTechnicianId: 'technician-2' };

    const report = await syncPendingOperations(db, server.remote);

    expect(report.outcomes.map((o) => o.result)).toEqual(['conflict', 'blocked']);
    expect(server.applied).toHaveLength(0);
    const queue = await db.listQueue();
    expect(queue).toHaveLength(2);
    expect(queue.find((o) => o.operationId === note.operationId)?.status).toBe('pending');
  });
});

describe('sincronización sin conflicto', () => {
  test('sin cambios remotos: se aplica, sale de la cola y se actualiza la copia local', async () => {
    const { db, server } = await setup();
    const { operation } = await db.enqueue(technician1, { incidentId: 'campus-inc-001', action: 'start' });

    const report = await syncPendingOperations(db, server.remote);

    expect(report.outcomes).toEqual([{ operationId: operation.operationId, result: 'applied' }]);
    expect(server.applied.map((o) => o.operationId)).toEqual([operation.operationId]);
    expect(await db.listQueue()).toEqual([]);
    expect(await db.getIncident('campus-inc-001')).toMatchObject({ status: 'in_progress', version: 2 });
  });

  test('el servidor cambió otro campo (descripción) y sigue asignada al técnico: se aplica', async () => {
    const { db, server } = await setup();
    await db.enqueue(technician1, { incidentId: 'campus-inc-001', action: 'start' });
    server.current = { ...assignedV1, version: 2, description: 'Falla de luz y sin red en laboratorio 3' };

    const report = await syncPendingOperations(db, server.remote);

    expect(report.outcomes.map((o) => o.result)).toEqual(['applied']);
    expect(await db.listQueue()).toEqual([]);
  });

  test('error de red: la operación sigue pendiente y el reintento conserva su operationId', async () => {
    const { db, server } = await setup();
    const { operation } = await db.enqueue(technician1, { incidentId: 'campus-inc-001', action: 'start' });

    server.remote.failWith = new Error('sin red');
    const failed = await syncPendingOperations(db, server.remote);
    expect(failed.outcomes).toEqual([{ operationId: operation.operationId, result: 'failed', reason: 'sin red' }]);
    expect(await db.listQueue()).toEqual([operation]);

    server.remote.failWith = undefined;
    const retried = await syncPendingOperations(db, server.remote);
    expect(retried.outcomes).toEqual([{ operationId: operation.operationId, result: 'applied' }]);
    expect(server.applied.map((o) => o.operationId)).toEqual([operation.operationId]);
  });

  test('un 409 del servidor (carrera) se guarda como conflicto, no como error', async () => {
    const { db, server } = await setup();
    const { operation } = await db.enqueue(technician1, { incidentId: 'campus-inc-001', action: 'start' });
    server.remote.applyOperation = async () => {
      throw new RemoteConflictError(['work'], 3);
    };

    const report = await syncPendingOperations(db, server.remote);

    expect(report.outcomes).toEqual([
      { operationId: operation.operationId, result: 'conflict', fields: ['work'], remoteVersion: 3 },
    ]);
    expect((await db.listQueue())[0]).toMatchObject({ status: 'conflict', conflict: { remoteVersion: 3 } });
  });
});