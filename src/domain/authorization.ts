import type { CampusRole, IncidentWork } from '../campusops/contracts';

export type IncidentAction =
  | 'create'
  | 'view'
  | 'comment'
  | 'assign'
  | 'prioritize'
  | 'start'
  | 'resolve'
  | 'add_evidence'
  | 'close'
  | 'reopen';

export type Actor = Readonly<{ role: CampusRole; actorId: string }>;

/**
 * Reglas según docs/CAMPUSOPS.md (sección "Perfiles"):
 * - reportante: crea y consulta/comenta sólo sus incidencias.
 * - técnico: sólo opera lo que tiene asignado a él.
 * - coordinador: ve todo, asigna, prioriza, cierra y reabre.
 */
export function canPerform(
  actor: Actor,
  action: IncidentAction,
  incident?: IncidentWork & Readonly<{ reporterId?: string }>,
): boolean {
  switch (actor.role) {
    case 'reporter':
      if (action === 'create') return true;
      if (action === 'view' || action === 'comment') {
        return incident?.reporterId === actor.actorId;
      }
      return false;

    case 'technician':
      if (!incident || incident.assignedTechnicianId !== actor.actorId) return false;
      return (
        action === 'view' ||
        action === 'start' ||
        action === 'resolve' ||
        action === 'comment' ||
        action === 'add_evidence'
      );

    case 'coordinator':
      if (action === 'reopen') {
        return (
          !!incident &&
          (incident.status === 'resolved' || incident.status === 'closed') &&
          incident.assignedTechnicianId !== null
        );
      }
      return action !== 'create' && action !== 'start' && action !== 'resolve';

    default:
      return false;
  }
}