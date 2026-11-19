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

Los GLB son croquis: el propio manifiesto avisa de que no tienen orientación
geográfica. `build_encaje.py` mide, andén a andén:

1. El eje largo del andén (rectángulo de área mínima sobre su contorno, no PCA:
   la PCA falla en placas casi cuadradas).
2. El rumbo del tramo de vía del CRTM más cercano a ese andén.
3. El giro que alinea ambos y el desplazamiento que deja el borde del andén a
   6,9 m del eje de la vía.

El resultado (`data/encaje.json`) lleva `giro_fino_deg`, `traslacion`,
`path_encajado` y la vía real. El atlas gira cada placa con esos valores y dibuja
la línea sobre `path_encajado`, así que la línea entra y sale de la estación por
donde va la vía de verdad, sin quiebros.

Comprobación en el navegador (consola):

```js
encajeDiagnostics()
```

Devuelve, por estación y línea, la diferencia angular entre el andén y su vía.
Medido: 0–13,5°, la mayoría por debajo de 2°; desajuste de distancia 0,0 m.
Los dos modelos sin red actual (Sol 2009-2021 y Acacias esquema) quedan como
estaban, sin encaje.

## Límites

- Los niveles (cotas) son los del archivo de origen: dan orden y separación, no
  profundidad real.
- El tamaño del modelo sobre el mapa es simbólico y ajustable.
- La red no es servicio en vivo: no hay trenes, horarios ni incidencias.

Hecho con ❤️ por David Antizar.
