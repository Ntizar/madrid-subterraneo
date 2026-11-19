# Plan de reparación · Madrid Subterráneo

Estado: **propuesta para ✅**. Nada de esto se ejecuta sin aprobación (toca arquitectura y >5 ficheros).

Verificador del contrato: `python scripts/verificar.py` (rc=0 solo si todo está en verde).

---

## 1. Qué está roto, medido (no deducido)

| Síntoma | Medida real | Dónde |
|---|---|---|
| La vía no coincide con el andén | `encajeDiagnostics()`: 129 m de separación en Cuatro Caminos L2; 48° de desvío en Pinar de Chamartín L1; 34° en Estación del Arte; 27° en Sol L2 | `fuente/src/main.js` `connectedEdgePath()` |
| El andén no está sobre la vía | 34 de 291 unidades estación-línea tienen la vía a más de 60 m del punto de la estación; 19 no tienen par de trazas | `data/metro.json` + `network.json` |
| Curvas extrañas | 10 shapes con quiebros de 67-107° entre segmentos de 130 m (muestreo agresivo del GTFS: se simplificó a 26-55 puntos) | `data/metro.json` (RDP ε=0,00018) |
| Micro-codos en el dato de origen | el `shapes.txt` oficial trae **1.225 puntos separados por menos de 1 m** (507 exactamente duplicados). Al dibujarlos, cada uno es un segmento nulo y un codo de 180° | GTFS crudo del CRTM |
| Cambios de cota | la cota se interpola **entre estaciones** (`ya+(yb-ya)*t`), así que una línea sube y baja; el modelo se centra en su cota, el andén queda a otra | `main.js` `cotaY()` / `loadSpatialModel()` |
| Solo 12 estaciones tienen 3D | 240 complejos, 291 andenes, **12** croquis GLB con "escala desconocida" | `data/models.json` |
| No hay trenes | el GTFS ya está en `data/metro.json` (shapes, frecuencias, calendario) pero el visor no lo usa para trenes | `main.js` |
| "Conectar" no dibuja escaleras | hay Dijkstra de líneas (`routing.js`) y ningún grafo dentro de la estación | `fuente/src/routing.js` |
| Móvil | a 390×844: **36 %** del lienzo libre (cabecera 62 px + panel 321 px abajo), **0** etiquetas visibles | `style.css` + `updateLabels()` |
| El repositorio no tiene tests | `package.json` declara `npm test → node tests.mjs`, el fichero **no existe** | `fuente/` |

Y el diagnóstico que ya emite el propio repo (`data/validacion.json`) está en **rojo con 19 fallos**, así que
el proyecto sabe que no cumple y aun así publica.

## 2. La decisión de fondo: la vía es la verdad

Hoy el README dice «el modelo es la verdad; la vía se adapta a él» y el código pliega la polilínea sobre
el eje del andén (`dv2 = dv - dv*w`). Eso es lo que produce las curvas y los cambios de cota: se está
deformando el dato geográfico para tapar un desajuste de anclaje.

Se invierte:

- **La vía no se toca.** Se dibuja exactamente la `shape` del GTFS del CRTM, densificada por interpolación
  lineal (misma geometría, más puntos), sin plegados ni desplazamientos laterales.
- **El andén se ancla a la vía**: punto medio de los dos puntos más cercanos, uno en cada dirección
  (`direction_id` 0 y 1 son los dos carriles, separados 4,4–6,2 m), rumbo = tangente, y el modelo se
  ajusta en ancho (`scaleZ = S/S_base`) para que sus dos vías caigan sobre las dos trazas.
- **Una cota por línea**, no por estación. La vía es horizontal dentro de la línea; el andén va a la cota
  de su línea. Si un día se modelan rampas, son datos explícitos, no una interpolación entre estaciones.
- **Los 12 croquis de Guillaumes** dejan de mandar: se mueven ellos (transformación rígida: giro,
  traslación, escala uniforme) hasta la vía, y se declaran como croquis de escala desconocida. Si no
  encajan, se muestran en su ficha aparte, no sobre el mapa deformando la red.

## 3. Fases, tareas y criterio de aceptación

Cada fase se cierra con un contrato de `harness.py` y su recibo. Los comandos se prueban a mano antes de
crear el contrato.

### F1 · Cimiento de datos y doctrina
- [ ] `scripts/preparar_gtfs.py`: descarga el GTFS oficial (ArcGIS `5c7f2951962540d69ffe8f640d94c246`,
      `application/zip`, 1,5 MB), lo cachea en `data/gtfs/` (ignorado) y genera `data/red.json` con:
      shapes completas por `shape_id`, `route_id → línea/dirección`, frecuencias y calendario.
- [ ] `scripts/andenes.py`: 291 andenes (estación × línea) con lat/lon sobre la vía, rumbo, S y tipología.
- [ ] Quitar el plegado: `connectedEdgePath` pasa a ser una simple densificación de la shape.
- [ ] `data/validacion.json` regenerado con `scripts/validar.py`.

**Criterio (comando):**
`python scripts/verificar.py datos encaje trazado` → rc 0, con `unidades con par de trazas: 291/291`,
`0` unidades a más de 60 m y `0` shapes con quiebro > 60°.
Recibo: la salida del comando pegada en el commit.

