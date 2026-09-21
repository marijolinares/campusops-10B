# Modelo de amenazas — CampusOps

**Versión:** 1.0  
**Fecha:** 2026-09-19  
**Autores:** Germán Yair Martínez Bolaños (amenazas generales + priorización), Irvin Isael Martínez Alejo (amenazas de fotografías y ubicación + revisión técnica), María José Linares (workflow CI + security.json)

> Todos los datos, cuentas y ubicaciones son **ficticios**. No se usan credenciales, personas ni instalaciones reales.

---

## 1. Activos — ¿Qué hay que proteger?

| ID | Activo | Descripción | Sensibilidad |
|---|---|---|---|
| A-01 | Incidencias | Reportes de fallas: categoría, descripción, estado, historial de cambios, diagnóstico. Contienen contexto operativo del campus ficticio. | Alta — acceso indebido revela patrones de fallas y operación interna. |
| A-02 | Sesiones y credenciales | Tokens de acceso (`accessToken`, `refreshToken`), identificadores de actor (`actorId`), datos de autenticación. | Crítica — un token robado permite suplantar cualquier perfil. |
| A-03 | Fotografías (evidencia) | Imágenes adjuntas a incidencias: evidencia fotográfica de daños, diagnóstico visual. | Alta — pueden contener información contextual sensible (placas de equipo, ubicaciones internas, personas). |
| A-04 | Ubicaciones | Coordenadas GPS, etiquetas de edificio/zona, datos de geocodificación. | Media-alta — revelan la distribución física de las instalaciones y la localización de fallas. |
| A-05 | Asignaciones | Relación técnico ↔ incidencia, prioridad, historial de reasignaciones. | Alta — alterarlas impacta la operación: un atacante podría desviar o bloquear la atención. |
| A-06 | Registros técnicos (logs) | Registros de depuración y telemetría: IDs de correlación, intentos, duraciones, códigos de error. | Media — si no se sanitizan, filtran tokens, nombres, ubicaciones o historial de asignaciones. |

---

## 2. Fronteras de confianza — ¿Dónde cambia el nivel de confianza?

```
┌──────────────────────────────────────────────────────────┐
│                     Dispositivo del usuario               │
│  ┌────────────────────┐    ┌──────────────────────────┐  │
│  │  App CampusOps     │    │  Almacenamiento local    │  │
│  │  (React Native /   │    │  (AsyncStorage, cola     │  │
│  │   Expo)            │    │   offline, fotos pend.)  │  │
│  └────────┬───────────┘    └──────────────────────────┘  │
│           │                                               │
└───────────┼───────────────────────────────────────────────┘
            │  ← FRONTERA F-01: App ↔ Backend
            │     (HTTPS, tokens Bearer, red no confiable)
┌───────────┼───────────────────────────────────────────────┐
│           ▼                                               │
│  ┌────────────────────┐                                   │
│  │  Backend CampusOps │  ← Servidor didáctico (127.0.0.1)│
│  │  (API REST v1)     │                                   │
│  └────────┬───────────┘                                   │
│           │                                               │
└───────────┼───────────────────────────────────────────────┘
            │  ← FRONTERA F-02: Backend ↔ Persistencia servidor
            ▼
    [Estado en memoria del simulador]

┌───────────────────────────────────────────────────────────┐
│  Proveedor externo de geocodificación                     │
│  (servicio de mapas de terceros)                          │
└───────────────────────────────────────────────────────────┘
     ↑  FRONTERA F-03: App ↔ Proveedor externo
     │  (red pública, API key, cuotas, datos de ubicación)
```

| ID | Frontera | Componentes separados | Riesgo principal |
|---|---|---|---|
| F-01 | App ↔ Backend | Aplicación móvil ↔ API REST CampusOps | El token viaja por red; la app no controla el servidor. Un intermediario podría interceptar o modificar peticiones. |
| F-02 | Backend ↔ Persistencia | API REST ↔ almacenamiento del servidor | El estado del servidor define la verdad; la app confía en las respuestas. Un servidor comprometido envía datos manipulados. |
| F-03 | App ↔ Proveedor externo | Aplicación ↔ servicio de geocodificación | La API key se expone si se incluye en el código fuente. El proveedor puede devolver datos incorrectos, parciales o no responder. |
| F-04 | App ↔ Almacenamiento local | Lógica de la app ↔ AsyncStorage / cola offline | Datos en el dispositivo accesibles si no hay protección adecuada; fotos pendientes pueden persistir tras desinstalar. |
| F-05 | App ↔ Permisos del SO | La app ↔ APIs de cámara, galería, ubicación del dispositivo | La app solicita recursos del SO; el usuario puede denegar o revocar. Los datos capturados (fotos, GPS) deben protegerse. |

