# Genera el boliche, la mesa y la silla. Correr con: npm run models
# Se escribe en coordenadas del juego: x derecha, y arriba, z hacia quien mira desde el asiento propio.
# Cada jugador se ve siempre en z positivo mirando a -z: de frente queda la barra.
# La luz se hornea en colores por vértice: el juego no calcula iluminación para el salón.
import json
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy

args = sys.argv[sys.argv.index("--") + 1 :]
OUT = Path(args[0])
ATLAS_FILE = Path(args[1])
PREVIEW = Path(args[2]) if len(args) > 2 else None

atlas = json.loads(ATLAS_FILE.read_text(encoding="utf8"))
SIZE = atlas["size"]
REGIONS = atlas["regions"]

random.seed(4)

HEIGHT = 3.6
X_MIN, X_MAX = -3.6, 3.6
Z_MIN, Z_MAX = -3.8, 4.0
TABLE_Y = 0.74

# (posición, color lineal, potencia)
LAMPS = [
    ((0.0, 2.5, 0.0), (1.0, 0.72, 0.42), 5.0),
    ((-1.9, 2.5, -1.6), (1.0, 0.7, 0.4), 3.2),
    ((1.9, 2.5, -1.6), (1.0, 0.7, 0.4), 3.2),
    ((0.0, 2.2, -3.2), (1.0, 0.74, 0.45), 1.3),
    ((3.2, 2.1, 0.2), (1.0, 0.62, 0.32), 1.5),
    ((-3.2, 1.9, 0.6), (0.85, 0.85, 0.8), 2.4),
    ((0.0, 3.0, 2.8), (1.0, 0.72, 0.45), 1.8),
    ((-2.75, 2.2, 1.6), (1.0, 0.72, 0.42), 0.9),
    ((2.85, 2.2, 0.45), (1.0, 0.72, 0.42), 0.8),
    ((2.75, 2.2, 2.6), (1.0, 0.72, 0.42), 0.9),
    ((-2.8, 2.2, -0.4), (1.0, 0.72, 0.42), 0.8),
    ((-2.4, 2.1, 3.7), (1.0, 0.68, 0.38), 0.8),
    ((0.75, 2.1, 3.7), (1.0, 0.68, 0.38), 0.8),
]
AMBIENT = (0.1, 0.072, 0.058)

# Lo que hace sombra sobre el piso: (x, z, radio, cuánto oscurece).
FLOOR_SHADOWS = [
    (0.0, 0.0, 1.55, 0.62),
    (-2.75, 1.6, 0.62, 0.55),
    (2.75, 2.6, 0.62, 0.55),
    (2.85, 0.45, 0.62, 0.55),
    (-2.8, -0.4, 0.62, 0.55),
    (-2.4, -1.84, 0.26, 0.45),
    (-1.25, -1.84, 0.26, 0.45),
    (1.1, -1.84, 0.26, 0.45),
    (2.3, -1.84, 0.26, 0.45),
    (3.05, 3.4, 0.62, 0.6),
    (-3.1, 3.3, 0.5, 0.5),
    (-0.75, 3.72, 0.7, 0.45),
]


def srgb(hex_color):
    def channel(value):
        c = value / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return tuple(channel(hex_color >> shift & 255) for shift in (16, 8, 0))


WHITE = (1.0, 1.0, 1.0)
WOOD_RED = srgb(0x8a4a2a)
WOOD_BLACK = srgb(0x2e1a0f)
BRASS = srgb(0xd6a648)
GLASS_COLORS = [srgb(c) for c in (0x3f6b2e, 0x7a3b1a, 0x2a4a2a, 0xc79a45, 0x8a1f1a, 0x1f3a5a, 0xc9c2a8, 0x4a2410)]


def normalize(v):
    length = math.sqrt(sum(c * c for c in v)) or 1
    return tuple(c / length for c in v)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def light_at(pos, normal, baked=True):
    if not baked:
        return WHITE
    total = list(AMBIENT)
    for lamp, color, power in LAMPS:
        to_lamp = sub(lamp, pos)
        dist2 = max(0.25, sum(c * c for c in to_lamp))
        facing = max(0.0, sum(a * b for a, b in zip(normalize(to_lamp), normal)))
        amount = power * (0.25 + 0.75 * facing) / (1.0 + dist2)
        for i in range(3):
            total[i] += color[i] * amount
    # Sombras de contacto sobre el piso y al pie del mostrador.
    shade = 1.0
    if pos[1] < 0.1:
        for x, z, radius, strength in FLOOR_SHADOWS:
            t = max(0.0, min(1.0, 1 - math.hypot(pos[0] - x, pos[2] - z) / radius))
            shade *= 1 - strength * t * t * (3 - 2 * t)
        t = max(0.0, min(1.0, 1 - (pos[2] + 2.14) / 0.7))
        shade *= 1 - 0.5 * t * t
    # Los rincones juntan menos luz: el salón gana profundidad sin calcular sombras.
    corner = lambda d, floor, reach: floor + (1 - floor) * max(0.0, min(1.0, d / reach)) ** 0.7
    shade *= corner(HEIGHT - pos[1], 0.55, 0.5) * corner(pos[1], 0.68, 0.4)
    shade *= corner(X_MAX - pos[0], 0.72, 0.5) * corner(pos[0] - X_MIN, 0.72, 0.5)
    shade *= corner(Z_MAX - pos[2], 0.72, 0.5) * corner(pos[2] - Z_MIN, 0.72, 0.5)
    return tuple(min(1.0, c * shade) for c in total)


class Part:
    # Fusionar puntos iguales ahorra vértices en el salón.
    merge_points = True

    def __init__(self, name, baked=True):
        self.name = name
        self.baked = baked
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UV")
        self.color = self.bm.loops.layers.float_color.new("Color")

    def face(self, corners, region, uvs, tint=WHITE, normal=None, glow=False):
        if normal is None:
            normal = normalize(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])))
        x, y, w, h = REGIONS[region]
        pad = 2
        verts = [self.bm.verts.new((c[0], -c[2], c[1])) for c in corners]
        bm_face = self.bm.faces.new(verts)
        for loop, corner, (u, v) in zip(bm_face.loops, corners, uvs):
            px = x + pad + u * (w - pad * 2)
            py = y + pad + v * (h - pad * 2)
            # El juego usa la textura sin invertir: v de glTF coincide con y del lienzo.
            loop[self.uv].uv = (px / SIZE, 1 - py / SIZE)
            lit = (1.0, 1.0, 1.0) if glow else light_at(corner, normal, self.baked)
            base = tint(corner) if callable(tint) else tint
            loop[self.color] = (lit[0] * base[0], lit[1] * base[1], lit[2] * base[2], 1.0)
        return bm_face

    def quad(self, a, b, c, d, region="white", tint=WHITE, glow=False, uv=(0, 0, 1, 1)):
        u0, v0, u1, v1 = uv
        self.face((a, b, c, d), region, ((u0, v1), (u1, v1), (u1, v0), (u0, v0)), tint, glow=glow)

    def patch(self, origin, du, dv, nu, nv, region, tint=WHITE, repeat=None, normal=None):
        """Plano subdividido: da gradiente de luz y permite repetir una textura del atlas."""
        ru, rv = repeat or (nu, nv)
        for i in range(nu):
            for j in range(nv):
                corner = lambda a, b: tuple(
                    origin[k] + du[k] * a / nu + dv[k] * b / nv for k in range(3)
                )
                # Cada celda muestra un tramo de la textura para que no se note el patrón.
                u0 = (i % ru) / ru
                v0 = (j % rv) / rv
                u1, v1 = u0 + 1 / ru, v0 + 1 / rv
                self.face(
                    (corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)),
                    region,
                    ((u0, v1), (u1, v1), (u1, v0), (u0, v0)),
                    tint,
                    normal=normal,
                )

    def box(self, center, size, region="white", tint=WHITE, yaw=0.0, top_region=None, skip_bottom=True):
        hx, hy, hz = (s / 2 for s in size)
        cos, sin = math.cos(yaw), math.sin(yaw)

        def p(x, y, z):
            return (center[0] + x * cos - z * sin, center[1] + y, center[2] + x * sin + z * cos)

        sides = [
            ((-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)),
            ((hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)),
            ((hx, -hy, hz), (hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz)),
            ((-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)),
            ((-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz), (-hx, hy, -hz)),
        ]
        if not skip_bottom:
            sides.append(((-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)))
        for index, side in enumerate(sides):
            corners = [p(*c) for c in side]
            self.quad(*corners, region=(top_region if index == 4 and top_region else region), tint=tint)

    def lathe(self, center, profile, segments=8, region="white", tint=WHITE, glow=False):
        """Revoluciona (radio, altura) alrededor de y. Sirve para botellas, lámparas y patas."""
        cx, base, cz = center
        for index in range(len(profile) - 1):
            r0, y0 = profile[index]
            r1, y1 = profile[index + 1]
            for i in range(segments):
                a0 = 2 * math.pi * i / segments
                a1 = 2 * math.pi * (i + 1) / segments
                mid = (a0 + a1) / 2
                slope = (y1 - y0, r0 - r1)
                normal = normalize((math.cos(mid) * slope[0], slope[1], math.sin(mid) * slope[0]))
                if abs(y1 - y0) < 1e-6:
                    normal = (0.0, 1.0 if r1 < r0 else -1.0, 0.0)
                pts = [
                    (cx + r0 * math.cos(a0), base + y0, cz + r0 * math.sin(a0)),
                    (cx + r1 * math.cos(a0), base + y1, cz + r1 * math.sin(a0)),
                    (cx + r1 * math.cos(a1), base + y1, cz + r1 * math.sin(a1)),
                    (cx + r0 * math.cos(a1), base + y0, cz + r0 * math.sin(a1)),
                ]
                uvs = ((i / segments, 1), (i / segments, 0), ((i + 1) / segments, 0), ((i + 1) / segments, 1))
                if r0 < 1e-5:
                    self.face((pts[0], pts[1], pts[2]), region, uvs[:3], tint, normal, glow)
                elif r1 < 1e-5:
                    self.face((pts[0], pts[1], pts[3]), region, (uvs[0], uvs[1], uvs[3]), tint, normal, glow)
                else:
                    self.face(pts, region, uvs, tint, normal, glow)

    def finish(self):
        mesh = bpy.data.meshes.new(self.name)
        self.bm.verts.ensure_lookup_table()
        if self.merge_points:
            bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=0.00001)
        self.bm.to_mesh(mesh)
        faces = len(self.bm.faces)
        self.bm.free()
        for polygon in mesh.polygons:
            polygon.use_smooth = False
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        print(f"{self.name}: {faces} caras")
        return obj


def bottle(part, x, y, z, height=None):
    height = height or random.uniform(0.26, 0.36)
    color = random.choice(GLASS_COLORS)
    r = random.uniform(0.032, 0.042)
    part.lathe(
        (x, y, z),
        [(r, 0), (r, height * 0.62), (r * 0.36, height * 0.8), (r * 0.32, height), (0, height)],
        segments=6,
        tint=color,
    )
    # Etiqueta: un rectángulo adelante, sin más geometría alrededor.
    cell = random.randrange(4), random.randrange(4)
    uv = (cell[0] / 4, cell[1] / 4, (cell[0] + 1) / 4, (cell[1] + 1) / 4)
    w, low, high = r * 0.92, height * 0.14, height * 0.52
    front = z + r * 0.98
    part.quad((x - w, y + low, front), (x + w, y + low, front), (x + w, y + high, front), (x - w, y + high, front), region="labels", uv=uv)


def siphon(part, x, y, z, color):
    part.lathe((x, y, z), [(0.05, 0), (0.052, 0.2), (0.042, 0.25), (0.02, 0.29), (0, 0.3)], segments=8, tint=color)
    part.box((x, y + 0.32, z), (0.05, 0.05, 0.1), tint=srgb(0xb8b8b0))


def thonet(part, ox, oz, yaw):
    """Silla de café de madera curvada. Mira hacia +z antes de girarla."""
    cos, sin = math.cos(yaw), math.sin(yaw)

    def at(x, z):
        return ox + x * cos - z * sin, oz + x * sin + z * cos

    tint = WOOD_RED
    cx, cz = at(0, 0)
    part.lathe((cx, 0.45, cz), [(0, 0.015), (0.19, 0.015), (0.2, 0), (0, 0)], segments=10, region="wood", tint=tint)
    for lx, lz in ((-0.14, 0.13), (0.14, 0.13), (-0.14, -0.13), (0.14, -0.13)):
        x, z = at(lx, lz)
        part.box((x, 0.225, z), (0.03, 0.45, 0.03), region="wood_dark", tint=tint, yaw=yaw)
    # Respaldo curvado por tramos.
    steps = 6
    for index in range(steps):
        a0 = math.pi * index / steps
        a1 = math.pi * (index + 1) / steps
        mid = (a0 + a1) / 2
        x, z = at(math.cos(mid) * 0.16, -0.16)
        y = 0.72 + math.sin(mid) * 0.2
        length = 0.16 * math.pi / steps * 1.5
        part.box((x, y, z), (0.03, length, 0.03), region="wood_dark", tint=tint, yaw=yaw)
    for lx in (-0.16, 0.16):
        x, z = at(lx, -0.16)
        part.box((x, 0.6, z), (0.03, 0.3, 0.03), region="wood_dark", tint=tint, yaw=yaw)
    x, z = at(0, -0.16)
    part.box((x, 0.66, z), (0.32, 0.07, 0.015), region="wood", tint=tint, yaw=yaw)


