import type { Incident } from '../domain/incident';
import type { IncidentCategory, IncidentStatus } from '../campusops/contracts';
import type { JsonObject } from '../course-evaluation/contracts';

/** DTO validado del sobre remoto: lo que devuelve `parseRemoteResource`. */
export type IncidentDto = Readonly<{
  id: string;
  version: number;
  status: string;
  payload: JsonObject | null;
}>;

const CATEGORIES: ReadonlySet<string> = new Set<IncidentCategory>([
  'electrical',
  'laboratory',
  'water',
  'connectivity',
  'equipment',
  'safety',
  'maintenance',
]);

const STATUSES: ReadonlySet<string> = new Set<IncidentStatus>([
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
]);

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export type MapResult =
  | Readonly<{ kind: 'incident'; incident: Incident }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'invalid' }>;

/**
 * Frontera DTO -> dominio.
 * - payload null: respuesta legítima sin datos; devuelve `empty` y NO inventa campos.
 * - payload incompleto o con tipos incorrectos: `invalid` (error de contrato).
 */
export function mapIncidentDto(dto: IncidentDto): MapResult {
  if (dto.payload === null) return { kind: 'empty' };
  const p = dto.payload;
  if (
    !STATUSES.has(dto.status) ||
    typeof p.category !== 'string' ||
    !CATEGORIES.has(p.category) ||
    !text(p.description) ||
    !text(p.location) ||
    !text(p.reporterId) ||
    !(p.assignedTechnicianId === null || text(p.assignedTechnicianId))
  ) {
    return { kind: 'invalid' };
  }
  return {
    kind: 'incident',
    incident: {
      id: dto.id,
      category: p.category as IncidentCategory,
      description: p.description,
      location: p.location,
      status: dto.status as IncidentStatus,
      reporterId: p.reporterId,
      assignedTechnicianId: p.assignedTechnicianId,
    },
  };
}