---

## 3. Amenazas priorizadas

Las amenazas se priorizan usando una escala de **impacto** (qué tan grave es la consecuencia) × **probabilidad** (qué tan fácil es explotar la vulnerabilidad), resultando en un nivel de riesgo: **Crítico**, **Alto**, **Medio** o **Bajo**.

### T-01 — Consultar incidencias ajenas (acceso no autorizado)

| Campo | Detalle |
|---|---|
| **Amenaza** | Un usuario con perfil Reportante manipula la petición HTTP (cambiando el `actorId` en el header `X-Course-Actor` o alterando el ID en `GET /v1/incidents/:id`) para consultar incidencias que no le pertenecen. |
| **Activo afectado** | A-01 (Incidencias), A-03 (Fotografías), A-04 (Ubicaciones) |
| **Frontera** | F-01 (App ↔ Backend) |
| **Impacto** | Alto — se expone información de incidencias, ubicaciones y evidencia fotográfica de otros reportantes o del equipo técnico. |
| **Probabilidad** | Alta — basta con modificar un header HTTP o el ID en la URL; no requiere herramientas sofisticadas. |
| **Prioridad** | 🔴 **Crítica** |
| **Justificación de la prioridad** | Es la amenaza con mayor facilidad de explotación y afecta la confidencialidad de múltiples activos simultáneamente. Un reportante no debe ver incidencias ajenas (CAMPUSOPS.md: "reportante ve sus reportes"). |
| **Control** | **C-01 — Filtrado por perfil en el backend.** El servidor valida que el actor autenticado (token + `X-Course-Actor`) solo acceda a incidencias que le corresponden según su perfil: Reportante ve solo las suyas, Técnico ve solo las asignadas, Coordinador ve todas. La app no confía en filtrado del lado del cliente. |
| **Verificación** | Prueba automatizada que intenta `GET /v1/incidents` con `reporter-1` y verifica que no devuelve incidencias de `reporter-2`. Se valida también que `GET /v1/incidents/campus-inc-002` con `reporter-1` devuelve 403 o lista vacía. |
| **Comando de verificación** | `npx jest --testPathPattern="course-tests/public/week-03" --no-coverage` |
| **Riesgo residual** | Si el token de un usuario es robado (ver T-04), el atacante puede consultar las incidencias del perfil suplantado. Este riesgo se mitiga parcialmente con expiración de sesión y refresh controlado (semana 6). |

---

### T-02 — Alterar asignaciones sin autorización

| Campo | Detalle |
|---|---|
| **Amenaza** | Un usuario con perfil Técnico envía `POST /v1/incidents/:id/actions` con `action: "assign"` para reasignar una incidencia a otro técnico, o modifica la prioridad sin tener perfil de Coordinador. |
| **Activo afectado** | A-05 (Asignaciones), A-01 (Incidencias) |
| **Frontera** | F-01 (App ↔ Backend) |
| **Impacto** | Alto — altera la cadena de atención: incidencias podrían quedar sin técnico, ser desviadas, o su prioridad ser manipulada. |
| **Probabilidad** | Media — requiere conocer el endpoint y fabricar un payload; el backend debe verificar roles. |
| **Prioridad** | 🔴 **Alta** |
| **Justificación de la prioridad** | Impacta directamente la operación del campus. La integridad de las asignaciones es esencial para el flujo `assigned → in_progress → resolved → closed`. Un técnico no debe poder reasignar ni un reportante priorizar. |
| **Control** | **C-02 — Validación de perfil por acción en el backend.** El servidor comprueba que la acción solicitada es válida para el perfil del actor: solo Coordinador puede `assign`, `prioritize`, `close` y `reopen`; solo el Técnico asignado puede `start` y `resolve`; Reportante solo puede `comment` y `add_evidence` en sus incidencias. La respuesta es 403 si el perfil no tiene permiso. |
| **Verificación** | Prueba que envía `POST /v1/incidents/campus-inc-001/actions` con `action: "assign"` desde `technician-1` y valida que el servidor responde 403. Se verifica que `coordinator-1` sí puede ejecutar la misma acción exitosamente. |
| **Comando de verificación** | `npx jest --testPathPattern="course-tests/public/week-03" --no-coverage` |
| **Riesgo residual** | Un coordinador legítimo podría reasignar maliciosamente. Este riesgo se controla con el historial inmutable de cambios (cada acción queda registrada con actor y timestamp), permitiendo auditoría posterior. |

