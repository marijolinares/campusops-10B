import type { IncidentRepository } from '../domain/ports';
import type { Incident } from '../domain/incident';

const FAKE_INCIDENTS: readonly Incident[] = [
  {
    id: 'campus-inc-001',
    category: 'electrical',
    description: 'Falla eléctrica en el laboratorio B2',
    location: 'Edificio B, laboratorio 2',
    status: 'assigned',
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
  },
  {
    id: 'campus-inc-002',
    category: 'water',
    description: 'Fuga de agua en el pasillo principal',
    location: 'Edificio A, planta baja',
    status: 'open',
    reporterId: 'reporter-2',
    assignedTechnicianId: null,
  },
];

export function createFakeIncidentRepository(): IncidentRepository {
  return {
    async listIncidents() {
      return FAKE_INCIDENTS;
    },
    async getIncidentById(id: string) {
      return FAKE_INCIDENTS.find((incident) => incident.id === id) ?? null;
    },
  };
}