def frame(part, x0, x1, y0, y1, plane, region, tint=WHITE, thickness=0.05):
    """Cuadro o espejo sobre una pared. plane = ('x', valor, signo) o ('z', valor, signo)."""
    axis, value, sign = plane
    def p(a, y, depth=0.0):
        d = value + sign * depth
        return (d, y, a) if axis == "x" else (a, y, d)

    def rect(a0, a1, b0, b1, depth, reg, t, uv=(0, 0, 1, 1)):
        # Se ordena para que la imagen no quede espejada desde adentro del salón.
        left, right = (a1, a0) if axis == "x" and sign > 0 else (a0, a1)
        part.quad(p(left, b0, depth), p(right, b0, depth), p(right, b1, depth), p(left, b1, depth), region=reg, tint=t, uv=uv)

    rect(x0, x1, y0, y1, 0.01, "wood_dark", WOOD_BLACK)
    rect(x0 + thickness, x1 - thickness, y0 + thickness, y1 - thickness, 0.02, region, tint)


TURQUOISE = srgb(0x3fa8b8)
CREAM_WARE = srgb(0xe8e2d2)
STONE = srgb(0x77706a)
MAHOGANY = srgb(0xa85a30)
MAHOGANY_DARK = srgb(0x5e2e17)
GLASSWARE = (0.62, 0.72, 0.74)


def rounded_plan(cx, cz, hx, hz, radius, corner_segments=5):
    """Contorno en planta de un rectángulo con esquinas redondeadas."""
    points = []
    for corner, (sx, sz, start) in enumerate(((1, 1, 0.0), (-1, 1, 0.5), (-1, -1, 1.0), (1, -1, 1.5))):
        for step in range(corner_segments + 1):
            angle = (start + 0.5 * step / corner_segments) * math.pi
            points.append((cx + sx * (hx - radius) + radius * math.cos(angle), cz + sz * (hz - radius) + radius * math.sin(angle)))
    return points


def extrude(part, points, y0, y1, region="white", tint=WHITE, flare=0.0):
    """Paredes de un contorno cerrado. `flare` abre o cierra arriba, para las molduras."""
    cx = sum(p[0] for p in points) / len(points)
    cz = sum(p[1] for p in points) / len(points)
    for index, (x0, z0) in enumerate(points):
        x1, z1 = points[(index + 1) % len(points)]
        mx, mz = (x0 + x1) / 2 - cx, (z0 + z1) / 2 - cz
        length = math.hypot(mx, mz) or 1
        normal = (mx / length, 0.25 if flare else 0.0, mz / length)
        scale = lambda x, z, k: (cx + (x - cx) * k, cz + (z - cz) * k)
        k = 1 + flare
        xa, za = scale(x0, z0, k)
        xb, zb = scale(x1, z1, k)
        part.face(((x0, y0, z0), (x1, y0, z1), (xb, y1, zb), (xa, y1, za)), region, ((0, 1), (1, 1), (1, 0), (0, 0)), tint, normal)


def cap(part, points, y, region="white", tint=WHITE, uv_span=(6.6, 1.0)):
    cx = sum(p[0] for p in points) / len(points)
    cz = sum(p[1] for p in points) / len(points)
    uv = lambda x, z: ((x - cx) / uv_span[0] + 0.5, (z - cz) / uv_span[1] + 0.5)
    for index, (x0, z0) in enumerate(points):
        x1, z1 = points[(index + 1) % len(points)]
        part.face(((cx, y, cz), (x0, y, z0), (x1, y, z1)), region, (uv(cx, cz), uv(x0, z0), uv(x1, z1)), tint, (0, 1, 0))


def limb(part, a, b, r0, r1, tint=WHITE, segments=6):
    axis = normalize(sub(b, a))
    helper_axis = (0.0, 1.0, 0.0) if abs(axis[1]) < 0.9 else (1.0, 0.0, 0.0)
    u = normalize(cross(axis, helper_axis))
    v = cross(axis, u)

    def ring(center, radius, t):
        return tuple(center[k] + radius * (math.cos(t) * u[k] + math.sin(t) * v[k]) for k in range(3))

    for i in range(segments):
        t0, t1 = 2 * math.pi * i / segments, 2 * math.pi * (i + 1) / segments
        mid = (t0 + t1) / 2
        normal = tuple(math.cos(mid) * u[k] + math.sin(mid) * v[k] for k in range(3))
        part.face((ring(a, r0, t0), ring(a, r0, t1), ring(b, r1, t1), ring(b, r1, t0)), "white", ((0, 1), (1, 1), (1, 0), (0, 0)), tint, normal)


def carved_panel(part, x0, x1, y0, y1, z):
    """Panel tallado: marco en relieve, fondo hundido y medallón central."""
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    bar = 0.05
    part.quad((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z), region="wood_dark", tint=MAHOGANY_DARK, uv=(0, 0, 1, 0.5))
    for box_center, box_size in (
        ((cx, y1 - bar / 2, z + 0.012), (w, bar, 0.024)),
        ((cx, y0 + bar / 2, z + 0.012), (w, bar, 0.024)),
        ((x0 + bar / 2, cy, z + 0.012), (bar, h - bar * 2, 0.024)),
        ((x1 - bar / 2, cy, z + 0.012), (bar, h - bar * 2, 0.024)),
    ):
        part.box(box_center, box_size, region="wood_dark", tint=MAHOGANY)
    # Filete interior y medallón en rombo.
    inset = 0.1
    for box_center, box_size in (
        ((cx, y1 - inset, z + 0.006), (w - inset * 2, 0.014, 0.012)),
        ((cx, y0 + inset, z + 0.006), (w - inset * 2, 0.014, 0.012)),
        ((x0 + inset, cy, z + 0.006), (0.014, h - inset * 2, 0.012)),
        ((x1 - inset, cy, z + 0.006), (0.014, h - inset * 2, 0.012)),
    ):
        part.box(box_center, box_size, tint=MAHOGANY)
    rx, ry = min(w * 0.17, 0.2), min(h * 0.26, 0.2)
    depth = z + 0.022
    for scale, tint in ((1.0, MAHOGANY), (0.74, MAHOGANY_DARK), (0.46, MAHOGANY), (0.2, srgb(0xc98a4c))):
        d = depth + (1 - scale) * 0.02
        steps = 14
        ring = [(cx + rx * scale * math.cos(2 * math.pi * i / steps), cy + ry * scale * math.sin(2 * math.pi * i / steps)) for i in range(steps)]
        for i in range(steps):
            ax, ay = ring[i]
            bx, by = ring[(i + 1) % steps]
            part.face(((cx, cy, d + 0.008), (ax, ay, d), (bx, by, d)), "white", ((0, 0), (1, 0), (1, 1)), tint, (0, 0, 1))


def glass(part, x, y, z, tall=False):
    height = 0.2 if tall else 0.11
    if tall:
        profile = [(0.032, 0), (0.008, 0.012), (0.007, 0.1), (0.034, 0.14), (0.036, 0.2)]
    else:
        profile = [(0.032, 0), (0.04, height)]
    part.lathe((x, y, z), profile, segments=6, tint=GLASSWARE)


def stack(part, x, y, z, count=5, radius=0.07, tint=CREAM_WARE):
    profile = []
    for i in range(count):
        base = i * 0.03
        profile += [(radius * 0.72, base), (radius, base + 0.028)]
    part.lathe((x, y, z), profile, segments=8, tint=tint)


def fill_row(part, x0, x1, y, z, kind):
    x = x0 + 0.05
    while x < x1 - 0.04:
        if kind == "wine":
            bottle(part, x, y, z, random.uniform(0.3, 0.38))
            x += random.uniform(0.098, 0.125)
        elif kind == "turquoise":
            r = 0.04
            h = random.uniform(0.3, 0.34)
            part.lathe((x, y, z), [(r, 0), (r, h * 0.66), (r * 0.42, h * 0.84), (r * 0.36, h), (0, h)], segments=6, tint=TURQUOISE)
            x += 0.1
        elif kind == "glasses":
            glass(part, x, y, z, tall=True)
            x += 0.09
        elif kind == "mixed":
            if random.random() < 0.34:
                stack(part, x + 0.03, y, z)
                x += 0.17
            else:
                glass(part, x, y, z)
                x += 0.085


def arch_ring(a, b, cy, steps, start=0.0, end=math.pi):
    return [(a * math.cos(start + (end - start) * i / steps), cy + b * math.sin(start + (end - start) * i / steps)) for i in range(steps + 1)]