---

### T-03 — Filtrar datos sensibles en registros/logs

| Campo | Detalle |
|---|---|
| **Amenaza** | Los registros técnicos (console.log, telemetría, reportes de error) incluyen datos sensibles en texto plano: tokens de sesión, nombres de usuario, correos, ubicaciones GPS, contenido de fotos, comentarios internos o historial de asignaciones. Un log exportado o accesible revela información protegida. |
| **Activo afectado** | A-02 (Sesiones), A-04 (Ubicaciones), A-06 (Registros), A-03 (Fotografías) |
| **Frontera** | F-04 (App ↔ Almacenamiento local), F-01 (App ↔ Backend) |
| **Impacto** | Medio-alto — los logs pueden ser accesibles por otras apps, herramientas de depuración, o servicios de crash reporting. Exponer un token equivale a comprometer la sesión. |
| **Probabilidad** | Alta — los desarrolladores frecuentemente registran objetos completos (request/response) durante el desarrollo sin sanitizar. |
| **Prioridad** | 🟠 **Alta** |
| **Justificación de la prioridad** | Es un vector de fuga silenciosa: no se detecta hasta que alguien inspecciona los logs. CAMPUSOPS.md establece explícitamente qué campos deben ocultarse. La función `redactForTelemetry` (semana 4) es el control central. |
| **Control** | **C-03 — Sanitización de logs con `redactForTelemetry`.** Toda salida de telemetría pasa por la función de sanitización que sustituye por `[REDACTED]` los campos sensibles definidos en CAMPUSOPS_API.md: `authorization`, `password`, `token`, `accessToken`, `refreshToken`, `email`, `displayName`, `name`, `userId`, `reporterId`, `technicianId`, `assignedTechnicianId`, `location`, `latitude`, `longitude`, `photos`, `evidence`, `internalComments`, `assignmentHistory`. Los campos técnicos (`incidentId`, `correlationId`, `status`, `attempt`, `durationMs`) se conservan. |
| **Verificación** | Prueba unitaria que pasa un objeto con todos los campos sensibles a `redactForTelemetry` y verifica que cada uno es reemplazado por `[REDACTED]`, mientras los campos técnicos permanecen intactos. Se verifica también que la función no muta el objeto original. |
| **Comando de verificación** | `npx jest --testPathPattern="redact" --no-coverage` (disponible desde semana 4) |
| **Riesgo residual** | Un desarrollador podría agregar un `console.log` que registre datos sensibles sin pasar por la función de sanitización. Mitigación: regla de lint o revisión de código que prohíba `console.log` directo en producción y búsqueda de secretos en CI (`grep -r` por patrones de tokens). |

---

### T-04 — Exponer credenciales y secretos

| Campo | Detalle |
|---|---|
| **Amenaza** | Tokens de API, claves de geocodificación, contraseñas o secretos del backend se incluyen en el código fuente, archivos de configuración versionados, variables de entorno hardcodeadas, o artefactos de build publicados. Al hacer push al repositorio público de GitHub, quedan expuestos permanentemente en el historial. |
| **Activo afectado** | A-02 (Sesiones y credenciales) |
| **Frontera** | F-03 (App ↔ Proveedor externo), F-01 (App ↔ Backend) |
| **Impacto** | Crítico — un secreto expuesto permite suplantación completa, acceso a servicios externos con el presupuesto del proyecto, y no se puede "deshacer" de un repositorio público sin reescribir el historial. |
| **Probabilidad** | Media — el proyecto usa fixtures públicos (`course-valid-token` como token de prueba, no como secreto real), pero al integrar un proveedor de mapas (semana 9) se introduce una API key real. |
| **Prioridad** | 🔴 **Crítica** |
| **Justificación de la prioridad** | Es la amenaza con mayor impacto potencial. La rúbrica penaliza explícitamente (G3): "Secreto o dato sensible real expuesto: el componente de seguridad vale 0, máximo 4.8/8 y revocación de la credencial expuesta". La prevención debe ser automática. |
| **Control** | **C-04 — Búsqueda de secretos en CI + .gitignore.** El workflow de GitHub Actions incluye un paso de búsqueda de secretos (`grep -rn` por patrones comunes: `password`, `secret`, `api_key`, `private_key`, archivos `.env`). El `.gitignore` excluye `.env`, `.env.local` y archivos de credenciales. Los valores de prueba (`course-valid-token`) se documentan como fixtures públicos, no como secretos. |
| **Verificación** | El paso `make verify-week-03` incluye búsqueda de secretos. Se verifica que no haya archivos `.env` ni patrones de credenciales en el repositorio versionado. Se introduce intencionalmente un archivo con un secreto ficticio, se confirma que el CI falla, y se remueve para restaurar el pipeline. |
| **Comando de verificación** | `make verify-week-03` y revisión manual de `git log --all --diff-filter=A -- '*.env' '.env*'` |
| **Riesgo residual** | Secretos que usen patrones no cubiertos por la búsqueda automatizada podrían pasar desapercibidos. Mitigación adicional: GitHub Secret Scanning (disponible en repos públicos) y revisión de pull requests. |

