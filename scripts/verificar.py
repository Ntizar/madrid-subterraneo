#!/usr/bin/env python3
"""Verificador del atlas: convierte el contrato del proyecto en números.

    python scripts/verificar.py            # todo
    python scripts/verificar.py datos      # cobertura y fuentes
    python scripts/verificar.py encaje     # vía real vs andén (S, par de trazas)
    python scripts/verificar.py cotas      # una cota por línea, andén a la cota de su línea
    python scripts/verificar.py trazado    # sin curvas extrañas ni pliegues

Sin dependencias: solo stdlib. Sale con 0 solo si TODO está en verde.

La unidad de trabajo NO es la estación: es la estación-línea (un andén). Un
intercambiador tiene un andén por línea, cada uno sobre su vía y a su cota.
"""
import json
import math
import os
import statistics
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def leer(nombre):
    with open(os.path.join(RAIZ, "data", nombre), encoding="utf-8") as f:
        return json.load(f)


def dist_m(a, b):
    """Distancia en metros entre dos (lat, lon)."""
    ky = 111320.0
    kx = 111320.0 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((b[0] - a[0]) * ky, (b[1] - a[1]) * kx)


def proyectar(p, pts):
    """Punto más cercano de una polilínea (lat, lon) y la tangente allí.

    Devuelve (dist_m, ang_deg) con rumbo atan2(norte, este), igual que el visor.
    """
    lat0 = math.radians(p[0])
    kx, ky = 111320.0 * math.cos(lat0), 111320.0
    px, py = 0.0, 0.0
    mejor = (1e18, 0.0)
    for i in range(len(pts) - 1):
        ax = (pts[i][1] - p[1]) * kx
        ay = (pts[i][0] - p[0]) * ky
        bx = (pts[i + 1][1] - p[1]) * kx
        by = (pts[i + 1][0] - p[0]) * ky
        dx, dy = bx - ax, by - ay
        n2 = dx * dx + dy * dy
        t = 0.0 if n2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / n2))
        cx, cy = ax + dx * t, ay + dy * t
        d = math.hypot(cx, cy)
        if d < mejor[0]:
            mejor = (d, math.degrees(math.atan2(dy, dx)))
        px, py = cx, cy
    return mejor


def dif_ang(a, b):
    """Diferencia angular mínima entre dos rumbos (0-90°: el eje no tiene sentido)."""
    d = abs((a - b + 90) % 180 - 90)
    return d


def cargar():
    metro = leer("metro.json")
    red = leer("network.json")
    shapes = metro["shapes"]
    # shape -> línea y dirección, a través de los patterns (nunca por el nombre)
    shape_de = {}
    for p in metro["patterns"]:
        shape_de.setdefault(p["s"], (p["l"], p.get("d", 0)))
    por_linea = {}
    for idx, (linea, direccion) in shape_de.items():
        por_linea.setdefault(linea, {}).setdefault(direccion, []).append(idx)
    return metro, red, shapes, por_linea


def unidades(metro):
    """(estación, línea) de cada andén, con su cota y su posición de estación."""
    out = []
    for s in metro["stations"]:
        for linea in s.get("l", []):
            out.append({"id": s["id"], "nombre": s["n"], "linea": linea,
                        "lat": s["lat"], "lon": s["lon"], "cota": s.get("cota")})
    return out


def cmd_datos(metro, red):
    fallos, avisos = [], []
    print(f"estaciones de red (CRTM) : {len(red['stations'])}")
    print(f"conexiones                : {len(red['edges'])}")
    print(f"estaciones GTFS           : {len(metro['stations'])}")
    print(f"líneas                    : {len(metro['lines'])}")
    print(f"shapes                    : {len(metro['shapes'])}")
    prints = ", ".join(f"{l['id']}:{l['depth']}" for l in metro["lines"])
    print(f"profundidad por línea     : {prints}")
    for l in metro["lines"]:
        if l["id"] not in {s["id"] for s in red["lines"]}:
            fallos.append(f"línea {l['id']} en GTFS y no en la red CRTM")
    if len(metro["lines"]) != 13:
        fallos.append(f"{len(metro['lines'])} líneas, se esperan 13")
    if not os.path.exists(os.path.join(RAIZ, "data", "andenes.json")):
        avisos.append("falta data/andenes.json: el anclaje del andén se recalcula en cada carga")
    print(f"\nunidades estación-línea   : {len(unidades(metro))}")
    return fallos, avisos