def build_back_bar(room):
    """Mueble antiguo de bar, modelado a partir del diseño generado en Meshy. Devuelve el z del mostrador."""
    back = Z_MIN + 0.06
    shelf_front = back + 0.34
    face = shelf_front + 0.05
    half = 3.08
    top_shelf = 2.56

    # Mueble bajo y fondo espejado.
    room.box((0, 0.54, back + 0.17), (half * 2, 1.08, 0.34), region="wood_dark", tint=MAHOGANY_DARK)
    room.patch((-half, 1.08, back), (half * 2, 0, 0), (0, top_shelf - 1.08, 0), 6, 2, "mirror", repeat=(2, 1), tint=(0.2, 0.15, 0.11), normal=(0, 0, 1))

    bays = ((-2.97, -1.11, "outer"), (-0.95, 0.95, "center"), (1.11, 2.97, "outer"))
    levels = (1.1, 1.58, 2.06)
    for x0, x1, kind in bays:
        for index, level in enumerate(levels):
            room.box(((x0 + x1) / 2, level - 0.015, back + 0.17), (x1 - x0, 0.03, 0.34), region="wood_dark", tint=MAHOGANY)
            room.box(((x0 + x1) / 2, level - 0.045, shelf_front - 0.01), (x1 - x0, 0.03, 0.02), region="wood_dark", tint=MAHOGANY_DARK)
            row = {0: "mixed", 1: "wine", 2: "turquoise" if kind == "outer" else "wine"}[index]
            if kind == "center" and index == 0:
                row = "glasses"
            fill_row(room, x0, x1, level, back + 0.17, row)
        # Arco de cada cuerpo: la madera baja en curva sobre los estantes.
        steps = 10
        cx, a = (x0 + x1) / 2, (x1 - x0) / 2
        spring, b = top_shelf - 0.16, 0.16
        for i in range(steps):
            t0, t1 = math.pi * i / steps, math.pi * (i + 1) / steps
            ax, ay = cx + a * math.cos(t0), spring + b * math.sin(t0)
            bx, by = cx + a * math.cos(t1), spring + b * math.sin(t1)
            room.face(((ax, ay, face), (ax, top_shelf + 0.02, face), (bx, top_shelf + 0.02, face), (bx, by, face)), "wood_dark", ((0, 1), (0, 0), (1, 0), (1, 1)), MAHOGANY, (0, 0, 1))

    # Columnas: las de afuera más altas, con remate torneado.
    for x, width, tall in ((-3.06, 0.2, True), (-1.03, 0.14, False), (1.03, 0.14, False), (3.06, 0.2, True)):
        top = 2.96 if tall else top_shelf + 0.04
        height = top - 1.08
        cy = 1.08 + height / 2
        room.box((x, cy, back + 0.2), (width, height, 0.4), region="wood_dark", tint=MAHOGANY_DARK)
        room.box((x, cy, face + 0.012), (width * 0.62, height - 0.16, 0.024), region="wood", tint=MAHOGANY)
        room.box((x, cy, face + 0.03), (width * 0.24, height - 0.42, 0.012), region="wood_dark", tint=MAHOGANY_DARK)
        for y, grow in ((1.12, 1.25), (top - 0.03, 1.32), (top - 0.09, 1.14)):
            room.box((x, y, back + 0.21), (width * grow, 0.05, 0.42), region="wood_dark", tint=MAHOGANY)
        if tall:
            room.lathe((x, top, back + 0.22), [(0.1, 0), (0.07, 0.03), (0.035, 0.06), (0.06, 0.11), (0.05, 0.17), (0.014, 0.25), (0, 0.27)], segments=8, region="wood_dark", tint=MAHOGANY)

    # Viga sobre los estantes.
    room.box((0, top_shelf + 0.05, back + 0.2), (half * 2 - 0.2, 0.09, 0.42), region="wood", tint=MAHOGANY)
    room.box((0, top_shelf + 0.11, back + 0.21), (half * 2 - 0.16, 0.04, 0.44), region="wood_dark", tint=MAHOGANY_DARK)

    # Arco de vitral con el medallón del café.
    glass_a, glass_b, spring = 2.84, 0.68, top_shelf + 0.12
    steps = 28
    arc = arch_ring(glass_a, glass_b, spring, steps)
    glass_z = back + 0.3
    uv = lambda x, y: ((x + glass_a) / (2 * glass_a), 1 - (y - spring) / glass_b)
    for i in range(steps):
        x0, y0 = arc[i]
        x1, y1 = arc[i + 1]
        room.face(((x0, y0, glass_z), (x1, y1, glass_z), (x1, spring, glass_z), (x0, spring, glass_z)), "arch_glass", (uv(x0, y0), uv(x1, y1), uv(x1, spring), uv(x0, spring)), (1.05, 1.05, 1.0), (0, 0, 1), glow=True)
    outer = arch_ring(glass_a + 0.13, glass_b + 0.12, spring, steps)
    for i in range(steps):
        p0, p1, q1, q0 = arc[i], arc[i + 1], outer[i + 1], outer[i]
        ny = math.sin(math.pi * (i + 0.5) / steps)
        room.face(((p0[0], p0[1], glass_z + 0.04), (p1[0], p1[1], glass_z + 0.04), (q1[0], q1[1], glass_z + 0.07), (q0[0], q0[1], glass_z + 0.07)), "wood", ((0, 1), (1, 1), (1, 0), (0, 0)), MAHOGANY, (0, 0.4 * ny, 0.9))
        room.face(((q0[0], q0[1], glass_z + 0.07), (q1[0], q1[1], glass_z + 0.07), (q1[0], q1[1], glass_z - 0.2), (q0[0], q0[1], glass_z - 0.2)), "wood_dark", ((0, 1), (1, 1), (1, 0), (0, 0)), MAHOGANY_DARK, (0, ny, 0.3))

    # Medallón central y remate tallado.
    mx, my, ma, mb = 0.0, spring + 0.31, 0.36, 0.28
    medal_z = glass_z + 0.05
    ring_steps = 18
    medal = arch_ring(ma, mb, my, ring_steps, 0, 2 * math.pi)
    medal_uv = lambda x, y: (x / (2 * ma) + 0.5, 0.5 - (y - my) / (2 * mb))
    for i in range(ring_steps):
        x0, y0 = medal[i]
        x1, y1 = medal[i + 1]
        room.face(((0, my, medal_z), (x0, y0, medal_z), (x1, y1, medal_z)), "medallion", ((0.5, 0.5), medal_uv(x0, y0), medal_uv(x1, y1)), (1, 1, 1), (0, 0, 1), glow=True)
    crest_y = spring + glass_b + 0.08
    room.face(((-0.34, crest_y, glass_z + 0.08), (0.34, crest_y, glass_z + 0.08), (0.12, crest_y + 0.17, glass_z + 0.05), (-0.12, crest_y + 0.17, glass_z + 0.05)), "wood", ((0, 1), (1, 1), (0.7, 0), (0.3, 0)), MAHOGANY, (0, 0.3, 0.95))
    room.lathe((0, crest_y + 0.13, glass_z + 0.02), [(0.06, 0), (0.04, 0.04), (0.012, 0.08), (0, 0.09)], segments=6, region="wood_dark", tint=MAHOGANY)

    # Cuadros a los costados del mueble.
    for x0, x1, region in ((-3.52, -3.18, "portrait"), (3.18, 3.52, "landscape")):
        cz = Z_MIN + 0.05
        room.quad((x0, 1.42, cz), (x1, 1.42, cz), (x1, 2.08, cz), (x0, 2.08, cz), region="wood_dark", tint=WOOD_BLACK)
        room.quad((x0 + 0.03, 1.46, cz + 0.008), (x1 - 0.03, 1.46, cz + 0.008), (x1 - 0.03, 2.04, cz + 0.008), (x0 + 0.03, 2.04, cz + 0.008), region=region)

    # Mostrador con las puntas redondeadas.
    counter_z = -2.56
    plan = rounded_plan(0, counter_z, 2.96, 0.36, 0.34)
    extrude(room, rounded_plan(0, counter_z, 3.0, 0.4, 0.36), 0.0, 0.12, region="wood_dark", tint=MAHOGANY_DARK)
    extrude(room, plan, 0.12, 0.9, region="wood_dark", tint=MAHOGANY_DARK)
    extrude(room, plan, 0.9, 0.97, region="wood", tint=MAHOGANY, flare=0.02)
    slab = rounded_plan(0, counter_z, 3.06, 0.42, 0.38)
    extrude(room, slab, 0.97, 1.04, region="wood_dark", tint=MAHOGANY)
    cap(room, slab, 1.04, region="plaster", tint=STONE)

    front = counter_z + 0.36
    panel_top, panel_bottom = 0.84, 0.18
    for x0, x1 in ((-2.44, -0.94), (-0.8, 0.8), (0.94, 2.44)):
        carved_panel(room, x0, x1, panel_bottom, panel_top, front + 0.002)
    for x in (-2.62, -0.87, 0.87, 2.62):
        room.box((x, 0.51, front + 0.016), (0.13, 0.78, 0.032), region="wood", tint=MAHOGANY)
        room.box((x, 0.51, front + 0.036), (0.05, 0.56, 0.012), region="wood_dark", tint=MAHOGANY_DARK)
        room.box((x, 0.87, front + 0.024), (0.16, 0.04, 0.048), region="wood_dark", tint=MAHOGANY)

    # Barra de bronce para el pie, con sus soportes.
    rail_y, rail_z = 0.15, front + 0.13
    rail_end_z = counter_z - 0.1
    points = [(-3.1, rail_end_z, -3.1 + 0.0), (-3.1, rail_z - 0.16, 0), (-2.98, rail_z - 0.04, 0), (-2.86, rail_z, 0), (2.86, rail_z, 0), (2.98, rail_z - 0.04, 0), (3.1, rail_z - 0.16, 0), (3.1, rail_end_z, 0)]
    bright = (0.95, 0.68, 0.28)
    for i in range(len(points) - 1):
        ax, az, _ = points[i]
        bx, bz, _ = points[i + 1]
        limb(room, (ax, rail_y, az), (bx, rail_y, bz), 0.024, 0.024, bright, segments=6)
    for x in (-2.7, -1.35, 0.0, 1.35, 2.7):
        room.lathe((x, 0, rail_z), [(0.05, 0), (0.038, 0.012), (0.016, 0.03), (0.018, rail_y - 0.02), (0.03, rail_y)], segments=6, tint=bright)
        limb(room, (x, rail_y, rail_z), (x, rail_y, front), 0.012, 0.012, bright, segments=4)

    # Sobre el mostrador: tirador de cerveza, platos y caja antigua.
    top = 1.04
    tap_x = 1.92
    room.lathe((tap_x, top, counter_z - 0.05), [(0.06, 0), (0.045, 0.02), (0.03, 0.05), (0.03, 0.32), (0.05, 0.36), (0.03, 0.4), (0, 0.41)], segments=8, tint=bright)
    limb(room, (tap_x, top + 0.34, counter_z - 0.05), (tap_x, top + 0.34, counter_z + 0.1), 0.016, 0.012, bright, segments=5)
    limb(room, (tap_x, top + 0.38, counter_z - 0.05), (tap_x, top + 0.56, counter_z - 0.05), 0.014, 0.02, srgb(0x2a1a10), segments=5)
    stack(room, tap_x + 0.32, top, counter_z + 0.02, count=6, radius=0.095)
    register_x = -2.15
    room.box((register_x, top + 0.09, counter_z - 0.06), (0.3, 0.18, 0.22), tint=srgb(0xa87c34))
    room.box((register_x, top + 0.22, counter_z - 0.08), (0.24, 0.1, 0.16), tint=srgb(0x8a6226))
    room.quad((register_x - 0.1, top + 0.18, counter_z + 0.052), (register_x + 0.1, top + 0.18, counter_z + 0.052), (register_x + 0.1, top + 0.26, counter_z + 0.0), (register_x - 0.1, top + 0.26, counter_z + 0.0), tint=srgb(0xe8dcb8))
    siphon(room, 0.15, top, counter_z - 0.06, TURQUOISE)
    return counter_z


def wall_box(part, wall, a, y, width, height, depth, region="wood_dark", tint=WHITE, off=0.0):
    """Listón apoyado sobre una pared. a es la posición a lo largo de la pared."""
    axis, value, sign = wall
    d = value + sign * (off + depth / 2)
    if axis == "x":
        part.box((d, y, a), (depth, height, width), region=region, tint=tint)
    else:
        part.box((a, y, d), (width, height, depth), region=region, tint=tint)


def wainscot(part, wall, a0, a1, top=0.98, gaps=()):
    """Zócalo con molduras y paneles en relieve, cortado donde hay una puerta o un mueble."""
    start = a0
    for gap0, gap1 in [*gaps, (a1, a1)]:
        length = gap0 - start
        if length > 0.2:
            mid = (start + gap0) / 2
            wall_box(part, wall, mid, top / 2, length, top, 0.012, "wood_dark", MAHOGANY_DARK)
            wall_box(part, wall, mid, 0.08, length, 0.16, 0.034, "wood_dark", WOOD_BLACK)
            wall_box(part, wall, mid, top, length, 0.05, 0.05, "wood_dark", MAHOGANY)
            wall_box(part, wall, mid, top - 0.045, length, 0.025, 0.03, "wood", MAHOGANY_DARK)
            count = max(1, round(length / 0.72))
            width = length / count
            low, high = 0.16, top - 0.06
            for i in range(count + 1):
                wall_box(part, wall, start + width * i, (low + high) / 2, 0.055, high - low, 0.026, "wood", MAHOGANY_DARK)
            for i in range(count):
                c = start + width * (i + 0.5)
                wall_box(part, wall, c, (low + high) / 2, width - 0.16, high - low - 0.1, 0.03, "wood", MAHOGANY)
        start = gap1


def pendant(part, x, z, y, shade=None):
    """Lámpara colgante con pantalla de vidrio verde."""
    shade = shade or srgb(0x2f6b4e)
    limb(part, (x, HEIGHT, z), (x, y + 0.2, z), 0.007, 0.007, srgb(0x2a2018), segments=4)
    part.lathe((x, HEIGHT - 0.05, z), [(0.06, 0.05), (0.03, 0.01), (0, 0)], segments=8, tint=BRASS)
    part.lathe((x, y, z), [(0.17, 0), (0.15, 0.03), (0.07, 0.15), (0.025, 0.2), (0, 0.21)], segments=10, tint=shade)
    part.lathe((x, y, z), [(0, 0.0), (0.15, 0.0)], segments=10, tint=srgb(0xffe6b0), glow=True)


def sconce(part, wall, a, y):
    axis, value, sign = wall
    at = lambda depth, height: (value + sign * depth, height, a) if axis == "x" else (a, height, value + sign * depth)
    wall_box(part, wall, a, y, 0.09, 0.14, 0.015, "white", BRASS)
    limb(part, at(0.01, y), at(0.12, y + 0.03), 0.009, 0.007, BRASS, segments=4)
    center = at(0.14, y + 0.03)
    part.lathe(center, [(0, 0.0), (0.075, 0.04), (0.085, 0.12), (0.04, 0.17), (0, 0.17)], segments=8, tint=srgb(0xfff0c0), glow=True)


def curtain(part, x, z0, z1, y0, y1):
    """Visillo plegado a media ventana, con su barra de bronce."""
    folds = 22
    side = 1 if x < 0 else -1
    lace = srgb(0xfff6e2)
    for i in range(folds):
        a0, a1 = lerp(z0, z1, i / folds), lerp(z0, z1, (i + 1) / folds)
        tint = scale(lace, 0.84 if i % 2 else 1.0)
        depth = 0.03 if i % 2 else 0.055
        depth1 = 0.055 if i % 2 else 0.03
        part.face(((x + side * depth, y0, a0), (x + side * depth1, y0, a1), (x + side * depth1, y1, a1), (x + side * depth, y1, a0)), "white", ((0, 1), (1, 1), (1, 0), (0, 0)), tint, glow=True)
    limb(part, (x + side * 0.05, y1 + 0.01, z0 - 0.03), (x + side * 0.05, y1 + 0.01, z1 + 0.03), 0.009, 0.009, BRASS, segments=5)


def ashtray(part, x, y, z):
    part.lathe((x, y, z), [(0.045, 0), (0.05, 0.016), (0.036, 0.016), (0.03, 0.006), (0, 0.006)], segments=8, tint=srgb(0xb9b2a4))


def cafe_table(part, x, z, chairs, goods=0):
    """Mesita de pie de hierro con tapa de mármol y lo que dejó el último cliente."""
    part.lathe((x, 0, z), [(0.26, 0), (0.1, 0.04), (0.035, 0.1), (0.03, 0.4), (0.045, 0.6), (0.03, 0.69)], segments=10, tint=srgb(0x1f1a16))
    part.lathe((x, 0.69, z), [(0.09, 0), (0.42, 0.02), (0.43, 0.04), (0.42, 0.055), (0, 0.055)], segments=14, region="plaster", tint=srgb(0xd9d0c0))
    for angle in chairs:
        thonet(part, x + math.sin(angle) * 0.62, z + math.cos(angle) * 0.62, angle + math.pi)
    top = 0.745
    ashtray(part, x - 0.12, top, z + 0.08)
    if goods == 0:
        glass(part, x + 0.08, top, z + 0.14)
        glass(part, x + 0.2, top, z - 0.06, tall=True)
        siphon(part, x - 0.04, top, z - 0.16, TURQUOISE)
    elif goods == 1:
        part.lathe((x + 0.1, top, z), [(0.03, 0), (0.03, 0.2), (0.012, 0.28), (0, 0.28)], segments=6, tint=random.choice(GLASS_COLORS))
        glass(part, x - 0.02, top, z - 0.17)
        part.box((x + 0.03, top + 0.012, z + 0.2), (0.07, 0.025, 0.1), tint=srgb(0xa33024), yaw=0.4)
    else:
        stack(part, x + 0.1, top, z + 0.1, count=2, radius=0.08)
        glass(part, x + 0.14, top + 0.03, z + 0.1)
        part.quad((x - 0.2, top + 0.003, z - 0.05), (x + 0.04, top + 0.003, z - 0.18), (x + 0.1, top + 0.003, z - 0.03), (x - 0.14, top + 0.003, z + 0.1), region="plaster", tint=srgb(0xd8cfb8))


