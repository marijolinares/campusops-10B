import type { IncidentCategory, IncidentStatus } from '../campusops/contracts';

export type Incident = Readonly<{
  id: string;
  category: IncidentCategory;
  description: string;
  location: string;
  status: IncidentStatus;
  reporterId: string;
  assignedTechnicianId: string | null;
}>;