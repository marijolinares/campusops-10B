# Definición del problema — CampusOps

## Problema

Cuando una incidencia es reasignada de un técnico a otro (por ejemplo, porque el
coordinador decide que otro técnico está mejor posicionado o disponible), el
sistema debe garantizar que solo el técnico vigente pueda modificar esa
incidencia. Sin esta validación, un técnico que ya no tiene la incidencia
asignada podría seguir registrando diagnósticos, notas o cambios de estado,
generando información inconsistente, decisiones duplicadas o conflictos de
responsabilidad sobre quién atendió realmente el caso. CampusOps debe resolver
este problema verificando la asignación vigente antes de permitir cualquier
acción de un técnico sobre una incidencia.

## Alcance

### Incluye

- Los tres perfiles de usuario (Reportante, Técnico, Coordinador) con sus funciones
  y permisos diferenciados dentro de una sola aplicación.
- El flujo completo de estados de una incidencia: abierta, asignada, en proceso,
  resuelta y cerrada, incluyendo la reapertura por parte de coordinación.
- Validación de que solo el técnico con la asignación vigente puede modificar
  una incidencia, incluyendo el registro de historial cuando ocurre una
  reasignación.

### No incluye

- Pagos o cualquier flujo de facturación.
- Chat en tiempo real entre usuarios.
- Inteligencia artificial o reconocimiento automático de imágenes.
- Panel web administrativo completo (fuera de la app móvil).
- Publicación obligatoria en tiendas de aplicaciones o soporte iOS (este último es
  una extensión voluntaria, no un requisito del núcleo).

## Actores y responsabilidades

- **Reportante:** crear una incidencia especificando categoría, descripción y
  ubicación, adjuntar fotografías, consultar el estado de sus propios reportes y
  agregar información posterior si es necesario.
- **Técnico:** consultar las incidencias que le fueron asignadas, iniciar su
  atención, registrar diagnóstico, notas y evidencias, y marcar la incidencia
  como resuelta, incluso trabajando sin conexión para sincronizar después.
- **Coordinador:** visualizar el conjunto de incidencias, priorizarlas, asignar o
  reasignar técnicos, revisar el historial y las evidencias, y decidir el cierre
  final o la reapertura de un caso.

## Flujo principal

1. Reportar: el reportante crea una incidencia indicando categoría, descripción,
   ubicación y, opcionalmente, fotografías; la incidencia queda en estado `open`.
2. Asignar: el coordinador revisa la incidencia, le asigna prioridad y la asigna
   a un técnico disponible; el estado cambia a `assigned`.
3. Atender: el técnico inicia la atención (`in_progress`), registra diagnóstico y
   evidencias, y al terminar marca la incidencia como resuelta (`resolved`).
4. Cerrar: el coordinador revisa la resolución y cierra el caso (`closed`), o lo
   reabre hacia `assigned` si detecta que el problema persiste.

## Criterios de aceptación verificables

1. Dado que un técnico tiene una incidencia asignada, cuando el coordinador la
   reasigna a un técnico distinto, entonces el primer técnico ya no puede
   registrar diagnóstico, notas ni cambios de estado sobre esa incidencia.

2. Dado que un técnico intenta modificar una incidencia justo después de que fue
   reasignada a otra persona, cuando envía su cambio, entonces el sistema rechaza
   la operación y muestra un mensaje claro indicando que ya no tiene la
   asignación vigente, en lugar de fallar en silencio o aplicar el cambio.

3. Dado que el coordinador reasigna una incidencia de un técnico a otro, cuando
   se consulta el historial de la incidencia, entonces queda registrado quién
   tenía la asignación anterior, quién la tiene ahora y en qué momento ocurrió
   el cambio.

