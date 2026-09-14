import type { IncidentRepository } from '../../domain/ports';
import type { Incident } from '../../domain/incident';

export function createListIncidentsUseCase(repository: IncidentRepository) {
  return async function listIncidents(): Promise<readonly Incident[]> {
    return repository.listIncidents();
  };
}