def barrel(part, x, y, z, radius=0.26, tall=0.68):
    profile = [(radius * 0.84, 0), (radius * 0.97, tall * 0.25), (radius, tall * 0.5), (radius * 0.97, tall * 0.75), (radius * 0.84, tall)]
    part.lathe((x, y, z), profile, segments=14, region="wood", tint=srgb(0xb07a48))
    part.lathe((x, y + tall, z), [(radius * 0.84, 0), (0, 0)], segments=14, region="wood_dark", tint=MAHOGANY)
    hoop = srgb(0x2a2420)
    for t in (0.1, 0.32, 0.68, 0.9):
        r = radius * (0.84 + 0.16 * math.sin(math.pi * t)) + 0.004
        part.lathe((x, y + tall * t, z), [(r, 0), (r, 0.022)], segments=14, tint=hoop)
    # Canilla.
    limb(part, (x - radius * 0.72, y + tall * 0.2, z - radius * 0.72), (x - radius * 0.86, y + tall * 0.19, z - radius * 0.86), 0.012, 0.01, BRASS, segments=5)


def demijohn(part, x, z, color):
    """Damajuana con canasto de mimbre."""
    wicker = srgb(0xb08a4a)
    part.lathe((x, 0, z), [(0.16, 0), (0.2, 0.08), (0.205, 0.22), (0.17, 0.33)], segments=12, region="wood", tint=wicker)
    part.lathe((x, 0.33, z), [(0.17, 0), (0.1, 0.09), (0.03, 0.14), (0.028, 0.22), (0.035, 0.23), (0, 0.23)], segments=10, tint=color)


def soda_crate(part, x, y, z, color):
    part.box((x, y + 0.09, z), (0.44, 0.18, 0.33), region="wood", tint=srgb(0x9a7044))
    for i in (-1, 0, 1):
        for j in (-0.5, 0.5):
            siphon(part, x + i * 0.14, y + 0.06, z + j * 0.15, color)


def bandoneon(part, x, y, z):
    black = srgb(0x171310)
    part.box((x - 0.12, y + 0.09, z), (0.085, 0.18, 0.18), tint=black)
    part.box((x + 0.12, y + 0.09, z), (0.085, 0.18, 0.18), tint=black)
    for i in range(5):
        part.box((x - 0.06 + i * 0.03, y + 0.088, z), (0.02, 0.17 - 0.012 * (i % 2), 0.17 - 0.012 * (i % 2)), tint=scale(MAHOGANY, 0.8 if i % 2 else 1.0))
    # Botones de nácar.
    for side in (-1, 1):
        for row in range(3):
            for col in range(3):
                part.box((x + side * 0.12 + (col - 1) * 0.022, y + 0.05 + row * 0.04, z + 0.092), (0.012, 0.012, 0.006), tint=srgb(0xe9e0cf))


def radio(part, x, y, z):
    part.box((x, y + 0.14, z), (0.36, 0.28, 0.17), region="wood", tint=MAHOGANY)
    part.lathe((x, y + 0.28, z), [(0.1, 0), (0, 0.0)], segments=6, tint=MAHOGANY)
    front_z = z + 0.087
    part.quad((x - 0.14, y + 0.14, front_z), (x + 0.14, y + 0.14, front_z), (x + 0.14, y + 0.24, front_z), (x - 0.14, y + 0.24, front_z), region="dial", glow=True)
    part.quad((x - 0.14, y + 0.04, front_z), (x + 0.14, y + 0.04, front_z), (x + 0.14, y + 0.125, front_z), (x - 0.14, y + 0.125, front_z), tint=srgb(0x3a2a18))
    for side in (-1, 1):
        part.lathe((x + side * 0.09, y + 0.07, front_z), [(0.018, 0), (0, 0.012)], segments=6, tint=BRASS)


def trophy(part, x, y, z):
    part.lathe((x, y, z), [(0.05, 0), (0.045, 0.03), (0.012, 0.05), (0.012, 0.11), (0.05, 0.14), (0.07, 0.22), (0.075, 0.27), (0, 0.27)], segments=10, tint=BRASS)


def coat_rack(part, x, z):
    wood = srgb(0x3a2214)
    part.lathe((x, 0, z), [(0.2, 0), (0.17, 0.02), (0.03, 0.06), (0.024, 1.7), (0.035, 1.76), (0, 1.8)], segments=8, region="wood_dark", tint=wood)
    for arm in range(4):
        angle = arm * math.pi / 2 + 0.4
        tip = (x + math.cos(angle) * 0.2, 1.74, z + math.sin(angle) * 0.2)
        limb(part, (x, 1.62, z), tip, 0.012, 0.01, wood, segments=4)
    # Sombrero y sobretodo colgados.
    hat = srgb(0x2c2622)
    hx, hz = x + 0.17, z - 0.1
    part.lathe((hx, 1.76, hz), [(0.15, 0), (0.15, 0.008), (0.09, 0.015), (0.085, 0.09), (0.05, 0.115), (0, 0.11)], segments=12, tint=hat)
    part.lathe((hx, 1.788, hz), [(0.087, 0), (0.087, 0.018)], segments=12, tint=srgb(0x7a1f1a))
    coat = srgb(0x3c352c)
    cx, cz = x - 0.14, z - 0.14
    part.lathe((cx, 0.72, cz), [(0.15, 0), (0.17, 0.3), (0.18, 0.7), (0.12, 0.92), (0.03, 0.98), (0, 1.0)], segments=10, tint=coat)
    part.box((cx + 0.1, 1.2, cz + 0.1), (0.03, 0.72, 0.03), tint=scale(coat, 0.7), yaw=0.7)


def bunting(part, x0, x1, z, y, sag=0.34, colors=None):
    """Banderines colgados de pared a pared."""
    colors = colors or [(srgb(0x58b7e6), srgb(0xf4e6c4)), (srgb(0xf4e6c4), srgb(0x58b7e6))]
    count = 16
    line = lambda t: (lerp(x0, x1, t), y - sag * 4 * t * (1 - t), z)
    for i in range(count):
        a, b = line(i / count), line((i + 1) / count)
        limb(part, a, b, 0.004, 0.004, srgb(0x2a2018), segments=3)
        color = colors[i % len(colors)][0]
        c = (lerp(a[0], b[0], 0.15), a[1] - 0.005, z)
        d = (lerp(a[0], b[0], 0.85), b[1] - 0.005, z)
        tip = ((c[0] + d[0]) / 2, (c[1] + d[1]) / 2 - 0.24, z + 0.01)
        part.face((c, d, tip), "white", ((0, 0), (1, 0), (0.5, 1)), color, normal=(0, 0, 1))


def espresso_machine(part, x, top, z):
    chrome = srgb(0xc8c4b8)
    plan = rounded_plan(x, z, 0.28, 0.14, 0.1)
    extrude(part, plan, top, top + 0.06, tint=srgb(0x2a2018))
    extrude(part, plan, top + 0.06, top + 0.3, tint=chrome)
    extrude(part, plan, top + 0.3, top + 0.33, tint=BRASS)
    part.lathe((x, top + 0.33, z), [(0.15, 0), (0.15, 0.1), (0.09, 0.19), (0.03, 0.22), (0, 0.23)], segments=12, tint=chrome)
    part.lathe((x, top + 0.56, z), [(0.03, 0), (0.012, 0.03), (0.025, 0.06), (0, 0.08)], segments=6, tint=BRASS)
    for side in (-1, 1):
        gx = x + side * 0.13
        limb(part, (gx, top + 0.2, z + 0.13), (gx, top + 0.2, z + 0.2), 0.03, 0.028, chrome, segments=8)
        limb(part, (gx, top + 0.17, z + 0.2), (gx, top + 0.17, z + 0.32), 0.012, 0.014, srgb(0x171310), segments=5)
        glass(part, gx, top, z + 0.2)
    for i in range(4):
        part.lathe((x - 0.15 + i * 0.1, top + 0.33, z - 0.09), [(0.03, 0), (0.038, 0.05), (0, 0.05)], segments=6, tint=CREAM_WARE)