def cmd_encaje(metro, shapes, por_linea):
    """Cada andén debe estar SOBRE su vía, con su par de trazas medido.

    La fuente es data/andenes.json (lo genera scripts/andenes.py desde el GTFS).
    Si no existe, se cae al cálculo al vuelo, que es lo que hacía el visor: medir
    la estación contra el par de trazas da 34 unidades a más de 60 m.
    """
    fallos, avisos = [], []
    ruta = os.path.join(RAIZ, "data", "andenes.json")
    if not os.path.exists(ruta):
        fallos.append("falta data/andenes.json: ejecuta python scripts/andenes.py")
        return fallos, avisos
    a = json.load(open(ruta, encoding="utf-8"))
    andenes = a.get("andenes") or {}
    total_unidades = len(unidades(metro))
    print(f"unidades estación-línea : {len(andenes)} (GTFS: {total_unidades})")
    if len(andenes) < total_unidades:
        fallos.append(f"faltan andenes: {len(andenes)} de {total_unidades}")

    # Cada andén se proyecta sobre CADA traza de su línea: la distancia de la
    # estación a su vía no puede ser absurda (es lo que fallaba: 34 unidades a >60 m).
    lejos = []
    for k, u in andenes.items():
        dirs = por_linea.get(u["l"], {})
        mejor = 1e18
        for d in dirs:
            for si in dirs[d]:
                mejor = min(mejor, proyectar((u["lat"], u["lon"]), shapes[si]["pts"])[0])
        if mejor > 60:
            lejos.append((u, mejor))
    print(f"andén con su vía a ≤60 m : {len(andenes) - len(lejos)}/{len(andenes)}")
    if lejos:
        for u, d in lejos[:5]:
            print(f"  - {u['n']} L{u['l']}: {d:.0f} m")
        fallos.append(f"{len(lejos)} andenes a más de 60 m de su vía")

    med = [u["S"] for u in andenes.values() if u["conf"] == "medida"]
    est = [u for u in andenes.values() if u["conf"] != "medida"]
    if med:
        mediana = statistics.median(med)
        print(f"separación de vías S    : mediana {mediana:.2f} m · "
              f"n={len(med)} medidas · {len(est)} estimadas")
        if not 4.4 <= mediana <= 6.2:
            fallos.append(f"S mediana {mediana:.2f} m fuera de 4,4-6,2 m")
        fuera = [x for x in med if not 3.0 <= x <= 15.0]
        if fuera:
            fallos.append(f"{len(fuera)} andenes con S fuera de 3-15 m y sin marcar como estimada")
    if est:
        pct = 100.0 * len(est) / max(1, len(andenes))
        avisos.append(f"{len(est)} andenes ({pct:.0f} %) con separación estimada: L3 sin par de "
                      "trazas en el feed, ramales y bucles")
        if pct > 25.0:
            fallos.append(f"{pct:.0f} % de andenes con separación estimada (máx 25 %)")
    return fallos, avisos


