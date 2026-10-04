import type { IncidentRepository } from '../domain/ports';
import { IncidentClientError } from '../api/clientErrors';
import type { IncidentClient } from '../api/incidentClient';

/**
 * Adaptador del puerto de dominio sobre el cliente cloud.
 * Los errores tipados se propagan como `IncidentClientError` para que la capa de
 * UI los distinga; ninguna pantalla conoce HTTP, fetch ni DTOs.
 */
export function createRemoteIncidentRepository(
  client: IncidentClient,
  actorId: string,
): IncidentRepository {
  let ready: Promise<void> | null = null;

  function ensureSession(): Promise<void> {
    if (!ready) {
      ready = client.login(actorId).then((result) => {
        if (!result.ok) {
          ready = null; // permite reintentar el login en la siguiente operación
          throw new IncidentClientError(result.error);
        }
      });
    }
    return ready;
  }

  return {
    async listIncidents() {
      await ensureSession();
      const result = await client.listIncidents();
      if (!result.ok) throw new IncidentClientError(result.error);
      return result.value.incidents;
    },
    async getIncidentById(id: string) {
      await ensureSession();
      const result = await client.getIncident(id);
      if (!result.ok) throw new IncidentClientError(result.error);
      return result.value;
    },
  };
}
