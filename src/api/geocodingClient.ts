import type { FetchLike } from './incidentClient';
import { chooseIncidentLocation } from '../domain/location';
import type { IncidentLocation } from '../campusops/contracts';

/**
 * Adaptador de geocodificación. Aísla al proveedor externo: la app sólo conoce
 * `resolveLocation(query, manualLabel)` y siempre recibe una IncidentLocation válida.
 * Cualquier fallo (timeout, 429, 5xx, desconexión, cuerpo ilegible o incompleto) se
 * presenta como "resultado no disponible" y cae a la ubicación manual.
 */

export type GeocodingFailure = 'timeout' | 'rate_limited' | 'server_error' | 'network' | 'invalid_body' | 'http_error';

export type GeocodingEvent = Readonly<{
  type: 'geocoding';
  outcome: 'provider' | 'manual' | 'cache_hit';
  failure?: GeocodingFailure;
  status?: number;
  elapsedMs: number;
}>;

export type GeocodingConfig = Readonly<{
  /** URL completa del endpoint de búsqueda, sin la consulta. */
  endpoint: string;
  /** Nombre del parámetro de consulta (`q` en el doble del curso y en Nominatim). */
  queryParam?: string;
  /** Parámetros fijos adicionales (p. ej. format=jsonv2&limit=1). */
  extraParams?: Readonly<Record<string, string>>;
  headers?: Readonly<Record<string, string>>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Vigencia de una entrada de caché en ms. 0 desactiva la caché. */
  cacheTtlMs?: number;
  /** Máximo de entradas en caché (descarta la más antigua). */
  cacheMaxEntries?: number;
  now?: () => number;
  /** Convierte la respuesta JSON del proveedor al forma { label, latitude, longitude }. */
  normalize?: (body: unknown) => unknown;
  /** Recibe eventos sanitizados: nunca la consulta, la etiqueta ni coordenadas. */
  log?: (event: GeocodingEvent) => void;
}>;

export const DEFAULT_GEOCODING_TIMEOUT_MS = 3000;
export const DEFAULT_GEOCODING_CACHE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_GEOCODING_CACHE_MAX = 50;

/** Normalizador para Nominatim (OpenStreetMap): arreglo con `display_name`, `lat`, `lon` como texto. */
export function normalizeNominatim(body: unknown): unknown {
  if (!Array.isArray(body) || body.length === 0) return null;
  const first: unknown = body[0];
  if (first === null || typeof first !== 'object') return null;
  const { display_name: label, lat, lon } = first as Record<string, unknown>;
  const latitude = typeof lat === 'string' && lat.trim() !== '' ? Number(lat) : lat;
  const longitude = typeof lon === 'string' && lon.trim() !== '' ? Number(lon) : lon;
  return { label, latitude, longitude };
}

type CacheEntry = { storedAt: number; value: unknown };

export type GeocodingClient = Readonly<{
  /** Devuelve la respuesta cruda validada del proveedor, o null si no está disponible. */
  lookup(query: string): Promise<unknown>;
  /** Siempre devuelve una ubicación: del proveedor si es válida; si no, la manual. */
  resolveLocation(query: string, manualLabel: string): Promise<IncidentLocation>;
  clearCache(): void;
  cacheSize(): number;
}>;

function classify(status: number): GeocodingFailure {
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'http_error';
}

export function createGeocodingClient(config: GeocodingConfig): GeocodingClient {
  const fetchImpl: FetchLike = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = config.timeoutMs ?? DEFAULT_GEOCODING_TIMEOUT_MS;
  const ttl = config.cacheTtlMs ?? DEFAULT_GEOCODING_CACHE_TTL_MS;
  const maxEntries = config.cacheMaxEntries ?? DEFAULT_GEOCODING_CACHE_MAX;
  const now = config.now ?? Date.now;
  const queryParam = config.queryParam ?? 'q';
  const cache = new Map<string, CacheEntry>();

  const emit = (event: GeocodingEvent) => config.log?.(event);

  async function fetchProvider(query: string): Promise<{ value: unknown; failure?: GeocodingFailure; status?: number }> {
    const params = new URLSearchParams({ ...(config.extraParams ?? {}), [queryParam]: query });
    const separator = config.endpoint.includes('?') ? '&' : '?';
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(`${config.endpoint}${separator}${params.toString()}`, {
        method: 'GET',
        headers: { ...(config.headers ?? {}) },
        signal: controller.signal,
      });
      if (!response.ok) return { value: null, failure: classify(response.status), status: response.status };
      let body: unknown;
      try {
        body = JSON.parse(await response.text());
      } catch {
        return { value: null, failure: 'invalid_body', status: response.status };
      }
      return { value: config.normalize ? config.normalize(body) : body, status: response.status };
    } catch {
      return { value: null, failure: timedOut ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function lookupInternal(query: string): Promise<{ value: unknown; failure?: GeocodingFailure; status?: number; cached: boolean }> {
    const key = query.trim().toLowerCase();
    if (ttl > 0) {
      const hit = cache.get(key);
      if (hit && now() - hit.storedAt < ttl) return { value: hit.value, cached: true };
      if (hit) cache.delete(key);
    }
    const result = await fetchProvider(query);
    // Sólo se cachean respuestas utilizables; los fallos no se guardan para poder reintentar.
    if (ttl > 0 && !result.failure && chooseIncidentLocation(result.value, '').source === 'provider') {
      if (cache.size >= maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { storedAt: now(), value: result.value });
    }
    return { ...result, cached: false };
  }

  return {
    async lookup(query) {
      if (typeof query !== 'string' || query.trim() === '') return null;
      return (await lookupInternal(query)).value;
    },
    async resolveLocation(query, manualLabel) {
      const started = now();
      if (typeof query !== 'string' || query.trim() === '') {
        emit({ type: 'geocoding', outcome: 'manual', elapsedMs: 0 });
        return chooseIncidentLocation(null, manualLabel);
      }
      const result = await lookupInternal(query);
      const location = chooseIncidentLocation(result.value, manualLabel);
      const failure = result.failure ?? (location.source === 'manual' ? 'invalid_body' : undefined);
      emit({
        type: 'geocoding',
        outcome: result.cached ? 'cache_hit' : location.source,
        ...(location.source === 'manual' && failure ? { failure } : {}),
        ...(result.status !== undefined ? { status: result.status } : {}),
        elapsedMs: Math.max(0, now() - started),
      });
      return location;
    },
    clearCache() {
      cache.clear();
    },
    cacheSize() {
      return cache.size;
    },
  };
}
