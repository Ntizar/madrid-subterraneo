#!/usr/bin/env python3
"""Construye la colocación de cada modelo sobre la red real.

Fuente de verdad (proyecto Metro Live, ya validado allí):

  data/metro.json          estaciones con cota real estimada y líneas con su perfil
  data/estaciones_3d.json  andén: ángulo, largo, tipología
  data/modelos3d.json      modelo del autor: giro propio, dx, dy, estación asignada

Salida `data/colocacion.json`: una fila por modelo con el sitio, el giro y la cota
que hay que aplicar. Nada se estima aquí: si falta el dato, se marca `sin_dato`.
"""
import json, math, os, struct


def eje_largo(pts):
    n = len(pts)
    mx = sum(p[0] for p in pts) / n
    mz = sum(p[1] for p in pts) / n
    mejor = None
    for i in range(180):
        a = math.radians(i)
        c, sn = math.cos(a), math.sin(a)
        us = [(p[0] - mx) * c + (p[1] - mz) * sn for p in pts]
        vs = [-(p[0] - mx) * sn + (p[1] - mz) * c for p in pts]
        du, dv = max(us) - min(us), max(vs) - min(vs)
        if mejor is None or du * dv < mejor[0]:
            mejor = (du * dv, a, du, dv)
    _, ang, du, dv = mejor
    if dv > du:
        ang += math.pi / 2
    return ang


def metros(lon, lat):
    return ((lon - (-3.7)) * 84800.0, (40.43 - lat) * 111320.0)


def rumbo(estacion_id, ids_linea, estaciones):
    if estacion_id not in ids_linea or len(ids_linea) < 2:
        return None
    i = ids_linea.index(estacion_id)
    a = estaciones[ids_linea[max(0, i - 1)]]
    b = estaciones[ids_linea[min(len(ids_linea) - 1, i + 1)]]
    ax, az = metros(a["lon"], a["lat"])
    bx, bz = metros(b["lon"], b["lat"])
    if abs(bx - ax) < 1e-9 and abs(bz - az) < 1e-9:
        return None
    return math.atan2(bz - az, bx - ax)


def busca_giro(plataformas, rumbos):
    """Giro global del modelo que pone todos sus andenes en la dirección de su vía."""
    if not plataformas or not rumbos:
        return None, None
    mejor = None
    for k in range(720):
        g = math.radians(k / 2.0)
        coste = 0.0
        for ang, r in zip(plataformas, rumbos):
            d = math.degrees((ang + g - r) % math.pi)
            d = min(d, 180 - d)
            coste += d * d
        if mejor is None or coste < mejor[0]:
            mejor = (coste, k / 2.0)
    return mejor[1], math.sqrt(mejor[0] / len(plataformas))

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(RAIZ, "data")


def carga(n):
    with open(os.path.join(D, n), encoding="utf-8") as f:
        return json.load(f)


def caja_glb(ruta):
    with open(ruta, "rb") as f:
        if f.read(4) != b"glTF":
            raise ValueError("no es GLB")
        f.read(8)
        largo, _ = struct.unpack("<II", f.read(8))
        g = json.loads(f.read(largo).decode("utf-8"))
    lo, hi = [1e30] * 3, [-1e30] * 3
    for malla in g.get("meshes", []):
        for pr in malla.get("primitives", []):
            i = pr.get("attributes", {}).get("POSITION")
            if i is None or "min" not in g["accessors"][i]:
                continue
            a = g["accessors"][i]
            for k in range(3):
                lo[k] = min(lo[k], a["min"][k])
                hi[k] = max(hi[k], a["max"][k])
    return lo, hi


def cerca(lat, lon, estaciones):
    """Estación más próxima por distancia plana (para modelos sin asignación)."""
    mejor = None
    for st in estaciones:
        d = math.hypot((st["lat"] - lat) * 111320, (st["lon"] - lon) * 84800)
        if mejor is None or d < mejor[0]:
            mejor = (d, st)
    return mejor[1] if mejor and mejor[0] < 400 else None


