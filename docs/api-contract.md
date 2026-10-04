# Contrato de datos del cliente cloud (Semana 5)

Fuentes: `docs/CAMPUSOPS_API.md`, `course-backend/README.md` y `course-backend/campusops.mjs`.
Todos los datos son ficticios.

## 1. Capas y límite de responsabilidades

| Capa | Archivo | Responsabilidad |
|---|---|---|
| UI | `src/ui/screens/*` | Muestra estados (cargando, lista, vacío, error). No conoce HTTP ni DTOs. |
| Casos de uso / puerto | `src/application/useCases/*`, `src/domain/ports.ts` | Operan con `Incident` (dominio). |
| Adaptador | `src/infrastructure/remoteIncidentRepository.ts` | Implementa el puerto; convierte `ClientError` en `IncidentClientError`. |
| Cliente | `src/api/incidentClient.ts` | HTTP, timeout, validación del sobre y errores tipados. |
| Mapeo | `src/api/incidentMapper.ts` | DTO validado → `Incident`. |
| Validación del sobre | `parseRemoteResource` (`src/course-evaluation`) | Valida `{ id, version, status, payload }`. |

Flujo: `fetch → JSON.parse → parseRemoteResource (DTO) → mapIncidentDto (dominio)`.
Un dato remoto no se usa hasta pasar ambas validaciones.

## 2. DTO remoto vs. objeto de la aplicación

**DTO (servidor)**: `{ id: string, version: entero >= 0, status: string, payload: objeto | null }`.
Campos extra del sobre se ignoran (compatibilidad hacia adelante).

**`payload` de incidencia**: `category`, `description`, `location`, `reporterId`,
`assignedTechnicianId: string | null` (más `priority`, `notes`, `evidence`, `history`, que la app no usa).

**Dominio (`Incident`)**: `id, category, description, location, status, reporterId, assignedTechnicianId`.
`version`, `payload`, `notes`, `evidence` e `history` no llegan a la UI.

Reglas de `mapIncidentDto`:
- `payload: null` → `empty` (respuesta legítima; no se inventan campos).
- `status` fuera de `open|assigned|in_progress|resolved|closed`, `category` fuera del catálogo,
  textos vacíos o tipos incorrectos → `invalid` (error de contrato).

## 3. Solicitudes y respuestas

Cabeceras autenticadas: `Authorization: Bearer <token>` y `X-Course-Actor: <actorId>`.
`X-Course-Scenario` sólo se usa en pruebas contra el backend didáctico.

| Operación | Solicitud | Respuesta 2xx esperada | Resultado del cliente |
|---|---|---|---|
| `login` | `POST /v1/session/login` `{ actorId }` | `{ actorId, role, accessToken, refreshToken, expiresIn }` | `{ actorId }`; el token queda sólo en memoria |
| Lista | `GET /v1/incidents` | `{ items: DTO[] }` | `{ incidents: Incident[], emptyCount }` |
| Detalle | `GET /v1/incidents/:id` | `DTO` | `Incident \| null` (`null` = payload nulo) |
| Crear | `POST /v1/incidents` + `Idempotency-Key` (>= 8 caracteres, estable entre reintentos) con `{ category, description, location }` | `201 { incident: DTO, operationId, duplicate: false }`; repetición con la misma clave: `200 { ..., duplicate: true }` | `{ incident: Incident \| null, duplicate }` |

Lista: si un solo elemento es inválido se rechaza toda la respuesta (`contract`); los elementos con
`payload: null` se omiten y se cuentan en `emptyCount`.

## 4. Representación de errores

El cliente nunca lanza: devuelve `ClientResult<T> = { ok: true, value } | { ok: false, error }`
con `error = { kind, status?, retryAfterMs?, message }`. Los mensajes son fijos, sin tokens,
cuerpos ni datos de la incidencia.

| `kind` | Causa | Distinto de |
|---|---|---|
| `timeout` | Sin respuesta en `timeoutMs` (por defecto 5000); se aborta la solicitud | `network` |
| `network` | Falla de conexión | `timeout` |
| `server` | HTTP 5xx | `contract` |
| `rate_limited` | 429 (conserva `Retry-After`) | `server` |
| `unauthorized` / `forbidden` / `not_found` / `conflict` | 401 / 403 / 404 / 409 (también sin sesión: `unauthorized` sin llamar a la red) | |
| `rejected` | Otro 4xx (p. ej. 422) | |
| `malformed` | 2xx cuyo cuerpo no es JSON | `contract` |
| `contract` | JSON válido que incumple DTO o modelo de dominio | `empty` |

**Vacío vs. inválido**: `payload: null` es éxito sin datos (`null` / `emptyCount`);
un objeto mal formado es el error `contract`. Nunca se sustituye por datos por defecto.

En el borde con la UI, `remoteIncidentRepository` lanza `IncidentClientError` (con `kind`);
las pantallas lo capturan y muestran un mensaje.

## 5. Registros (logs)

`log` recibe sólo `{ event, label, outcome, status }` tras `redactForTelemetry`; no se registran
tokens, cuerpos ni datos de incidencias. Verificado en `week-05-client.test.ts`.

## 6. Variantes del backend usadas en pruebas

`success`, `nullable`, `malformed`, `server_error`, `rate_limited`, `slow` (1200 ms).
Las pruebas corren contra `127.0.0.1` (puerto efímero) o con un doble de `fetch`; no usan
Internet ni proveedores reales.

- `course-tests/team/week-05-client.test.ts` (doble de `fetch`)
- `course-tests/team/week-05-backend-variants.test.ts` (backend local)
- `course-tests/team/week-05-contract.test.ts` (`parseRemoteResource`)