---

### T-05 — Acceso no autorizado a fotografías

| Campo | Detalle |
|---|---|
| **Amenaza** | Las fotografías adjuntas a una incidencia (evidencia de daños, diagnóstico visual) son accesibles por usuarios que no tienen relación con esa incidencia. Un Reportante podría acceder a las fotos de evidencia de un Técnico en otra incidencia, o las fotos pendientes en la cola offline son accesibles desde el sistema de archivos del dispositivo. **Ejemplo concreto:** el Técnico A, autenticado con su propio token, solicita `GET /v1/incidents/campus-inc-002/photos` de una incidencia asignada al Técnico B; se espera que el backend responda con acceso denegado (403) en vez de servir la foto. **Vector adicional:** cuando la cola offline sincroniza con el backend tras recuperar conexión, cada operación pendiente (`PendingIncidentOperation`) debe validar el `actorId` original antes de subir o exponer la foto. |
| **Activo afectado** | A-03 (Fotografías) |
| **Frontera** | F-01 (App ↔ Backend), F-04 (App ↔ Almacenamiento local), F-05 (App ↔ Permisos del SO) |
| **Impacto** | Medio-alto — las fotografías pueden contener información visual sensible: placas de equipos, distribución de laboratorios, personas en el entorno. |
| **Probabilidad** | Media — requiere acceso a los endpoints de evidencia o al almacenamiento local del dispositivo. |
| **Prioridad** | 🟠 **Media-alta** |
| **Justificación de la prioridad** | Las fotos son el activo con mayor contenido visual; su exposición tiene impacto de privacidad que trasciende el texto. CAMPUSOPS.md exige que los logs oculten `photos` y `evidence`. |
| **Control** | **C-05 — Acceso a fotos vinculado al perfil + permisos mínimos del SO.** El backend solo entrega evidencia fotográfica al actor vinculado a la incidencia (reportante, técnico asignado, o coordinador). La app solicita permiso de cámara solo al momento de fotografiar y usa el selector del sistema para imágenes existentes, sin acceso indiscriminado a la galería. Las fotos pendientes se almacenan en el directorio de la app, no en almacenamiento público. |
| **Verificación** | Prueba que verifica que `GET /v1/incidents/:id` con un actor no vinculado no incluye fotos de evidencia. Prueba manual de que la app funciona si se deniega el permiso de cámara (el flujo continúa sin foto). |
| **Comando de verificación** | `npx jest --testPathPattern="course-tests/public/week-03" --no-coverage` |
| **Riesgo residual** | Si el dispositivo está rooteado o comprometido, un atacante con acceso al sistema de archivos puede leer las fotos pendientes. Mitigación parcial: cifrado del almacenamiento local (extensión futura, no requerida en el mínimo). |

---

### T-06 — Exposición de ubicaciones precisas

