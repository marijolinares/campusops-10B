import { parseRemoteResource } from '../../src/course-evaluation';

const VALID = {
  id: 'campus-inc-001',
  version: 2,
  status: 'assigned',
  payload: { category: 'connectivity', description: 'Falla ficticia' },
};

test('acepta un DTO válido y devuelve solo los campos del sobre', () => {
  const result = parseRemoteResource({ ...VALID, ignored: 'forward-compatible' });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual(VALID);
    expect(result.value).not.toHaveProperty('ignored');
  }
});

test('payload null es legítimo y no se reemplaza por datos inventados', () => {
  const result = parseRemoteResource({ id: 'r-2', version: 3, status: 'closed', payload: null });
  expect(result).toEqual({
    ok: true,
    value: { id: 'r-2', version: 3, status: 'closed', payload: null },
  });
});

test.each([
  ['id vacío', { ...VALID, id: '' }],
  ['id solo espacios', { ...VALID, id: '   ' }],
  ['id no es texto', { ...VALID, id: 42 }],
  ['status vacío', { ...VALID, status: '' }],
])('rechaza %s', (_name, input) => {
  expect(parseRemoteResource(input)).toEqual({ ok: false, error: 'contract' });
});

test.each([
  ['version como string numérico', { ...VALID, version: '3' }],
  ['version decimal', { ...VALID, version: 1.5 }],
  ['version negativa', { ...VALID, version: -1 }],
  ['version NaN', { ...VALID, version: Number.NaN }],
  ['version ausente', { id: 'r-9', status: 'open', payload: null }],
])('rechaza %s', (_name, input) => {
  expect(parseRemoteResource(input)).toEqual({ ok: false, error: 'contract' });
});

test.each([
  ['payload ausente (undefined)', { id: 'r-9', version: 1, status: 'open' }],
  ['payload es un arreglo', { ...VALID, payload: [] }],
  ['payload es un string', { ...VALID, payload: 'hola' }],
])('rechaza %s', (_name, input) => {
  expect(parseRemoteResource(input)).toEqual({ ok: false, error: 'contract' });
});

test.each([[null], [undefined], ['texto'], [7], [[]]])(
  'rechaza una entrada que no es objeto: %p',
  (input) => {
    expect(parseRemoteResource(input)).toEqual({ ok: false, error: 'contract' });
  },
);