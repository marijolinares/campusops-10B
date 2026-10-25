import { mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { openLocalDatabase, QueueError } from '../../src/infrastructure/localDatabase';
import type { KeyValueStorage } from '../../src/infrastructure/keyValueStorage';
import {
  ensureCurrentSchema,
  MigrationError,
  STORAGE_KEYS,
} from '../../src/infrastructure/migrations';
import type { StoredIncident } from '../../src/domain/offlineModel';

/** Almacenamiento en disco: cada instancia nueva simula cerrar y reabrir la app. */
function fileStorage(dir: string): KeyValueStorage {
  const file = (key: string) => join(dir, encodeURIComponent(key));
  return {
    async getItem(key) {
      return existsSync(file(key)) ? readFileSync(file(key), 'utf8') : null;
    },
    async setItem(key, value) {
      writeFileSync(file(key), value, 'utf8');
    },
    async removeItem(key) {
      if (existsSync(file(key))) unlinkSync(file(key));
    },
  };
}

const technician = { role: 'technician', actorId: 'technician-1' } as const;
const otherTechnician = { role: 'technician', actorId: 'technician-2' } as const;
const coordinator = { role: 'coordinator', actorId: 'coordinator-1' } as const;

const incident: StoredIncident = {
  id: 'campus-inc-001',
  version: 1,
  category: 'electrical',
  description: 'Falla en tablero del laboratorio B',
  location: 'Edificio B',
  status: 'assigned',
  reporterId: 'reporter-1',
  assignedTechnicianId: 'technician-1',
};

const legacyIncidents = [
  {
    id: 'campus-inc-001',
    category: 'electrical',
    description: 'Falla en tablero del laboratorio B',
    location: 'Edificio B',
    status: 'assigned',
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
  },
  {
    id: 'campus-inc-002',
    category: 'water',
    description: 'Fuga en baño',
    location: 'Edificio A',
    status: 'open',
    reporterId: 'reporter-2',
    assignedTechnicianId: null,
    version: 3,
  },
];
const legacyQueue = [
  { id: 'op-legacy-1', incidentId: 'campus-inc-001', author: 'technician-1', kind: 'start' },
  { id: 'op-legacy-2', incidentId: 'campus-inc-001', author: 'technician-1', kind: 'note', text: 'Tablero sin energía' },
  {
    id: 'op-legacy-3',
    incidentId: 'campus-inc-001',
    author: 'technician-1',
    kind: 'photo',
    photoUri: 'file:///cache/foto-1.jpg',
  },
];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'campusops-w08-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function seedLegacy(storage: KeyValueStorage) {
  await storage.setItem(STORAGE_KEYS.legacyIncidents, JSON.stringify(legacyIncidents));
  await storage.setItem(STORAGE_KEYS.legacyQueue, JSON.stringify(legacyQueue));
}