| Campo | Detalle |
|---|---|
| **Amenaza** | Las coordenadas GPS exactas de las incidencias se transmiten, almacenan o registran sin necesidad, revelando la ubicación precisa de fallas y la distribución del campus. El proveedor de geocodificación externo recibe coordenadas y podría correlacionarlas con la identidad del usuario. **Caso concreto:** un `console.log` de depuración registra el objeto completo de la incidencia (incluyendo `latitude`/`longitude`) en texto plano antes de pasar por `redactForTelemetry`; si ese log llega a un archivo persistente o a la salida de CI, la ubicación exacta queda expuesta sin comprometer red ni backend. |
| **Activo afectado** | A-04 (Ubicaciones) |
| **Frontera** | F-03 (App ↔ Proveedor externo), F-01 (App ↔ Backend) |
| **Impacto** | Medio — las coordenadas ficticias no exponen personas reales, pero el patrón de diseño debe proteger ubicaciones reales en un despliegue futuro. |
| **Probabilidad** | Media — la app envía coordenadas al backend y al proveedor de geocodificación como parte del flujo normal. |
| **Prioridad** | 🟡 **Media** |
| **Justificación de la prioridad** | Menor impacto que las amenazas de sesión o asignaciones, pero relevante por la interacción con proveedor externo (F-03) y la posibilidad de correlación. |
| **Control** | **C-06 — Ubicación bajo demanda + etiqueta textual como alternativa.** La app solicita ubicación GPS solo cuando el usuario lo necesita (no en segundo plano, CAMPUSOPS.md). Si la geocodificación falla, se permite captura manual de edificio/zona/referencia textual (`selectIncidentLocation` en semana 9). Los logs sanitizan `latitude`, `longitude` y `location` con `[REDACTED]`. |
| **Verificación** | Prueba que `redactForTelemetry` redacta `latitude`, `longitude` y `location`. Verificación manual de que la app no solicita ubicación en segundo plano (solo `whenInUse`). |
| **Comando de verificación** | `npx jest --testPathPattern="redact" --no-coverage` (semana 4) |
| **Riesgo residual** | El proveedor de geocodificación externo retiene las consultas enviadas. Mitigación: caché local para evitar consultas repetidas al proveedor con las mismas coordenadas. |

---

## 4. Resumen de priorización

| Prioridad | Amenaza | Control | Verificación disponible |
|---|---|---|---|
| 🔴 Crítica | T-04 — Exponer credenciales | C-04 — Búsqueda de secretos en CI | `make verify-week-03` |
| 🔴 Crítica | T-01 — Consultar incidencias ajenas | C-01 — Filtrado por perfil en backend | Tests públicos semana 03 |
| 🔴 Alta | T-02 — Alterar asignaciones | C-02 — Validación de perfil por acción | Tests públicos semana 03 |
| 🟠 Alta | T-03 — Filtrar datos en logs | C-03 — Sanitización `redactForTelemetry` | Tests de redacción (semana 4) |
| 🟠 Media-alta | T-05 — Acceso no autorizado a fotos | C-05 — Acceso vinculado + permisos mínimos | Tests de autorización + manual |
| 🟡 Media | T-06 — Exposición de ubicaciones | C-06 — Ubicación bajo demanda + textual | Tests de redacción + manual |

**Decisión justificada:** Atendemos primero **T-04 (Exponer credenciales)** y **T-01 (Consultar incidencias ajenas)** porque:

1. T-04 es irreversible en un repositorio público y la rúbrica lo penaliza explícitamente (gate G3). El control C-04 se integra al workflow de CI esta misma semana, proporcionando detección automática continua.
2. T-01 es la amenaza con mayor facilidad de explotación (solo requiere modificar un header) y afecta la confidencialidad de tres activos simultáneamente.

---

## 5. Relación con la arquitectura (ADR-001)

La Clean Architecture adoptada en ADR-001 facilita los controles de seguridad:

| Capa | Control de seguridad |
|---|---|
| **Domain** | Define los puertos con contratos que incluyen el actor/perfil como parámetro, asegurando que las reglas de autorización sean parte del dominio, no de la infraestructura. |
| **Application** | Los casos de uso validan el perfil del actor antes de ejecutar la operación (C-01, C-02). |
| **Infrastructure** | Los adaptadores implementan sanitización (C-03) y no exponen credenciales en su configuración (C-04). El adaptador de geocodificación maneja el proveedor externo con alternativa manual (C-06). |
| **UI** | Oculta botones según perfil (complemento visual, no control de seguridad). Solicita permisos del SO bajo demanda (C-05). |

---

## 6. Datos ficticios utilizados

- **Actores de prueba:** `reporter-1`, `reporter-2`, `technician-1`, `technician-2`, `coordinator-1` (fixtures del backend didáctico).
- **Incidencias ficticias:** `campus-inc-001` (falla eléctrica, Edificio B), `campus-inc-002` (fuga de agua, Edificio A).
- **Token de prueba:** `course-valid-token` (fixture público, no es un secreto real).
- **Coordenadas ficticias:** latitud `20.6597`, longitud `-103.3496` (campus ficticio).
- **Proveedor de geocodificación:** doble determinista del backend (`GET /v1/geocoding?q=...`).

---

## Referencias

- `docs/CAMPUSOPS.md` — alcance, perfiles, privacidad y permisos.
- `docs/CAMPUSOPS_API.md` — contrato público de la API, actores de prueba, variantes.
- `docs/adr/ADR-001-architecture.md` — arquitectura Clean Architecture por capas.
- `docs/architecture.mmd` — diagrama de fronteras de confianza por capa.