def build_room():
    room = Part("boliche")
    width, depth = X_MAX - X_MIN, Z_MAX - Z_MIN
    nx, nz = int(width), int(depth)
    right = ("x", X_MAX, -1)
    left = ("x", X_MIN, 1)
    back_wall = ("z", Z_MAX, -1)
    paper = srgb(0xd8b8a0)

    # Piso con guarda de baldosas oscuras, bien subdividido para llevar las sombras horneadas.
    room.patch((X_MIN, 0, Z_MIN), (width, 0, 0), (0, 0, depth), nx * 4, nz * 4, "tile", repeat=(4, 4), normal=(0, 1, 0))
    room.patch((-2.05, 0.006, -2.05), (4.1, 0, 0), (0, 0, 4.1), 8, 8, "rug", repeat=(2, 2), normal=(0, 1, 0))
    guard = srgb(0x4a2c1c)
    for a in (X_MIN + 0.13, X_MAX - 0.13):
        room.patch((a - 0.11, 0.004, Z_MIN), (0.22, 0, 0), (0, 0, depth), 1, nz, "plaster", tint=guard, normal=(0, 1, 0))
    for a in (Z_MAX - 0.13, ):
        room.patch((X_MIN, 0.004, a - 0.11), (width, 0, 0), (0, 0, 0.22), nx, 1, "plaster", tint=guard, normal=(0, 1, 0))

    # Techo de chapa estampada, con nervios, vigas y una roseta sobre la lámpara.
    tin = srgb(0xb8a27a)
    room.patch((X_MIN, HEIGHT, Z_MIN), (width, 0, 0), (0, 0, depth), nx * 2, nz * 2, "tin", tint=tin, repeat=(1, 1), normal=(0, -1, 0))
    rib = srgb(0x8e7a58)
    for i in range(1, 6):
        room.box((X_MIN + width * i / 6, HEIGHT - 0.022, (Z_MIN + Z_MAX) / 2), (0.05, 0.044, depth), tint=rib)
    for i in range(1, 7):
        room.box((0, HEIGHT - 0.022, Z_MIN + depth * i / 7), (width, 0.044, 0.05), tint=rib)
    for z in (-1.15, 1.45):
        room.box((0, HEIGHT - 0.11, z), (width, 0.2, 0.2), region="wood_dark", tint=MAHOGANY_DARK)
        room.box((0, HEIGHT - 0.215, z), (width, 0.03, 0.25), region="wood", tint=MAHOGANY)
        for x in (X_MIN + 0.09, X_MAX - 0.09):
            room.box((x, HEIGHT - 0.4, z), (0.14, 0.34, 0.14), region="wood_dark", tint=MAHOGANY_DARK)
    room.lathe((0, HEIGHT - 0.07, 0), [(0.36, 0.07), (0.33, 0.045), (0.24, 0.05), (0.2, 0.02), (0.08, 0.015), (0.04, 0)], segments=16, region="plaster", tint=srgb(0xd8c8a4))

    # Cornisa alrededor de todo el salón.
    for wall, a, length in ((right, (Z_MIN + Z_MAX) / 2, depth), (left, (Z_MIN + Z_MAX) / 2, depth), (back_wall, 0, width), (("z", Z_MIN, 1), 0, width)):
        wall_box(room, wall, a, HEIGHT - 0.1, length, 0.2, 0.06, "wood_dark", MAHOGANY_DARK)
        wall_box(room, wall, a, HEIGHT - 0.22, length, 0.04, 0.08, "wood", MAHOGANY)
        wall_box(room, wall, a, HEIGHT - 0.27, length, 0.03, 0.04, "wood_dark", MAHOGANY_DARK)

    # Pared del frente: empapelada arriba y a los costados de la estantería.
    room.patch((X_MIN, 0, Z_MIN), (width, 0, 0), (0, HEIGHT, 0), nx * 2, 8, "wallpaper", tint=paper, repeat=(1, 1), normal=(0, 0, 1))

    # Pared derecha: ladrillo, espejos y cuadros, como en los boliches de San Telmo.
    room.patch((X_MAX, 0, Z_MIN), (0, 0, depth), (0, HEIGHT, 0), nz * 2, 8, "brick", repeat=(4, 4), normal=(-1, 0, 0))
    wainscot(room, right, -2.1, Z_MAX, top=0.82)
    frame(room, -1.9, -1.0, 1.15, 2.45, right, "mirror")
    frame(room, -0.8, 1.25, 2.12, 2.95, right, "sign_red", thickness=0.02)
    frame(room, -0.8, -0.1, 1.15, 1.85, right, "portrait")
    frame(room, 0.1, 0.8, 1.15, 1.85, right, "landscape")
    frame(room, 1.0, 1.75, 1.0, 2.0, right, "mirror")
    frame(room, 1.95, 2.55, 1.2, 2.0, right, "poster", thickness=0.02)
    frame(room, 2.0, 3.0, 2.25, 2.75, right, "sign_small", thickness=0.02)
    frame(room, 2.72, 3.5, 1.05, 2.05, right, "chalkboard", thickness=0.04)
    # Reloj de pared, almanaque y dos apliques de luz.
    frame(room, -3.3, -2.5, 2.25, 3.05, right, "clock")
    frame(room, -2.45, -2.05, 1.35, 1.75, right, "calendar", thickness=0.012)
    for z in (-2.0, 0.95):
        room.lathe((X_MAX - 0.13, 2.05, z), [(0, 0.0), (0.09, 0.05), (0.1, 0.15), (0.05, 0.2), (0, 0.2)], segments=8, tint=srgb(0xfff0c0), glow=True)
        room.box((X_MAX - 0.07, 2.02, z), (0.13, 0.03, 0.03), tint=BRASS)

    # Pared izquierda: empapelado, zócalo tallado y ventanales a la calle con visillos.
    room.patch((X_MIN, 0, Z_MIN), (0, 0, depth), (0, HEIGHT, 0), nz * 2, 8, "wallpaper", tint=paper, repeat=(1, 1), normal=(1, 0, 0))
    wainscot(room, left, -2.15, Z_MAX)
    for z0, z1, region in ((-2.5, -0.9, "glass_bar"), (-0.75, 0.85, "glass_cafe"), (1.0, 2.6, "stained")):
        frame(room, z0, z1, 1.05, 2.75, left, region, thickness=0.07)
        wall_box(room, left, (z0 + z1) / 2, 1.04, z1 - z0 + 0.14, 0.04, 0.11, "wood", MAHOGANY)
        wall_box(room, left, (z0 + z1) / 2, 2.8, z1 - z0 + 0.1, 0.09, 0.07, "wood_dark", MAHOGANY_DARK)
        wall_box(room, left, (z0 + z1) / 2, 1.9, 0.035, 1.7, 0.035, "wood_dark", MAHOGANY_DARK, off=0.02)
        curtain(room, X_MIN + 0.03, z0 + 0.08, z1 - 0.08, 1.08, 1.72)

    # Pared de atrás: la puerta a la calle, el aparador y las fotos del club.
    room.patch((X_MIN, 0, Z_MAX), (width, 0, 0), (0, HEIGHT, 0), nx * 2, 8, "wallpaper", tint=paper, repeat=(1, 1), normal=(0, 0, -1))
    door_x0, door_x1 = 1.3, 2.4
    wainscot(room, back_wall, X_MIN, X_MAX, gaps=((door_x0 - 0.1, door_x1 + 0.1),))
    door_z = Z_MAX - 0.03
    door_mid = (door_x0 + door_x1) / 2
    room.box((door_mid, 1.3, Z_MAX - 0.015), (door_x1 - door_x0 + 0.24, 2.6, 0.03), region="wood_dark", tint=MAHOGANY_DARK)
    room.box((door_mid, 1.18, door_z), (door_x1 - door_x0, 2.36, 0.03), region="wood", tint=MAHOGANY)
    for x0, x1 in ((door_x0 + 0.05, door_mid - 0.025), (door_mid + 0.025, door_x1 - 0.05)):
        mid = (x0 + x1) / 2
        room.box((mid, 0.46, door_z - 0.018), (x1 - x0 - 0.04, 0.68, 0.012), region="wood_dark", tint=MAHOGANY_DARK)
        room.quad((x1, 0.9, door_z - 0.018), (x0, 0.9, door_z - 0.018), (x0, 2.24, door_z - 0.018), (x1, 2.24, door_z - 0.018), region="door_glass", glow=True, tint=(0.8, 0.8, 0.8))
    room.quad((door_x1, 2.42, Z_MAX - 0.034), (door_x0, 2.42, Z_MAX - 0.034), (door_x0, 2.82, Z_MAX - 0.034), (door_x1, 2.82, Z_MAX - 0.034), region="stained", glow=True, tint=(0.75, 0.75, 0.75))
    room.box((door_mid, 2.86, Z_MAX - 0.03), (door_x1 - door_x0 + 0.34, 0.09, 0.06), region="wood_dark", tint=MAHOGANY)
    for x in (door_mid - 0.07, door_mid + 0.07):
        limb(room, (x, 1.0, door_z - 0.03), (x, 1.2, door_z - 0.03), 0.008, 0.008, BRASS, segments=4)
    coat_rack(room, 0.72, 3.68)
    frame(room, -2.75, -1.75, 1.35, 2.35, ("z", Z_MAX, -1), "photos", thickness=0.04)
    frame(room, -1.3, -0.15, 1.35, 1.95, ("z", Z_MAX, -1), "portrait", thickness=0.04)
    frame(room, -1.3, -0.15, 2.05, 2.6, ("z", Z_MAX, -1), "landscape", thickness=0.04)
    sconce(room, back_wall, -1.52, 2.45)
    sconce(room, back_wall, 0.75, 2.45)

    # Aparador con la radio, el bandoneón y las copas del club.
    bx, bz = -0.75, Z_MAX - 0.3
    room.box((bx, 0.42, bz), (1.5, 0.84, 0.5), region="wood_dark", tint=MAHOGANY_DARK)
    room.box((bx, 0.86, bz), (1.58, 0.04, 0.56), region="wood", tint=MAHOGANY)
    for x in (bx - 0.5, bx, bx + 0.5):
        room.box((x, 0.46, bz - 0.255), (0.42, 0.6, 0.012), region="wood", tint=MAHOGANY)
        room.lathe((x + 0.14, 0.5, bz - 0.27), [(0.012, 0), (0, 0.01)], segments=5, tint=BRASS)
    radio(room, bx - 0.45, 0.88, bz)
    bandoneon(room, bx + 0.15, 0.88, bz)
    trophy(room, bx + 0.55, 0.88, bz + 0.05)
    trophy(room, bx + 0.42, 0.88, bz - 0.06)

    counter_z = build_back_bar(room)
    espresso_machine(room, -0.85, 1.04, counter_z - 0.05)
    for i in range(5):
        glass(room, 0.55 + i * 0.09, 1.04, counter_z + 0.2, tall=i % 2 == 0)
    ashtray(room, -1.5, 1.04, counter_z + 0.22)
    room.box((1.0, 1.095, counter_z + 0.18), (0.11, 0.11, 0.06), tint=srgb(0xb8b0a0))
    room.box((-1.55, 1.045, counter_z - 0.05), (0.34, 0.012, 0.24), region="plaster", tint=srgb(0xd8cfb8), yaw=0.2)

    # Banquetas de barra.
    for x in (-2.4, -1.25, 1.1, 2.3):
        room.lathe((x, 0, counter_z + 0.72), [(0.17, 0), (0.17, 0.02), (0.035, 0.05), (0.035, 0.66), (0.17, 0.68), (0.18, 0.74), (0, 0.76)], segments=8, region="wood_dark", tint=WOOD_RED)

    # Mesitas con sillas contra las paredes.
    for x, z, chairs, goods in ((-2.75, 1.6, (1.5, -1.5), 0), (2.75, 2.6, (0.2, 3.2), 1), (-2.8, -0.4, (0.1, 3.0), 2), (2.85, 0.45, (-1.3, 1.9), 0)):
        cafe_table(room, x, z, chairs, goods)
        pendant(room, x, z, 2.28)

    # Rincón de los toneles y los cajones de soda.
    barrel(room, 3.18, 0, 3.5)
    barrel(room, 2.72, 0, 3.62)
    barrel(room, 3.22, 0, 3.0)
    barrel(room, 3.14, 0.68, 3.42, radius=0.22, tall=0.56)
    soda_crate(room, 2.42, 0, 3.72, TURQUOISE)
    soda_crate(room, 2.42, 0.18, 3.72, srgb(0x3f7a4e))

    # Rincón de las damajuanas, con un helecho.
    demijohn(room, -3.3, 3.62, srgb(0x2a4a2a))
    demijohn(room, -2.86, 3.68, srgb(0x3f6b2e))
    demijohn(room, -3.32, 3.16, srgb(0x4a3a1a))
    pot = srgb(0x9a4f2e)
    room.lathe((-3.28, 0, 2.72), [(0.1, 0), (0.15, 0.24), (0.165, 0.27), (0.14, 0.27), (0, 0.24)], segments=10, tint=pot)
    fern = srgb(0x2f6b34)
    # Frondas finas que salen del centro y se arquean hacia afuera.
    for leaf in range(26):
        angle = leaf * 2.4
        reach = 0.2 + 0.05 * (leaf % 5)
        base = (-3.28, 0.27, 2.72)
        tip = (base[0] + math.cos(angle) * reach, 0.3 + 0.05 * (leaf % 3), base[2] + math.sin(angle) * reach)
        mid = (lerp(base[0], tip[0], 0.55), tip[1] + 0.12, lerp(base[2], tip[2], 0.55))
        across = (-math.sin(angle) * 0.022, 0, math.cos(angle) * 0.022)
        green = scale(fern, 0.7 + 0.12 * (leaf % 4))
        low = tuple(base[k] + across[k] * 0.4 for k in range(3))
        low2 = tuple(base[k] - across[k] * 0.4 for k in range(3))
        wide = tuple(mid[k] + across[k] for k in range(3))
        wide2 = tuple(mid[k] - across[k] for k in range(3))
        room.face((low, low2, wide2, wide), "white", ((0, 1), (1, 1), (1, 0), (0, 0)), green, normal=(0, 1, 0))
        room.face((wide, wide2, tip), "white", ((0, 1), (1, 1), (0.5, 0)), green, normal=(0, 1, 0))

    # Banderines de un lado al otro, por encima de las cabezas.
    bunting(room, X_MIN, X_MAX, -0.55, 3.28)
    bunting(room, X_MIN, X_MAX, 2.25, 3.28, colors=[(srgb(0xb3261e), None), (srgb(0xf4e6c4), None), (srgb(0xe3a93c), None)])

    # Lámpara de la mesa, con cadena y foco, y un globo junto a la puerta.
    limb(room, (0, HEIGHT - 0.06, 0), (0, 2.82, 0), 0.008, 0.008, BRASS, segments=4)
    room.lathe((0, 2.55, 0), [(0.28, 0), (0.26, 0.04), (0.13, 0.22), (0.05, 0.28), (0, 0.29)], segments=18, tint=srgb(0x2f6b4e))
    room.lathe((0, 2.55, 0), [(0.28, 0), (0.285, 0.012), (0.27, 0.03)], segments=18, tint=BRASS)
    room.lathe((0, 2.55, 0), [(0, 0.02), (0.26, 0.02)], segments=18, tint=srgb(0xffe3a8), glow=True)
    room.lathe((0, 2.5, 0), [(0, 0.0), (0.05, 0.015), (0.06, 0.05), (0.03, 0.08), (0, 0.08)], segments=10, tint=(1.0, 0.96, 0.82), glow=True)
    limb(room, (0, HEIGHT - 0.02, 2.8), (0, 3.28, 2.8), 0.008, 0.008, BRASS, segments=4)
    room.lathe((0, 2.92, 2.8), [(0, 0), (0.16, 0.04), (0.22, 0.18), (0.16, 0.32), (0, 0.36)], segments=12, tint=srgb(0xfff0c8), glow=True)

    # Ventilador de techo.
    fx, fz = 1.6, -0.2
    room.box((fx, 3.38, fz), (0.03, 0.44, 0.03), tint=WOOD_BLACK)
    room.lathe((fx, 3.1, fz), [(0, 0), (0.1, 0.03), (0.1, 0.1), (0.03, 0.14), (0, 0.14)], segments=8, tint=srgb(0xb8b0a0))
    for blade in range(4):
        angle = blade * math.pi / 2 + 0.3
        room.box((fx + math.cos(angle) * 0.42, 3.14, fz + math.sin(angle) * 0.42), (0.68, 0.012, 0.13), region="wood_dark", tint=WOOD_RED, yaw=-angle)

    return room


def build_table():
    # Radio 1 en planta: el juego la escala según los jugadores. La tapa queda en y = 0.
    table = Part("mesa")
    top_tint = (1.0, 0.94, 0.86)
    segments = 96
    for ring in range(4):
        r0, r1 = ring * 0.235, (ring + 1) * 0.235
        for i in range(segments):
            a0, a1 = 2 * math.pi * i / segments, 2 * math.pi * (i + 1) / segments
            pts = [(r0, a0), (r1, a0), (r1, a1), (r0, a1)]
            corners = [(r * math.cos(a), 0.0, r * math.sin(a)) for r, a in pts]
            uvs = [(c[0] / 2 + 0.5, c[2] / 2 + 0.5) for c in corners]
            tint = lambda c: tuple(t * (1.0 - 0.34 * (c[0] ** 2 + c[2] ** 2)) for t in top_tint)
            if ring == 0:
                table.face((corners[0], corners[1], corners[2]), "table", uvs[:3], tint, (0, 1, 0), glow=True)
            else:
                table.face(corners, "table", uvs, tint, (0, 1, 0), glow=True)
    profile = [(0.94, 0.0), (0.948, 0.006), (0.958, 0.006), (1.0, -0.012), (1.0, -0.05), (0.96, -0.08), (0, -0.08)]
    colors = [srgb(0xa8823a), srgb(0xa8823a), srgb(0x6b3d22), srgb(0x5a3019), srgb(0x2e1a0f), srgb(0x20120a)]
    for index in range(len(profile) - 1):
        table.lathe((0, 0, 0), profile[index : index + 2], segments=segments, tint=colors[index], glow=True)
    table.lathe((0, 0, 0), [(0.1, -0.08), (0.075, -0.14), (0.055, -0.3), (0.075, -0.46), (0.11, -0.56), (0.13, -0.64)], segments=12, region="wood_dark", tint=(1.2, 1.1, 1.0))
    for leg in range(4):
        angle = math.pi / 4 + leg * math.pi / 2
        table.box((math.cos(angle) * 0.27, -0.685, math.sin(angle) * 0.27), (0.54, 0.075, 0.08), region="wood_dark", yaw=-angle)
    return table


