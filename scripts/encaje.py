#!/usr/bin/env python3
"""Encaje de las vías reales (network.json) dentro de cada modelo de estación (models.json).

Los GLB son croquis: su orientación es "source_file_orientation_not_geographic", así que sus
andenes no miran al rumbo real de su línea. Este script:

  1. mide el rumbo de cada andén en el modelo y el de su vía real en el mapa;
  2. calcula un giro de conjunto (media ponderada) y el giro fino de cada andén;
  3. escribe la vía real en coordenadas del modelo, para dibujar la estación con
     las vías de verdad entrando por donde entran.

Salida: data/encaje.json
"""
import json, math, unicodedata

R = 6378137.0
LAT0, LON0 = 40.4168, -3.7038
ESCALA_EXTENTO_KM = 0.5          # map_representation.normalized_max_extent_km
VENTANA_M = 260                  # tramo de vía real que se lleva al modelo


def norm(t):
    t = unicodedata.normalize("NFD", (t or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return "".join(c for c in t if c.isalnum())


def a_metros(lon, lat):
    return (math.radians(lon - LON0) * R * math.cos(math.radians(LAT0)),
            math.radians(lat - LAT0) * R)


def dir_principal(pts):
    n = len(pts)
    mx = sum(p[0] for p in pts) / n
    my = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - mx) ** 2 for p in pts) / n
    syy = sum((p[1] - my) ** 2 for p in pts) / n
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts) / n
    return 0.5 * math.atan2(2 * sxy, sxx - syy)


def dif_ang(a, b):
    d = (a - b) % math.pi
    return d - math.pi if d > math.pi / 2 else d


def girar(p, ang):
    c, s = math.cos(ang), math.sin(ang)
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c)


red = json.load(open("data/network.json"))
mods = json.load(open("data/models.json"))
estaciones = {s["id"]: s for s in red["stations"]}

por_estacion = {}
for e in red["edges"]:
    for lado in ("a", "b"):
        por_estacion.setdefault((str(e["line"]), e[lado]), []).append(e)


def via_geo(linea, sid):
    """Polilínea real (metros) de la vía de esa línea al paso por la estación."""
    tramos = por_estacion.get((str(linea), sid), [])
    if not tramos:
        return None
    pts = []
    for e in tramos:
        p = [a_metros(*c) for c in e["coords"]]
        if e["a"] != sid:
            p = p[::-1]
        pts.append(p)
    if len(pts) == 1:
        return pts[0]
    return pts[0] + pts[1]


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
    ax, ay = a_metros(s["lon"], s["lat"])
    anchor = m.get("anchor") or {}
    if anchor.get("lon"):
        ax, ay = a_metros(anchor["lon"], anchor["lat"])

    ext = 1.0
    for p in m.get("platforms", []):
        for q in p.get("path", []):
            ext = max(ext, abs(q[0]), abs(q[2]))
    escala = (ESCALA_EXTENTO_KM * 1000) / (2 * ext)      # unidades modelo -> metros

    andenes = []
    for p in m.get("platforms", []):
        pts = [(q[0], q[2]) for q in p.get("path", [])]
        if len(pts) < 3:
            continue
        geopts = via_geo(p["line"], sid)
        if not geopts:
            andenes.append({"linea": p["line"], "cota": p.get("level_in_file"), "sin_via": True})
            continue
        dmod = dir_principal(pts)
        cerca = [(x, y) for (x, y) in geopts if math.dist((x, y), (ax, ay)) <= VENTANA_M]
        if len(cerca) < 2:
            cerca = geopts
        dgeo = dir_principal(cerca)
        andenes.append({"linea": p["line"], "cota": p.get("level_in_file"),
                        "giro": dif_ang(dgeo, dmod), "largo": math.dist(pts[0], pts[-1])})

    validos = [a for a in andenes if "giro" in a]
    if not validos:
        salida.append({"id": m["id"], "estacion": sid, "nombre": s["name"], "error": "sin vías"})
        continue

    sw = sum(a["largo"] for a in validos) or 1
    cx = sum(math.cos(2 * a["giro"]) * a["largo"] for a in validos) / sw
    cy = sum(math.sin(2 * a["giro"]) * a["largo"] for a in validos) / sw
    giro = 0.5 * math.atan2(cy, cx)

    detalle = []
    for a in andenes:
        if "giro" not in a:
            detalle.append(a)
            continue
        geopts = via_geo(a["linea"], sid)
        via = []
        for (x, y) in geopts:
            dx, dy = (x - ax), (y - ay)
            if math.hypot(dx, dy) > VENTANA_M * 1.6:
                continue
            mx, my = girar((dx, dy), -giro)
            via.append([round(mx / escala, 1), round(my / escala, 1)])
        detalle.append({
            "linea": a["linea"], "cota": a["cota"],
            "giro_fino_deg": round(math.degrees(a["giro"] - giro), 1),
            "via": via,
        })

    salida.append({
        "id": m["id"], "estacion": sid, "nombre": s["name"],
        "lon": s["lon"], "lat": s["lat"], "x": round(ax, 1), "y": round(ay, 1),
        "giro_deg": round(math.degrees(giro), 1),
        "escala": round(escala, 3),
        "andenes": detalle,
    })

json.dump({"meta": {"aviso": "giro medido contra la red CRTM; el croquis no es geográfico de origen",
                    "ventana_m": VENTANA_M}, "estaciones": salida},
          open("data/encaje.json", "w"), ensure_ascii=False, indent=1)

ok = [s for s in salida if "giro_deg" in s]
print(f"modelos {len(mods)} · encajados {len(ok)}")
for s in salida:
    if "giro_deg" not in s:
        print(f"  {s['id']:24s} AVISO {s.get('error')}")
        continue
    finos = ", ".join(f"L{a['linea']}:{a.get('giro_fino_deg','-')}°" for a in s["andenes"])
    print(f"  {s['id']:24s} {s['nombre']:20s} giro {s['giro_deg']:6.1f}°  escala {s['escala']:.2f}  {finos}")
