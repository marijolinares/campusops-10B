# Auditoría de seguridad — Semana 4

**Autor:** Germán Yair Martínez Bolaños  
**Fecha:** 2026-09-24  
**Repositorio:** [campusops-10B](https://github.com/marijolinares/campusops-10B)  
**Rama:** `week4/security-audit-german`

---

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | Mensaje de error expone código HTTP del servidor | Un atacante podría enumerar el comportamiento interno del backend a partir de los códigos de status filtrados en los mensajes de error | Se reemplazó el mensaje dinámico por un mensaje genérico que no revela detalles técnicos | [hallazgo-1-error-tecnico.md](evidence/hallazgo-1-error-tecnico.md) |
| 2 | Función `redactForTelemetry` sin implementar — logs pueden exponer tokens, contraseñas, ubicaciones y datos personales | Cualquier registro de telemetría que pase por esta función lanzaba un error; los desarrolladores podrían hacer `console.log` de objetos completos exponiendo `accessToken`, `password`, `email`, coordenadas GPS y fotos | Se implementó la función completa que sanitiza 20 campos sensibles reemplazándolos por `[REDACTED]`, conservando los campos técnicos seguros | [hallazgo-2-logs-sanitizados.md](evidence/hallazgo-2-logs-sanitizados.md) |
| 3 | El archivo `.env.example` contenía un valor real en lugar de solo el nombre de la variable | Establece un patrón peligroso: si en el futuro se agrega una API Key u otro secreto al `.env.example` con su valor real, quedaría expuesto permanentemente en el historial del repositorio público | Se eliminó el valor, dejando solo el nombre de la variable vacía | [hallazgo-3-env-example.md](evidence/hallazgo-3-env-example.md) |

---

## Hallazgo 1 — Información técnica expuesta en mensajes de error

### Problema encontrado

En el archivo `src/api/courseBackend.ts`, línea 14, el mensaje de error incluía directamente el código de status HTTP del servidor:

```ts
throw new Error(`Backend health failed with ${response.status}`);
```

### Riesgo

Un atacante que provoque errores intencionalmente podría obtener información sobre el comportamiento interno del backend (por ejemplo, distinguir entre un 403 Forbidden, un 500 Internal Server Error o un 404 Not Found). Esta información facilita la enumeración de endpoints y el descubrimiento de configuraciones internas del servidor.

Según la amenaza T-03 del modelo de amenazas del proyecto, los mensajes de error no deben revelar información técnica detallada al usuario o a los logs.

### Solución

Se reemplazó el mensaje dinámico por uno genérico:

### Antes

```ts
throw new Error(`Backend health failed with ${response.status}`);
```

### Después

```ts
throw new Error('No fue posible conectar con el servicio de salud del backend.');
```

### Evidencia

- **Diff de la corrección:** ver [hallazgo-1-error-tecnico.md](evidence/hallazgo-1-error-tecnico.md)
- **TypeScript compila sin errores:** `npx tsc --noEmit` ejecutado exitosamente

---

## Hallazgo 2 — Función de sanitización de logs sin implementar

### Problema encontrado

La función `redactForTelemetry` en `src/course-evaluation/index.ts` estaba definida como un stub que lanzaba un error:

```ts
export function redactForTelemetry(_input: unknown): unknown {
  return pending('redactForTelemetry');
}
```

Esto significaba que **no existía ningún mecanismo de sanitización de logs funcional** en el proyecto. Cualquier `console.log` o sistema de telemetría que registrara objetos de incidencias, sesiones o ubicaciones podría exponer campos sensibles como:

- `accessToken`, `refreshToken`, `password` (sesiones y credenciales)
- `email`, `displayName`, `name` (datos personales)
- `latitude`, `longitude`, `location` (ubicaciones)
- `photos`, `evidence` (evidencia fotográfica)
- `reporterId`, `assignedTechnicianId` (asignaciones internas)

### Riesgo

Este es el problema más grave encontrado. El modelo de amenazas T-03 identifica la filtración de datos en logs como una amenaza de prioridad **Alta**. Sin la función implementada:

1. Los logs pueden ser accesibles por otras apps, herramientas de depuración o servicios de crash reporting.
2. Un token expuesto en logs equivale a comprometer la sesión completa.
3. Las ubicaciones GPS en logs revelan la distribución física de las instalaciones.
4. CAMPUSOPS.md establece explícitamente que logs deben ocultar: tokens/contraseñas, nombre/identificador personal, correo, ubicación, fotos, comentarios internos e historial de asignaciones.

### Solución

Se implementó la función completa `redactForTelemetry` con las siguientes características:

- **20 campos sensibles** identificados y sanitizados (basados en CAMPUSOPS.md y el modelo de amenazas)
- **Recorrido recursivo** de objetos anidados
- **Soporte para arrays** de objetos
- **No muta el objeto original** (crea una copia nueva)
- **Conserva campos técnicos** seguros: `incidentId`, `correlationId`, `status`, `attempt`, `durationMs`

### Antes

```ts
export function redactForTelemetry(_input: unknown): unknown {
  return pending('redactForTelemetry');
}
```

### Después

```ts
const SENSITIVE_KEYS = new Set([
  'authorization', 'password', 'token', 'accessToken', 'refreshToken',
  'email', 'displayName', 'name', 'userId', 'reporterId',
  'technicianId', 'assignedTechnicianId', 'location', 'latitude',
  'longitude', 'photos', 'evidence', 'internalComments', 'assignmentHistory',
]);

// ... (función redactObject con recorrido recursivo)

export function redactForTelemetry(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  if (Array.isArray(input)) return input.map((item) => redactForTelemetry(item));
  return redactObject(input as Record<string, unknown>);
}
```

### Evidencia

- **Código completo y diff:** ver [hallazgo-2-logs-sanitizados.md](evidence/hallazgo-2-logs-sanitizados.md)
- **Ejemplo de entrada/salida** con datos ficticios incluido en la evidencia
- **TypeScript compila sin errores:** `npx tsc --noEmit` ejecutado exitosamente

---

## Hallazgo 3 — Archivo `.env.example` con valor predeterminado

### Problema encontrado

El archivo `.env.example` contenía un valor concreto:

```
EXPO_PUBLIC_COURSE_BACKEND_URL=http://127.0.0.1:4310
```

### Riesgo

Aunque el valor actual (`http://127.0.0.1:4310`) no es un secreto, el archivo `.env.example` establece un patrón de uso. Si en el futuro se añade una variable como `EXPO_PUBLIC_MAPS_API_KEY` con su valor real (lo cual ocurrirá en la semana 9 al integrar el servicio de geocodificación), el mismo patrón de copiar el valor real al ejemplo provocaría que una API Key quede expuesta permanentemente en el historial del repositorio público.

El modelo de amenazas T-04 identifica la exposición de credenciales como amenaza de prioridad **Crítica** y la rúbrica penaliza explícitamente (G3): _"Secreto o dato sensible real expuesto: el componente de seguridad vale 0"_.

### Solución

Se eliminó el valor del archivo `.env.example`, dejando solo el nombre de la variable:

### Antes

```
EXPO_PUBLIC_COURSE_BACKEND_URL=http://127.0.0.1:4310
```

### Después

```
EXPO_PUBLIC_COURSE_BACKEND_URL=
```

### Evidencia

- **Diff y verificación de `.gitignore`:** ver [hallazgo-3-env-example.md](evidence/hallazgo-3-env-example.md)
- **`git status` confirma** que `.env` no aparece como archivo tracked
- **`git ls-files -- .env` confirma** que `.env` nunca fue agregado al repositorio
- **`.gitignore` incluye `.env`** correctamente

---

## Comprobación final

### `git status` — No se subió `.env`

```
$ git status
On branch week4/security-audit-german
Changes not staged for commit:
  modified:   .env.example
  modified:   src/api/courseBackend.ts
  modified:   src/course-evaluation/index.ts

Untracked files:
  docs/evidence/
  docs/security-audit.md
```

✅ El archivo `.env` **no aparece** en la lista — está correctamente excluido por `.gitignore`.

### TypeScript — El proyecto compila sin errores

```
$ npx tsc --noEmit
(sin errores)
```

✅ Todas las correcciones son válidas y no rompen el build.

### Datos ficticios — Confirmación

✅ **Ningún dato real** fue utilizado en esta auditoría.  
Todos los tokens (`course-valid-token`), actores (`reporter-1`), correos (`usuario@ficticio.com`) y coordenadas (`20.6597, -103.3496`) son fixtures públicos del backend didáctico o valores inventados para demostración.
