# Política de resiliencia de CampusOps (semana 9)

Este documento lo completa el equipo por secciones. Cada sección indica quién la escribe y qué código la respalda.

## 1. Proveedor de ubicación y ejecución externa  *(German)*

**Proveedor real:** Nominatim, el servicio de geocodificación de OpenStreetMap (`https://nominatim.openstreetmap.org/search`). Se eligió porque no requiere cuenta ni clave, de modo que no hay credenciales que proteger en el repositorio.

**Restricciones del proveedor (política de uso de Nominatim):**

| Restricción | Cómo la respetamos |
|---|---|
| Máximo 1 solicitud por segundo | La caché evita repetir consultas iguales; la evidencia real hace una sola solicitud |
| Cabecera `User-Agent` que identifique la aplicación | `CampusOps-DMI-student-test/1.0` con contacto del equipo |
| Prohibido el uso intensivo o masivo | Sólo una consulta de prueba; sin ráfagas |
| Caché obligatoria para consultas repetidas | `geocodingClient` guarda resultados válidos 10 minutos |
| Atribución a OpenStreetMap (ODbL) | Se cita aquí; la app debe mostrarla si presenta mapas |
| Sin garantía de disponibilidad ni cuota por contrato | Toda falla cae a ubicación manual |

**Adaptador:** [`src/api/geocodingClient.ts`](../src/api/geocodingClient.ts). La app sólo conoce `resolveLocation(consulta, etiquetaManual)` y siempre recibe una `IncidentLocation` válida. `normalizeNominatim` convierte la respuesta del proveedor (arreglo con `display_name`, `lat` y `lon` como texto) al formato `{ label, latitude, longitude }`. Cambiar de proveedor sólo requiere otro `endpoint` y otro normalizador.

**Decisión de aceptación:** [`src/domain/location.ts`](../src/domain/location.ts), expuesta como `selectIncidentLocation` en `src/course-evaluation/index.ts`. Se acepta únicamente un objeto con `label` textual no vacío y latitud/longitud numéricas finitas dentro de [-90, 90] y [-180, 180]. Todo lo demás se trata como no disponible.

**Ejecución real con datos ficticios:** `reports/week-09/provider-real-run.json` (consulta a Nominatim por un lugar público, sin datos personales, ni de incidencias, ni credenciales) generada con `tools/week-09-provider-real-run.mjs`. Las pruebas automáticas **no** dependen de Internet: usan el doble controlado del curso (`course-backend`, `/v1/geocoding` con `X-Course-Scenario`).

**Privacidad:** los eventos de registro (`GeocodingEvent`) guardan sólo resultado, tipo de fallo, estado HTTP y duración. Nunca la consulta, la etiqueta ni las coordenadas.

## 2. Caché  *(German)*

- Clave: consulta recortada y en minúsculas, por lo que `"Edificio A"` y `"  edificio a "` comparten entrada.
- Vigencia (`cacheTtlMs`): 10 minutos por defecto; `0` desactiva la caché. Máximo `cacheMaxEntries` = 50, se descarta la entrada más antigua.
- **Sólo se guardan respuestas utilizables** (las que `selectIncidentLocation` aceptaría como `provider`). Los fallos (429, 5xx, timeout, desconexión) y los datos incompletos o inválidos **no se cachean**, para poder reintentar cuando el proveedor se recupere.
- El reloj es inyectable (`now`), por lo que el vencimiento se comprueba sin esperas reales.

## 3. Ubicación manual  *(German)*

La alternativa manual siempre está disponible: [`src/ui/components/LocationField.tsx`](../src/ui/components/LocationField.tsx) permite escribir edificio, zona o referencia.

| Situación del proveedor | Resultado en la app |
|---|---|
| Respuesta válida | `{ source: 'provider', label, latitude, longitude }` |
| `null`, objeto incompleto, coordenadas inválidas o tipos incorrectos | `{ source: 'manual', label: <lo escrito> }` |
| Timeout (3 s por defecto, configurable) | Ubicación manual; se avisa con un mensaje |
| 429, 5xx o cuerpo ilegible | Ubicación manual |
| Sin conexión | Ubicación manual |
| Texto vacío | No se llama al proveedor; se pide escribir una referencia |

