import { deduplicateOperations, resolveSync } from '../../src/course-evaluation';

test('si los dos lados hacen el mismo cambio no hay conflicto', () => {
  const base = { id: 'r1', version: 1, fields: { a: 1 } };
  const same = { id: 'r1', version: 2, fields: { a: 2 } };
  expect(resolveSync(base, same, same)).toEqual({ kind: 'merged', fields: { a: 2 } });
});

test('el remoto borra un campo que local no tocó: se acepta el borrado', () => {
  const base = { id: 'r1', version: 1, fields: { c: 1 } };
  const local = { id: 'r1', version: 1, fields: { c: 1 } };
  const remote = { id: 'r1', version: 2, fields: {} };
  expect(resolveSync(base, local, remote)).toEqual({ kind: 'merged', fields: {} });
});

test('editar local un campo que el remoto borró es conflicto', () => {
  const base = { id: 'r1', version: 1, fields: { b: 1 } };
  const local = { id: 'r1', version: 1, fields: { b: 2 } };
  const remote = { id: 'r1', version: 2, fields: {} };
  expect(resolveSync(base, local, remote)).toEqual({ kind: 'conflict', fields: ['b'] });
});

test('un conflicto no modifica base, local ni remoto', () => {
  const base = { id: 'x', version: 1, fields: { work: { status: 'assigned', tech: 't1' } } };
  const local = { id: 'x', version: 1, fields: { work: { status: 'in_progress', tech: 't1' } } };
  const remote = { id: 'x', version: 2, fields: { work: { status: 'assigned', tech: 't2' } } };
  const before = JSON.stringify([base, local, remote]);
  resolveSync(base, local, remote);
  expect(JSON.stringify([base, local, remote])).toBe(before);
});

test('deduplicateOperations conserva la primera ocurrencia y el orden', () => {
  const ops = [
    { operationId: 'b', n: 1 },
    { operationId: 'a', n: 2 },
    { operationId: 'b', n: 3 },
  ];
  expect(deduplicateOperations(ops)).toEqual([ops[0], ops[1]]);
  expect(deduplicateOperations([])).toEqual([]);
});