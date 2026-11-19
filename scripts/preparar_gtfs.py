#!/usr/bin/env python3
"""Refresca los trazados de data/metro.json con el GTFS oficial del CRTM.

    python scripts/preparar_gtfs.py

El visor dibuja lo que hay en `metro.json`. Ese fichero se construyó simplificando
las shapes a 26-55 puntos, y el resultado tiene codos de 90°: no son curvas del
metro, son el muestreo. Este script:

  1. baja (o reutiliza) el GTFS oficial de Metro del CRTM,
  2. quita los puntos que están a menos de 1 m del anterior (el feed trae 1.225),
  3. simplifica con un error máximo de 1 m (no 20),
  4. sustituye los `pts` de cada shape y reescala `cum`, `sp` y `perfiles`.

No inventa trazado: la L3 y el Ramal no vienen con geometría en el feed y se
quedan como estaban, declarados como reconstruidos.
"""
import collections
import csv
import io
import json
import math
import os
import sys
import urllib.request
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GTFS_URL = ("https://www.arcgis.com/sharing/rest/content/items/"
            "5c7f2951962540d69ffe8f640d94c246/data")
GTFS_ZIP = os.path.join(RAIZ, "data", "gtfs", "gtfs.zip")
EPS_M = 1.0        # error máximo admitido al simplificar, en metros
MIN_SEP_M = 1.0    # puntos consecutivos más juntos que esto son ruido


def descargar():
    if os.path.exists(GTFS_ZIP) and os.path.getsize(GTFS_ZIP) > 1_000_000:
        return GTFS_ZIP
    os.makedirs(os.path.dirname(GTFS_ZIP), exist_ok=True)
    print(f"descargando GTFS del CRTM… ({GTFS_URL})")
    urllib.request.urlretrieve(GTFS_URL, GTFS_ZIP)
    if os.path.getsize(GTFS_ZIP) < 1_000_000:
        sys.exit("la descarga no es un zip del GTFS")
    return GTFS_ZIP


def dist_m(a, b):
    ky = 111320.0
    kx = 111320.0 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((b[0] - a[0]) * ky, (b[1] - a[1]) * kx)


