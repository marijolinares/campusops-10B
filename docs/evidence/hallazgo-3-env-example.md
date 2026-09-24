# Evidencia — Hallazgo 3: Archivo `.env.example` contiene valor real

## Archivo afectado

`.env.example`, línea 1.

## Antes (archivo con el problema)

```
EXPO_PUBLIC_COURSE_BACKEND_URL=http://127.0.0.1:4310
```

El archivo `.env.example` incluía un valor concreto (`http://127.0.0.1:4310`) en lugar de dejar la variable vacía. Aunque este valor no es un secreto, establece una mala práctica: un archivo `.env.example` solo debe contener los nombres de las variables que el desarrollador necesita configurar, sin valores predeterminados que puedan confundirse con configuraciones de producción.

Si en el futuro se agrega una variable como `EXPO_PUBLIC_MAPS_API_KEY=AIzaSy...`, el mismo patrón de poner el valor real podría provocar que una API Key quede expuesta en el repositorio.

## Después (archivo corregido)

```
EXPO_PUBLIC_COURSE_BACKEND_URL=
```

Ahora el archivo solo contiene el nombre de la variable, sin valor. El desarrollador debe configurar su propio `.env` local.

## Diff real de la corrección

```diff
-EXPO_PUBLIC_COURSE_BACKEND_URL=http://127.0.0.1:4310
+EXPO_PUBLIC_COURSE_BACKEND_URL=
```

## Verificación: `.env` está ignorado por Git

```
$ git status
On branch week4/security-audit-german
Changes not staged for commit:
  modified:   .env.example
  modified:   src/api/courseBackend.ts
  modified:   src/course-evaluation/index.ts

no changes added to commit
```

El archivo `.env` NO aparece en `git status`, confirmando que `.gitignore` lo excluye correctamente.

## Verificación: `.gitignore` incluye `.env`

```
$ cat .gitignore
node_modules/
.expo/
android/
ios/
coverage/
.jest-cache/
dist/
.env          <-- CONFIRMADO: .env está ignorado
*.jks
*.keystore
*.p8
*.p12
reports/**/generated-*
.DS_Store
```

## Verificación: `.env` nunca fue tracked por Git

```
$ git ls-files -- .env
(vacío — nunca fue agregado al repositorio)
```
