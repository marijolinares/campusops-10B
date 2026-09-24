# Evidencia — Hallazgo 2: Función de sanitización sin implementar (`redactForTelemetry`)

## Archivo afectado

`src/course-evaluation/index.ts`, función `redactForTelemetry`.

## Antes (código con el problema)

```ts
export function redactForTelemetry(_input: unknown): unknown {
  return pending('redactForTelemetry');
}
```

La función lanzaba un error sin implementar ninguna sanitización. Esto significaba que cualquier `console.log` o telemetría que pasara objetos de incidencias, sesiones o ubicaciones podía exponer campos como `accessToken`, `password`, `location`, `latitude`, `longitude`, `evidence`, `photos`, `email`, etc.

## Después (código corregido)

```ts
const SENSITIVE_KEYS = new Set([
  'authorization', 'password', 'token', 'accessToken', 'refreshToken',
  'email', 'displayName', 'name', 'userId', 'reporterId',
  'technicianId', 'assignedTechnicianId', 'location', 'latitude',
  'longitude', 'photos', 'evidence', 'internalComments', 'assignmentHistory',
]);

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      result[key] = redactObject(obj[key] as Record<string, unknown>);
    } else if (Array.isArray(obj[key])) {
      result[key] = (obj[key] as unknown[]).map((item) =>
        typeof item === 'object' && item !== null && !Array.isArray(item)
          ? redactObject(item as Record<string, unknown>)
          : item,
      );
    } else {
      result[key] = obj[key];
    }
  }
  return result;
}

export function redactForTelemetry(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  if (Array.isArray(input)) return input.map((item) => redactForTelemetry(item));
  return redactObject(input as Record<string, unknown>);
}
```

## Comportamiento esperado

### Entrada de ejemplo

```json
{
  "incidentId": "campus-inc-001",
  "status": "assigned",
  "correlationId": "abc-123",
  "attempt": 1,
  "durationMs": 350,
  "accessToken": "course-valid-token",
  "refreshToken": "course-refresh-0",
  "email": "usuario@ficticio.com",
  "password": "ficticio123",
  "location": "Edificio B, laboratorio 2",
  "latitude": 20.6597,
  "longitude": -103.3496,
  "reporterId": "reporter-1",
  "assignedTechnicianId": "technician-1",
  "photos": ["foto1.jpg"],
  "evidence": [{"actorId": "tech-1", "evidenceId": "ev-001"}]
}
```

### Salida después de `redactForTelemetry`

```json
{
  "incidentId": "campus-inc-001",
  "status": "assigned",
  "correlationId": "abc-123",
  "attempt": 1,
  "durationMs": 350,
  "accessToken": "[REDACTED]",
  "refreshToken": "[REDACTED]",
  "email": "[REDACTED]",
  "password": "[REDACTED]",
  "location": "[REDACTED]",
  "latitude": "[REDACTED]",
  "longitude": "[REDACTED]",
  "reporterId": "[REDACTED]",
  "assignedTechnicianId": "[REDACTED]",
  "photos": "[REDACTED]",
  "evidence": "[REDACTED]"
}
```

Los campos técnicos (`incidentId`, `status`, `correlationId`, `attempt`, `durationMs`) se conservan.
Los campos sensibles son reemplazados por `[REDACTED]`.

## Verificación

```
$ npx tsc --noEmit
(sin errores — compila correctamente)
```

La función no muta el objeto original (crea una copia nueva), cumpliendo con el requisito del modelo de amenazas T-03.