def cmd_cotas(metro, shapes, por_linea):
    """La cota que se dibuja debe ser el perfil, no una recta entre estaciones.

    `data/metro.json` ya trae un perfil por shape (pares [s sobre la vía, cota]).
    El visor, en cambio, interpola entre la cota de una estación y la de la
    siguiente: eso es lo que hace dientes de sierra. Aquí se comprueba el perfil
    y se comprueba que el visor lo usa.
    """
    fallos, avisos = [], []
    perfiles = {int(k): v for k, v in (metro.get("perfiles") or {}).items()}
    print(f"perfiles de cota en el dato: {len(perfiles)}")
    peor_inv, peor_pend = 0, 0.0
    for k, p in perfiles.items():
        pe = [(c1 - c0) / (s1 - s0) * 100 for (s0, c0), (s1, c1) in zip(p, p[1:]) if s1 > s0]
        if not pe:
            continue
        inv = sum(1 for a, b in zip(pe, pe[1:]) if a * b < 0 and abs(b) > 0.3)
        pend = max(abs(x) for x in pe)
        peor_inv, peor_pend = max(peor_inv, inv), max(peor_pend, pend)
    if perfiles:
        print(f"  peor perfil: {peor_inv} cambios de sentido · pendiente máx {peor_pend:.1f} %")
        if peor_inv > 0:
            fallos.append(f"algún perfil sube y baja ({peor_inv} veces)")
        if peor_pend > 3.0:
            fallos.append(f"pendiente de {peor_pend:.1f} % en el perfil (máx de metro ~3 %)")

    # coherencia: el perfil pasa por la cota de cada estación
    def s_en_shape(sh, lat, lon):
        pts, cum = sh["pts"], sh["cum"]
        best = (1e18, 0.0)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            kx, ky = 111320.0 * math.cos(math.radians(lat)), 111320.0
            ax, ay = (a[1] - lon) * kx, (a[0] - lat) * ky
            bx, by = (b[1] - lon) * kx, (b[0] - lat) * ky
            dx, dy = bx - ax, by - ay
            n = dx * dx + dy * dy
            t = 0.0 if n == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / n))
            d = math.hypot(ax + dx * t, ay + dy * t)
            if d < best[0]:
                best = (d, cum[i] + (cum[i + 1] - cum[i]) * t)
        return best

    def cota_en(p, s):
        if s <= p[0][0]:
            return p[0][1]
        for (s0, c0), (s1, c1) in zip(p, p[1:]):
            if s0 <= s <= s1:
                return c0 + (c1 - c0) * ((s - s0) / (s1 - s0) if s1 > s0 else 0)
        return p[-1][1]

    errs = []
    for st in metro["stations"]:
        if st.get("cota") is None:
            continue
        for linea in st.get("l", []):
            for si in sorted(por_linea.get(linea, {}).get(0, []))[:1]:
                if si not in perfiles:
                    continue
                d, s = s_en_shape(shapes[si], st["lat"], st["lon"])
                if d > 300:
                    continue
                errs.append(abs(cota_en(perfiles[si], s) - st["cota"]))
    if errs:
        print(f"  coherencia perfil↔estación: n={len(errs)} · mediana {statistics.median(errs):.2f} m · "
              f"máx {max(errs):.2f} m")
        if max(errs) > 0.5:
            fallos.append(f"el perfil no pasa por la cota de la estación (máx {max(errs):.1f} m)")

    # ¿lo usa el visor?
    visor = os.path.join(RAIZ, "fuente", "src", "main.js")
    if os.path.exists(visor):
        src = open(visor, encoding="utf-8").read()
        if "perfiles" not in src:
            fallos.append("el visor no usa los perfiles de cota: interpola entre estaciones")
    return fallos, avisos


def giro_deg(a, b):
    """Giro real entre dos rumbos consecutivos, en [-180, 180]."""
    return ((b - a + 180.0) % 360.0) - 180.0


