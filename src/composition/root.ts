import { createFakeIncidentRepository } from '../infrastructure/fakeIncidentRepository';
import { createRemoteIncidentRepository } from '../infrastructure/remoteIncidentRepository';
import { createIncidentClient } from '../api/incidentClient';
import { createListIncidentsUseCase } from '../application/useCases/listIncidents';
import { createGetIncidentDetailUseCase } from '../application/useCases/getIncidentDetail';
import type { IncidentRepository } from '../domain/ports';
import type { SessionStatus } from '../domain/session';
import { createSecureStorage } from '../infrastructure/secureStorage';

// Con EXPO_PUBLIC_COURSE_BACKEND_URL definido, la app consume el backend didáctico
// mediante la capa de cliente; sin ella usa el repositorio local ficticio.
const backendUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL;

// La app se entera de los cambios de sesión (p. ej. renovación fallida => volver a login).
const sessionListeners = new Set<(status: SessionStatus) => void>();
export function onSessionChange(listener: (status: SessionStatus) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

const incidentClient = backendUrl
  ? createIncidentClient({
      baseUrl: backendUrl,
      storage: createSecureStorage(), // tokens en el almacenamiento seguro
      onSessionChange: (status) => sessionListeners.forEach((listener) => listener(status)),
    })
  : null;

const repository: IncidentRepository = incidentClient
  ? createRemoteIncidentRepository(incidentClient, 'reporter-1')
  : createFakeIncidentRepository();

export const listIncidents = createListIncidentsUseCase(repository);
export const getIncidentDetail = createGetIncidentDetailUseCase(repository);

/** Cierra la sesión y borra todos los tokens. Sin backend no hay sesión que cerrar. */
export async function logout(): Promise<void> {
  await incidentClient?.logout();
}