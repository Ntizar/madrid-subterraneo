#!/usr/bin/env python3
"""Encaja cada andén del croquis sobre la vía real del CRTM.

Produce public/data/encaje.json:
  - giro_fino_deg: giro (grados) de cada andén alrededor del origen del modelo
  - traslacion:    desplazamiento en unidades del modelo
  - path_encajado: el path del andén ya transformado (mismas unidades)
  - via:           la vía real del CRTM en unidades del modelo, para dibujarla
  - desajuste_m:   distancia del borde del andén al eje de la vía

Convenio de ejes: el atlas coloca el GLB sin girar y el mundo es
x = este, z = -norte. Así que el modelo se toma con z hacia el sur:
  modelo = ( (lon-lon0)·k , -(lat-lat0)·k ) / metros_por_unidad
"""
import json, math, struct, unicodedata

KM_POR_GRADO_LON = 84.8
KM_POR_GRADO_LAT = 111.32
SEPARACION_M = 6.9          # centro del andén -> eje de la vía
VENTANA_M = 340             # tramo de vía real que acompaña al andén


def norm(t):
    t = unicodedata.normalize("NFD", (t or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return "".join(c for c in t if c.isalnum())


def metros(lon, lat):
    """Desplazamiento en metros respecto del ancla, en ejes (este, norte)."""
    return ((lon + 3.7) * KM_POR_GRADO_LON * 1000.0,
            (40.43 - lat) * KM_POR_GRADO_LAT * 1000.0)


def dir_principal(pts):
    """Eje largo del andén y su centroide.

    El path es el contorno de una placa: se busca el rectángulo de área mínima
    (calipers) y su lado largo es el eje. La PCA falla en placas casi cuadradas.
    """
    n = len(pts)
    mx = sum(p[0] for p in pts) / n
    mz = sum(p[1] for p in pts) / n
    mejor = None
    for i in range(360):
        a = math.radians(i / 2)
        c, s = math.cos(a), math.sin(a)
        us = [(p[0] - mx) * c + (p[1] - mz) * s for p in pts]
        vs = [-(p[0] - mx) * s + (p[1] - mz) * c for p in pts]
        du = max(us) - min(us)
        dv = max(vs) - min(vs)
        area = du * dv
        if mejor is None or area < mejor[0]:
            mejor = (area, a, du, dv)
    _, ang, du, dv = mejor
    # el eje del andén es el lado largo del rectángulo
    if dv > du:
        ang += math.pi / 2
    return ang, (mx, mz)


def girar(p, ang):
    c, s = math.cos(ang), math.sin(ang)
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c)


def seg_proyeccion(p, pts):
    mejor = None
    for i in range(len(pts) - 1):
        ax, az = pts[i]
        bx, bz = pts[i + 1]
        vx, vz = bx - ax, bz - az
        L2 = vx * vx + vz * vz
        if L2 < 1e-12:
            continue
        t = max(0.0, min(1.0, ((p[0] - ax) * vx + (p[1] - az) * vz) / L2))
        q = (ax + vx * t, az + vz * t)
        d = math.hypot(p[0] - q[0], p[1] - q[1])
        if mejor is None or d < mejor[0]:
            L = math.sqrt(L2)
            mejor = (d, q, (vx / L, vz / L))
    return mejor


def caja_glb(ruta):
    """Caja envolvente del GLB a partir de los accessors POSITION (sin nodos)."""
    with open(ruta, "rb") as f:
        cabecera = f.read(12)
        if cabecera[:4] != b"glTF":
            raise ValueError("no es GLB")
        largo, tipo = struct.unpack("<II", f.read(8))
        if tipo != 0x4E4F534A:
            raise ValueError("sin chunk JSON")
        gltf = json.loads(f.read(largo).decode("utf-8"))
    minimo = [1e30] * 3
    maximo = [-1e30] * 3
    for malla in gltf.get("meshes", []):
        for prim in malla.get("primitives", []):
            i = prim.get("attributes", {}).get("POSITION")
            if i is None:
                continue
            acc = gltf["accessors"][i]
            if "min" not in acc:
                continue
            for k in range(3):
                minimo[k] = min(minimo[k], acc["min"][k])
                maximo[k] = max(maximo[k], acc["max"][k])
    return [maximo[k] - minimo[k] for k in range(3)]


red = json.load(open("public/data/network.json"))
mods = json.load(open("public/data/models.json"))
estaciones = {s["id"]: s for s in red["stations"]}

por_estacion = {}
for e in red["edges"]:
    for lado in ("a", "b"):
        por_estacion.setdefault((str(e["line"]), e[lado]), []).append(e)


def via_geo(linea, sid):
    tramos = por_estacion.get((str(linea), sid), [])
    if not tramos:
        return None
    pts = []
    for e in tramos:
        p = [metros(*c) for c in e["coords"]]
        if e["a"] != sid:
            p = p[::-1]
        pts.append(p)
    return pts[0] if len(pts) == 1 else pts[0] + pts[1]


salida = []
for m in mods:
    sid = m.get("station_id")
    if not sid:
        cand = [s for s in red["stations"] if norm(s["name"]) == norm(m.get("name"))]
        sid = cand[0]["id"] if cand else None
    if not sid:
        salida.append({"id": m["id"], "nombre": m.get("name"), "error": "sin estación en la red"})
        continue

    s = estaciones[sid]
    ancla = m.get("anchor") or {}
    try:
        caja = caja_glb("public" + m["file"].replace("/models", "/models"))
        maxdim = max(caja)
    except Exception as err:
        salida.append({"id": m["id"], "error": "GLB ilegible: %s" % err})
        continue
    # el atlas normaliza el mayor lado a 0,5 unidades de mundo (= 500 m)
    metros_por_unidad = 500.0 / maxdim

    ax, az = metros(ancla.get("lon") or s["lon"], ancla.get("lat") or s["lat"])

    andenes, peor = [], 0.0
    for p in m.get("platforms", []):
        pts = [(q[0], q[2]) for q in p.get("path", [])]
        if len(pts) < 3:
            continue
        g = via_geo(p["line"], sid)
        if not g:
            andenes.append({"linea": p["line"], "sin_via": True})
            continue
        via = [[(x - ax) / metros_por_unidad, (z - az) / metros_por_unidad]
               for (x, z) in g if math.hypot(x - ax, z - az) <= VENTANA_M]
        if len(via) < 2:
            andenes.append({"linea": p["line"], "sin_via": True})
            continue

        dir_and, centro = dir_principal(pts)
        # rumbo local de la vía: el del tramo más cercano al andén (no la cuerda)
        proy0 = seg_proyeccion(centro, via)
        if proy0 is None:
            andenes.append({"linea": p["line"], "sin_via": True})
            continue
        dir_via = math.atan2(proy0[2][1], proy0[2][0])
        delta = (dir_via - dir_and) % math.pi
        if delta > math.pi / 2:
            delta -= math.pi

        c2 = girar(centro, delta)
        proy = seg_proyeccion(c2, via)
        if proy is None:
            andenes.append({"linea": p["line"], "sin_via": True})
            continue
        _, q, u = proy
        n = (-u[1], u[0])
        lado = (c2[0] - q[0]) * n[0] + (c2[1] - q[1]) * n[1]
        signo = 1.0 if lado >= 0 else -1.0
        sep = SEPARACION_M / metros_por_unidad
        objetivo = (q[0] + n[0] * signo * sep, q[1] + n[1] * signo * sep)
        t = (objetivo[0] - c2[0], objetivo[1] - c2[1])

        # path completo [x,y,z] con x,z ya movidos; la Y (nivel) se conserva
        encajado = []
        for q3 in p["path"]:
            gx, gz = girar((q3[0], q3[2]), delta)
            encajado.append([round(gx + t[0], 4), q3[1], round(gz + t[1], 4)])
        desajuste = abs(seg_proyeccion(objetivo, via)[0] - sep) * metros_por_unidad \
            if seg_proyeccion(objetivo, via) else None
        if desajuste is not None:
            peor = max(peor, desajuste)

        andenes.append({
            "linea": p["line"],
            "giro_fino_deg": round(math.degrees(delta), 3),
            "traslacion": [round(t[0], 4), round(t[1], 4)],
            "meshes": p.get("mesh_names", []),
            "path_encajado": encajado,
            "via": [[round(v[0], 4), round(v[1], 4)] for v in via],
            "desajuste_m": round(desajuste, 2) if desajuste is not None else None,
        })

        # --- transformación de conjunto: media ponderada (peso = largo del andén)
        ac = ass = tx = tz = peso = 0.0
        for a in andenes:
            if a.get("giro_fino_deg") is None:
                continue
            w = a.get("largo") or 1.0
            ac += math.cos(math.radians(a["giro_fino_deg"])) * w
            ass += math.sin(math.radians(a["giro_fino_deg"])) * w
            tx += a["traslacion"][0] * w
            tz += a["traslacion"][1] * w
            peso += w
        conj_deg = math.degrees(math.atan2(ass, ac)) if peso else 0.0
        conj_t = (tx / peso if peso else 0.0, tz / peso if peso else 0.0)

    salida.append({
        "id": m["id"], "estacion": sid, "nombre": s["name"],
        "giro_conjunto_deg": round(conj_deg, 3),
        "traslacion_conjunto": [round(conj_t[0], 4), round(conj_t[1], 4)],
        "metros_por_unidad": round(metros_por_unidad, 4),
        "maxdim": round(maxdim, 4),
        "peor_desajuste_m": round(peor, 2),
        "andenes": andenes,
    })

json.dump({"meta": {
    "aviso": "andén colocado sobre la vía del CRTM; el croquis de origen no es geográfico",
    "separacion_m": SEPARACION_M, "ventana_m": VENTANA_M},
    "estaciones": salida}, open("public/data/encaje.json", "w"), ensure_ascii=False, indent=1)

print(f"modelos {len(mods)} · encajados {sum(1 for e in salida if 'andenes' in e)}")
for e in salida:
    if "andenes" not in e:
        print(f"  {e['id']:26s} AVISO {e.get('error')}")
        continue
    trozos = [f"L{a['linea']}:{a.get('giro_fino_deg', 0):+.1f}°/{a.get('desajuste_m')} m"
              for a in e["andenes"]]
    print(f"  {e['id']:26s} maxdim {e['maxdim']:8.2f}  " + " · ".join(trozos))