### F2 · Una sola cota por línea
- [ ] `cotaY(linea)`: la profundidad de la línea (`depth`), no de la estación.
- [ ] El andén y su vía comparten la misma Y por construcción; el modelo se coloca con su eje a esa Y.
- [ ] `script de comprobación`: separación vertical máxima andén-vía < 0,10 m en las 291 unidades.

**Criterio:** `python scripts/verificar.py cotas` → rc 0 y `rango` de cota por línea ≤ 0,5 m (hoy hasta 7,5 m).

### F3 · Las 240 estaciones, mapeadas
- [ ] Generador paramétrico de estación por tipología (lateral, central, tresbolillo, paralelo, dos
      niveles, elevada) en Three.js: andén, vías, bóveda, escaleras fijas de subida/bajada y vestíbulo.
- [ ] Instanciado/malla fusionada por tipología: 240 complejos sin 240 llamadas de dibujo.
- [ ] Los 12 croquis GLB quedan como capa aparte «Croquis de Guillaumes», con su transformación rígida.
- [ ] El control «Tamaño real» escala el modelo **alrededor del eje de la vía**, nunca lo desplaza.

**Criterio:** en navegador, `window.atlasDiagnostics().estaciones === 240` y
`unidadesConAnden === 291`; y `verificar.py datos` rc 0. Captura de Sol y de Avenida de América.

### F4 · Trenes a su hora (GTFS)
- [ ] Motor de horarios: `frequencies.txt` + `calendar.txt`/`calendar_dates.txt` + reloj de Madrid;
      un tren = posición sobre su `shape` en función de la hora de paso.
- [ ] Capa de trenes (esferas/instancias) con ×1, ×60, ×300 y «Ahora».
- [ ] Ficha de estación: próximos trenes por línea y sentido.
- [ ] Declarar en la UI: **es horario oficial, no telemetría** (el CRTM no publica posiciones en abierto).

**Criterio:** `node fuente/tests.mjs trenes` compara, para 3 instantes de un laborable, el número de
trenes por línea y sentido contra el cálculo independiente en Python del mismo GTFS
(`scripts/verificar_trenes.py`), con tolerancia 0; y cada tren dibujado está a < 1 m de su shape.

### F5 · Ruta por dentro de la estación
- [ ] Grafo intra-estación por complejo: andén → escalera → vestíbulo → escalera → andén, con niveles.
      Para las paramétricas se genera con el arquetipo; para los 12 croquis se declara a mano.
- [ ] Al elegir trayecto, la cámara entra en el complejo y **dibuja el camino por las escaleras** (línea
      sobre el suelo + marcador de «sube/baja»), no solo el listado de líneas.
- [ ] Coste coherente: mínimo de transbordos; empate → menos escalones.

**Criterio:** `node fuente/tests.mjs rutas` con 12 trayectos fijos (Sol L1→L2, Alonso Martínez L4→L10,
Avenida de América L4→L9, Ópera L5→Ramal…): ruta existe, `saltosSinEscalera === 0`, `escaleras >= 1`
en cada transbordo, y el número de transbordos coincide con el calculado por un Dijkstra independiente.

### F6 · Móvil map-first
- [ ] El panel deja de ser una tarjeta de 321 px: *bottom sheet* con tres alturas (peek 15 %, media, completa)
      y el mapa siempre visible detrás.
- [ ] `updateLabels`: colisión + recorte al viewport; mínimo 6 etiquetas visibles, 0 fuera.
- [ ] Controles de 44 px, sin solapes con la cabecera.

**Criterio:** a 320×640, 360×740 y 390×844: `scrollWidth === clientWidth`, **≥55 %** del lienzo libre,
≥6 etiquetas dentro, 0 etiquetas fuera, 0 controles < 44 px. Medido con Playwright, no a ojo.

### F7 · Rendimiento, documentación y despliegue
- [ ] Presupuesto: < 3 MB de carga inicial, < 200 draw calls, frame medio < 16,7 ms en escritorio.
- [ ] README nuevo: fuentes oficiales (CRTM GTFS, CRTM M4_Red, Guillaumes), qué es dato y qué es
      estimación, y la doctrina «la vía es la verdad».
- [ ] Deploy en GitHub Pages (push a `master`) + comprobación en vivo de la URL.

**Criterio:** `curl -fsS https://ntizar.github.io/madrid-subterraneo/ | grep -q "atlas"` y las tres
medidas de rendimiento por debajo del presupuesto, con su salida en el recibo.

## 4. Lo que NO se va a hacer

- No se inventan profundidades: las cotas son estimación por línea, ya declarada en la UI.
- No se tocan los datos del CRTM para que encajen; se toca el visor.
- No se sustituyen los croquis de Guillaumes: se reubican y se etiquetan como lo que son.
- No se añade ninguna dependencia pesada: Three.js ya está, Playwright ya está en `devDependencies`.

## 5. Orden de ejecución y por qué

F1 y F2 primero porque todo lo demás se apoya en la vía y su cota. F3 antes que F4 y F5 porque un tren y
una ruta necesitan andén. F6 en paralelo desde F3 (cada pantalla nueva se hace ya móvil). F7 al final.

Hecho con ❤️ por David Antizar.
