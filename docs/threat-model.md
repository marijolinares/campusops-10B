## Amenazas — aportación de Irvin 

### Amenaza 1: Filtración de ubicación en logs

- **Activo:** ubicación de la incidencia (latitud/longitud)
- **Frontera de confianza:** App ↔ Proveedor externo (mapas/geocodificación)
- **Amenaza:** las coordenadas quedan expuestas en texto plano en logs de depuración
- **Control que lo reduce:** sanitizar/enmascarar automáticamente las coordenadas antes de escribirlas en cualquier log
- **Prueba que lo verifica:** test que inyecta una ubicación de prueba en el logger y confirma que el archivo de log la muestra enmascarada, no en texto plano
- **Prioridad:** Media
- **Justificación de la prioridad:** no son datos financieros, pero sí revelan ubicación física de personal dentro del campus
- **Riesgo que permanece:** si el proveedor externo de mapas es comprometido, este control no protege ese caso; queda fuera del alcance de esta semana

### Amenaza 2: Consulta no autorizada de fotos de otra incidencia

- **Activo:** fotos de evidencia adjuntas a una incidencia
- **Frontera de confianza:** App (cola offline local) ↔ Backend de CampusOps al sincronizar
- **Amenaza:** un técnico podría consultar la foto de una incidencia que no le pertenece ni tiene asignada
- **Control que lo reduce:** el backend debe verificar que el usuario autenticado sea el reportante o el técnico asignado antes de entregar la foto, sin confiar en el filtrado del cliente
- **Prueba que lo verifica:** prueba de integración donde el Técnico A intenta pedir la foto de una incidencia asignada al Técnico B, y se espera una respuesta de acceso denegado
- **Prioridad:** Alta
- **Justificación de la prioridad:** es exactamente el tipo de amenaza que pide priorizar la actividad (consultar incidencias ajenas)
- **Riesgo que permanece:** si el dispositivo del técnico cachea la foto localmente tras sincronizar, queda expuesta si el dispositivo se pierde o se comparte; fuera de alcance esta semana

- **Datos usados:** todos los ejemplos de esta sección son ficticios (incidencias, técnicos y ubicaciones de prueba), sin datos reales de personal ni del campus.