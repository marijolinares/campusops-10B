# ADR-001 — Arquitectura interna de CampusOps

**Estado:** Aceptada  
**Fecha:** 2026-09-12  
**Autores:** Germán Yair Martínez Bolaños, María José Linares, Irvin Isael Martínez Alejo

---

## Contexto

CampusOps es una aplicación móvil de gestión de incidencias universitarias construida con React Native, Expo y TypeScript (stack ya definido; este ADR no lo reevalúa). La aplicación debe soportar:

- **Tres perfiles de usuario** con funciones distintas: Reportante, Técnico y Coordinador.
- **Gestión de incidencias** con flujo de estados (open → assigned → in_progress → resolved → closed).
- **Sesión y autenticación** con permisos según perfil.
- **Persistencia local** y cola de operaciones sin conexión.
- **Servicios de ubicación/geocodificación** con un proveedor externo sustituible.
- **Evidencia fotográfica** con permisos de cámara/galería bajo demanda.

Necesitamos decidir cómo organizar internamente estas responsabilidades para que:

1. Se puedan **probar** las reglas de negocio sin levantar la UI ni depender de un servicio externo real.
2. Se pueda **cambiar un proveedor** (por ejemplo, de mapas o de almacenamiento) sin modificar la lógica de la aplicación ni las pantallas.
3. La **complejidad** sea manejable para un equipo de 3 personas durante 13 semanas.

---

## Alternativas evaluadas

### Alternativa 1: Clean Architecture por capas

Organizar el código en cuatro capas con reglas de dependencia estrictas:

| Capa | Responsabilidad | Depende de |
|---|---|---|
| **UI** (presentación) | Pantallas, componentes React Native, navegación | Application |
| **Application** (casos de uso) | Orquestación de flujos: listar incidencias, crear reporte, cambiar estado | Domain (contratos) |
| **Domain** (dominio) | Modelos de negocio (`Incident`, `User`, roles, estados), interfaces/puertos (`IncidentRepository`, `LocationProvider`) | Nada externo |
| **Infrastructure** (infraestructura) | Implementaciones concretas: API HTTP, almacenamiento AsyncStorage, proveedor de geocodificación, fakes en memoria | Domain (implementa sus contratos) |

**Regla de dependencia:** las capas internas no conocen a las externas. La UI importa de Application; Application importa de Domain; Infrastructure implementa los contratos de Domain. La UI **nunca** importa directamente de Infrastructure. Se usa inversión de dependencias en el borde externo.

**Estructura de carpetas resultante:**

```
src/
├── ui/                  # Pantallas y componentes
│   ├── screens/
│   └── components/
├── application/         # Casos de uso
│   └── usecases/
├── domain/              # Modelos, tipos, interfaces/puertos
│   ├── models/
│   └── ports/
└── infrastructure/      # Adaptadores concretos y fakes
    ├── repositories/
    └── providers/
```

### Alternativa 2: Feature-First (modular por funcionalidad)

Organizar el código por dominio funcional, donde cada feature agrupa su propia UI, lógica y acceso a datos:

```
src/
├── incidents/
│   ├── IncidentListScreen.tsx
│   ├── IncidentDetailScreen.tsx
│   ├── incidentService.ts
│   └── incidentApi.ts
├── session/
│   ├── LoginScreen.tsx
│   ├── sessionService.ts
│   └── sessionStorage.ts
└── location/
    ├── LocationPicker.tsx
    ├── locationService.ts
    └── geocodingApi.ts
```

Cada módulo de feature es autónomo. Las features se comunican mediante imports directos entre módulos o un bus de eventos compartido.

---

## Comparación

