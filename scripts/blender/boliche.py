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
    ((-2.1, 2.75, -2.1), (1.0, 0.68, 0.36), 2.6),
    ((2.1, 2.75, -2.1), (1.0, 0.68, 0.36), 2.6),
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

    # Estantería de la barra: el fondo de la escena.
    shelf_z = Z_MIN + 0.32
    room.box((0, 0.5, Z_MIN + 0.2), (6.6, 1.0, 0.38), region="wood_dark", tint=WOOD_RED)
    bay_count = 6
    bay_width = 6.3 / bay_count
    room.patch((-3.2, 1.0, Z_MIN + 0.03), (6.4, 0, 0), (0, 1.55, 0), 6, 2, "mirror", repeat=(2, 1), tint=(0.55, 0.5, 0.42), normal=(0, 0, 1))
    for level in (1.02, 1.5, 2.0):
        room.box((0, level, shelf_z - 0.08), (6.4, 0.04, 0.34), region="wood_dark", tint=WOOD_RED)
        for bay in range(bay_count * 5):
            x = -3.05 + (bay + random.random() * 0.3) * (6.1 / (bay_count * 5))
            if random.random() < 0.9:
                bottle(room, x, level + 0.02, shelf_z - 0.1)
    for i in range(bay_count + 1):
        x = -3.15 + i * bay_width
        room.box((x, 1.8, shelf_z + 0.06), (0.1, 1.6, 0.14), region="wood_dark", tint=WOOD_BLACK)
    room.box((0, 2.58, shelf_z + 0.06), (6.5, 0.12, 0.2), region="wood", tint=WOOD_RED)

    # Vitrales a los costados, cartel fileteado en el centro y remate tallado.
    front = shelf_z + 0.17
    for x0, x1 in ((-3.25, -1.2), (1.2, 3.25)):
        room.quad((x0, 2.64, front), (x1, 2.64, front), (x1, 3.18, front), (x0, 3.18, front), region="stained", tint=(1.25, 1.25, 1.1), glow=True)
        room.box(((x0 + x1) / 2, 3.2, front - 0.04), (x1 - x0 + 0.1, 0.07, 0.12), region="wood", tint=WOOD_RED)
    room.quad((-1.12, 2.56, front + 0.03), (1.12, 2.56, front + 0.03), (1.12, 3.4, front + 0.03), (-1.12, 3.4, front + 0.03), region="sign_main", glow=True, tint=(0.92, 0.9, 0.82))
    room.box((0, 2.98, front - 0.02), (2.36, 0.96, 0.05), region="wood_dark", tint=WOOD_BLACK)

    # Mostrador con frente en paneles y tapa gastada.
    counter_z = -2.55
    room.box((0, 1.04, counter_z), (6.2, 0.05, 0.72), region="wood", tint=(1.1, 1.0, 0.92))
    room.box((0, 0.5, counter_z), (6.0, 1.0, 0.58), region="wood_dark", tint=WOOD_RED)
    for i in range(9):
        x = -2.68 + i * 0.67
        room.quad((x - 0.27, 0.16, counter_z + 0.296), (x + 0.27, 0.16, counter_z + 0.296), (x + 0.27, 0.86, counter_z + 0.296), (x - 0.27, 0.86, counter_z + 0.296), region="wood", tint=WOOD_BLACK)
    room.box((0, 0.08, counter_z + 0.34), (6.0, 0.03, 0.03), tint=BRASS)

    # Sobre el mostrador: sifones, cafetera, panera con campana y botellas.
    for i, color in enumerate((srgb(0xc8352a), srgb(0x2a7ac0), srgb(0xc8352a), srgb(0x3f8a5a))):
        siphon(room, 1.55 + i * 0.17, 1.065, counter_z + 0.1 - (i % 2) * 0.1, color)
    room.lathe((-1.7, 1.065, counter_z), [(0.16, 0), (0.16, 0.08), (0.11, 0.1), (0.11, 0.46), (0.08, 0.5), (0.03, 0.56), (0, 0.56)], segments=10, tint=srgb(0xb9b5a4))
    for side in (-1, 1):
        room.box((-1.7 + side * 0.15, 1.3, counter_z), (0.06, 0.03, 0.03), tint=BRASS)
    room.lathe((0.5, 1.065, counter_z), [(0.2, 0), (0.2, 0.02), (0.17, 0.05), (0.17, 0.2), (0.1, 0.28), (0.02, 0.3), (0, 0.3)], segments=10, tint=srgb(0xdedad0))
    room.lathe((0.5, 1.09, counter_z), [(0.1, 0), (0.12, 0.04), (0.1, 0.09), (0, 0.1)], segments=8, tint=srgb(0xb88a4c))
    for x in (-0.6, -0.42, 2.55):
        bottle(room, x, 1.065, counter_z - 0.05, 0.32)

    # Banquetas de barra.
    for x in (-2.4, -1.25, 1.1, 2.3):
        room.lathe((x, 0, counter_z + 0.72), [(0.17, 0), (0.17, 0.02), (0.035, 0.05), (0.035, 0.66), (0.17, 0.68), (0.18, 0.74), (0, 0.76)], segments=8, region="wood_dark", tint=WOOD_RED)

    # Mesitas con sillas contra las paredes.
    for x, z, chairs in ((-2.75, 1.6, (1.5, -1.5)), (2.75, 2.6, (0.2, 3.2)), (-2.8, -0.4, (0.1,))):
        room.lathe((x, 0, z), [(0.26, 0), (0.08, 0.05), (0.04, 0.1), (0.04, 0.68), (0.4, 0.7), (0.42, 0.74), (0, 0.75)], segments=10, region="wood_dark", tint=WOOD_RED)
        for angle in chairs:
            thonet(room, x + math.sin(angle) * 0.62, z + math.cos(angle) * 0.62, angle + math.pi)
        room.lathe((x + 0.1, 0.75, z), [(0.03, 0), (0.03, 0.2), (0.012, 0.28), (0, 0.28)], segments=6, tint=random.choice(GLASS_COLORS))

    # Lámparas: la de la mesa, las de la barra y un globo.
    room.box((0, 3.2, 0), (0.015, 0.8, 0.015), tint=WOOD_BLACK)
    room.lathe((0, 2.55, 0), [(0.28, 0), (0.26, 0.04), (0.13, 0.22), (0.05, 0.28), (0, 0.29)], segments=14, tint=srgb(0x2f6b4e))
    room.lathe((0, 2.55, 0), [(0, 0.0), (0.26, 0.0)], segments=14, tint=srgb(0xffe3a8), glow=True)
    for x in (-2.1, 2.1):
        room.box((x, 3.2, -2.1), (0.015, 0.8, 0.015), tint=WOOD_BLACK)
        room.lathe((x, 2.56, -2.1), [(0.26, 0), (0.2, 0.06), (0.06, 0.24), (0, 0.26)], segments=10, tint=srgb(0xd4a85a), glow=True)
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
