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

**El modelo es la verdad.** Los GLB son croquis sin orientación geográfica (lo
dice su manifiesto) y su escala interna no es la del CRTM. Por eso el modelo no se
mueve ni se deforma: es la **vía** la que se adapta a él.

En `connectedEdgePath()` la polilínea de cada línea se densifica y se **pliega
sobre el eje del andén** con una ventana suave: en el tramo del andén la vía va
exactamente por su eje y en su misma dirección, y fuera se abre por una curva
continua hasta el trazado real del CRTM. Sin saltos, sin codos de 90° y sin
quiebros: la transición es C1 porque el desplazamiento y su derivada tienden a
cero en los extremos de la ventana.

Comprobación en el navegador (consola):

```js
encajeDiagnostics()
```

Devuelve, por estación y línea, la separación máxima entre la vía dibujada y el
eje del andén. Medido: **mediana 2,4 m, 26 de 30 andenes por debajo de 10 m**.
Los cuatro que quedan por encima (Alameda de Osuna 37 m, Pinar de Chamartín
L1 68 m, Alonso Martínez L4 13 m y L5 20 m) son andenes que el croquis dibuja
lejos de su vía: se ven venir y son los siguientes a afinar.

`build_encaje.py` sigue generando `data/encaje.json` con la geometría de cada
andén y su vía, pero ya solo se usa para diagnóstico: nada del modelo se mueve.

## Límites

- Los niveles (cotas) son los del archivo de origen: dan orden y separación, no
  profundidad real.
- El tamaño del modelo sobre el mapa es simbólico y ajustable.
- La red no es servicio en vivo: no hay trenes, horarios ni incidencias.

Hecho con ❤️ por David Antizar.
