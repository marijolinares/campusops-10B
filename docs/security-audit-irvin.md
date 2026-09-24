# Auditoría de seguridad y privacidad
## Hallazgos - Semana 4

| Hallazgo | Riesgo | Solución aplicada | Evidencia |
| :--- | :--- | :--- | :--- |
| 1 | Token o secreto escrito en el código fuente | Cualquier persona con acceso al repositorio podría verlo | Se trasladó a una variable de entorno | token-corregido.png |
| 2 | Uso de console.log con datos informativos | Los registros de la consola podrían filtrar información privada | Se eliminó o sanitizó el mensaje en consola | console-limpio.png |
| 3 | Archivo .env sin verificar en .gitignore | Riesgo de subir credenciales reales al repositorio público | Se añadió el archivo .env al .gitignore | gitignore-env.png |