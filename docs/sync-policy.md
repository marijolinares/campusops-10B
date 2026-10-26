# Política de sincronización (Semana 8)

Todos los datos son ficticios. Este documento define cómo CampusOps decide qué hacer cuando un registro cambió en el dispositivo sin conexión y también cambió en el servidor.

## 1. Problema

Un técnico trabaja sin conexión y modifica una incidencia. Mientras tanto, otra persona (por ejemplo, el coordinador) puede cambiar la misma incidencia en el servidor. Al volver la red hay dos versiones distintas del mismo registro. La app no debe perder el trabajo del técnico ni sobrescribir silenciosamente lo que cambió el servidor.

## 2. Modelo de comparación (tres vías)

Se comparan tres copias del registro, campo por campo:

| Copia | Qué es |
|---|---|
| **base** | El registro tal como estaba cuando el dispositivo lo descargó (versión base). |
| **local** | El registro con los cambios hechos sin conexión. |
| **remoto** | El registro actual en el servidor. |

La versión base de cada operación pendiente se guarda en la cola local como el campo `baseVersion` de la operación (ver `docs/data-model.md`). La base completa es la copia local de la incidencia (`getIncident`), que no se actualiza hasta que el servidor confirma la operación. Si esa copia ya no está en `baseVersion`, no hay base fiable y se marca conflicto en el campo `base`.

La lógica vive en `src/domain/sync.ts` (dominio puro, sin red ni almacenamiento) y se expone mediante `resolveSync` y `deduplicateOperations` en `src/course-evaluation/index.ts`.

## 3. Reglas de combinación

Para cada campo del registro:

| ¿Cambió local? | ¿Cambió remoto? | Resultado del campo |
|---|---|---|
| No | No | Se conserva el valor base. |
| Sí | No | Gana el valor **local**. |
| No | Sí | Gana el valor **remoto**. |
| Sí | Sí, con el **mismo** valor | Ese valor (no hay conflicto). |
| Sí | Sí, con valores **distintos** | **Conflicto** en ese campo. |

Resultado de `resolveSync`:

- Si ningún campo está en conflicto: `{ kind: 'merged', fields }` con todos los campos combinados.
- Si algún campo está en conflicto: `{ kind: 'conflict', fields: [...] }` con los nombres de los campos en conflicto, ordenados. En ese caso **no se combina nada automáticamente**.

Una comparación de un campo cuyo valor es un objeto (por ejemplo `work`) se hace sobre el objeto completo, no por subcampo.

## 4. Caso principal: reasignación conflictiva

Situación del producto:

1. La incidencia `campus-inc-001` está asignada a `technician-1` con estado `assigned` (versión 1).
2. Sin conexión, `technician-1` empieza el trabajo: el estado local pasa a `in_progress`.
3. Mientras tanto, en el servidor la incidencia se reasigna a `technician-2` (versión 2).

Ambos lados cambiaron el campo `work`, con valores distintos, así que el resultado es `{ kind: 'conflict', fields: ['work'] }`.

Garantías:

- **No se pisa lo remoto:** la reasignación del servidor no se sobrescribe con el estado local.
- **No se borra la intención local:** la operación local (empezar el trabajo) no se descarta; se conserva en la cola, marcada como conflicto, para que una persona decida.
- **No se modifican los datos de entrada:** `resolveSync` no cambia `base`, `local` ni `remote`. La prueba pública de la semana 8 lo comprueba comparando el JSON antes y después.
- **La decisión es humana:** la app no elige ganador automáticamente. Quien resuelve es el coordinador. La operación queda en la cola con `status: 'conflict'` y los campos en conflicto; todavía no existe pantalla de resolución.

## 5. Cambios independientes

Si local y remoto cambian campos **distintos**, se combinan los dos. Ejemplo de la prueba pública: local cambia `title` y remoto cambia `priority`; el resultado es `merged` con ambos cambios. Si los dos cambian `title` de forma distinta, el resultado es `conflict` sobre `title`.

Un campo que el remoto borró y que local no tocó se acepta como borrado. Si local lo editó y el remoto lo borró, es un conflicto.

## 6. Operaciones repetidas

Cada operación pendiente tiene un `operationId` estable. Si la misma operación aparece más de una vez (por ejemplo, tras un reintento o una reconexión), `deduplicateOperations` conserva **solo la primera ocurrencia** y respeta el orden original. Así un reintento no aplica el mismo efecto dos veces. El reintento con el mismo `operationId` se describe en la sección 7b de este documento y en `enqueue` de `docs/data-model.md`: un reintento reutiliza el mismo `operationId` y el servidor debe ser idempotente por ese id.

## 7. Pruebas

| Prueba | Qué comprueba |
|---|---|
| `course-tests/public/week-08.test.ts` | Detección del conflicto de reasignación sin mutar los datos, combinación de cambios independientes y duplicados por `operationId`. |
| `course-tests/team/week-08-sync.test.ts` | Mismo cambio en ambos lados, borrado remoto, edición contra borrado, no mutación y orden al deduplicar. |

```bash
npx jest --no-watchman course-tests/public/week-08.test.ts course-tests/team/week-08-sync.test.ts
```
## 7b. Conexión con la cola persistente

`syncPendingOperations` (`src/application/useCases/syncPendingOperations.ts`) recorre la cola guardada por `openLocalDatabase` al recuperar la red. Para cada operación pendiente:

| Resultado | Cuándo | Efecto en la cola |
|---|---|---|
| `applied` | El servidor la aceptó | Se retira y se actualiza la copia local |
| `conflict` | `resolveSync` detecta conflicto, o el servidor responde 409 | Se conserva marcada `conflict`; no se envía nada |
| `blocked` | Hay un conflicto anterior en la misma incidencia | Queda pendiente (respeta el orden) |
| `failed` | Error de red u otro | Queda pendiente; se reintenta con el mismo `operationId` |

Además, un técnico no puede actuar sobre una incidencia que el servidor ya reasignó a otra persona, aunque no choquen campos. La prueba del caso obligatorio está en `course-tests/team/week-08-sync-persistence.test.ts`.

### Varias operaciones sobre la misma incidencia

Un técnico sin conexión puede encolar varias operaciones sobre la misma incidencia (por ejemplo inicio de atención, una nota y una referencia de fotografía pendiente), y todas nacen con la misma `baseVersion`. Cuando el servidor confirma la primera, la incidencia sube de versión; si las siguientes conservaran la versión vieja, se confundirían con un conflicto que no existe (y el servidor las rechazaría con 409).

Por eso, al confirmar una operación, `confirmApplied` (`src/infrastructure/localDatabase.ts`) hace en **una sola escritura** tres cosas: retira esa operación de la cola, guarda la copia actualizada de la incidencia y pasa a la nueva versión la `baseVersion` de las operaciones **pendientes** de esa incidencia. El `operationId` y el contenido no cambian, así que un reintento conserva su identidad. Las operaciones en `conflict` no se tocan, y si la primera operación entra en conflicto nada se reubica: las siguientes quedan `blocked` con su versión base original. Las pruebas están en `course-tests/team/week-08-sync-multi-operation.test.ts` (aplicación en orden, reinicio a mitad de la sincronización y conflicto real).

## 8. Límites

- La comparación de objetos es por campo completo; no se combinan subcampos de `work`.
- No existe todavía una pantalla para resolver conflictos; el resultado `conflict` se detecta y se conserva, pero la decisión final queda pendiente de la interfaz.
- `deduplicateOperations` considera solo el `operationId`; no compara el contenido de dos operaciones con el mismo identificador.
- Las pruebas usan datos ficticios y no conectan con un servidor real.