def build_chair():
    chair = Part("silla", baked=False)
    thonet(chair, 0, 0, 0)
    return chair



class Figure(Part):
    """Personaje sin textura. En las UV viaja qué pinta cada cara:
    x = tipo de color (0 fijo, 1 piel, 2 pelo, 3 ropa del equipo, 4 sombrero o detalle)
    y = variante de personaje (0 siempre visible, 1 a 6 según el personaje)."""

    FIXED, SKIN, HAIR, CLOTH, ACCENT = 0, 1, 2, 3, 4
    # Las variantes repiten piezas en el mismo lugar: fusionarlas borraría las de los demás.
    merge_points = False

    def __init__(self, name):
        super().__init__(name, baked=False)
        self.kind = self.FIXED
        self.variant = 0

    def face(self, corners, region, uvs, tint=WHITE, normal=None, glow=False):
        verts = [self.bm.verts.new((c[0], -c[2], c[1])) for c in corners]
        bm_face = self.bm.faces.new(verts)
        for loop, corner in zip(bm_face.loops, corners):
            loop[self.uv].uv = (self.kind / 8, 1 - self.variant / 8)
            base = tint(corner) if callable(tint) else tint
            loop[self.color] = (base[0], base[1], base[2], 1.0)
        return bm_face

    def use(self, kind, variant=None):
        self.kind = kind
        if variant is not None:
            self.variant = variant

    def grid(self, point, nu, nv, tint=WHITE, kind=None):
        """Superficie continua: point(u, v) con u y v entre 0 y 1. Mirada de afuera, u va a la derecha y v hacia arriba."""
        base_kind = self.kind
        for j in range(nv):
            for i in range(nu):
                if kind:
                    self.kind = kind((i + 0.5) / nu, (j + 0.5) / nv)
                self.face(
                    (point(i / nu, j / nv), point((i + 1) / nu, j / nv), point((i + 1) / nu, (j + 1) / nv), point(i / nu, (j + 1) / nv)),
                    "white",
                    (),
                    tint,
                )
        self.kind = base_kind

    def ellipsoid(self, center, radii, tint=WHITE, segments=12, rings=8):
        def point(u, v):
            lat = math.pi * (v - 0.5)
            lon = 2 * math.pi * u
            return (
                center[0] + radii[0] * math.cos(lat) * math.sin(lon),
                center[1] + radii[1] * math.sin(lat),
                center[2] + radii[2] * math.cos(lat) * math.cos(lon),
            )

        self.grid(point, segments, rings, tint)

    def sweep(self, path, radii, tint=WHITE, segments=10, smooth_steps=4, flat=1.0, closed=False):
        """Tubo que sigue un recorrido suavizado. radii tiene un radio por punto del recorrido."""
        points, sizes = catmull(path, radii, smooth_steps, closed)
        count = len(points)
        tangent = normalize(sub(points[1], points[0]))
        helper_axis = (0.0, 1.0, 0.0) if abs(tangent[1]) < 0.9 else (1.0, 0.0, 0.0)
        u = normalize(cross(tangent, helper_axis))
        rings = []
        for index in range(count):
            ahead = points[min(index + 1, count - 1)]
            behind = points[max(index - 1, 0)]
            tangent = normalize(sub(ahead, behind))
            # Transporte paralelo: el tubo no se retuerce en las curvas.
            side = sub(u, tuple(tangent[k] * sum(u[m] * tangent[m] for m in range(3)) for k in range(3)))
            u = normalize(side)
            v = cross(tangent, u)
            rings.append((points[index], sizes[index], u, v))
        for index in range(count - 1):
            a, b = rings[index], rings[index + 1]

            def at(ring, t):
                c, r, ru, rv = ring
                return tuple(c[k] + r * (math.cos(t) * ru[k] + flat * math.sin(t) * rv[k]) for k in range(3))

            for i in range(segments):
                t0, t1 = 2 * math.pi * i / segments, 2 * math.pi * (i + 1) / segments
                self.face((at(a, t0), at(a, t1), at(b, t1), at(b, t0)), "white", (), tint)


def clamp01(x):
    return max(0.0, min(1.0, x))


def smooth(a, b, x):
    t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(a, b, t):
    return tuple(lerp(a[k], b[k], t) for k in range(3))


def scale(color, amount):
    return tuple(c * amount for c in color)


def bell(x, y, cx, cy, sx, sy):
    return math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2)


def catmull(path, radii, steps, closed=False):
    if closed:
        path = [path[-1], *path, path[0], path[1]]
        radii = [radii[-1], *radii, radii[0], radii[1]]
    else:
        path = [path[0], *path, path[-1]]
        radii = [radii[0], *radii, radii[-1]]
    points, sizes = [], []
    for index in range(1, len(path) - 2):
        p0, p1, p2, p3 = path[index - 1], path[index], path[index + 1], path[index + 2]
        for step in range(steps):
            t = step / steps
            points.append(tuple(
                0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t ** 3)
                for k in range(3)
            ))
            sizes.append(lerp(radii[index], radii[index + 1], t))
    points.append(path[-2])
    sizes.append(radii[-2])
    return points, sizes


# ---- Cabeza ----
# El centro de la cabeza es el ojo de la cámara. Adelante es +z.
HEAD_RX, HEAD_RY, HEAD_RZ = 0.128, 0.162, 0.148
HEAD_CENTER = (0.0, 0.0, -0.008)
# La cara pintada cubre este medio ancho alrededor del centro; coincide con el dibujo de atlas.ts.
FACE_HALF = 0.13


def head_point(lon, lat):
    cos_lat = math.cos(lat)
    x = HEAD_RX * cos_lat * math.sin(lon)
    y = HEAD_RY * math.sin(lat)
    z = HEAD_RZ * cos_lat * math.cos(lon)
    low = smooth(-0.05, -0.165, y)
    x *= (1 - 0.34 * low) * (1 + 0.03 * smooth(0.02, 0.12, y))
    # Quijada: la parte baja de la cara se mantiene ancha antes de cerrar en el mentón.
    x *= 1 + 0.05 * bell(0, y, 0, -0.1, 1, 0.04)
    if z < 0:
        z *= (1 + 0.1 * smooth(-0.02, 0.08, y)) * (1 - 0.42 * low)
    else:
        z *= 1 - 0.1 * low
    side = abs(x)
    relief = (
        0.006 * bell(side, y, 0.03, 0.05, 0.06, 0.016)     # Arco de las cejas.
        - 0.013 * bell(side, y, 0.053, 0.018, 0.028, 0.017)  # Cuencas de los ojos.
        + 0.007 * bell(side, y, 0.085, -0.03, 0.04, 0.03)    # Pómulos.
        + 0.012 * bell(x, y, 0, 0.012, 0.011, 0.03)          # Tabique.
        + 0.029 * bell(x, y, 0, -0.033, 0.016, 0.023)        # Nariz.
        + 0.012 * bell(x, y, 0, -0.043, 0.011, 0.011)        # Punta.
        + 0.009 * bell(side, y, 0.017, -0.05, 0.008, 0.008)  # Aletas.
        - 0.004 * bell(x, y, 0, -0.067, 0.02, 0.007)         # Bajo la nariz.
        + 0.006 * bell(x, y, 0, -0.083, 0.03, 0.012)         # Labios.
        - 0.005 * bell(x, y, 0, -0.106, 0.032, 0.007)        # Bajo el labio.
        + 0.009 * bell(x, y, 0, -0.13, 0.032, 0.018)         # Mentón.
        - 0.004 * bell(side, y, 0.115, 0.05, 0.02, 0.05)     # Sienes.
    )
    z += relief * smooth(0.02, 0.09, z)
    return (x + HEAD_CENTER[0], y + HEAD_CENTER[1], z + HEAD_CENTER[2])


def warp(s, gain):
    return gain * s + (1 - gain) * s ** 3


def head_grid(u, v):
    # Más vértices en el centro de la cara, donde está el relieve.
    return head_point(math.pi * warp(2 * u - 1, 0.35), (math.pi / 2) * warp(2 * v - 1, 0.5))


def skin_tint(p):
    x, y, z = p
    shade = 1 - 0.28 * smooth(-0.1, -0.16, y) * smooth(0.14, -0.02, z)
    # Los costados caen en sombra: le da volumen a la cara aunque la luz venga de frente.
    shade *= 1 - 0.2 * smooth(0.07, 0.0, z) * smooth(0.09, 0.0, y)
    blush = 0.06 * bell(abs(x), y, 0.08, -0.035, 0.035, 0.025) + 0.14 * bell(x, y, 0, -0.04, 0.018, 0.016)
    return (shade, shade * (1 - blush), shade * (1 - blush * 1.1))


def surface_at(x, y):
    """Punto de la cara que está frente a (x, y)."""
    lon, lat = math.asin(clamp01(abs(x) / HEAD_RX) * 0.99) * (1 if x >= 0 else -1), math.asin(max(-0.99, min(0.99, y / HEAD_RY)))
    for _ in range(8):
        p = head_point(lon, lat)
        lat += (y - p[1]) / (HEAD_RY * max(0.2, math.cos(lat)))
        lon += (x - p[0]) / (HEAD_RX * max(0.2, math.cos(lat)))
    return head_point(lon, lat)


def outward(p):
    return normalize(sub(p, HEAD_CENTER))


def keyed(*keys):
    """Línea alrededor de la cabeza: pares (grados desde el frente, grados de latitud), simétrica."""

    def line(lon):
        degrees = abs(math.degrees(lon))
        degrees = min(degrees, 360 - degrees)
        for (a, va), (b, vb) in zip(keys, keys[1:]):
            if degrees <= b:
                return math.radians(lerp(va, vb, smooth(a, b, degrees)))
        return math.radians(keys[-1][1])

    return line


def hair_cap(head, low, thick, top=lambda lon: math.radians(89), lon0=-180, lon1=180, nu=84, nv=16, fade=True, roll=0.0, grain=0.14):
    """Pelo que nace en una línea continua y se apoya sobre el cráneo: no quedan bordes en escalera."""
    a, b = math.radians(lon0), math.radians(lon1)

    def place(lon, lat, off):
        p = head_point(lon, lat)
        n = outward(p)
        return tuple(p[k] + n[k] * off for k in range(3))

    def point(u, v):
        lon = lerp(a, b, u)
        lat = lerp(low(lon), top(lon), v)
        return place(lon, lat, thick(lon, lat, v) * (smooth(0, 0.3, v) if fade else 1) + 0.0012)

    def tint(p):
        lon = math.atan2(p[0], p[2] - HEAD_CENTER[2])
        strand = 0.5 * math.sin(lon * 41 + math.sin(p[1] * 18) * 1.6) + 0.5 * math.sin(lon * 97 + p[1] * 9)
        return scale(WHITE, 1 + grain * strand)

    head.grid(point, nu, nv, tint)
    if roll:
        # Remate redondeado que vuelve hacia el cuello: de abajo no se ve el interior.
        def under(u, v):
            lon = lerp(a, b, u)
            angle = (1 - v) * math.pi * 0.75
            lat = low(lon)
            base = place(lon, lat, 0.0)
            n = outward(base)
            off = thick(lon, lat, 0) * 0.5 + 0.0012
            return tuple(base[k] + n[k] * (off + off * math.cos(angle)) - (roll * math.sin(angle) if k == 1 else 0) for k in range(3))

        head.grid(under, nu, 6, scale(WHITE, 0.86))


def moustache(head, half, y_top, y_bottom, droop, bulk, split=0.0):
    def point(u, v):
        s = 2 * u - 1
        x = s * half
        # droop positivo cae en las puntas; negativo las levanta.
        center = split * math.exp(-((s / 0.14) ** 2))
        taper = 1 - s ** 4
        mid = (y_top + y_bottom) / 2 - droop * s * s
        half_height = (y_top - y_bottom) / 2 * taper * (1 - 0.8 * center / max(split, 0.001) if split else 1) + 0.0006
        p = surface_at(x, mid + lerp(-half_height, half_height, v))
        off = 0.0012 + bulk * math.sin(math.pi * v) ** 0.6 * taper
        return (p[0], p[1], p[2] + off)

    head.grid(point, 22, 5)


