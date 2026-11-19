#!/usr/bin/env python3
"""Coloca cada andén SOBRE su vía, a partir del GTFS oficial del CRTM.

    python scripts/andenes.py

La unidad no es la estación: es la estación-línea. En un intercambiador hay un
andén por línea, cada uno sobre su vía y a la cota de su perfil.

Para cada unidad se proyecta la estación sobre las dos direcciones de su línea
(`direction_id` 0 y 1 son los DOS CARRILES, separados 4,4-6,2 m), se ancla en el
punto medio y se toma el rumbo de la tangente. La separación medida (S) dice el
ancho de vías real de esa estación y con ella el visor ajusta el modelo.

Salida: data/andenes.json (lo consume el visor; no se edita a mano).
"""
import json
import math
import os
import statistics
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M_PER_DEG = 111320.0
LARGO = {"estrecho": 90.0, "ancho": 110.0, "ramal": 60.0}
S_NOMINAL = 4.6          # separación nominal cuando el par de trazas no es fiable
S_MIN, S_MAX = 3.0, 15.0


def leer(nombre):
    with open(os.path.join(RAIZ, "data", nombre), encoding="utf-8") as f:
        return json.load(f)


def dist_m(a, b):
    ky = M_PER_DEG
    kx = M_PER_DEG * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((b[0] - a[0]) * ky, (b[1] - a[1]) * kx)


def proyectar(p, pts):
    """(dist_m, s_m, ang_deg) del punto más cercano de una polilínea.

    `s_m` es la distancia recorrida sobre la traza; sirve para leer el perfil de
    cota de la vía en ese punto exacto.
    """
    kx = M_PER_DEG * math.cos(math.radians(p[0]))
    ky = M_PER_DEG
    mejor = (1e18, 0.0, 0.0)
    s = 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ax, ay = (a[1] - p[1]) * kx, (a[0] - p[0]) * ky
        bx, by = (b[1] - p[1]) * kx, (b[0] - p[0]) * ky
        dx, dy = bx - ax, by - ay
        n2 = dx * dx + dy * dy
        t = 0.0 if n2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / n2))
        px, py = ax + dx * t, ay + dy * t
        d = math.hypot(px, py)
        if d < mejor[0]:
            ang = math.degrees(math.atan2(b[0] - a[0], b[1] - a[1]))
            # el punto proyectado sobre el SEGMENTO (no el vértice más cercano):
            # con shapes muestreadas cada 50 m, el vértice deja el ancla 25 m fuera
            mejor = (d, s + math.hypot(bx - ax, by - ay) * t, ang,
                     p[0] + py / ky, p[1] + px / kx)
        s += math.hypot(bx - ax, by - ay)
    return mejor


def cota_en_perfil(perfil, s_m):
    """Cota (m de profundidad) del perfil de la vía en la distancia s."""
    if not perfil:
        return None
    if s_m <= perfil[0][0]:
        return perfil[0][1]
    for (s0, c0), (s1, c1) in zip(perfil, perfil[1:]):
        if s0 <= s_m <= s1:
            t = (s_m - s0) / (s1 - s0) if s1 > s0 else 0.0
            return c0 + (c1 - c0) * t
    return perfil[-1][1]


def perfil_de(lineas):
    digitos = [x for x in lineas if x.isdigit()]
    if "R" in lineas:
        return "ramal"
    if digitos and all(int(x) >= 6 for x in digitos):
        return "ancho"
    return "estrecho"


