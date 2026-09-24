# Auditoría de seguridad — Semana 4

Autor: Irvin Isael Martinez Alejo
Proyecto: campusops-10B

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | CORS abierto a cualquier origen en `course-backend/server.mjs` | Cualquier sitio web podría hacer peticiones al backend local sin restricción | Se restringió el origen mediante la variable `COURSE_BACKEND_ALLOWED_ORIGIN` | evidence/cors-corregido.png |
| 2 | `redactForTelemetry` en `src/course-evaluation/index.ts` no estaba implementada | Tokens, correos y ubicaciones podían enviarse sin redactar a logs/telemetría | Se implementó una función de redacción recursiva basada en claves sensibles | evidence/redact-tests-pasando.png |
| 3 | `audit:ci` solo fallaba ante vulnerabilidades críticas | Vulnerabilidades altas en dependencias podían pasar desapercibidas en CI | Se bajó el umbral a `--audit-level=high` | evidence/audit-ci.png |

## Hallazgo 1 — CORS abierto
### Problema encontrado
En `course-backend/server.mjs` la respuesta HTTP incluía `'access-control-allow-origin': '*'`.
### Riesgo
Cualquier origen (incluyendo sitios maliciosos) podía consumir la API local sin restricción.
### Solución
Se reemplazó por una variable de entorno `COURSE_BACKEND_ALLOWED_ORIGIN` con valor por defecto `http://localhost:8081`.
### Antes
\`\`\`js
'access-control-allow-origin': '*',
\`\`\`
### Después
\`\`\`js
'access-control-allow-origin': allowedOrigin,
\`\`\`
### Evidencia
Ver evidence/cors-corregido.png (salida de `curl -i` mostrando el nuevo header).

## Hallazgo 2 — Redacción de telemetría faltante
### Problema encontrado
`redactForTelemetry` en `src/course-evaluation/index.ts` solo lanzaba un error (`pending`), por lo que no existía ninguna redacción real de datos sensibles.
### Riesgo
Datos como tokens de acceso, correos electrónicos, ubicación y comentarios internos podían enviarse sin redactar a un sistema de logs/telemetría.
### Solución
Se implementó una función recursiva que reemplaza por `[REDACTED]` cualquier campo cuya clave coincida con una lista de claves sensibles (`authorization`, `accessToken`, `email`, `location`, etc.), preservando el resto de la estructura.
### Evidencia
Ver evidence/redact-tests-pasando.png (pruebas `week-04.test.ts` y `week-10.test.ts` pasando).

## Hallazgo 3 — Umbral de auditoría de dependencias
### Problema encontrado
El script `audit:ci` solo fallaba ante vulnerabilidades críticas.
### Riesgo
Vulnerabilidades de severidad alta podían acumularse sin bloquear el pipeline.
### Solución
Se cambió `--audit-level=critical` por `--audit-level=high`.
### Evidencia
Ver evidence/audit-ci.png.