def build_head():
    head = Figure("cabeza")
    head.use(Figure.SKIN, 0)
    head.grid(head_grid, 42, 32, skin_tint)
    for side in (-1, 1):
        # Oreja: pabellón aplastado con el interior en sombra.
        center = (side * 0.127, 0.002, -0.022)

        def ear_tint(p, c=center):
            return scale(WHITE, lerp(0.74, 1.0, smooth(0.1, 0.6, math.hypot((p[1] - c[1]) / 0.04, (p[2] - c[2]) / 0.026))))

        head.ellipsoid(center, (0.015, 0.04, 0.026), ear_tint, segments=12, rings=9)

    short_line = keyed((0, 38), (32, 33), (58, 18), (78, -6), (98, -8), (125, -22), (180, -30))

    # 1. Raya al costado, peinado de oficina.
    head.use(Figure.HAIR, 1)
    part = math.radians(32)

    def parted(lon, lat, v):
        groove = 1 - 0.75 * math.exp(-(((lon - part) / 0.085) ** 2)) * smooth(0, 0.25, v)
        volume = 0.016 + 0.009 * smooth(0.0, -1.2, lon - part) * smooth(0.0, 0.5, v)
        return volume * groove

    hair_cap(head, short_line, parted)
    head.use(Figure.HAIR)
    moustache(head, 0.05, -0.0605, -0.0675, -0.007, 0.0028, split=1.0)

    # 2. A la gomina, tirante hacia atrás y con entradas.
    head.use(Figure.HAIR, 2)
    slick_line = keyed((0, 43), (14, 46), (34, 36), (58, 19), (78, -5), (98, -8), (125, -22), (180, -32))

    def slick(lon, lat, v):
        return 0.013 + 0.012 * smooth(0.0, 0.45, v) * smooth(math.pi, 0.2, abs(lon)) + 0.0014 * math.sin(lon * 34)

    hair_cap(head, slick_line, slick, grain=0.22)

    # 3. Sombrero de ala, el de los retratos de Gardel.
    head.use(Figure.HAIR, 3)
    under_hat = lambda lon: math.radians(42)
    hair_cap(head, short_line, lambda lon, lat, v: 0.011, top=under_hat, nv=8)
    head.use(Figure.ACCENT)

    def hat(u, v):
        # El perfil va del borde del ala a la copa; se recorre de afuera hacia arriba.
        lon = 2 * math.pi * u
        s, c = math.sin(lon), math.cos(lon)
        profile = [(1.0, -0.004), (1.015, 0.002), (0.98, 0.007), (0.64, 0.009), (0.61, 0.05), (0.57, 0.135), (0.46, 0.158), (0.2, 0.152), (0.0, 0.14)]
        t = v * (len(profile) - 1)
        index = min(int(t), len(profile) - 2)
        r = lerp(profile[index][0], profile[index + 1][0], t - index)
        h = lerp(profile[index][1], profile[index + 1][1], t - index)
        brim = smooth(0.64, 1.0, r)
        crown = smooth(0.02, 0.12, h) * (1 - brim)
        # El ala baja adelante y sube a los costados; la copa se aprieta arriba al frente y se hunde al medio.
        y = 0.104 + h - 0.018 * brim * max(0.0, c) ** 2 + 0.014 * brim * s * s
        y -= 0.022 * crown * math.exp(-((r * s / 0.16) ** 2)) * smooth(0.6, 0.2, r)
        pinch = 1 - 0.2 * crown * max(0.0, c) ** 2
        return (0.21 * r * s * pinch, y, -0.008 + 0.232 * r * c)

    head.grid(hat, 32, 32, lambda p: scale(WHITE, 0.82 + 0.18 * smooth(0.11, 0.22, p[1])))
    head.use(Figure.FIXED)

    def band(u, v):
        lon = 2 * math.pi * u
        y = lerp(0.114, 0.146, v)
        k = 0.21 * lerp(0.637, 0.618, v) + 0.0015
        return (k * math.sin(lon), y, -0.008 + k * 1.105 * math.cos(lon))

    head.grid(band, 28, 2, srgb(0x17110d))

    # 4. Boina y bigote de almacenero.
    head.use(Figure.HAIR, 4)
    hair_cap(head, short_line, lambda lon, lat, v: 0.01, top=under_hat, nv=8)
    moustache(head, 0.05, -0.055, -0.074, 0.008, 0.008)
    head.use(Figure.ACCENT)

    def beret(u, v):
        lon = 2 * math.pi * u
        s, c = math.sin(lon), math.cos(lon)
        # Se desinfla hacia un costado, como se usa.
        angle = v * math.pi * 0.5
        outer = lerp(0.128, 0.178, smooth(0.0, 0.3, v)) * math.cos(angle * 0.92) ** 0.75
        y = 0.106 + 0.082 * math.sin(angle) ** 0.85 - 0.016 * s * smooth(0.1, 0.5, v)
        return (0.008 + outer * s, y, -0.012 + outer * 1.08 * c)

    head.grid(beret, 30, 12, lambda p: scale(WHITE, 0.82 + 0.18 * smooth(0.11, 0.18, p[1])))
    head.sweep([(0.012, 0.18, -0.012), (0.012, 0.205, -0.012)], [0.008, 0.006], segments=6, smooth_steps=1)

    # 5. Melena corta a la mandíbula, redondeada y con el remate hacia adentro.
    head.use(Figure.HAIR, 5)
    bob_line = keyed((0, 40), (22, 37), (46, 24), (66, 0), (84, -36), (110, -44), (180, -46))

    def bob(lon, lat, v):
        return 0.021 + 0.022 * smooth(0.5, -0.7, lat)

    hair_cap(head, bob_line, bob, fade=False, roll=0.012, grain=0.16)

    # 6. Pelado con los costados canosos y anteojos redondos.
    head.use(Figure.HAIR, 6)
    ring_low = keyed((0, 8), (62, 8), (80, -8), (110, -14), (180, -26))
    ring_top = keyed((0, 8), (62, 12), (80, 22), (112, 36), (180, 42))
    hair_cap(head, ring_low, lambda lon, lat, v: 0.013, top=ring_top, lon0=-180, lon1=180, nv=8, grain=0.2)
    head.use(Figure.FIXED)
    GOLD = srgb(0xa98a4a)
    for side in (-1, 1):
        ring = []
        for step in range(18):
            angle = 2 * math.pi * step / 18
            x, y = side * 0.053 + 0.03 * math.cos(angle), 0.018 + 0.027 * math.sin(angle)
            p = surface_at(x, y)
            ring.append((p[0], p[1], max(p[2], surface_at(side * 0.053, 0.03)[2]) + 0.012))
        head.sweep(ring, [0.0026] * 18, GOLD, segments=5, smooth_steps=1, closed=True)
        p = surface_at(side * 0.083, 0.02)
        head.sweep([(p[0], p[1], p[2] + 0.012), (side * 0.128, 0.022, 0.05), (side * 0.134, 0.02, -0.02)], [0.0022] * 3, GOLD, segments=5, smooth_steps=3)
    nose = surface_at(0, 0.024)
    head.sweep([(-0.024, 0.024, nose[2] + 0.004), (0, 0.03, nose[2] + 0.006), (0.024, 0.024, nose[2] + 0.004)], [0.0024] * 3, GOLD, segments=5, smooth_steps=3)
    return head


def build_face():
    """La parte de adelante de la cabeza, un pelito afuera, con UV para el dibujo de la cara."""
    face = Figure("cara")
    half = FACE_HALF

    def write(corners):
        verts = [face.bm.verts.new((c[0], -c[2], c[1])) for c in corners]
        polygon = face.bm.faces.new(verts)
        for loop, corner in zip(polygon.loops, corners):
            # glTF invierte la v: al juego le llega con el 0 abajo, igual que los demás cuadros del atlas.
            loop[face.uv].uv = (corner[0] / (2 * half) + 0.5, 1 - (corner[1] / (2 * half) + 0.5))
            loop[face.color] = (1.0, 1.0, 1.0, 1.0)

    nu, nv = 42, 32
    lift = lambda p: (p[0], p[1], p[2] + 0.0014)
    for j in range(nv):
        for i in range(nu):
            corners = [head_grid(i / nu, j / nv), head_grid((i + 1) / nu, j / nv), head_grid((i + 1) / nu, (j + 1) / nv), head_grid(i / nu, (j + 1) / nv)]
            if all(abs(c[0]) < half and abs(c[1]) < half and c[2] > 0 for c in corners):
                write([lift(c) for c in corners])
    return face


# ---- Cuerpo ----
SHIRT = srgb(0xe4dccb)
PANTS = srgb(0x2c2622)
SHOE = srgb(0x1a120c)
TIE = srgb(0x5e1a18)
INK = srgb(0x171310)
PEARL = srgb(0xe9e0cf)
BUTTON = srgb(0x2a201a)

# (altura, ancho, profundidad, centro en z)
MAN = [(0.44, 0.165, 0.116, -0.03), (0.6, 0.168, 0.114, -0.026), (0.74, 0.178, 0.12, -0.016), (0.85, 0.192, 0.128, -0.01), (0.93, 0.192, 0.112, -0.016), (0.975, 0.168, 0.09, -0.022), (1.022, 0.09, 0.07, -0.02), (1.05, 0.062, 0.06, -0.015)]
WOMAN = [(0.44, 0.165, 0.118, -0.03), (0.6, 0.15, 0.108, -0.026), (0.74, 0.142, 0.1, -0.018), (0.85, 0.168, 0.124, -0.006), (0.93, 0.172, 0.104, -0.014), (0.975, 0.146, 0.08, -0.022), (1.022, 0.074, 0.062, -0.02), (1.05, 0.05, 0.05, -0.015)]


def profile(table, y):
    y = max(table[0][0], min(table[-1][0], y))
    for a, b in zip(table, table[1:]):
        if y <= b[0]:
            t = smooth(a[0], b[0], y)
            return tuple(lerp(a[k], b[k], t) for k in (1, 2, 3))
    return table[-1][1:]


def front(table, x, y, off=0.0):
    """Punto del frente del torso, para apoyar encima la ropa."""
    rx, rz, cz = profile(table, y)
    s = min(0.995, abs(x) / rx)
    return (x, y, cz + rz * math.sqrt(1 - s * s) + off)


def front_patch(body, table, y0, y1, left, right, off, tint=WHITE, rows=8, cols=4):
    def point(u, v):
        y = lerp(y0, y1, v)
        return front(table, lerp(left(y), right(y), u), y, off)

    body.grid(point, cols, rows, tint)


def torso_shade(p):
    # Sombra suave de la mesa abajo y de la cabeza bajo el mentón.
    amount = 0.7 + 0.3 * smooth(0.72, 0.86, p[1])
    amount *= 1 - 0.3 * smooth(0.96, 1.04, p[1]) * smooth(0.0, 0.05, p[2])
    return scale(WHITE, amount)


def torso(body, table, tint):
    y0, y1 = table[0][0], table[-1][0]

    def point(u, v):
        angle = 2 * math.pi * u
        y = lerp(y0, y1, v)
        rx, rz, cz = profile(table, y)
        # Un poco adentro: la prenda de encima no deja asomar el torso en las curvas.
        return ((rx - 0.005) * math.sin(angle), y, cz + (rz - 0.005) * math.cos(angle))

    body.grid(point, 28, 20, tint)


def garment(body, table, y0, y1, opening, armhole=None, off=0.004):
    """Prenda sobre el torso. opening da el medio ancho del escote en cada altura y armhole cuánto rodea
    el hombro: el borde sigue la superficie, por eso sale limpio en vez de escalonado."""
    reach = armhole or (lambda y: math.pi / 2)

    def place(angle, y):
        rx, rz, cz = profile(table, y)
        return ((rx + off) * math.sin(angle), y, cz + (rz + off) * math.cos(angle))

    def open_angle(y):
        return math.asin(min(0.98, opening(y) / profile(table, y)[0]))

    def front_right(u, v):
        y = lerp(y0, y1, v)
        return place(lerp(open_angle(y), reach(y), u), y)

    def front_left(u, v):
        y = lerp(y0, y1, v)
        return place(-lerp(reach(y), open_angle(y), u), y)

    def back(u, v):
        y = lerp(y0, y1, v)
        a = reach(y)
        # Dos paños: del hombro derecho al centro y del centro al hombro izquierdo.
        return place(lerp(math.pi - a, math.pi + a, u), y)

    body.grid(front_right, 10, 24, torso_shade)
    body.grid(front_left, 10, 24, torso_shade)
    body.grid(back, 20, 24, torso_shade)


def neck(body, radius):
    body.use(Figure.SKIN)
    # Sube hasta adentro de la cabeza; la parte alta queda en la sombra del mentón.
    body.sweep([(0, 1.0, -0.016), (0, 1.1, -0.014), (0, 1.17, -0.012)], [radius * 1.28, radius, radius * 0.98], lambda p: scale(WHITE, 0.66 + 0.14 * smooth(1.02, 1.04, p[1])), segments=14, smooth_steps=2)


def shirt_collar(body, table, tint=SHIRT):
    body.use(Figure.FIXED)
    body.sweep([(0, 1.0, -0.017), (0, 1.058, -0.016)], [0.076, 0.069], tint, segments=16, smooth_steps=2)
    for side in (-1, 1):
        a = (side * 0.008, 1.06, 0.052)
        b = (side * 0.066, 1.06, 0.012)
        c = front(table, side * 0.072, 0.982, 0.013)
        d = front(table, side * 0.02, 0.982, 0.017)
        shadow = tuple(p + (0, -0.006, -0.003)[k] for k, p in enumerate(c)), tuple(p + (0, -0.006, -0.003)[k] for k, p in enumerate(d))
        def wing(q, off=0.0):
            return lambda u, v: tuple(lerp(lerp(q[3][k], q[2][k], u), lerp(q[0][k], q[1][k], u), v) + (off if k == 2 else 0) for k in range(3))

        order = (a, b, c, d) if side > 0 else (b, a, d, c)
        low = (a, b, shadow[0], shadow[1]) if side > 0 else (b, a, shadow[1], shadow[0])
        body.grid(wing(low, -0.003), 3, 3, scale(tint, 0.62))
        body.grid(wing(order), 3, 3, tint)