def main():
    metro = leer("metro.json")
    shapes = metro["shapes"]

    # shapes usadas por cada línea y dirección (por patterns, nunca por el nombre)
    por_linea = {}
    for p in metro["patterns"]:
        por_linea.setdefault(p["l"], {}).setdefault(p.get("d", 0), set()).add(p["s"])
    for linea in por_linea:
        for d in por_linea[linea]:
            por_linea[linea][d] = sorted(por_linea[linea][d])

    andenes, estimadas, sin_linea = {}, 0, []
    for st in metro["stations"]:
        for linea in st.get("l", []):
            dirs = por_linea.get(linea, {})
            if not dirs:
                sin_linea.append(f"{st['n']} L{linea}")
                continue
            p = (st["lat"], st["lon"])
            # se prueban todas las combinaciones de traza por dirección y se elige
            # la que deja las dos vías más juntas: en un bucle, el punto más cercano
            # de la dirección contraria puede estar al otro lado del recorrido
            mejor = None
            for si0 in dirs.get(0, []):
                a = proyectar(p, shapes[si0]["pts"]) + (si0,)
                if a[0] > 60:
                    continue
                for si1 in dirs.get(1, []):
                    b = proyectar(p, shapes[si1]["pts"]) + (si1,)
                    if b[0] > 60:
                        continue
                    # A es la proyección de la estación en su traza; B, la proyección
                    # de A en la otra traza (en un bucle, buscar desde la estación
                    # cae al otro lado del recorrido)
                    A = (a[3], a[4])
                    b2 = min((proyectar(A, shapes[si1]["pts"]) + (si1,) for _ in (0,)),
                             key=lambda x: x[0])
                    B = (b2[3], b2[4])
                    S = dist_m(A, B)
                    if mejor is None or S < mejor[0]:
                        mejor = (S, A, B, a[2], si0, si1, a[0], b2[0])

            conf = "medida"
            if mejor and S_MIN <= mejor[0] <= S_MAX:
                S, pa, pb, ang, si0, si1, dA, dB = mejor
                lat = (pa[0] + pb[0]) / 2
                lon = (pa[1] + pb[1]) / 2
            else:
                # una sola dirección, trazas cruzadas o bucle de cabecera:
                # se ancla en la traza más cercana con separación nominal
                candidatos = [proyectar(p, shapes[si]["pts"]) + (si,) for d in dirs for si in dirs[d]]
                candidatos.sort(key=lambda x: x[0])
                if not candidatos:
                    sin_linea.append(f"{st['n']} L{linea}")
                    continue
                # el ancla va SOBRE la traza, no en el centroide de la estación:
                # el aeropuerto o un macrohub tienen la estación lejos del túnel
                lat, lon = candidatos[0][3], candidatos[0][4]
                S, ang = S_NOMINAL, candidatos[0][2]
                dA = candidatos[0][0]
                dB = None
                conf = "estimada"
                estimadas += 1

            # cota del PERFIL en el punto del andén: la plataforma y su vía
            # comparten la misma Y por construcción
            cota_linea = None
            ref = None
            for d in sorted(dirs):
                for si in dirs[d]:
                    cota_linea = cota_en_perfil(metro.get("perfiles", {}).get(str(si)),
                                                proyectar((lat, lon), shapes[si]["pts"])[1])
                    ref = si
                    if cota_linea is not None:
                        break
                if cota_linea is not None:
                    break
            perfil = perfil_de([linea] + [l for l in st["l"] if l != linea])
            andenes[f"{st['id']}|{linea}"] = {
                "est": st["id"], "n": st["n"], "l": linea,
                "lat": round(lat, 6), "lon": round(lon, 6), "cota": st.get("cota"),
                "cota_linea": None if cota_linea is None else round(float(cota_linea), 2),
                "ang": round(ang, 2),
                "S": round(S, 2),
                "dA": None if dA is None else round(dA, 2),
                "dB": None if dB is None else round(dB, 2),
                "largo": LARGO[perfil], "perfil": perfil,
                "tipo": "lateral" if S <= 9 else ("central" if S <= 13 else "multiple"),
                "conf": conf,
            }

    vals = [a["S"] for a in andenes.values() if a["conf"] == "medida"]
    salida = {
        "meta": {
            "fuente": "GTFS Red de Metro · CRTM (feed_version 20250527)",
            "unidad": "estación-línea (un andén por línea y complejo)",
            "unidades": len(andenes),
            "con_separacion_medida": len(vals),
            "estimadas": estimadas,
            "S_mediana": round(statistics.median(vals), 2) if vals else None,
            "nota": "S es la separación entre las dos direcciones medidas en el punto "
                    "del andén; el visor ajusta el ancho del modelo con ella.",
        },
        "andenes": andenes,
    }
    destino = os.path.join(RAIZ, "data", "andenes.json")
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"))

    print(f"OK {destino}")
    print(f"  unidades            : {len(andenes)}")
    print(f"  S medida            : {len(vals)}  (mediana {salida['meta']['S_mediana']} m)")
    print(f"  con S estimada      : {estimadas}")
    if sin_linea:
        print(f"  sin trazado GTFS    : {len(sin_linea)} -> {', '.join(sin_linea[:5])}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