describe('cola persistente: reinicio sin conexión', () => {
  test('conserva identidad y contenido tras cerrar y reabrir', async () => {
    const first = await openLocalDatabase(fileStorage(dir));
    await first.saveIncidents([incident]);
    const start = await first.enqueue(technician, { operationId: 'op-start-1', incidentId: 'campus-inc-001', action: 'start' });
    const note = await first.enqueue(technician, {
      operationId: 'op-note-1',
      incidentId: 'campus-inc-001',
      action: 'comment',
      payload: { text: 'Sin energía en el tablero' },
    });
    const photo = await first.enqueue(technician, {
      operationId: 'op-photo-1',
      incidentId: 'campus-inc-001',
      action: 'add_evidence',
      payload: { evidenceId: 'pending:op-photo-1', localUri: 'file:///cache/foto-1.jpg' },
    });
    const before = await first.listQueue();

    // "reinicio": nueva instancia sobre el mismo almacenamiento en disco
    const second = await openLocalDatabase(fileStorage(dir));
    const after = await second.listQueue();

    expect(after).toEqual(before);
    expect(after.map((item) => item.operationId)).toEqual(['op-start-1', 'op-note-1', 'op-photo-1']);
    expect(after[0]).toEqual(start.operation);
    expect(after[1]).toEqual(note.operation);
    expect(after[2]?.payload).toEqual(photo.operation.payload);
    // la referencia de foto es un recurso pendiente, no una carga confirmada
    expect(after[2]?.payload.uploaded).toBe(false);
    expect(after.every((item) => item.baseVersion === 1 && item.actorId === 'technician-1')).toBe(true);
    expect(second.migrationOutcome).toBe('already-current');
  });

  test('reintentar el mismo operationId no duplica; con otro contenido es error', async () => {
    const db = await openLocalDatabase(fileStorage(dir));
    await db.saveIncidents([incident]);
    const input = { operationId: 'op-1', incidentId: 'campus-inc-001', action: 'comment', payload: { text: 'A' } } as const;
    const a = await db.enqueue(technician, input);
    const b = await db.enqueue(technician, input);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(await db.listQueue()).toHaveLength(1);
    await expect(db.enqueue(technician, { ...input, payload: { text: 'B' } })).rejects.toMatchObject({
      code: 'operation_id_reuse',
    });
    expect(await db.listQueue()).toHaveLength(1);
  });

  test('mutaciones concurrentes no pierden operaciones', async () => {
    const db = await openLocalDatabase(fileStorage(dir));
    await db.saveIncidents([incident]);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        db.enqueue(technician, { operationId: `op-${i}`, incidentId: 'campus-inc-001', action: 'comment', payload: { text: `n${i}` } }),
      ),
    );
    const reopened = await openLocalDatabase(fileStorage(dir));
    expect(await reopened.listQueue()).toHaveLength(10);
  });

  test('respeta permisos por perfil de la semana 6', async () => {
    const db = await openLocalDatabase(fileStorage(dir));
    await db.saveIncidents([incident]);
    const base = { incidentId: 'campus-inc-001', action: 'start' } as const;
    await expect(db.enqueue(otherTechnician, base)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(db.enqueue(coordinator, base)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(db.enqueue(technician, { incidentId: 'nope', action: 'start' })).rejects.toBeInstanceOf(QueueError);
    expect(await db.listQueue()).toEqual([]);
  });

  test('un error o conflicto no retira la operación; sólo lo confirmado', async () => {
    const db = await openLocalDatabase(fileStorage(dir));
    await db.saveIncidents([incident]);
    await db.enqueue(technician, { operationId: 'op-a', incidentId: 'campus-inc-001', action: 'start' });
    await db.enqueue(technician, { operationId: 'op-b', incidentId: 'campus-inc-001', action: 'comment', payload: { text: 'x' } });
    await db.markConflict('op-a', { fields: ['work'], remoteVersion: 2 });
    expect(await db.removeConfirmed(['no-existe'])).toBe(0);
    expect((await db.listQueue()).map((item) => [item.operationId, item.status])).toEqual([
      ['op-a', 'conflict'],
      ['op-b', 'pending'],
    ]);
    expect(await db.removeConfirmed(['op-b'])).toBe(1);
    const reopened = await openLocalDatabase(fileStorage(dir));
    const queue = await reopened.listQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ operationId: 'op-a', status: 'conflict', payload: {} });
  });

  test('saveIncidents actualiza la copia del servidor sin tocar la cola', async () => {
    const db = await openLocalDatabase(fileStorage(dir));
    await db.saveIncidents([incident]);
    await db.enqueue(technician, { operationId: 'op-a', incidentId: 'campus-inc-001', action: 'start' });
    await db.saveIncidents([{ ...incident, version: 2, assignedTechnicianId: 'technician-2' }]);
    expect((await db.getIncident('campus-inc-001'))?.assignedTechnicianId).toBe('technician-2');
    expect(await db.listQueue()).toHaveLength(1);
  });

  test('un documento dañado nunca se reemplaza por uno vacío', async () => {
    const storage = fileStorage(dir);
    await storage.setItem(STORAGE_KEYS.documentV2, '{"schemaVersion":2,"incidents":[');
    await expect(openLocalDatabase(storage)).rejects.toMatchObject({ code: 'unrecoverable_store' });
    expect(await storage.getItem(STORAGE_KEYS.documentV2)).toBe('{"schemaVersion":2,"incidents":[');
  });
});

