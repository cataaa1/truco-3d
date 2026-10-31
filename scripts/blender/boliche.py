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
]
AMBIENT = (0.13, 0.095, 0.075)


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
    # Sombra falsa debajo de la mesa y oscurecido en los rincones del piso.
    if pos[1] < 0.1:
        shade = min(1.0, 0.45 + 0.55 * (math.hypot(pos[0], pos[2]) / 1.6) ** 2)
        total = [c * shade for c in total]
    return tuple(min(1.0, c) for c in total)


class Part:
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


def build_room():
    room = Part("boliche")
    width, depth = X_MAX - X_MIN, Z_MAX - Z_MIN
    nx, nz = int(width), int(depth)

    # Piso, techo y paredes.
    room.patch((X_MIN, 0, Z_MIN), (width, 0, 0), (0, 0, depth), nx * 2, nz * 2, "tile", repeat=(2, 2), normal=(0, 1, 0))
    room.patch((-2.05, 0.006, -2.05), (4.1, 0, 0), (0, 0, 4.1), 4, 4, "rug", repeat=(1, 1), normal=(0, 1, 0))
    ceiling = srgb(0x6e2c22)
    room.patch((X_MIN, HEIGHT, Z_MIN), (width, 0, 0), (0, 0, depth), nx, nz, "plaster", tint=ceiling, normal=(0, -1, 0))
    for z in (-2.2, -0.2, 1.8, 3.4):
        room.box((0, HEIGHT - 0.09, z), (width, 0.18, 0.16), region="wood_dark", tint=WOOD_BLACK)

    # Pared del frente: yeso arriba, atrás de la estantería.
    room.patch((X_MIN, 0, Z_MIN), (width, 0, 0), (0, HEIGHT, 0), nx, 4, "plaster", tint=srgb(0x9a7a56), normal=(0, 0, 1))

    # Pared derecha: ladrillo, espejos y cuadros, como en los boliches de San Telmo.
    room.patch((X_MAX, 0, Z_MIN), (0, 0, depth), (0, HEIGHT, 0), nz, 4, "brick", repeat=(2, 2), normal=(-1, 0, 0))
    wall = ("x", X_MAX, -1)
    frame(room, -1.9, -1.0, 1.15, 2.45, wall, "mirror")
    frame(room, -0.8, 1.25, 2.12, 2.95, wall, "sign_red", thickness=0.02)
    frame(room, -0.8, -0.1, 1.15, 1.85, wall, "portrait")
    frame(room, 0.1, 0.8, 1.15, 1.85, wall, "landscape")
    frame(room, 1.0, 1.75, 1.0, 2.0, wall, "mirror")
    frame(room, 1.95, 2.55, 1.2, 2.0, wall, "poster", thickness=0.02)
    frame(room, 2.0, 3.0, 2.25, 2.75, wall, "sign_small", thickness=0.02)
    # Reloj de pared y dos apliques de luz.
    frame(room, -3.3, -2.5, 2.25, 3.05, wall, "clock")
    for z in (-2.0, 0.95):
        room.lathe((X_MAX - 0.13, 2.05, z), [(0, 0.0), (0.09, 0.05), (0.1, 0.15), (0.05, 0.2), (0, 0.2)], segments=8, tint=srgb(0xfff0c0), glow=True)
        room.box((X_MAX - 0.07, 2.02, z), (0.13, 0.03, 0.03), tint=BRASS)

    # Pared izquierda: zócalo de madera y ventanales pintados a la calle.
    room.patch((X_MIN, 0, Z_MIN), (0, 0, depth), (0, 1.0, 0), nz, 1, "wood", tint=WOOD_RED, repeat=(1, 1), normal=(1, 0, 0))
    room.patch((X_MIN, 1.0, Z_MIN), (0, 0, depth), (0, HEIGHT - 1.0, 0), nz, 3, "plaster", tint=srgb(0xc2a67c), normal=(1, 0, 0))
    window = ("x", X_MIN, 1)
    frame(room, -2.5, -0.9, 1.05, 2.75, window, "glass_bar", thickness=0.07)
    frame(room, -0.75, 0.85, 1.05, 2.75, window, "glass_cafe", thickness=0.07)
    frame(room, 1.0, 2.6, 1.05, 2.75, window, "stained", thickness=0.07)

    # Pared de atrás: casi no se ve, se resuelve con madera y yeso.
    room.patch((X_MIN, 0, Z_MAX), (width, 0, 0), (0, HEIGHT, 0), nx, 4, "plaster", tint=srgb(0x7a5a3e), normal=(0, 0, -1))

    counter_z = build_back_bar(room)

    # Banquetas de barra.
    for x in (-2.4, -1.25, 1.1, 2.3):
        room.lathe((x, 0, counter_z + 0.72), [(0.17, 0), (0.17, 0.02), (0.035, 0.05), (0.035, 0.66), (0.17, 0.68), (0.18, 0.74), (0, 0.76)], segments=8, region="wood_dark", tint=WOOD_RED)

    # Mesitas con sillas contra las paredes.
    for x, z, chairs in ((-2.75, 1.6, (1.5, -1.5)), (2.75, 2.6, (0.2, 3.2)), (-2.8, -0.4, (0.1,))):
        room.lathe((x, 0, z), [(0.26, 0), (0.08, 0.05), (0.04, 0.1), (0.04, 0.68), (0.4, 0.7), (0.42, 0.74), (0, 0.75)], segments=10, region="wood_dark", tint=WOOD_RED)
        for angle in chairs:
            thonet(room, x + math.sin(angle) * 0.62, z + math.cos(angle) * 0.62, angle + math.pi)
        room.lathe((x + 0.1, 0.75, z), [(0.03, 0), (0.03, 0.2), (0.012, 0.28), (0, 0.28)], segments=6, tint=random.choice(GLASS_COLORS))

    # Lámparas: la de la mesa y un globo.
    room.box((0, 3.2, 0), (0.015, 0.8, 0.015), tint=WOOD_BLACK)
    room.lathe((0, 2.55, 0), [(0.28, 0), (0.26, 0.04), (0.13, 0.22), (0.05, 0.28), (0, 0.29)], segments=14, tint=srgb(0x2f6b4e))
    room.lathe((0, 2.55, 0), [(0, 0.0), (0.26, 0.0)], segments=14, tint=srgb(0xffe3a8), glow=True)
    room.box((0, 3.4, 2.8), (0.015, 0.4, 0.015), tint=WOOD_BLACK)
    room.lathe((0, 2.92, 2.8), [(0, 0), (0.16, 0.04), (0.22, 0.18), (0.16, 0.32), (0, 0.36)], segments=10, tint=srgb(0xfff0c8), glow=True)

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
    segments = 40
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
    x = tipo de color (0 fijo, 1 piel, 2 pelo o sombrero, 3 ropa del equipo)
    y = variante de cabeza (0 siempre visible, 1 a 6 según el personaje)."""

    FIXED, SKIN, HAIR, CLOTH = 0, 1, 2, 3

    def __init__(self, name):
        super().__init__(name, baked=False)
        self.kind = self.FIXED
        self.variant = 0

    def face(self, corners, region, uvs, tint=WHITE, normal=None, glow=False):
        verts = [self.bm.verts.new((c[0], -c[2], c[1])) for c in corners]
        bm_face = self.bm.faces.new(verts)
        for loop in bm_face.loops:
            loop[self.uv].uv = (self.kind / 4, 1 - self.variant / 8)
            loop[self.color] = (tint[0], tint[1], tint[2], 1.0)
        return bm_face

    def use(self, kind, variant=None):
        self.kind = kind
        if variant is not None:
            self.variant = variant

    def ellipsoid(self, center, radii, keep=None, tint=WHITE, segments=14, rings=10):
        def point(i, j):
            lat = math.pi * (j / rings - 0.5)
            lon = 2 * math.pi * i / segments
            return (
                center[0] + radii[0] * math.cos(lat) * math.sin(lon),
                center[1] + radii[1] * math.sin(lat),
                center[2] + radii[2] * math.cos(lat) * math.cos(lon),
            )

        for j in range(rings):
            for i in range(segments):
                corners = [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)]
                if keep and not keep(*[sum(c[k] for c in corners) / 4 for k in range(3)]):
                    continue
                if j == 0:
                    self.face((corners[0], corners[3], corners[2]), "white", (), tint)
                elif j == rings - 1:
                    self.face((corners[0], corners[1], corners[2]), "white", (), tint)
                else:
                    self.face(corners, "white", (), tint)

    def tube(self, sections, tint=WHITE, segments=10):
        """Une elipses (rx, rz, y, cz) de abajo hacia arriba."""
        for index in range(len(sections) - 1):
            a, b = sections[index], sections[index + 1]
            for i in range(segments):
                t0, t1 = 2 * math.pi * i / segments, 2 * math.pi * (i + 1) / segments
                self.face(
                    (
                        (a[0] * math.sin(t0), a[2], a[3] + a[1] * math.cos(t0)),
                        (a[0] * math.sin(t1), a[2], a[3] + a[1] * math.cos(t1)),
                        (b[0] * math.sin(t1), b[2], b[3] + b[1] * math.cos(t1)),
                        (b[0] * math.sin(t0), b[2], b[3] + b[1] * math.cos(t0)),
                    ),
                    "white",
                    (),
                    tint,
                )

    def limb(self, a, b, r0, r1, tint=WHITE, segments=6):
        axis = normalize(sub(b, a))
        helper_axis = (0.0, 1.0, 0.0) if abs(axis[1]) < 0.9 else (1.0, 0.0, 0.0)
        u = normalize(cross(axis, helper_axis))
        v = cross(axis, u)

        def ring(center, radius, t):
            return tuple(center[k] + radius * (math.cos(t) * u[k] + math.sin(t) * v[k]) for k in range(3))

        for i in range(segments):
            t0, t1 = 2 * math.pi * i / segments, 2 * math.pi * (i + 1) / segments
            self.face((ring(a, r0, t0), ring(a, r0, t1), ring(b, r1, t1), ring(b, r1, t0)), "white", (), tint)


SHIRT = srgb(0xcfc5b0)
PANTS = srgb(0x2c2622)
SHOE = srgb(0x1a120c)
TIE = srgb(0x6e1f1a)
HEAD_RADII = (0.165, 0.175, 0.165)


def build_body():
    body = Figure("cuerpo")
    # Piernas sentadas: casi no se ven, pero evitan que parezca un busto flotando.
    body.use(Figure.FIXED)
    for side in (-1, 1):
        body.limb((side * 0.09, 0.5, -0.02), (side * 0.1, 0.5, 0.36), 0.075, 0.06, PANTS)
        body.limb((side * 0.1, 0.5, 0.36), (side * 0.1, 0.08, 0.36), 0.058, 0.045, PANTS)
        body.box((side * 0.1, 0.04, 0.41), (0.09, 0.07, 0.2), tint=SHOE)

    # Chaleco del color del equipo, con la camisa a la vista.
    body.use(Figure.CLOTH)
    body.tube(
        [
            (0.17, 0.12, 0.46, -0.02),
            (0.19, 0.125, 0.56, -0.02),
            (0.195, 0.125, 0.74, -0.02),
            (0.215, 0.12, 0.92, -0.02),
            (0.15, 0.09, 1.0, -0.02),
            (0.07, 0.06, 1.03, -0.02),
        ],
        tint=WHITE,
        segments=12,
    )
    body.use(Figure.FIXED)
    # Pechera y corbata sobre el chaleco, de frente.
    front = 0.108
    body.quad((-0.055, 0.68, front), (0.055, 0.68, front), (0.075, 1.0, 0.06), (-0.075, 1.0, 0.06), tint=SHIRT)
    body.quad((-0.018, 0.74, front + 0.004), (0.018, 0.74, front + 0.004), (0.022, 0.98, 0.066), (-0.022, 0.98, 0.066), tint=TIE)
    # Cuello de camisa y cuello de la persona.
    body.tube([(0.076, 0.076, 1.0, -0.01), (0.07, 0.07, 1.055, -0.01)], tint=SHIRT, segments=10)
    body.use(Figure.SKIN)
    body.tube([(0.058, 0.058, 1.05, -0.01), (0.056, 0.056, 1.12, -0.01)], segments=8)

    # Brazos con las manos delante de la cara, donde el juego pone las cartas.
    for side in (-1, 1):
        shoulder = (side * 0.215, 0.95, -0.02)
        elbow = (side * 0.28, 0.72, 0.09)
        wrist = (side * 0.12, 0.845, 0.33)
        hand = (side * 0.088, 0.862, 0.392)
        body.use(Figure.FIXED)
        body.limb(shoulder, elbow, 0.06, 0.048, SHIRT, segments=8)
        body.limb(elbow, wrist, 0.046, 0.032, SHIRT, segments=8)
        body.use(Figure.SKIN)
        body.ellipsoid(hand, (0.045, 0.036, 0.03), segments=8, rings=5)
        # Pulgar y dedos abrazando el canto de las cartas.
        body.limb((side * 0.058, 0.864, 0.378), (side * 0.03, 0.872, 0.372), 0.012, 0.01, segments=5)
        for finger in range(3):
            y = 0.85 + finger * 0.016
            body.limb((side * 0.122, y, 0.39), (side * 0.128, y + 0.004, 0.36), 0.01, 0.009, segments=4)
    return body


def build_head():
    # El centro de la cabeza es el ojo de la cámara. Adelante es +z.
    head = Figure("cabeza")
    head.use(Figure.SKIN, 0)
    head.ellipsoid((0, 0, 0), HEAD_RADII, segments=16, rings=12)
    for side in (-1, 1):
        head.ellipsoid((side * 0.165, 0.0, -0.005), (0.018, 0.04, 0.03), segments=6, rings=4)

    shell = (0.178, 0.188, 0.178)

    head.use(Figure.HAIR, 1)  # Corto, con raya.
    head.ellipsoid((0, 0.005, -0.004), shell, keep=lambda x, y, z: y > 0.1 or (z < -0.012 and y > -0.07), segments=16, rings=12)

    head.use(Figure.HAIR, 2)  # A la gomina, alto y para atrás.
    head.ellipsoid((0, 0.012, -0.012), (0.176, 0.2, 0.2), keep=lambda x, y, z: y > 0.11 or (z < -0.03 and y > -0.04), segments=16, rings=12)

    head.use(Figure.HAIR, 3)  # Sombrero de ala, el de los retratos de Gardel.
    head.lathe((0, 0, 0), [(0.285, 0.122), (0.285, 0.133), (0.175, 0.14), (0.165, 0.26), (0.115, 0.29), (0, 0.288)], segments=14)
    head.use(Figure.FIXED, 3)
    head.lathe((0, 0, 0), [(0.178, 0.14), (0.171, 0.185)], segments=14, tint=srgb(0x14100c))

    head.use(Figure.HAIR, 4)  # Boina.
    head.ellipsoid((0.015, 0.145, -0.01), (0.215, 0.07, 0.215), keep=lambda x, y, z: y > 0.112, segments=14, rings=8)
    head.limb((0.015, 0.21, -0.01), (0.015, 0.25, -0.01), 0.012, 0.008, segments=5)

    head.use(Figure.HAIR, 5)  # Melena hasta los hombros.
    head.ellipsoid((0, 0.0, -0.012), (0.186, 0.25, 0.186), keep=lambda x, y, z: y > 0.1 or (z < 0.015 and y > -0.2), segments=16, rings=12)

    head.use(Figure.HAIR, 6)  # Pelado con los costados canosos.
    head.ellipsoid((0, 0, -0.004), (0.174, 0.182, 0.174), keep=lambda x, y, z: z < 0.02 and -0.07 < y < 0.075, segments=16, rings=12)
    return head

for item in list(bpy.data.objects):
    bpy.data.objects.remove(item)

build_room().finish()
build_table().finish()
build_chair().finish()
build_body().finish()
build_head().finish()
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