def necktie(body, table, y_low, color=TIE):
    body.use(Figure.FIXED)
    width = lambda y: lerp(0.024, 0.014, smooth(y_low, 0.975, y))
    front_patch(body, table, y_low, 0.975, lambda y: -width(y), lambda y: width(y), 0.006, color, rows=6, cols=2)
    # Nudo: más ancho arriba, con volumen y un poco más oscuro en los bordes.
    knot_width = lambda y: lerp(0.012, 0.021, smooth(0.962, 0.992, y))

    def knot(u, v):
        y = lerp(0.962, 0.994, v)
        x = lerp(-knot_width(y), knot_width(y), u)
        return front(table, x, y, 0.009 + 0.007 * math.sin(math.pi * u) * math.sin(math.pi * v) ** 0.5)

    body.grid(knot, 6, 4, scale(color, 1.12))


def bow_tie(body, table, color=INK):
    body.use(Figure.FIXED)
    center = front(table, 0, 0.995, 0.018)
    for side in (-1, 1):
        body.ellipsoid((side * 0.033, center[1], center[2]), (0.03, 0.021, 0.009), color, segments=10, rings=6)
    body.ellipsoid(center, (0.011, 0.012, 0.012), color, segments=8, rings=5)


def buttons(body, table, ys, x=0.0, color=BUTTON):
    body.use(Figure.FIXED)
    for y in ys:
        body.ellipsoid(front(table, x, y, 0.006), (0.0075, 0.0075, 0.004), color, segments=8, rings=4)


def arm_path(side, table_scale=1.0):
    # El antebrazo descansa sobre el borde de la mesa, y la muñeca queda apoyada sobre el paño.
    shoulder = (side * 0.192 * table_scale, 0.925, -0.024)
    return [
        shoulder,
        (side * lerp(0.192 * table_scale, 0.248, 0.6), 0.825, -0.008),
        (side * 0.262, 0.752, 0.075),
        (side * 0.248, 0.754, 0.15),
        (side * 0.2, 0.772, 0.262),
        (side * 0.152, 0.779, 0.372),
        (side * 0.138, 0.78, 0.402),
    ]


ARM_RADII = [0.058, 0.054, 0.048, 0.045, 0.04, 0.034, 0.031]


def arm(body, side, tint=WHITE, table_scale=1.0, shrink=1.0):
    path = arm_path(side, table_scale)
    radii = [r * shrink for r in ARM_RADII]
    root = (path[0][0] - side * 0.05, path[0][1] + 0.022, path[0][2])
    body.sweep([root, *path], [radii[0] * 0.8, *radii], tint, segments=16, smooth_steps=3)


def cuff(body, side, tint=SHIRT, shrink=1.0):
    path = arm_path(side)
    start, end = path[-2], path[-1]
    along = lambda t: tuple(lerp(start[k], end[k], t) for k in range(3))
    body.use(Figure.FIXED)
    body.sweep([along(-0.45), along(0.6)], [0.0425 * shrink, 0.0395 * shrink], tint, segments=16, smooth_steps=1)


HAND_CREASE = (0.86, 0.76, 0.72)


def finger(body, joints, radii, segments=9):
    """Dedo de tres falanges con la punta redonda y un pliegue apenas más oscuro en cada nudillo."""
    tips = len(joints) - 1

    def tint(p):
        near = min(math.dist(p, joint) for joint in joints[1:tips])
        return mix(HAND_CREASE, WHITE, smooth(0.003, 0.009, near))

    body.sweep(joints, radii, tint, segments=segments, smooth_steps=3)
    body.ellipsoid(joints[-1], (radii[-1],) * 3, segments=segments, rings=5)


def hand(body, side):
    """Mano que sostiene las cartas por abajo: el pulgar por delante y los otros cuatro dedos por detrás."""
    body.use(Figure.SKIN, 0)
    # La muñeca nace bien adentro de la manga y se abre rápido, para que el corte quede limpio.
    wrist = (side * 0.142, 0.778, 0.392)
    heel = (side * 0.128, 0.786, 0.424)
    middle = (side * 0.112, 0.806, 0.452)
    knuckles = (side * 0.098, 0.83, 0.474)
    body.sweep([wrist, heel, middle, knuckles], [0.016, 0.03, 0.036, 0.03], segments=14, smooth_steps=4, flat=0.68)

    # Los cuatro dedos suben por detrás de las cartas, de afuera hacia adentro.
    for index, (x, length) in enumerate(((0.128, 0.84), (0.11, 1.0), (0.09, 1.06), (0.07, 0.96))):
        x *= side
        base_y = 0.826 + 0.003 * index
        base_z = 0.482
        joints = [
            (x, base_y - 0.012, base_z - 0.012),
            (x, base_y + 0.012 * length, base_z + 0.012),
            (x * 0.99, base_y + 0.03 * length, base_z + 0.024),
            (x * 0.98, base_y + 0.044 * length, base_z + 0.026),
        ]
        finger(body, joints, [0.0125, 0.0116, 0.0102, 0.0088])

    # Pulgar por delante de las cartas, apoyado sobre el borde de abajo.
    base = (side * 0.112, 0.79, 0.424)
    joints = [base, (side * 0.09, 0.799, 0.414), (side * 0.069, 0.811, 0.416), (side * 0.051, 0.823, 0.424)]
    finger(body, joints, [0.0175, 0.0145, 0.0122, 0.0102])
    # Uña del pulgar, lo único que queda bien a la vista desde el asiento.
    nail = (side * 0.0535, 0.8265, 0.4185)
    body.ellipsoid(nail, (0.0078, 0.0086, 0.0034), (1.12, 1.02, 0.98), segments=9, rings=5)


def lapels(body, table, y_low, opening, tint):
    """Solapas con muesca, apoyadas sobre el saco."""
    for side in (-1, 1):
        inner = lambda y, s=side: s * opening(y)

        def outer(y, s=side):
            width = lerp(0.02, 0.062, smooth(y_low, 0.93, y))
            notch = 0.022 * bell(y, 0, 0.955, 0, 0.012, 1)
            return s * (opening(y) + width - notch)

        left, right = (outer, inner) if side < 0 else (inner, outer)
        front_patch(body, table, y_low, 1.0, left, right, 0.007, tint, rows=12, cols=2)


def build_body():
    body = Figure("cuerpo")
    # Piernas sentadas: casi no se ven, pero evitan que parezca un busto flotando.
    for side in (-1, 1):
        body.use(Figure.FIXED, 0)
        body.sweep([(side * 0.09, 0.5, -0.02), (side * 0.1, 0.5, 0.36), (side * 0.1, 0.08, 0.36)], [0.078, 0.064, 0.046], PANTS, segments=8, smooth_steps=2)
        body.ellipsoid((side * 0.1, 0.045, 0.41), (0.05, 0.04, 0.105), SHOE, segments=8, rings=5)
        hand(body, side)

    def shirt_base(variant):
        # Debajo siempre está la camisa: la ropa de encima se recorta con bordes limpios.
        body.use(Figure.FIXED, variant)
        torso(body, MAN, lambda p: tuple(a * b for a, b in zip(torso_shade(p), SHIRT)))

    def shirt_sleeves():
        body.use(Figure.FIXED)
        for side in (-1, 1):
            arm(body, side, SHIRT)
            cuff(body, side, scale(SHIRT, 1.02))

    def coat_sleeves():
        for side in (-1, 1):
            body.use(Figure.CLOTH)
            arm(body, side, shrink=1.04)
            cuff(body, side)

    vee = lambda low, width: (lambda y: lerp(0.0, width, smooth(low, 1.0, y)))
    armhole = lambda y: lerp(math.pi / 2, 0.82, smooth(0.8, 0.965, y))

    # 1. Chaleco abotonado, camisa y corbata.
    shirt_base(1)
    body.use(Figure.CLOTH)
    garment(body, MAN, 0.44, 0.985, vee(0.83, 0.085), armhole)
    necktie(body, MAN, 0.82)
    shirt_collar(body, MAN)
    neck(body, 0.056)
    buttons(body, MAN, (0.815, 0.775))
    shirt_sleeves()

    # 2 y 3. Saco con solapas; el 3 lleva lengue blanco en vez de corbata.
    for variant in (2, 3):
        shirt_base(variant)
        body.use(Figure.CLOTH)
        opening = vee(0.8, 0.072)
        garment(body, MAN, 0.44, 1.02, opening)
        lapels(body, MAN, 0.8, opening, scale(WHITE, 0.74))
        if variant == 2:
            necktie(body, MAN, 0.79, INK)
            shirt_collar(body, MAN)
            # Pañuelo en el bolsillo.
            body.use(Figure.FIXED)
            front_patch(body, MAN, 0.872, 0.902, lambda y: 0.118, lambda y: 0.16 - 0.5 * (y - 0.872), 0.008, SHIRT, rows=3, cols=3)
        else:
            silk = srgb(0xf1ece0)
            body.use(Figure.FIXED)
            body.sweep([(0, 1.0, -0.016), (0, 1.03, -0.016)], [0.08, 0.074], silk, segments=14, smooth_steps=2)
            # Dos paños cruzados que cierran el escote, con el de arriba apenas más claro.
            drape = lambda y: smooth(0.8, 1.0, y)
            front_patch(body, MAN, 0.81, 1.0, lambda y: -0.07 * drape(y) - 0.002, lambda y: 0.01 + 0.012 * drape(y), 0.006, scale(silk, 0.86), rows=8, cols=3)
            front_patch(body, MAN, 0.82, 1.0, lambda y: -0.012 - 0.008 * drape(y), lambda y: 0.066 * drape(y) + 0.004, 0.009, silk, rows=8, cols=3)
        neck(body, 0.056)
        buttons(body, MAN, (0.775,), 0.012)
        coat_sleeves()

    # 4. Pulóver en V con la camisa asomando.
    shirt_base(4)
    v_open = vee(0.885, 0.062)
    body.use(Figure.CLOTH)
    garment(body, MAN, 0.44, 1.01, v_open)
    necktie(body, MAN, 0.88, srgb(0x3b2f24))
    shirt_collar(body, MAN)
    body.use(Figure.CLOTH)
    for side in (-1, 1):
        inner = lambda y, s=side: s * v_open(y)
        outer = lambda y, s=side: s * (v_open(y) + 0.003 + 0.015 * smooth(0.885, 0.92, y))
        left, right = (outer, inner) if side < 0 else (inner, outer)
        front_patch(body, MAN, 0.885, 1.0, left, right, 0.007, scale(WHITE, 0.76), rows=6, cols=1)
    neck(body, 0.057)
    coat_sleeves()

    # 5. Vestido con escote en V, collar de perlas y brazos descubiertos.
    body.use(Figure.SKIN, 5)
    torso(body, WOMAN, torso_shade)
    body.use(Figure.CLOTH)
    garment(body, WOMAN, 0.44, 1.0, vee(0.9, 0.074))
    body.use(Figure.ACCENT)
    front_patch(body, WOMAN, 0.752, 0.776, lambda y: -0.135, lambda y: 0.135, 0.007, rows=2, cols=10)
    neck(body, 0.047)
    body.use(Figure.FIXED)
    for step in range(13):
        t = step / 12 * 2 - 1
        y = 1.012 - 0.052 * (1 - t * t)
        p = front(WOMAN, t * 0.066, y, 0.008)
        body.ellipsoid(p, (0.0072,) * 3, PEARL, segments=7, rings=5)
    for side in (-1, 1):
        body.use(Figure.SKIN)
        arm(body, side, table_scale=0.84, shrink=0.86)
        path = arm_path(side, 0.84)
        body.use(Figure.CLOTH)
        root = (path[0][0] - side * 0.05, path[0][1] + 0.022, path[0][2])
        body.sweep([root, *path[:2]], [0.046, 0.056, 0.052], segments=16, smooth_steps=3)

    # 6. Mozo: chaleco, moño y ligas en las mangas.
    shirt_base(6)
    body.use(Figure.CLOTH)
    garment(body, MAN, 0.44, 0.985, vee(0.83, 0.1), armhole)
    bow_tie(body, MAN)
    shirt_collar(body, MAN)
    neck(body, 0.057)
    buttons(body, MAN, (0.815, 0.775), 0.0, srgb(0xc9a557))
    shirt_sleeves()
    body.use(Figure.ACCENT)
    for side in (-1, 1):
        path = arm_path(side)
        a, b = path[1], path[2]
        ring = [tuple(lerp(a[k], b[k], t) for k in range(3)) for t in (0.25, 0.45)]
        body.sweep(ring, [0.0545, 0.0535], segments=12, smooth_steps=1)
    return body


for item in list(bpy.data.objects):
    bpy.data.objects.remove(item)

build_room().finish()
build_table().finish()
build_chair().finish()
build_body().finish()
build_head().finish()
build_face().finish()
bpy.context.view_layer.update()

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format="GLB",
    export_materials="NONE",
    export_normals=False,
    export_vertex_color="ACTIVE",
    export_texcoords=True,
    export_apply=True,
)
