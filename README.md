# Madrid Subterráneo · Atlas

Atlas geográfico de la red de Metro de Madrid con las estaciones en 3D colocadas
sobre su anclaje del CRTM y **cada andén encajado sobre su vía real**.

- Web publicada: https://ntizar.github.io/madrid-subterraneo/
- Datos: red del CRTM (240 complejos, 13 líneas) y 12 modelos GLB de Albert Guillaumes.
- Diseño: Aurora (tokens en `vendor/aurora-tokens.css`).

## Qué hay en la raíz

La raíz del repo **es el sitio publicado** (GitHub Pages sirve desde aquí):

```
index.html   assets/   data/   models/   style.css   vendor/   favicon.svg
```

## Qué hay en `fuente/`

El proyecto Vite de origen, para editar y reconstruir:

```
fuente/src/main.js      lógica del atlas (mapa, modelos, encaje)
fuente/build_encaje.py  calcula el encaje andén → vía y escribe data/encaje.json
fuente/index.html       plantilla
fuente/serve.cjs        servidor local del build
fuente/reference/       GeoJSON del CRTM
fuente/public/          css, vendor y assets de origen (los datos y los GLB se sirven desde la raíz)
```

`fuente/public/data` y `fuente/public/models` no se duplican aquí: son los mismos
ficheros que ya están en la raíz del repo.

Para reconstruir:

```
cd fuente
npm ci
python3 build_encaje.py     # regenera data/encaje.json
npm run build               # escribe dist/
cp -r dist/* ..             # publica en la raíz
```

## El encaje (lo importante)

**La vía es la verdad.** La polilínea de cada línea es la del GTFS oficial del CRTM
(shape completa, sin puntos a menos de 1 m y simplificada con error máximo de 1 m): no se
pliega, no se desplaza y no cambia de cota para hacer sitio a nada.

Cada andén es una **unidad estación-línea** (291 en 240 complejos) y se ancla **entre las
dos direcciones de su vía**: `direction_id` 0 y 1 son los dos carriles, separados 4,4-6,2 m.
El ancla es el punto medio de los dos puntos más cercanos, el rumbo es la tangente y la
separación S se mide en ese mismo punto. La plataforma se genera desde esos datos (largo
real por perfil, ancho S) y su **cota sale del perfil de la vía** (`perfiles` de
`data/metro.json`), no de una recta entre estaciones: plataforma y raíl comparten la misma
Y por construcción.

Comprobación en el navegador (consola):

```
atlasDiagnostics()
```

Devuelve la distancia de cada plataforma a su vía y el salto de cota. Medido en local:
**mediana 3,6 m** (el semiancho de la plataforma), que es el encaje exacto; el 5 % peor son
andenes de ramal (L9, L12) donde la traza del feed no llega al andén y se marcan como
separación estimada.

Los **12 croquis de Albert Guillaumes** son esquemas sin escala geográfica: no se plantan
sobre el mapa (intentarlo deformaba el trazado). Se abren en su ficha, que es donde aportan.

## Cómo se regenera

```
python scripts/preparar_gtfs.py    # GTFS oficial del CRTM -> data/metro.json (trazados y perfiles)
python scripts/andenes.py          # 291 andenes anclados a su vía -> data/andenes.json
python scripts/verificar.py        # el contrato: datos, encaje, cotas y trazado
```

## Límites

- Los niveles (cotas) son los del archivo de origen: dan orden y separación, no
  profundidad real.
- El tamaño del modelo sobre el mapa es simbólico y ajustable.
- La red no es servicio en vivo: no hay trenes, horarios ni incidencias.

Hecho con ❤️ por David Antizar.
