import { createFakeIncidentRepository } from '../infrastructure/fakeIncidentRepository';
import { createListIncidentsUseCase } from '../application/useCases/listIncidents';
import { createGetIncidentDetailUseCase } from '../application/useCases/getIncidentDetail';

const repository = createFakeIncidentRepository();

export const listIncidents = createListIncidentsUseCase(repository);
export const getIncidentDetail = createGetIncidentDetailUseCase(repository);