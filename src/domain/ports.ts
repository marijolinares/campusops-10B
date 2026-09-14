import type { Incident } from './incident';

export interface IncidentRepository {
  listIncidents(): Promise<readonly Incident[]>;
  getIncidentById(id: string): Promise<Incident | null>;
}