**Nunca se inventan coordenadas:** la ubicación manual no incluye `latitude` ni `longitude`.

## 4. Reglas de reintento  *(Irvin: función de decisión; Majo: conexión con el adaptador)*

Decisión pura: [`src/domain/retry.ts`](../src/domain/retry.ts) (`decideRetry`, expuesta como `planRetry`). Ejecución: [`src/application/retryOperation.ts`](../src/application/retryOperation.ts) (`withRetry`). Primer consumidor real: la opción `retry` de [`src/api/geocodingClient.ts`](../src/api/geocodingClient.ts).

| Regla | Valor |
|---|---|
| Qué se reintenta | `timeout`, 429 y 5xx. Nunca otros 4xx (404, 422, 409…), cuerpo ilegible ni errores de contrato |
| Intentos | Se reintenta tras los intentos 1, 2 y 3. Desde el intento 4 ya no (4 intentos como máximo) |
| Espera | Progresiva: 500 ms, 1000 ms, 2000 ms (`base × 2^(intento−1)`), con tope de 5000 ms |
| `Retry-After` | Si es válido (número finito > 0) manda sobre la espera calculada. Si pide más que el tope (5 s) **no se reintenta** y se informa o se usa la alternativa |
| Demoras | Siempre finitas; un valor inválido (negativo, NaN, infinito) se ignora |
| POST | Sólo se reintenta con una `Idempotency-Key` estable y el mismo contenido. Sin clave: un solo intento |
| GET | Reintentable sin clave (no cambia el estado del servidor) |
| Pruebas sin esperar | `sleep` es inyectable: las pruebas no duermen de verdad |

**Registro:** `onAttempt` entrega sólo `{ attempt, outcome, status, delayMs }`. Nunca cuerpos, tokens, consultas ni datos de la incidencia.

## 5. Respuesta perdida y reglas de fallo  *(Irvin: reglas; Majo: prueba con el backend)*

**Respuesta perdida:** el cliente envía un POST, el servidor lo guarda, pero la respuesta no llega y el cliente cuenta un timeout. Si el cliente creara otra operación habría un duplicado. Por eso el reintento reutiliza **la misma clave y el mismo contenido**: el servidor reconoce la operación y responde `200` con `duplicate: true`, sin repetir el efecto.

Prueba contra el backend didáctico real (`X-Course-Scenario: timeout_after_commit`): [`course-tests/team/week-09-lost-response.test.ts`](../course-tests/team/week-09-lost-response.test.ts). Comprueba que el primer intento termina en timeout, el segundo devuelve `200` y `duplicate: true`, y que al final existe **una sola** incidencia con esa descripción. Una segunda prueba comprueba que un POST sin clave no se reintenta.

**Qué hacer según el fallo:**

| Situación | Acción |
|---|---|
| Timeout, 429 con espera aceptable, 5xx | Reintentar según la sección 4 |
| 429 con `Retry-After` mayor al tope | No reintentar; informar o usar la alternativa |
| Se agotan los intentos | Geocodificación: ubicación manual. Operaciones de incidencia: la operación queda pendiente en la cola (política de sincronización, `docs/sync-policy.md`) |
| POST sin clave estable | No reintentar; informar al usuario |
| 409 `idempotency_key_reused` o `version_conflict` | No reintentar: es un conflicto, no una falla temporal |
| 4xx de validación (422) | No reintentar; corregir los datos |
| Cuerpo ilegible o contrato inválido | No reintentar; tratar como resultado no disponible |

## 6. Pruebas que respaldan esta política

- `course-tests/team/week-09-location.test.ts`: reglas de aceptación, adaptador contra el doble (éxito, incompleto, inválido, malformado, 429, 500, timeout real, desconexión) y caché.
- `course-tests/team/week-09-location-ui.test.tsx`: captura manual desde la interfaz.
- `course-tests/team/week-09-retry.test.ts`: `planRetry` y `withRetry` (límite, esperas, `Retry-After`, POST con y sin clave).
- `course-tests/team/week-09-geocoding-retry.test.ts`: el adaptador de geocodificación aplica la política de reintento.
- `course-tests/team/week-09-lost-response.test.ts`: respuesta perdida contra el backend real, sin duplicados.