def rdp(pts, eps_m):
    """Douglas-Peucker con tolerancia en metros (proyección local)."""
    if len(pts) < 3:
        return pts
    lat0 = math.radians(sum(p[0] for p in pts) / len(pts))
    kx, ky = 111320.0 * math.cos(lat0), 111320.0
    xy = [(p[1] * kx, p[0] * ky) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    pila = [(0, len(pts) - 1)]
    while pila:
        i, j = pila.pop()
        if j <= i + 1:
            continue
        x1, y1 = xy[i]
        x2, y2 = xy[j]
        dx, dy = x2 - x1, y2 - y1
        n = math.hypot(dx, dy) or 1e-12
        mejor, bi = -1.0, -1
        for k in range(i + 1, j):
            x, y = xy[k]
            d = abs(dy * (x - x1) - dx * (y - y1)) / n
            if d > mejor:
                mejor, bi = d, k
        if mejor > eps_m:
            keep[bi] = True
            pila += [(i, bi), (bi, j)]
    return [p for p, k in zip(pts, keep) if k]


def limpiar(pts):
    """Quita puntos consecutivos a menos de MIN_SEP_M y los repetidos."""
    salida = []
    for p in pts:
        if not salida or dist_m(salida[-1], p) >= MIN_SEP_M:
            salida.append(p)
    return salida


def largo(pts):
    return sum(dist_m(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def main():
    z = zipfile.ZipFile(descargar())
    crudas = collections.defaultdict(list)
    with z.open("shapes.txt") as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            crudas[r["shape_id"]].append(
                (int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
    nuevas = {}
    quitados = 0
    for sid, pts in crudas.items():
        p = [(la, lo) for _, la, lo in sorted(pts)]
        limpio = limpiar(p)
        quitados += len(p) - len(limpio)
        if len(limpio) >= 3:
            nuevas[sid] = rdp(limpio, EPS_M)
    print(f"GTFS: {len(crudas)} shapes · {quitados} puntos de ruido quitados (<{MIN_SEP_M:.0f} m)")

    ruta = os.path.join(RAIZ, "data", "metro.json")
    m = json.load(open(ruta, encoding="utf-8"))
    cambios, sin_mapeo = 0, []
    for i, sh in enumerate(m["shapes"]):
        viejo = sh["pts"]
        L = sh["cum"][-1] or largo([(p[0], p[1]) for p in viejo])
        a, b = tuple(viejo[0]), tuple(viejo[-1])
        cand = []
        for sid, p in nuevas.items():
            Lc = largo(p)
            if abs(Lc - L) / max(L, 1.0) < 0.05:
                ext = min(dist_m(a, p[0]) + dist_m(b, p[-1]),
                          dist_m(a, p[-1]) + dist_m(b, p[0]))
                cand.append((ext, abs(Lc - L), sid, Lc))
        cand.sort()
        if not cand or cand[0][0] > 400:
            sin_mapeo.append((i, round(L)))
            continue
        ext, _, sid, Lc = cand[0]
        p = nuevas[sid]
        factor = Lc / L if L else 1.0
        cum = [0.0]
        for k in range(1, len(p)):
            cum.append(cum[-1] + dist_m(p[k - 1], p[k]))
        m["shapes"][i] = {
            "n": len(p),
            "cum": [round(c) for c in cum],
            "pts": [[round(la, 6), round(lo, 6)] for la, lo in p],
        }
        # las paradas y el perfil se reescalan con la longitud (misma geometría)
        for pat in m["patterns"]:
            if pat["s"] == i:
                pat["sp"] = [round(x * factor) for x in pat["sp"]]
        if str(i) in (m.get("perfiles") or {}):
            m["perfiles"][str(i)] = [[round(s * factor), c] for s, c in m["perfiles"][str(i)]]
        cambios += 1

    if sin_mapeo:
        print("sin shape en el GTFS (se suavizan y se marcan como reconstruidas):")
        for i, L in sin_mapeo:
            sh = m["shapes"][i]
            if sh.get("reconstruida"):
                lineas = sorted({p["l"] for p in m["patterns"] if p["s"] == i})
                print(f"  shape {i} → L{','.join(lineas)} · ya reconstruida, se deja")
                continue
            pts = [tuple(p) for p in sh["pts"]]
            for _ in range(3):
                suave = [pts[0]]
                for a, b in zip(pts, pts[1:]):
                    suave.append((a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25))
                    suave.append((a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75))
                suave.append(pts[-1])
                pts = suave
            cum = [0.0]
            for k in range(1, len(pts)):
                cum.append(cum[-1] + dist_m(pts[k - 1], pts[k]))
            factor = (cum[-1] / L) if L else 1.0
            m["shapes"][i] = {"n": len(pts), "cum": [round(c) for c in cum],
                              "pts": [[round(la, 6), round(lo, 6)] for la, lo in pts],
                              "reconstruida": True}
            for pat in m["patterns"]:
                if pat["s"] == i:
                    pat["sp"] = [round(x * factor) for x in pat["sp"]]
            if str(i) in (m.get("perfiles") or {}):
                m["perfiles"][str(i)] = [[round(s * factor), c] for s, c in m["perfiles"][str(i)]]
            lineas = sorted({p["l"] for p in m["patterns"] if p["s"] == i})
            print(f"  shape {i} ({L} m) → L{','.join(lineas)} · {len(pts)} pts suavizados")

    m["meta"]["generado"] = "2026-11-19"
    m["meta"]["nota_trazado"] = (
        f"Shapes del GTFS oficial del CRTM, sin puntos a menos de {MIN_SEP_M:.0f} m "
        f"y simplificadas con error máximo {EPS_M:.0f} m. La L3 y el Ramal no traen "
        "geometría en el feed: van reconstruidas y marcadas.")
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK {ruta} · {cambios}/{len(m['shapes'])} shapes refrescadas · "
          f"{os.path.getsize(ruta)/1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
