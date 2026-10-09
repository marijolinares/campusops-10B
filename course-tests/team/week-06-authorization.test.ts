import { canPerform } from '../../src/domain/authorization';

const inc = { status: 'assigned' as const, assignedTechnicianId: 'technician-1', reporterId: 'reporter-1' };
const reporter = { role: 'reporter' as const, actorId: 'reporter-1' };
const tech1 = { role: 'technician' as const, actorId: 'technician-1' };
const tech2 = { role: 'technician' as const, actorId: 'technician-2' };
const coord = { role: 'coordinator' as const, actorId: 'coordinator-1' };

test('reportante crea y ve lo suyo, pero no cierra ni ve lo ajeno', () => {
  expect(canPerform(reporter, 'create')).toBe(true);
  expect(canPerform(reporter, 'view', inc)).toBe(true);
  expect(canPerform(reporter, 'close', inc)).toBe(false);
  expect(canPerform({ ...reporter, actorId: 'reporter-2' }, 'view', inc)).toBe(false);
});
test('técnico sólo opera lo asignado a él', () => {
  expect(canPerform(tech1, 'start', inc)).toBe(true);
  expect(canPerform(tech2, 'start', inc)).toBe(false);
  expect(canPerform(tech1, 'close', inc)).toBe(false);
  expect(canPerform(tech1, 'start', { ...inc, assignedTechnicianId: 'technician-2' })).toBe(false);
});
test('coordinador cierra y reabre sólo con técnico asignado', () => {
  expect(canPerform(coord, 'close', inc)).toBe(true);
  expect(canPerform(coord, 'reopen', { ...inc, status: 'resolved' })).toBe(true);
  expect(canPerform(coord, 'reopen', { ...inc, status: 'resolved', assignedTechnicianId: null })).toBe(false);
  expect(canPerform(coord, 'reopen', { ...inc, status: 'in_progress' })).toBe(false);
});