# 📋 Semana 02 — Resumen de avance (Germán)

**Fecha:** 2026-09-12  
**Rama:** develops  
**Autor:** Germán Yair Martínez Bolaños

---

## ✅ Lo que ya se hizo

### 1. ADR-001 — Decisión de arquitectura (`docs/adr/ADR-001-architecture.md`)
- Se compararon **2 alternativas**:
  - **Clean Architecture por capas** (UI → Application → Domain ← Infrastructure)
  - **Feature-First** (modular por funcionalidad, cada feature con su propia UI + lógica + datos)
- Se eligió **Clean Architecture por capas** por:
  - **Testabilidad**: dominio y aplicación se prueban con fakes inyectados, sin UI ni red
  - **Cambio de proveedor**: crear un nuevo adaptador en infrastructure sin tocar application/domain
  - **Escalabilidad**: reglas de dependencia claras que previenen acoplamiento accidental
- El ADR incluye: contexto, alternativas detalladas, tabla comparativa, decisión, consecuencias (positivas y negativas) y trade-off central
- **✅ Pasa la prueba pública** `week-02.test.ts` (verifica que contenga "alternativa" y "consecuencia/trade-off")

### 2. Diagrama Mermaid placeholder (`docs/architecture.mmd`)
- Se creó un **placeholder funcional** con las 4 capas (UI, Application, Domain, Infrastructure)
- Las dependencias están dirigidas correctamente: UI→Application, Application→Domain, Infrastructure→Domain
- **NO hay arista directa UI→Infrastructure** (requisito del test)
- **⚠️ Irvin debe reemplazarlo** con el diagrama completo

### 3. Test público de Semana 02
- Se instaló `course-tests/public/week-02.test.ts` desde el ZIP de la actividad
- Se ejecutó y **pasó correctamente** (2 suites, 2 tests, 0 fallos)

---

## 🔧 Lo que falta por hacer

### Para Irvin → `docs/architecture.mmd`
Reemplazar el placeholder con un diagrama Mermaid completo que incluya:
- [ ] Las 4 capas: UI, Application, Domain, Infrastructure
- [ ] Los 3 perfiles: Reportante, Técnico, Coordinador
- [ ] Los límites de: incidencias, sesión, persistencia, proveedores (ubicación/mapas)
- [ ] Dependencias dirigidas (UI→App, App→Domain, Infra→Domain)
- [ ] Verificar que **NO** haya arista UI→Infrastructure
- [ ] Agregar leyenda si usa nombres distintos a los estándar

### Para Lin → Esqueleto ejecutable + evidencias
- [ ] Reorganizar `src/` en las 4 capas (ui/, application/, domain/, infrastructure/)
- [ ] Implementar modelo `Incident` en domain con datos ficticios
- [ ] Crear puerto `IncidentRepository` en domain/ports/
- [ ] Crear `InMemoryIncidentRepository` en infrastructure/ (fake con datos sintéticos)
- [ ] Crear caso de uso `ListIncidentsUseCase` y `GetIncidentDetailUseCase` en application/
- [ ] Crear pantallas `IncidentListScreen` y `IncidentDetailScreen` en ui/
- [ ] `reports/week-02/dependencies.json` — con:
  - Al menos 1 comprobación nominal (estado final correcto)
  - Al menos 1 comprobación de límite o falla (violación detectada y corregida)
  - Campos: `commitSha`, `generatedAt`, `checks` (cada uno con `id`, `status`, `scenarioType`, `command`, `evidence`)
- [ ] **AC-03**: Introducir intencionalmente una violación (ej. UI importa de infrastructure), documentar el "antes" (falla), corregirla y documentar el "después" (correcto) en dependencies.json
- [ ] `evidence/week-02/engineering.json` con: `commitSha`, `decision`, 2+ `alternatives`, `tradeoff`, `requirementIds`, `verification`
- [ ] `evidence/week-02/individual.json` con: `teamId`, 3 `members` (cada uno con `studentId`, `commitShas`, `files`, `tests`, `reviews`, `prediction`, `command`, `observedResult`, `explanation`)

---

## 📌 Comandos útiles para verificar

```bash
# Ejecutar prueba pública de semana 02
npx jest --no-watchman --cacheDirectory .jest-cache course-tests/public/week-02.test.ts

# Verificación completa
make verify-week-02
make public-test-week-02
make feedback

# Antes de entregar (después de crear tag)
git tag -a week-02-final -m "DMI week 02 final"
make evidence-week-02

# Subir todo
git push origin HEAD
git push origin week-02-final
git rev-list -n 1 week-02-final
```

---

## 📂 Archivos creados/modificados en este commit

| Archivo | Estado | Descripción |
|---|---|---|
| `docs/adr/ADR-001-architecture.md` | ✅ NUEVO | ADR completo con 2 alternativas y justificación |
| `docs/architecture.mmd` | ⚠️ NUEVO (placeholder) | Irvin debe completarlo |
| `course-tests/public/week-02.test.ts` | ✅ NUEVO | Test público instalado del ZIP |
