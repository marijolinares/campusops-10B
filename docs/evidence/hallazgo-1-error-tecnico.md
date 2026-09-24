# Evidencia — Hallazgo 1: Información técnica expuesta en mensajes de error

## Archivo afectado

`src/api/courseBackend.ts`, línea 14.

## Antes (código con el problema)

```ts
throw new Error(`Backend health failed with ${response.status}`);
```

El mensaje incluía directamente `response.status`, exponiendo el código HTTP del servidor (ej. 500, 403, 404) en el mensaje de error que podría llegar a logs, reportes de crash o incluso a la interfaz.

## Después (código corregido)

```ts
throw new Error('No fue posible conectar con el servicio de salud del backend.');
```

El mensaje ahora es genérico y no revela detalles internos del servidor.

## Diff real de la corrección

```diff
-    throw new Error(`Backend health failed with ${response.status}`);
+    throw new Error('No fue posible conectar con el servicio de salud del backend.');
```

## Verificación

```
$ npx tsc --noEmit
(sin errores — compila correctamente)
```

El typecheck pasa sin errores, confirmando que la corrección es válida y no rompe el proyecto.