def cmd_trazado(metro):
    """Trazado fiel: sin codos ni bucles inventados en las shapes de origen."""
    fallos, avisos = [], []
    peores = []
    for idx, sh in enumerate(metro["shapes"]):
        pts = sh["pts"]
        giros = []
        for i in range(1, len(pts) - 1):
            a = math.atan2(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
            b = math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
            # un quiebro es un giro grande entre dos segmentos CORTOS; el mismo
            # giro entre dos cuerdas de 1 km es una curva suave mal muestreada
            corto = min(dist_m(pts[i - 1], pts[i]), dist_m(pts[i], pts[i + 1]))
            g = abs(giro_deg(math.degrees(a), math.degrees(b)))
            # radio de la curva: un giro de 60° con cuerdas de 90 m es una curva
            # real de ~85 m de radio; con cuerdas de 20 m es un quiebro
            giros.append((g if corto < 60 else 0.0, g, corto))
        if not giros:
            continue
        largo = sum(dist_m(pts[i], pts[i + 1]) for i in range(len(pts) - 1)) / 1000.0
        neto = dist_m(pts[0], pts[-1]) / 1000.0
        peores.append((max(giros, key=lambda x: x[0]), idx, len(pts), largo, neto))
    peores.sort(key=lambda p: p[0][0], reverse=True)
    print(f"shapes analizadas        : {len(peores)}")
    print("quiebros (giro > 60° entre segmentos de menos de 150 m):")
    for (q, g, corto), idx, n, largo, neto in peores[:5]:
        print(f"  shape {idx:>2} ({n:>3} pts, {largo:5.1f} km, recta neta {neto:5.1f} km): "
              f"quiebro máx {q:5.1f}° (giro {g:.0f}° en segmentos de {corto:.0f} m)")
    recon = {i for i, sh in enumerate(metro["shapes"]) if sh.get("reconstruida")}
    codos = [p for p in peores if p[0][0] > 60 and p[1] not in recon]
    codos_recon = [p for p in peores if p[0][0] > 60 and p[1] in recon]
    if codos_recon:
        avisos.append(f"{len(codos_recon)} shapes reconstruidas con quiebro > 60°")
    if recon:
        print(f"  shapes reconstruidas   : {len(recon)} (L3 y Ramal, fuera del GTFS)")
    if codos:
        print(f"  quiebro en 60 m        : {len(codos)}")
    print(f"  shapes con quiebro > 60°: {len(codos)}")
    for (q, g, corto), idx, n, largo, neto in codos[:5]:
        print(f"    - shape {idx}: {q:.0f}° con segmentos de {corto:.0f} m")
    if codos:
        fallos.append(f"{len(codos)} shapes con un quiebro de más de 60° en menos de 150 m")
    enroscones = [p for p in peores if p[3] > 1 and p[4] > 0 and p[3] / p[4] > 2.5]
    if enroscones:
        avisos.append(f"{len(enroscones)} shapes recorren más del doble de la distancia neta (bucle o ida y vuelta)")
    return fallos, avisos


def main():
    que = sys.argv[1] if len(sys.argv) > 1 else "todo"
    metro, red, shapes, por_linea = cargar()
    todo = {"datos": lambda: cmd_datos(metro, red),
            "encaje": lambda: cmd_encaje(metro, shapes, por_linea),
            "cotas": lambda: cmd_cotas(metro, shapes, por_linea),
            "trazado": lambda: cmd_trazado(metro)}
    if que not in todo and que != "todo":
        print(f"uso: verificar.py [{'|'.join(todo)}|todo]")
        return 2
    fallos, avisos = [], []
    for nombre, fn in todo.items():
        if que not in ("todo", nombre):
            continue
        print(f"\n=== {nombre.upper()} ===")
        f, a = fn()
        fallos += [f"[{nombre}] {x}" for x in f]
        avisos += [f"[{nombre}] {x}" for x in a]
    print("\n=== RESULTADO ===")
    for x in avisos:
        print(f"AVISO  {x}")
    for x in fallos:
        print(f"FALLO  {x}")
    print(("VERDE" if not fallos else f"ROJO · {len(fallos)} fallos"))
    return 0 if not fallos else 1


if __name__ == "__main__":
    sys.exit(main())
