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

## 4. Reglas de reintento  *(Irvin — pendiente)*

_Se completa con `planRetry`: respeto de `Retry-After`, esperas progresivas, límite (no se reintenta desde el intento 4), demoras finitas y POST sólo con identidad estable._

## 5. Respuesta perdida y reglas de fallo  *(Irvin — pendiente)*

_Se completa con el caso `timeout_after_commit`: misma clave y mismo contenido, sin duplicados; cuándo reintentar, cuándo usar la alternativa y cuándo informar el fallo._

## 6. Pruebas que respaldan esta política

- `course-tests/team/week-09-location.test.ts`: reglas de aceptación, adaptador contra el doble (éxito, incompleto, inválido, malformado, 429, 500, timeout real, desconexión) y caché.
- `course-tests/team/week-09-location-ui.test.tsx`: captura manual desde la interfaz.