| Criterio | Clean Architecture (capas) | Feature-First (modular) |
|---|---|---|
| **Facilidad de prueba** | ✅ Alta. El dominio y la aplicación se prueban con fakes inyectados, sin UI ni red. Los puertos permiten crear dobles deterministas. | ⚠️ Media. La lógica mezclada con acceso a datos dentro del módulo requiere mocks más elaborados y frágiles. |
| **Complejidad inicial** | ⚠️ Media-alta. Más carpetas, más archivos, más indirecciones. Requiere disciplina para respetar las reglas de dependencia. | ✅ Baja. Intuitivo para equipos pequeños; cada feature es fácil de encontrar. |
| **Cambio de proveedor** | ✅ Fácil. Cambiar de proveedor de mapas = crear un nuevo adaptador en `infrastructure/` que implemente el mismo puerto. Application y Domain no cambian. | ❌ Difícil. El proveedor está acoplado dentro de la feature; cambiarlo obliga a modificar `locationService.ts` y posiblemente la pantalla. Si varias features usan el mismo proveedor, hay que modificar todas. |
| **Escalabilidad** | ✅ Crece de forma predecible; cada capa tiene límites claros. | ⚠️ Al crecer, las features se acoplan entre sí y las dependencias cruzadas son difíciles de rastrear. |
| **Coherencia con la rúbrica** | ✅ La actividad pide explícitamente identificar límites UI / Application / Domain / Infrastructure y demostrar que la UI no depende de infraestructura. | ❌ No expone directamente las 4 capas que pide la rúbrica. |

---

## Decisión

Elegimos **Clean Architecture por capas** (Alternativa 1).

**Razones principales:**

1. **Testabilidad**: Las reglas de negocio de incidencias (transiciones de estado, validaciones de perfil, resolución de conflictos) se prueban con datos sintéticos y fakes inyectados. No se necesita montar React Native ni conectar una API real para validar lógica de dominio.

2. **Cambio de proveedor**: El contrato `LocationProvider` en dominio define qué espera la aplicación de un servicio de geocodificación. En semana 2 usamos un `FakeLocationProvider` en memoria; en semana 9 se sustituye por un adaptador real contra un servicio de mapas. La capa de aplicación y el dominio no se tocan. Lo mismo aplica para persistencia: hoy usamos un `InMemoryIncidentRepository`; en semana 8 se sustituye por uno que use AsyncStorage.

3. **Complejidad controlada**: Aunque es más compleja inicialmente, la regla de dependencia previene el acoplamiento accidental que en Feature-First se vuelve difícil de corregir conforme se acumulan semanas de desarrollo.

---

## Consecuencias

### Positivas

- La UI puede desarrollarse en paralelo con la lógica de negocio, usando fakes que devuelven datos deterministas.
- Cada integrante puede trabajar en una capa distinta con menos conflictos de merge.
- Los tests de arquitectura (imports, dependencias) son verificables automáticamente: se puede comprobar que ningún archivo de UI importa de infrastructure.
- Sustituir un componente (proveedor de mapas, mecanismo de almacenamiento, formato de API) requiere solo un nuevo adaptador que respete el puerto existente.

### Negativas

- Mayor cantidad de archivos y carpetas desde el inicio, lo cual puede parecer excesivo para la funcionalidad mínima de semana 2 (lista/detalle con datos ficticios).
- Requiere disciplina del equipo para no tomar atajos (como importar directamente el fake desde la UI en vez de pasar por el caso de uso).
- La indirección de puertos/adaptadores puede dificultar la depuración para quien no conozca el patrón.

---

## Trade-off central

El equilibrio que buscamos es:

> **Testabilidad y facilidad de cambio de proveedor** a cambio de **complejidad inicial moderada**.

Aceptamos escribir más código estructural (interfaces, casos de uso, inyección de fakes) porque:

- Las pruebas automatizadas de la materia exigen límites verificables entre capas.
- A lo largo de 13 semanas se sustituirán los fakes por implementaciones reales (API, AsyncStorage, geocodificación) y el costo de un acoplamiento temprano se acumularía.
- Un equipo de 3 personas puede mantener la disciplina si los límites están claros desde el ADR y el diagrama.

En Feature-First la complejidad inicial sería menor, pero el costo de reorganizar cuando se agreguen sesión, persistencia y proveedores externos (semanas 4-9) superaría el ahorro inicial.

---

## Referencias

- Martin, R. C. *Clean Architecture*. Prentice Hall, 2017.
- `docs/CAMPUSOPS.md` — alcance y perfiles del proyecto.
- `ACLARACION_ANTES_DE_INICIAR.md` — producto mínimo y límites de semana 2.
