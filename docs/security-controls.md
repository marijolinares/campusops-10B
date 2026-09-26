# Controles de Seguridad y Privacidad

## 1. Identificación de información y su destino

Al utilizar CampusOps, diversas piezas de información sensible pueden terminar almacenadas o expuestas si no se controlan adecuadamente:

- **Sesión y credenciales:** Tokens de acceso (`accessToken`, `refreshToken`), IDs de usuario, contraseñas. Pueden terminar en el almacenamiento local del dispositivo o en logs técnicos si se registran peticiones/respuestas HTTP sin sanitizar.
- **Nombres y Ubicación (GPS/Textual):** Datos personales de reportantes/técnicos y coordenadas de incidencias (`latitude`, `longitude`, `location`). Podrían almacenarse en logs de eventos o enviarse a proveedores externos.
- **Fotografías y evidencia:** Imágenes de daños (`photos`, `evidence`). Podrían quedar expuestas en la galería pública del dispositivo, en logs sin redactar, o en la cola offline.
- **Comentarios internos y Asignaciones:** Podrían aparecer en logs y reportes de errores.

## 2. Mecanismo de almacenamiento seguro

Para los datos de sesión y secretos (tokens de autenticación y credenciales), utilizamos el adaptador **`SecureStorage` (basado en `expo-secure-store`)**.
- **Justificación:** Este mecanismo utiliza almacenamiento seguro respaldado por el sistema operativo nativo (Keychain en iOS, Keystore en Android), cifrando los datos para que no estén disponibles en texto plano ni sean extraídos fácilmente por otras apps. 
- **Riesgo residual:** Si un dispositivo es alterado a nivel sistema (root/jailbreak), un atacante avanzado podría eventualmente comprometer el entorno seguro. Además, en entornos como la web, SecureStore hace *fallback* a memoria, lo cual debe ser considerado si se despliega en web (nuestro caso primario es móvil). 

## 3. Relación con las amenazas del modelo (Semana 3)

### T-03: Filtrar datos sensibles en registros/logs
- **Control implementado:** Implementamos la función `redactForTelemetry` en `src/course-evaluation/index.ts` y su integración en `src/infrastructure/secureStorage.ts` mediante `sanitizedLog` y `reportErrorSafely`.
- **Relación:** Mitiga directamente la amenaza T-03 asegurando que toda información de contexto enviada a telemetría o logs pase por sanitización profunda. Las claves sensibles como `authorization`, `token`, `latitude`, `longitude`, o `photos` son reemplazadas por `[REDACTED]`, conservando solo información técnica segura.

### T-04: Exponer credenciales y secretos
- **Control implementado:** Uso de `expo-secure-store` para manejar secretos en el dispositivo, sumado a los controles de CI (búsqueda de secretos) para evitar filtraciones en el repositorio.
- **Relación:** Mitiga la amenaza crítica T-04 al evitar que cualquier token, API key o secreto de acceso se registre en código fuente, se persista en logs, o se almacene de forma insegura en el dispositivo.
