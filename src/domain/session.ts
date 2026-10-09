/**
 * Reglas de estados de la sesión (semana 06). Dominio puro: sin red ni almacenamiento.
 *
 * Reutilizable por el cliente (src/api/incidentClient.ts) y por el adaptador
 * `coordinateRefresh` de src/course-evaluation. El diagrama
 * docs/session-state-machine.mmd debe coincidir con `transition`.
 */

export type SessionStatus =
  | 'unauthenticated' // sin sesión (estado inicial y destino tras un fallo o logout)
  | 'authenticating' // inicio de sesión en curso
  | 'authenticated' // sesión válida
  | 'expired' // el servidor respondió 401: el token ya no sirve
  | 'refreshing'; // una (sola) renovación compartida en curso

export type SessionEvent =
  | 'loginStarted'
  | 'loginSucceeded'
  | 'loginFailed'
  | 'unauthorized' // llegó un 401
  | 'refreshStarted'
  | 'refreshSucceeded'
  | 'refreshFailed'
  | 'logout';

/** Cada petición se reintenta como máximo una vez tras renovar. */
export const MAX_RETRIES_PER_REQUEST = 1;

/**
 * Tabla de transiciones. Lo que no aparece aquí es una transición inválida y
 * deja el estado sin cambios (así un 401 tardío o un evento duplicado no
 * provocan bucles ni estados incoherentes).
 */
const TRANSITIONS: Readonly<
  Record<SessionStatus, Readonly<Partial<Record<SessionEvent, SessionStatus>>>>
> = {
  unauthenticated: { loginStarted: 'authenticating', logout: 'unauthenticated' },
  authenticating: {
    loginSucceeded: 'authenticated',
    loginFailed: 'unauthenticated',
    logout: 'unauthenticated',
  },
  authenticated: {
    unauthorized: 'expired',
    loginStarted: 'authenticating',
    logout: 'unauthenticated',
  },
  expired: {
    refreshStarted: 'refreshing',
    refreshFailed: 'unauthenticated', // no hay refresh token que usar
    unauthorized: 'expired',
    logout: 'unauthenticated',
  },
  refreshing: {
    refreshSucceeded: 'authenticated',
    refreshFailed: 'unauthenticated', // la renovación falló: se vuelve a no autenticado
    unauthorized: 'refreshing', // 401 simultáneos comparten la renovación en curso
    logout: 'unauthenticated',
  },
};

export function transition(state: SessionStatus, event: SessionEvent): SessionStatus {
  return TRANSITIONS[state][event] ?? state;
}

/** ¿Una petición con `attempts` reintentos previos puede reintentarse otra vez? */
export function canRetry(attempts: number): boolean {
  return attempts < MAX_RETRIES_PER_REQUEST;
}

/**
 * Un 401 con `requestGeneration` menor a la generación activa ya fue cubierto
 * por una renovación: sólo debe reintentar con el token nuevo (401 tardío).
 */
export function isStaleGeneration(requestGeneration: number, activeGeneration: number): boolean {
  return requestGeneration < activeGeneration;
}

export function isAuthenticated(state: SessionStatus): boolean {
  return state === 'authenticated';
}
