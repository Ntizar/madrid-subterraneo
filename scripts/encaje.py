#!/usr/bin/env python3
"""Encaje: cada andén de cada modelo se coloca exactamente sobre su vía real.

Los GLB son croquis y su manifiesto lo dice: "source_file_orientation_not_geographic".
Aquí se mide, andén a andén, el giro y la traslación que dejan el andén pegado a la vía
del CRTM, más un giro de conjunto para no deshacer el croquis.

Salida: data/encaje.json
"""
import json, math, sys, os, unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from colocacion import _seg_proyeccion

R = 6378137.0
LAT0, LON0 = 40.4168, -3.7038
ESCALA_EXTENTO_KM = 0.5
VENTANA_M = 320
ANCHO_ANDEN = 7.0
SEPARACION = ANCHO_ANDEN / 2 + 1.7        # centro del andén -> eje de la vía (m de modelo)


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
    return 0.5 * math.atan2(2 * sxy, sxx - syy), (mx, my)


def girar(p, ang):
    c, s = math.cos(ang), math.sin(ang)
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c)


def mod_pi(a):
    d = a % math.pi
    return d - math.pi if d > math.pi / 2 else d


red = json.load(open("data/network.json"))
mods = json.load(open("data/models.json"))
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
        p = [a_metros(*c) for c in e["coords"]]
        if e["a"] != sid:
            p = p[::-1]
        pts.append(p)
    return pts[0] if len(pts) == 1 else pts[0] + pts[1]


salida = []
peor = 0.0

for m in mods:
    sid = m.get("station_id")
    if not sid:
        cand = [s for s in red["stations"] if norm(s["name"]) == norm(m.get("name"))]
        sid = cand[0]["id"] if cand else None
    if not sid:
        salida.append({"id": m["id"], "nombre": m.get("name"), "error": "sin estación en la red"})
        continue

    s = estaciones[sid]
    anchor = m.get("anchor") or {}
    ax, ay = a_metros(anchor.get("lon") or s["lon"], anchor.get("lat") or s["lat"])

    ext = 1.0
    for p in m.get("platforms", []):
        for q in p.get("path", []):
            ext = max(ext, abs(q[0]), abs(q[2]))
    escala = (ESCALA_EXTENTO_KM * 1000) / (2 * ext)     # unidades modelo -> m reales

    # --- 1) vía real y rumbo de cada andén, todo en coordenadas geográficas -----
    piezas = []
    for p in m.get("platforms", []):
        pts = [(q[0], q[2]) for q in p.get("path", [])]
        if len(pts) < 3:
            continue
        g = via_geo(p["line"], sid)
        if not g:
            piezas.append({"linea": p["line"], "sin_via": True})
            continue
        via_m = [(x - ax, y - ay) for (x, y) in g
                 if math.hypot(x - ax, y - ay) <= VENTANA_M * 1.5]
        if len(via_m) < 2:
            piezas.append({"linea": p["line"], "sin_via": True})
            continue
        d_and, centro = dir_principal(pts)
        d_via = math.atan2(via_m[-1][1] - via_m[0][1], via_m[-1][0] - via_m[0][0])
        largo = math.hypot(pts[-1][0] - pts[0][0], pts[-1][1] - pts[0][1])
        piezas.append({"linea": p["line"], "cota": p.get("level_in_file"),
                       "d_and": d_and, "centro": centro, "d_via": d_via,
                       "via": via_m, "largo": largo})

    validas = [x for x in piezas if "d_via" in x]
    if not validas:
        salida.append({"id": m["id"], "estacion": sid, "nombre": s["name"], "error": "sin vías"})
        continue

    # --- 2) giro de conjunto (deja el croquis mirando al norte) -----------------
    sw = sum(x["largo"] for x in validas) or 1
    cx = sum(math.cos(2 * mod_pi(x["d_via"] - x["d_and"])) * x["largo"] for x in validas) / sw
    cy = sum(math.sin(2 * mod_pi(x["d_via"] - x["d_and"])) * x["largo"] for x in validas) / sw
    teta = 0.5 * math.atan2(cy, cx)

    # --- 3) colocación fina: giro pequeño + traslación hasta el carril ---------
    andenes = []
    for x in piezas:
        if "d_via" not in x:
            andenes.append(x)
            continue
        delta = mod_pi(x["d_via"] - x["d_and"] - teta)     # giro fino, en el marco del modelo
        # --- colocación en el marco geográfico (metros) ---
        cg = girar(x["centro"], teta + delta)
        c_m = (cg[0] * escala, cg[1] * escala)             # centroide orientado, en metros
        proy = _seg_proyeccion(c_m, x["via"], x["via"])
        if proy is None:
            andenes.append({"linea": x["linea"], "sin_via": True})
            continue
        _, q, u = proy
        n = (-u[1], u[0])
        lado = (c_m[0] - q[0]) * n[0] + (c_m[1] - q[1]) * n[1]
        signo = 1.0 if lado >= 0 else -1.0
        sep_m = SEPARACION * escala
        cT = (q[0] + n[0] * signo * sep_m, q[1] + n[1] * signo * sep_m)
        t_geo = (cT[0] - c_m[0], cT[1] - c_m[1])           # metros
        t_local = girar(t_geo, -teta)                      # metros, marco del modelo

        # vía en coordenadas del modelo, para dibujarla
        via_local = [[round(g[0] / escala, 1), round(g[1] / escala, 1)]
                     for g in (girar(p_, -teta) for p_ in x["via"])]

        # validación: distancia del centroide colocado al eje de la vía
        d_m = _seg_proyeccion(cT, x["via"], x["via"])
        desajuste = abs(d_m[0] - sep_m) if d_m else None

        andenes.append({
            "linea": x["linea"], "cota": x["cota"],
            "giro_fino_deg": round(math.degrees(delta), 1),
            "traslacion": [round(t_local[0] / escala, 2), round(t_local[1] / escala, 2)],
            "via": via_local,
            "desajuste_m": round(desajuste, 2) if desajuste is not None else None,
        })

    salida.append({
        "id": m["id"], "estacion": sid, "nombre": s["name"],
        "lon": s["lon"], "lat": s["lat"],
        "escala": round(escala, 4),
        "giro_conjunto_deg": round(math.degrees(teta), 1),
        "andenes": andenes,
    })

json.dump({"meta": {"aviso": "andén colocado sobre la vía del CRTM; el croquis de origen no es geográfico",
                    "separacion_modelo": SEPARACION, "ventana_m": VENTANA_M},
           "estaciones": salida}, open("data/encaje.json", "w"), ensure_ascii=False, indent=1)

ok = [e for e in salida if "giro_conjunto_deg" in e]
print(f"modelos {len(mods)} · encajados {len(ok)}")
for e in salida:
    if "giro_conjunto_deg" not in e:
        print(f"  {e['id']:24s} AVISO {e.get('error')}")
        continue
    trozos = [f"L{a['linea']}:{a['giro_fino_deg']:+.0f}°/{a['desajuste_m']} m"
              for a in e["andenes"] if "via" in a]
    print(f"  {e['id']:24s} {e['nombre']:20s} giro {e['giro_conjunto_deg']:+6.1f}°  " + " · ".join(trozos))
print(f"peor desajuste andén-vía: {peor:.2f} m")