describe('migración v1 → v2', () => {
  test('correcta: conserva incidencias y operaciones con su identidad', async () => {
    const storage = fileStorage(dir);
    await seedLegacy(storage);
    const db = await openLocalDatabase(storage, { now: () => '2026-10-25T00:00:00.000Z' });
    expect(db.migrationOutcome).toBe('migrated');
    const incidents = await db.getIncidents();
    expect(incidents.map((i) => [i.id, i.version])).toEqual([
      ['campus-inc-001', 1],
      ['campus-inc-002', 3],
    ]);
    const queue = await db.listQueue();
    expect(queue.map((op) => [op.operationId, op.action, op.actorId, op.baseVersion, op.status])).toEqual([
      ['op-legacy-1', 'start', 'technician-1', 1, 'pending'],
      ['op-legacy-2', 'comment', 'technician-1', 1, 'pending'],
      ['op-legacy-3', 'add_evidence', 'technician-1', 1, 'pending'],
    ]);
    expect(queue[1]?.payload).toEqual({ text: 'Tablero sin energía' });
    expect(queue[2]?.payload).toEqual({
      evidenceId: 'pending:op-legacy-3',
      localUri: 'file:///cache/foto-1.jpg',
      uploaded: false,
    });
    // v1 eliminado sólo después del commit
    expect(await storage.getItem(STORAGE_KEYS.legacyIncidents)).toBeNull();
    expect(await storage.getItem(STORAGE_KEYS.legacyQueue)).toBeNull();
    // idempotente al reabrir
    const again = await openLocalDatabase(storage);
    expect(again.migrationOutcome).toBe('already-current');
    expect(await again.listQueue()).toEqual(queue);
  });

  test.each(['mid-transform', 'before-commit'] as const)(
    'falla %s: revierte, v1 intacto y sin clave v2; reabrir recupera',
    async (faultAt) => {
      const storage = fileStorage(dir);
      await seedLegacy(storage);
      const snapshotBefore = [
        await storage.getItem(STORAGE_KEYS.legacyIncidents),
        await storage.getItem(STORAGE_KEYS.legacyQueue),
      ];

      await expect(openLocalDatabase(storage, { faultAt })).rejects.toBeInstanceOf(MigrationError);

      // estado tras la falla: exactamente el anterior, sin mezcla
      expect([
        await storage.getItem(STORAGE_KEYS.legacyIncidents),
        await storage.getItem(STORAGE_KEYS.legacyQueue),
      ]).toEqual(snapshotBefore);
      expect(await storage.getItem(STORAGE_KEYS.documentV2)).toBeNull();
      expect(readdirSync(dir)).toHaveLength(2);

      // recuperación: reabrir sin falla completa la migración con los mismos datos
      const db = await openLocalDatabase(storage);
      expect(db.migrationOutcome).toBe('migrated');
      expect((await db.listQueue()).map((op) => op.operationId)).toEqual(['op-legacy-1', 'op-legacy-2', 'op-legacy-3']);
      expect(await db.getIncidents()).toHaveLength(2);
    },
  );

  test('falla after-commit: v2 íntegro, restos v1 limpiados al reabrir sin duplicar', async () => {
    const storage = fileStorage(dir);
    await seedLegacy(storage);
    await expect(openLocalDatabase(storage, { faultAt: 'after-commit' })).rejects.toBeInstanceOf(MigrationError);
    expect(await storage.getItem(STORAGE_KEYS.documentV2)).not.toBeNull();
    expect(await storage.getItem(STORAGE_KEYS.legacyQueue)).not.toBeNull(); // restos aún presentes

    const db = await openLocalDatabase(storage);
    expect(db.migrationOutcome).toBe('cleaned-after-commit');
    expect(await storage.getItem(STORAGE_KEYS.legacyIncidents)).toBeNull();
    expect(await storage.getItem(STORAGE_KEYS.legacyQueue)).toBeNull();
    expect(await db.listQueue()).toHaveLength(3); // sin duplicar
  });

  test('v2 ilegible con v1 disponible: se migra de nuevo desde v1', async () => {
    const storage = fileStorage(dir);
    await seedLegacy(storage);
    await storage.setItem(STORAGE_KEYS.documentV2, '{"schemaVersion":2,"queue":[{');
    const db = await openLocalDatabase(storage);
    expect(db.migrationOutcome).toBe('discarded-unreadable-v2');
    expect(await db.listQueue()).toHaveLength(3);
  });

  test('v1 ilegible no se borra y se informa', async () => {
    const storage = fileStorage(dir);
    await storage.setItem(STORAGE_KEYS.legacyQueue, 'no es json');
    await expect(ensureCurrentSchema(storage)).rejects.toMatchObject({ code: 'legacy_unreadable' });
    expect(await storage.getItem(STORAGE_KEYS.legacyQueue)).toBe('no es json');
  });

  test('instalación nueva crea un documento v2 vacío', async () => {
    const db = await openLocalDatabase(fileStorage(dir));
    expect(db.migrationOutcome).toBe('fresh');
    expect(await db.listQueue()).toEqual([]);
  });
});
