#!/usr/bin/env python3
"""Reglas de validación del encaje. Se ejecutan ANTES de dibujar y bloquean el build.

R1 dirección   el eje del andén, ya girado, va en la dirección de su vía (±8°)
R2 planta      el centro del andén cae sobre su vía (±25 m antes de plegar la línea)
R3 cota        cada estación de la red tiene cota y está dentro del rango de su línea
R4 vertical     ninguna línea salta más de 15 m de cota entre estaciones seguidas
R5 cobertura    todas las estaciones de la red tienen cota y todo modelo tiene estación

Uso:  python3 scripts/validar.py [--json]
Sale con código 1 si alguna regla falla.
"""
import json, math, os, sys, unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(RAIZ, "data")

LIM_DIR = 8.0
LIM_PLANTA = 25.0
LIM_SALTO_COTA = 15.0


def carga(n):
    with open(os.path.join(D, n), encoding="utf-8") as f:
        return json.load(f)


def norm(t):
    t = unicodedata.normalize("NFD", (t or "").lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn" and c.isalnum())


def metros(lon, lat):
    return ((lon + 3.7) * 84800.0, (40.43 - lat) * 111320.0)


def eje_largo(pts):
    n = len(pts)
    mx = sum(p[0] for p in pts) / n
    mz = sum(p[1] for p in pts) / n
    mejor = None
    for i in range(180):
        a = math.radians(i)
        c, s = math.cos(a), math.sin(a)
        us = [(p[0] - mx) * c + (p[1] - mz) * s for p in pts]
        vs = [-(p[0] - mx) * s + (p[1] - mz) * c for p in pts]
        du, dv = max(us) - min(us), max(vs) - min(vs)
        if mejor is None or du * dv < mejor[0]:
            mejor = (du * dv, a, du, dv)
    _, ang, du, dv = mejor
    if dv > du:
        ang += math.pi / 2
    return ang, (mx, mz)


def rumbo_via(estacion, linea, estaciones, por_linea):
    """Rumbo de la línea al pasar por la estación, por la cuerda con sus vecinas."""
    puntos = por_linea.get(linea, [])
    if estacion not in puntos or len(puntos) < 2:
        return None
    i = puntos.index(estacion)
    prev = puntos[max(0, i - 1)]
    siguiente = puntos[min(len(puntos) - 1, i + 1)]
    if prev == estacion and siguiente == estacion:
        return None
    a = estaciones[prev] if prev != estacion else estaciones[estacion]
    b = estaciones[siguiente] if siguiente != estacion else estaciones[estacion]
    ax, az = metros(a["lon"], a["lat"])
    bx, bz = metros(b["lon"], b["lat"])
    return math.atan2(bz - az, bx - ax)


def main():
    metro = carga("metro.json")
    coloc = carga("colocacion.json")
    red = carga("models.json")

    estaciones = {s["id"]: s for s in metro["stations"]}
    lineas = {l["id"]: l for l in metro["lines"]}
    por_linea = {}
    for l in metro.get("shapes") or metro.get("patterns") or []:
        pass
    # orden de estaciones por línea: se deduce de la propia lista de líneas de cada estación
    for st in metro["stations"]:
        for l in st.get("l", []):
            por_linea.setdefault(l, []).append(st["id"])
    # ordenar cada línea por recorrido: vecino más próximo desde el extremo
    def ordenar(ids):
        if len(ids) < 3:
            return ids
        resta = set(ids)
        arranque = min(ids, key=lambda i: estaciones[i]["lon"])
        orden = [arranque]
        resta.discard(arranque)
        while resta:
            ult = estaciones[orden[-1]]
            sig = min(resta, key=lambda i: math.hypot(
                (estaciones[i]["lat"] - ult["lat"]) * 111320,
                (estaciones[i]["lon"] - ult["lon"]) * 84800))
            orden.append(sig)
            resta.discard(sig)
        return orden
    for l in list(por_linea):
        por_linea[l] = ordenar(por_linea[l])

    fallos, avisos = [], []

    # --- R1 y R2: dirección y planta de cada andén del modelo ------------------
    detalle = []
    for f in coloc["modelos"]:
        if f.get("sin_dato"):
            fallos.append(f"R5 {f['id']}: {f['sin_dato']}")
            continue
        m = next((x for x in red if x["id"] == f["id"]), None)
        if not m:
            fallos.append(f"R5 {f['id']}: no está en models.json")
            continue
        st = estaciones[f["estacion"]]
        ax, az = metros(st["lon"], st["lat"])
        giro = math.radians(f["giro"])
        for p in m.get("platforms", []):
            pts = [(q[0], q[2]) for q in p.get("path", [])]
            if len(pts) < 3:
                continue
            ang, (mx, mz) = eje_largo(pts)
            ang += giro                      # el giro que se va a aplicar al modelo
            rumbo = rumbo_via(f["estacion"], p["line"], estaciones, por_linea)
            if rumbo is None:
                avisos.append(f"R1 {f['id']} L{p['line']}: sin rumbo de vía")
                continue
            d = abs(math.degrees((ang - rumbo) % math.pi))
            d = min(d, 180 - d)
            # distancia en planta del centro del andén a la vía (puntos de la línea)
            centro = (mx * math.cos(giro) - mz * math.sin(giro) + (f["dx"] or 0),
                      mx * math.sin(giro) + mz * math.cos(giro) - (f["dy"] or 0))
            linea_pts = [metros(estaciones[i]["lon"], estaciones[i]["lat"]) for i in por_linea[p["line"]]]
            dist = min(math.hypot(centro[0] - (x - ax), centro[1] - (z - az)) for x, z in linea_pts)
            detalle.append({"modelo": f["id"], "linea": p["line"], "estacion": f["estacion"],
                            "direccion_deg": round(d, 1), "planta_m": round(dist, 1)})
            if d > LIM_DIR:
                fallos.append(f"R1 {f['id']} L{p['line']}: {d:.1f}° de desvío (>{LIM_DIR}°)")
            if dist > LIM_PLANTA:
                avisos.append(f"R2 {f['id']} L{p['line']}: centro a {dist:.0f} m de la vía (>{LIM_PLANTA} m)")

    # --- R3: toda estación tiene cota y entra en el rango de su línea ----------
    sin_cota = [s["id"] for s in metro["stations"] if s.get("cota") is None]
    if sin_cota:
        fallos.append(f"R3 {len(sin_cota)} estaciones sin cota")
    fuera = []
    for st in metro["stations"]:
        for l in st.get("l", []):
            li = lineas.get(l, {})
            lo, hi = li.get("cotaMin"), li.get("cotaMax")
            if lo is None or hi is None:
                continue
            if not (lo - 1 <= st["cota"] <= hi + 1):
                fuera.append(f"{st['n']} L{l} {st['cota']} m fuera de [{lo},{hi}]")
    if fuera:
        avisos.append(f"R3 {len(fuera)} cotas fuera del rango de su línea: " + "; ".join(fuera[:4]))

    # --- R4: continuidad vertical por línea ------------------------------------
    saltos = []
    for l, ids in por_linea.items():
        cotas = [estaciones[i]["cota"] for i in ids]
        for a, b, ia, ib in zip(cotas, cotas[1:], ids, ids[1:]):
            if abs(a - b) > LIM_SALTO_COTA:
                saltos.append(f"L{l} {estaciones[ia]['n']}({a}) → {estaciones[ib]['n']}({b})")
    if saltos:
        fallos.append(f"R4 {len(saltos)} saltos de cota > {LIM_SALTO_COTA} m: " + "; ".join(saltos[:4]))

    # --- R5: cobertura --------------------------------------------------------
    con_modelo = [f for f in coloc["modelos"] if not f.get("sin_dato")]
    print(f"red: {len(metro['stations'])} estaciones · {len(por_linea)} líneas · "
          f"modelos: {len(coloc['modelos'])} ({len(con_modelo)} colocados)\n")

    print("R1/R2 por andén")
    for d in sorted(detalle, key=lambda x: -x["direccion_deg"]):
        marca = "ok " if d["direccion_deg"] <= LIM_DIR else "MAL"
        print(f"  {marca} {d['modelo']:24s} L{d['linea']:3s} dir {d['direccion_deg']:5.1f}°  "
              f"planta {d['planta_m']:6.1f} m")

    print("\nResumen")
    if avisos:
        for a in avisos[:10]:
            print("  aviso:", a)
    if fallos:
        for f in fallos[:10]:
            print("  FALLO:", f)
        print(f"\n{len(fallos)} fallos, {len(avisos)} avisos → NO se dibuja")
    else:
        print(f"  reglas en verde ({len(avisos)} avisos)")

    json.dump({"ok": not fallos, "fallos": fallos, "avisos": avisos, "detalle": detalle,
               "limites": {"direccion_deg": LIM_DIR, "planta_m": LIM_PLANTA,
                           "salto_cota_m": LIM_SALTO_COTA}},
              open(os.path.join(D, "validacion.json"), "w"), ensure_ascii=False, indent=1)
    return 0 if not fallos else 1


if __name__ == "__main__":
    sys.exit(main())
