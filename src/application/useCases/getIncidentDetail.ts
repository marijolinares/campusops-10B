import type { IncidentRepository } from '../../domain/ports';
import type { Incident } from '../../domain/incident';

export function createGetIncidentDetailUseCase(repository: IncidentRepository) {
  return async function getIncidentDetail(id: string): Promise<Incident | null> {
    return repository.getIncidentById(id);
  };
}