def main():
    metro = carga("metro.json")
    est3d = carga("estaciones_3d.json")
    mod3d = carga("modelos3d.json")
    catalogo = carga("models.json")

    por_id = {s["id"]: s for s in metro["stations"]}
    por_linea = {}
    for st in metro["stations"]:
        for l in st.get("l", []):
            por_linea.setdefault(l, []).append(st["id"])
    lineas = {l["id"]: l for l in metro["lines"]}

    salida = []
    for m in catalogo:
        fila = {"id": m["id"], "nombre": m.get("name"),
                "glb": m.get("file"), "lineas_modelo": sorted({p["line"] for p in m.get("platforms", [])})}
        ancla = m.get("anchor") or {}
        ref = mod3d.get(m["id"])
        st = None
        if ref and ref.get("estacion"):
            st = por_id.get(ref["estacion"])
            fila["fuente"] = "modelos3d.estacion"
        if st is None and ancla:
            st = cerca(ancla["lat"], ancla["lon"], metro["stations"])
            fila["fuente"] = "ancla del manifiesto" if st else None
        if st is None:
            fila["sin_dato"] = "no se identifica la estación"
            salida.append(fila)
            continue

        e3 = est3d.get(st["id"], {})

        # giro: del catálogo si existe; si no (o si no cuadra), se resuelve con la
        # dirección real de las vías en esa estación
        angs, rumbos = [], []
        for p in m.get("platforms", []):
            pts = [(q[0], q[2]) for q in p.get("path", [])]
            if len(pts) < 3:
                continue
            r = rumbo(st["id"], por_linea.get(p["line"], []), por_id)
            if r is None:
                continue
            angs.append(eje_largo(pts))
            rumbos.append(r)
        giro_dato = (ref or {}).get("ang")
        giro_calc, residuo = (busca_giro(angs, rumbos) if angs else (None, None))
        giro = giro_dato
        refinado = False
        if giro is None:
            giro, refinado = giro_calc, giro_calc is not None
        fila["giro_residuo_deg"] = None if residuo is None else round(residuo, 2)
        fila["giro_refinado"] = refinado
        fila.update({
            "estacion": st["id"], "estacion_nombre": st["n"],
            "lat": st["lat"], "lon": st["lon"],
            "cota": st.get("cota"),
            "giro": round(giro, 3) if giro is not None else None,
            "giro_modelo": giro_dato,
            "dx": (ref or {}).get("dx", 0.0),
            "dy": (ref or {}).get("dy", 0.0),
            "giro_confiable": (ref or {}).get("giro_confiable"),
            "ang_anden": e3.get("ang"), "largo_anden": e3.get("largo"),
            "tipo": e3.get("tipo"),
            "cotas_lineas": {l: lineas.get(l, {}).get("depth") for l in st.get("l", [])},
        })
        try:
            lo, hi = caja_glb(os.path.join(RAIZ, fila["glb"].lstrip("/")))
            fila["caja_m"] = [round(hi[k] - lo[k], 2) for k in range(3)]
            fila["centro"] = [round((lo[0] + hi[0]) / 2, 3), round((lo[2] + hi[2]) / 2, 3)]
        except Exception as e:
            fila["error_glb"] = str(e)
        salida.append(fila)

    json.dump({"meta": {"fuente": "metro.json + estaciones_3d.json + modelos3d.json",
                        "nota": "giro en grados (signo del visor), dx/dy en metros, cota en metros de profundidad"},
               "modelos": salida}, open(os.path.join(D, "colocacion.json"), "w"),
              ensure_ascii=False, indent=1)

    # cotas de TODA la red del atlas: empareja por coordenadas con metro.json
    red = carga("network.json")
    cotas, sin = {}, []
    for st in red["stations"]:
        mejor = None
        for mst in metro["stations"]:
            d = math.hypot((mst["lat"] - st["lat"]) * 111320,
                           (mst["lon"] - st["lon"]) * 84800)
            if mejor is None or d < mejor[0]:
                mejor = (d, mst)
        if mejor[0] <= 120:
            cotas[st["id"]] = {"cota": mejor[1].get("cota"), "metro_id": mejor[1]["id"],
                               "dist_m": round(mejor[0], 1), "nombre": st["name"]}
        else:
            sin.append((st["id"], st["name"], round(mejor[0], 1)))
    json.dump({"meta": {"fuente": "metro.json (cota estimada del CRTM por estación)",
                        "emparejadas": len(cotas), "sin_emparejar": len(sin)},
               "cotas": cotas}, open(os.path.join(D, "cotas.json"), "w"),
              ensure_ascii=False, indent=1)
    print(f"\ncotas de red: {len(cotas)} de {len(red['stations'])} estaciones"
          + (f" · sin emparejar: {sin[:3]}" if sin else ""))

    print(f"{len(salida)} modelos")
    for f in salida:
        if f.get("sin_dato"):
            print(f"  {f['id']:24s} SIN DATO · {f['sin_dato']}")
        else:
            print(f"  {f['id']:24s} {f['estacion']:12s} giro {f['giro']:+7.1f}° "
                  f"dx {f['dx']:+6.1f} dy {f['dy']:+6.1f} cota {f['cota']} m "
                  f"({f.get('fuente')})")


if __name__ == "__main__":
    main()
