"""Encaje fino: cada andén se coloca SOBRE su vía real (giro + traslación).

Se ejecuta desde scripts/encaje.py; aquí solo la colocación andén -> vía.
"""
import math


def _seg_proyeccion(p, a, b):
    """Punto de la polilínea más cercano a p, con su dirección local."""
    mejor = None
    for i in range(len(a) - 1):
        ax, ay = a[i]
        bx, by = b[i + 1]
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy
        if L2 < 1e-9:
            continue
        t = max(0.0, min(1.0, ((p[0] - ax) * vx + (p[1] - ay) * vy) / L2))
        q = (ax + vx * t, ay + vy * t)
        d = math.hypot(p[0] - q[0], p[1] - q[1])
        if mejor is None or d < mejor[0]:
            L = math.sqrt(L2)
            mejor = (d, q, (vx / L, vy / L))
    return mejor


def colocar_anden(centro, dir_and, via, ancho):
    """Devuelve (giro_deg, dx, dz) para llevar el andén al costado de su vía.

    centro/dir_and: centroide y dirección del andén en coordenadas del modelo.
    via: polilínea real de la vía en coordenadas del modelo.
    """
    if len(via) < 2:
        return None
    # dirección de la vía: del primer al último tramo largo
    vx = via[-1][0] - via[0][0]
    vy = via[-1][1] - via[0][1]
    dir_via = math.atan2(vy, vx)

    # giro que alinea el eje del andén con el de la vía (módulo pi)
    d = (dir_via - dir_and) % math.pi
    if d > math.pi / 2:
        d -= math.pi
    giro = d

    # centroide ya girado
    c, s = math.cos(giro), math.sin(giro)
    cx = centro[0] * c - centro[1] * s
    cy = centro[0] * s + centro[1] * c

    proy = _seg_proyeccion((cx, cy), via, via)
    if proy is None:
        return None
    _, q, dirq = proy

    # lado en el que estaba el andén respecto a la vía (desplazamiento mínimo)
    lado = (cx - q[0]) * (-dirq[1]) + (cy - q[1]) * dirq[0]
    signo = 1.0 if lado >= 0 else -1.0
    sep = ancho / 2 + 1.7                       # borde del andén sobre el carril
    nx, ny = -dirq[1] * signo, dirq[0] * signo

    dx = q[0] + nx * sep - cx
    dy = q[1] + ny * sep - cy
    return math.degrees(giro), dx, dy
