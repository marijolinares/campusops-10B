/**
 * Representación de errores del cliente cloud (semana 5).
 *
 * Cada fallo remoto se traduce a un `ClientError` con un `kind` distinguible.
 * Los mensajes son fijos: nunca incluyen tokens, cuerpos de respuesta ni
 * datos de la incidencia, de modo que pueden registrarse sin exponer información.
 */
export type ClientErrorKind =
  | 'timeout' // el servidor no respondió dentro del límite
  | 'network' // no se pudo establecer la conexión
  | 'server' // 5xx
  | 'rate_limited' // 429
  | 'unauthorized' // 401
  | 'forbidden' // 403
  | 'not_found' // 404
  | 'conflict' // 409
  | 'rejected' // otro 4xx (p. ej. 422 por datos que el servidor rechazó)
  | 'malformed' // la respuesta no es JSON válido
  | 'contract'; // JSON válido, pero no cumple el DTO o el modelo de la app

export type ClientError = Readonly<{
  kind: ClientErrorKind;
  status?: number;
  retryAfterMs?: number;
  message: string;
}>;

export type ClientResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: ClientError }>;

const MESSAGES: Record<ClientErrorKind, string> = {
  timeout: 'El servidor tardó demasiado en responder.',
  network: 'No se pudo conectar con el servidor.',
  server: 'El servidor reportó un error interno.',
  rate_limited: 'Demasiadas solicitudes; intenta más tarde.',
  unauthorized: 'La sesión no es válida.',
  forbidden: 'No tienes permiso para esta operación.',
  not_found: 'El recurso solicitado no existe.',
  conflict: 'La operación entra en conflicto con el estado del servidor.',
  rejected: 'El servidor rechazó la solicitud.',
  malformed: 'La respuesta del servidor no tiene un formato legible.',
  contract: 'La respuesta del servidor no cumple el contrato esperado.',
};

export function clientError(
  kind: ClientErrorKind,
  extra: Readonly<{ status?: number; retryAfterMs?: number }> = {},
): ClientError {
  return { kind, message: MESSAGES[kind], ...extra };
}

export function fail<T = never>(
  kind: ClientErrorKind,
  extra: Readonly<{ status?: number; retryAfterMs?: number }> = {},
): ClientResult<T> {
  return { ok: false, error: clientError(kind, extra) };
}

export function kindFromStatus(status: number): ClientErrorKind {
  if (status >= 500) return 'server';
  switch (status) {
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    default:
      return 'rejected';
  }
}

/** Excepción usada sólo en el borde con la UI/puertos de dominio basados en Promise. */
export class IncidentClientError extends Error {
  readonly kind: ClientErrorKind;
  readonly status?: number | undefined;

  constructor(error: ClientError) {
    super(error.message);
    this.name = 'IncidentClientError';
    this.kind = error.kind;
    this.status = error.status;
  }
}
