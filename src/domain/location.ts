import type { IncidentLocation } from '../campusops/contracts';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -limit && value <= limit;
}

/**
 * Decide la ubicación de una incidencia a partir de un resultado externo desconocido.
 * Sólo se acepta un objeto con `label` textual no vacío y coordenadas numéricas finitas
 * (latitud [-90,90], longitud [-180,180]). Cualquier otra cosa (null, error como dato,
 * objeto incompleto, coordenadas inválidas o tipos incorrectos) cae a la captura manual
 * con la etiqueta escrita por la persona; nunca se inventan coordenadas.
 */
export function chooseIncidentLocation(provider: unknown, manualLabel: string): IncidentLocation {
  if (provider !== null && typeof provider === 'object' && !Array.isArray(provider)) {
    const { label, latitude, longitude } = provider as Record<string, unknown>;
    if (isNonEmptyString(label) && isCoordinate(latitude, 90) && isCoordinate(longitude, 180)) {
      return { source: 'provider', label, latitude, longitude };
    }
  }
  return { source: 'manual', label: manualLabel };
}
