import { createFakeIncidentRepository } from '../infrastructure/fakeIncidentRepository';
import { createRemoteIncidentRepository } from '../infrastructure/remoteIncidentRepository';
import { createIncidentClient } from '../api/incidentClient';
import { createListIncidentsUseCase } from '../application/useCases/listIncidents';
import { createGetIncidentDetailUseCase } from '../application/useCases/getIncidentDetail';
import type { IncidentRepository } from '../domain/ports';

// Con EXPO_PUBLIC_COURSE_BACKEND_URL definido, la app consume el backend didáctico
// mediante la capa de cliente; sin ella usa el repositorio local ficticio.
const backendUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL;

const repository: IncidentRepository = backendUrl
  ? createRemoteIncidentRepository(createIncidentClient({ baseUrl: backendUrl }), 'reporter-1')
  : createFakeIncidentRepository();

export const listIncidents = createListIncidentsUseCase(repository);
export const getIncidentDetail = createGetIncidentDetailUseCase(repository);