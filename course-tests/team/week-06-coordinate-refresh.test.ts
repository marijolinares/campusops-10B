import { coordinateRefresh, redactForTelemetry } from '../../src/course-evaluation';

const r401 = (requestId: string, generation = 0) => ({ type: 'request401' as const, requestId, generation });

describe('coordinateRefresh', () => {
  test('3 errores 401 juntos -> 1 refresh y 1 reintento por petición', () => {
    const s = coordinateRefresh([r401('a'), r401('b'), r401('c'),
      { type: 'refreshSucceeded', generation: 1, token: 'course-token-1' }]);
    expect(s.refreshCalls).toBe(1);
    expect(s.retriedRequestIds).toEqual(['a', 'b', 'c']);
    expect(s.persistedToken).toBe('course-token-1');
  });

  test('refresh fallido: borra el token, no reintenta y no hay bucle', () => {
    const s = coordinateRefresh([r401('a'), r401('b'), { type: 'refreshFailed' }, r401('a'), r401('c')]);
    expect(s).toMatchObject({ status: 'anonymous', persistedToken: null, refreshCalls: 1, retriedRequestIds: [] });
  });

  test('401 tardío (generación vieja): se reintenta sin otro refresh', () => {
    const s = coordinateRefresh([r401('a'),
      { type: 'refreshSucceeded', generation: 1, token: 't1' }, r401('late', 0)]);
    expect(s.refreshCalls).toBe(1);
    expect(s.retriedRequestIds).toEqual(['a', 'late']);
  });

  test('una petición ya reintentada no se reintenta otra vez', () => {
    const s = coordinateRefresh([r401('a'), { type: 'refreshSucceeded', generation: 1, token: 't1' }, r401('a', 1)]);
    expect(s.retriedRequestIds).toEqual(['a']);
    expect(s.refreshCalls).toBe(1);
  });

  test('logout descarta peticiones en espera y un éxito posterior no revive la sesión', () => {
    const s = coordinateRefresh([r401('a'), { type: 'logout' },
      { type: 'refreshSucceeded', generation: 1, token: 't1' }]);
    expect(s).toMatchObject({ status: 'anonymous', persistedToken: null, retriedRequestIds: [] });
  });

  test('los tokens no aparecen en logs sanitizados', () => {
    const out = JSON.stringify(redactForTelemetry({ accessToken: 'secreto-1', refreshToken: 'secreto-2', status: 401 }));
    expect(out).not.toContain('secreto');
    expect(out).toContain('401');
  });
});