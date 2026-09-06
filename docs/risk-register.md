# Registro de riesgos — CampusOps

> Registren exactamente tres riesgos y ordénenlos del más al menos prioritario.

| Prioridad | Riesgo | Probabilidad | Impacto | Mitigación | Cómo comprobar la mitigación |
|---:|---|---|---|---|---|
| 1 | Pérdida de evidencias por cierre de la app | Media: los SO móviles frecuentemente cierran aplicaciones en segundo plano para liberar memoria. | Alto: los técnicos perderían fotos o diagnósticos y tendrían que regresar físicamente al lugar a recapturarlos. | Persistir la cola de operaciones (incluyendo fotos y notas) en el almacenamiento local del dispositivo para sobrevivir al reinicio. | Prueba E2E que capture una foto, simule el cierre forzado de la aplicación y, al reiniciarla, confirme que la imagen sigue en la cola pendiente. |
| 2 | Conflicto de reasignación sin conexión | Media: los técnicos operan en zonas sin señal y un coordinador podría reasignar un reporte concurrentemente. | Alto: pérdida de asignación o trabajo duplicado si los cambios locales sobrescriben a los del coordinador, o viceversa. | Implementar detección de conflictos para conservar la intención pendiente local e informar del conflicto en lugar de sobrescribir silenciosamente. | Prueba de integración que simule un cambio remoto y uno local concurrente, verificando que se reporte el conflicto sin pérdida de intención. |
| 3 | Exposición de datos en logs de diagnóstico | Baja: la app es de uso interno y no maneja datos financieros, pero los errores pueden volcar estado completo. | Alto: filtrar tokens, ubicaciones o información personal en texto plano compromete la seguridad del sistema y usuarios. | Aplicar sanitización obligatoria y automática de logs para enmascarar tokens, credenciales y fotos antes de escribirlos o enviarlos. | Ejecución de prueba que inyecte un token en la traza y verificación de que el archivo log lo muestra ofuscado/enmascarado. |

## Riesgo que atenderíamos primero

Atenderíamos primero el **Riesgo 1 (Pérdida de evidencias por cierre de la app)**. La confiabilidad offline es el requisito clave del proyecto; si el técnico pierde su trabajo capturado por algo tan común como responder una llamada o cambiar de aplicación (lo que provoca el cierre de la app en segundo plano), perderá la confianza en la herramienta. Garantizar que la captura no se pierda al reiniciar es el cimiento necesario antes de abordar la sincronización y conflictos complejos.
