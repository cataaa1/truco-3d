# Objetos completos del boliche, modelados con detalle y bordes redondeados.
# Cada función arma un objeto en una colección propia, con el origen en el punto de apoyo
# y en coordenadas de Blender: z arriba, el frente mirando a -y.
# Se usa desde boliche.py y también se puede correr suelto en Blender para mirarlo.
import math

import bmesh
import bpy
from mathutils import Euler, Matrix

WHITE = (0.92, 0.92, 0.9)
CELESTE = (0.18, 0.43, 0.74)
BLACK = (0.012, 0.012, 0.014)
GOLD = (0.8, 0.52, 0.12)
LOCAL = "local"


def material(name, color, roughness=0.6, metallic=0.0, stripes=None, cloth=False, bands=()):
    """Material simple. stripes = (período, ancho, color): bandas verticales según x del objeto.
    bands = [(altura, alto, color), ...]: franjas horizontales, como las de una etiqueta."""
    found = bpy.data.materials.get(name)
    if found:
        return found
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    # La posición propia de cada pieza: sigue igual aunque el objeto se cuelgue girado en el salón.
    local = nodes.new("ShaderNodeAttribute")
    local.attribute_name = LOCAL
    if stripes:
        period, width, other = stripes
        split = nodes.new("ShaderNodeSeparateXYZ")
        links.new(local.outputs["Vector"], split.inputs[0])
        # Distancia al centro de la banda más cercana; con un borde apenas suave.
        shift = nodes.new("ShaderNodeMath")
        shift.operation = "ADD"
        shift.inputs[1].default_value = period / 2
        links.new(split.outputs["X"], shift.inputs[0])
        wrap = nodes.new("ShaderNodeMath")
        wrap.operation = "PINGPONG"
        wrap.inputs[1].default_value = period / 2
        links.new(shift.outputs[0], wrap.inputs[0])
        band = nodes.new("ShaderNodeMapRange")
        band.inputs["From Min"].default_value = width / 2 - 0.0015
        band.inputs["From Max"].default_value = width / 2 + 0.0015
        links.new(wrap.outputs[0], band.inputs["Value"])
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs[6].default_value = (*other, 1)
        mix.inputs[7].default_value = (*color, 1)
        links.new(band.outputs["Result"], mix.inputs["Factor"])
        links.new(mix.outputs[2], shader.inputs["Base Color"])
    if bands:
        split = nodes.new("ShaderNodeSeparateXYZ")
        links.new(local.outputs["Vector"], split.inputs[0])
        color_out = None
        for center, height, band_color in bands:
            distance = nodes.new("ShaderNodeMath")
            distance.operation = "SUBTRACT"
            distance.inputs[1].default_value = center
            links.new(split.outputs["Z"], distance.inputs[0])
            absolute = nodes.new("ShaderNodeMath")
            absolute.operation = "ABSOLUTE"
            links.new(distance.outputs[0], absolute.inputs[0])
            edge = nodes.new("ShaderNodeMapRange")
            edge.inputs["From Min"].default_value = height / 2 - 0.0006
            edge.inputs["From Max"].default_value = height / 2 + 0.0006
            links.new(absolute.outputs[0], edge.inputs["Value"])
            mix = nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.inputs[6].default_value = (*band_color, 1)
            if color_out is None:
                mix.inputs[7].default_value = (*color, 1)
            else:
                links.new(color_out, mix.inputs[7])
            links.new(edge.outputs["Result"], mix.inputs["Factor"])
            color_out = mix.outputs[2]
        links.new(color_out, shader.inputs["Base Color"])
    if cloth:
        # Pliegues suaves y trama de tela: se notan al hornear la luz.
        folds = nodes.new("ShaderNodeTexNoise")
        folds.inputs["Scale"].default_value = 9
        folds.inputs["Detail"].default_value = 1
        weave = nodes.new("ShaderNodeTexNoise")
        weave.inputs["Scale"].default_value = 900
        links.new(local.outputs["Vector"], folds.inputs["Vector"])
        links.new(local.outputs["Vector"], weave.inputs["Vector"])
        big = nodes.new("ShaderNodeBump")
        big.inputs["Strength"].default_value = 0.35
        big.inputs["Distance"].default_value = 0.004
        links.new(folds.outputs["Fac"], big.inputs["Height"])
        small = nodes.new("ShaderNodeBump")
        small.inputs["Strength"].default_value = 0.1
        links.new(weave.outputs["Fac"], small.inputs["Height"])
        links.new(big.outputs["Normal"], small.inputs["Normal"])
        links.new(small.outputs["Normal"], shader.inputs["Normal"])
    return mat


def link(obj, collection):
    collection.objects.link(obj)
    if obj.type == "MESH":
        attribute = obj.data.attributes.new(LOCAL, "FLOAT_VECTOR", "POINT")
        attribute.data.foreach_set("vector", [c for v in obj.data.vertices for c in v.co])
    return obj


def drop_hidden_faces(collection):
    """Saca lo que queda apoyado contra la pared: nadie lo ve y ocuparía lugar en la textura."""
    for obj in collection.objects:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.normal_update()
        hidden = [f for f in bm.faces if f.normal.y > 0.7]
        bmesh.ops.delete(bm, geom=hidden, context="FACES")
        bm.to_mesh(obj.data)
        bm.free()


def rounded_box(name, size, center, radius, mat, collection, segments=3):
    """Caja con todas las aristas redondeadas."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = (v.co.x * size[0] + center[0], v.co.y * size[1] + center[1], v.co.z * size[2] + center[2])
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=radius, segments=segments, affect="EDGES", profile=0.5)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh), collection)
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def frame_ring(name, outer, inner, y0, y1, z_center, radius, mat, collection, segments=3):
    """Marco rectangular hueco (outer e inner son (ancho, alto)), con los cantos redondeados."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for y in (y0, y1):
        for w, h in (outer, inner):
            rings.append([bm.verts.new((sx * w / 2, y, z_center + sz * h / 2)) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    front_out, front_in, back_out, back_in = rings
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((front_out[i], front_out[j], front_in[j], front_in[i]))
        bm.faces.new((back_out[j], back_out[i], back_in[i], back_in[j]))
        bm.faces.new((front_out[j], front_out[i], back_out[i], back_out[j]))
        bm.faces.new((front_in[i], front_in[j], back_in[j], back_in[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=radius, segments=segments, affect="EDGES", profile=0.5)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh), collection)
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def flat_shape(name, points, y, thickness, bevel, mat, collection, resolution=3):
    """Pieza plana con el contorno dado en (x, z): tela, parches o vivos, con borde redondo."""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "2D"
    curve.fill_mode = "BOTH"
    curve.extrude = max(0.0, thickness / 2 - bevel)
    curve.bevel_depth = bevel
    curve.bevel_resolution = resolution
    curve.resolution_u = 6
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, (x, z) in zip(spline.points, points):
        point.co = (x, z, 0, 1)
    spline.use_cyclic_u = True
    obj = link(bpy.data.objects.new(name, curve), collection)
    # La curva vive en el plano xy: se la para frente a quien mira.
    obj.rotation_euler = (math.pi / 2, 0, 0)
    obj.location = (0, y, 0)
    obj.data.materials.append(mat)
    return to_mesh(obj)


def to_mesh(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    # La colección todavía no está en ninguna escena: la posición se aplica a mano.
    mesh.transform(Matrix.Translation(obj.location) @ Euler(obj.rotation_euler).to_matrix().to_4x4())
    collection = obj.users_collection[0]
    name = obj.name
    bpy.data.objects.remove(obj)
    new = link(bpy.data.objects.new(name, mesh), collection)
    smooth(new)
    return new


def smooth(obj, angle=40):
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(angle))


def arc(cx, cz, rx, rz, a0, a1, steps):
    return [(cx + rx * math.cos(a0 + (a1 - a0) * i / steps), cz + rz * math.sin(a0 + (a1 - a0) * i / steps)) for i in range(steps + 1)]


def band_along(points, width):
    """Contorno de una tira de ancho fijo que sigue una línea abierta."""
    left, right = [], []
    for i, (x, z) in enumerate(points):
        a = points[max(i - 1, 0)]
        b = points[min(i + 1, len(points) - 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dz) or 1
        nx, nz = -dz / length * width / 2, dx / length * width / 2
        left.append((x + nx, z + nz))
        right.append((x - nx, z - nz))
    return left + right[::-1]


def sun(name, center, y, radius, mat, collection):
    """Sol de mayo: disco con rayos rectos y ondulados alternados."""
    points = []
    rays = 16
    for i in range(rays * 2):
        angle = math.pi / 2 + math.pi * i / rays
        reach = radius * (1.0 if i % 2 == 0 else 0.62)
        if i % 4 == 2:
            reach *= 0.86
        points.append((center[0] + reach * math.cos(angle), center[1] + reach * math.sin(angle)))
    return flat_shape(name, points, y, 0.0012, 0.0004, mat, collection, resolution=1)


def number(name, text, center, height, y, mat, collection):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = text
    for path in ("C:/Windows/Fonts/impact.ttf", "C:/Windows/Fonts/arialbd.ttf"):
        try:
            curve.font = bpy.data.fonts.load(path, check_existing=True)
            break
        except RuntimeError:
            continue
    curve.size = height
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.extrude = 0.0006
    curve.bevel_depth = 0.0003
    curve.bevel_resolution = 1
    curve.resolution_u = 4
    obj = link(bpy.data.objects.new(name, curve), collection)
    obj.rotation_euler = (math.pi / 2, 0, 0)
    obj.location = (center[0], y, center[1])
    obj.data.materials.append(mat)
    return to_mesh(obj)


def cuadro_camiseta(collection_name="cuadro_camiseta"):
    """Camiseta celeste y blanca de Messi con la 10, enmarcada como en los bares. Mide 0,66 x 0,72 m."""
    collection = bpy.data.collections.new(collection_name)
    W, H, D = 0.66, 0.72, 0.07
    frame_black = material("marco_negro", (0.02, 0.02, 0.022), roughness=0.28)
    velvet = material("fondo_terciopelo", (0.01, 0.01, 0.012), roughness=0.95)
    line = material("filete_blanco", (0.8, 0.8, 0.78), roughness=0.5)
    jersey = material("camiseta_bastones", WHITE, roughness=0.8, stripes=(0.111, 0.059, CELESTE), cloth=True)
    sleeve_mat = material("camiseta_manga", WHITE, roughness=0.8, cloth=True)
    ink = material("camiseta_negro", BLACK, roughness=0.55)
    gold = material("bordado_oro", GOLD, roughness=0.35)

    # Marco y fondo: la camiseta queda adentro de una caja con profundidad y ocupa toda la ventana.
    frame_ring("marco", (W, H), (W - 0.09, H - 0.09), -D, 0.0, 0.0, 0.009, frame_black, collection)
    rounded_box("fondo", (W - 0.07, 0.012, H - 0.07), (0, -0.008, 0), 0.002, velvet, collection, segments=1)
    front = -0.016
    frame_ring("filete_exterior", (W - 0.115, H - 0.115), (W - 0.124, H - 0.124), front - 0.0015, front, 0.0, 0.0006, line, collection, segments=1)
    frame_ring("filete_camiseta", (0.52, 0.52), (0.51, 0.51), front - 0.0015, front, 0.0, 0.0006, line, collection, segments=1)

    # La camiseta se dibuja en tamaño real (el cuerpo va de -0,32 a 0,235 de alto) y se achica para entrar.
    y = front - 0.004
    k = 0.82
    middle = (0.235 - 0.32) / 2
    fit = lambda pts: [(x * k, (z - middle) * k) for x, z in pts]
    body = [(-0.185, -0.32), (0.185, -0.32), (0.19, 0.0), (0.198, 0.15), (0.17, 0.205)]
    collar = arc(0, 0.235, 0.07, 0.045, 0.0, -math.pi, 14)
    body += [(0.07, 0.235)] + collar[1:-1] + [(-0.07, 0.235), (-0.17, 0.205), (-0.198, 0.15), (-0.19, 0.0)]
    flat_shape("camiseta", fit(body), y, 0.006, 0.0026, jersey, collection)
    # Cuello negro redondo.
    neck = arc(0, 0.235, 0.075, 0.05, 0.05, -math.pi - 0.05, 18)
    flat_shape("cuello", fit(band_along(neck, 0.016)), y - 0.0035, 0.0018, 0.0008, ink, collection)

    # Mangas dobladas hacia adelante, con el puño negro.
    for side in (-1, 1):
        sleeve = [(0.155, 0.21), (0.205, 0.195), (0.29, 0.1), (0.262, 0.04), (0.24, 0.05), (0.19, 0.085), (0.188, 0.15)]
        sleeve = [(side * x, z) for x, z in sleeve]
        if side < 0:
            sleeve = sleeve[::-1]
        flat_shape(f"manga_{'izq' if side < 0 else 'der'}", fit(sleeve), y - 0.004, 0.005, 0.0022, sleeve_mat, collection)
        cuff = [(0.29, 0.1), (0.262, 0.04), (0.2525, 0.0495), (0.2805, 0.1095)]
        cuff = [(side * x, z) for x, z in cuff]
        if side < 0:
            cuff = cuff[::-1]
        flat_shape(f"puno_{'izq' if side < 0 else 'der'}", fit(cuff), y - 0.0068, 0.0012, 0.0005, ink, collection)

    # El sol bordado, separado del cuello, y la espalda con el nombre y el número.
    (sx, sz), = fit([(0.0, 0.152)])
    sun("sol", (sx, sz), y - 0.0034, 0.016 * k, gold, collection)
    (tx, tz), = fit([(0.0, 0.082)])
    number("nombre", "MESSI", (tx, tz), 0.085 * k, y - 0.0034, ink, collection)
    (nx, nz), = fit([(0.0, -0.11)])
    number("numero", "10", (nx, nz), 0.34 * k, y - 0.0034, ink, collection)
    drop_hidden_faces(collection)
    return collection


# ---- Botellas ----
# Perfiles reales, de la base al pico: (radio, altura) en metros. Se suavizan antes de girarlos.


def smooth_profile(points, steps=4):
    """Curva suave que pasa por todos los puntos (Catmull-Rom)."""
    out = []
    padded = [points[0], *points, points[-1]]
    for i in range(1, len(padded) - 2):
        p0, p1, p2, p3 = padded[i - 1], padded[i], padded[i + 1], padded[i + 2]
        for step in range(steps):
            t = step / steps
            out.append(tuple(
                0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t ** 3)
                for k in range(2)
            ))
    out.append(points[-1])
    return out


def radius_at(profile, z):
    for (r0, z0), (r1, z1) in zip(profile, profile[1:]):
        if z0 <= z <= z1 and z1 > z0:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return profile[-1][0]


def section(angle, squareness):
    """Corte de la botella: 1 es redondo; más alto, más cuadrado con las esquinas redondeadas."""
    c, s = math.cos(angle), math.sin(angle)
    e = 1 / squareness
    return (math.copysign(abs(c) ** e, c), math.copysign(abs(s) ** e, s))


def revolve(name, profile, mat, collection, segments=28, squareness=1.0, a0=0.0, a1=2 * math.pi, offset=0.0, round_from=None):
    """Gira un perfil alrededor del eje vertical. Con a0 y a1 arma solo una parte, como una etiqueta.
    round_from: altura desde la que una botella cuadrada se vuelve redonda (el hombro y el cuello)."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    full = abs(a1 - a0 - 2 * math.pi) < 1e-6
    columns = segments if full else segments + 1
    rings = []
    for r, z in profile:
        ring = []
        shape = squareness
        if round_from is not None:
            t = min(1.0, max(0.0, (z - round_from + 0.012) / 0.03))
            shape = squareness + (1.0 - squareness) * t * t * (3 - 2 * t)
        for i in range(columns):
            angle = a0 + (a1 - a0) * i / segments
            sx, sy = section(angle, shape)
            ring.append(bm.verts.new(((r + offset) * sx, (r + offset) * sy, z)))
        rings.append(ring)
    for lower, upper in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % columns
            bm.faces.new((lower[i], lower[j], upper[j], upper[i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh), collection)
    obj.data.materials.append(mat)
    smooth(obj, angle=60)
    return obj


GLASS = {
    "verde": (0.03, 0.12, 0.05),
    "verde_claro": (0.12, 0.26, 0.12),
    "ambar": (0.32, 0.12, 0.02),
    "oscuro": (0.035, 0.018, 0.01),
    "cristal": (0.55, 0.62, 0.6),
    "turquesa": (0.025, 0.2, 0.23),
}


# Hacia dónde queda el salón visto desde los estantes: ahí se pinta el reflejo del vidrio.
SHINE = (-0.35, -1.0, 0.3)


def glass_material(kind):
    """Vidrio de color con un reflejo pintado: en el juego la luz es mate y el brillo se perdería."""
    name = f"vidrio_{kind}"
    if bpy.data.materials.get(name):
        return bpy.data.materials[name]
    mat = material(name, GLASS[kind], roughness=0.12)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes["Principled BSDF"]
    geometry = nodes.new("ShaderNodeNewGeometry")
    facing = nodes.new("ShaderNodeVectorMath")
    facing.operation = "DOT_PRODUCT"
    length = math.sqrt(sum(c * c for c in SHINE))
    facing.inputs[1].default_value = tuple(c / length for c in SHINE)
    links.new(geometry.outputs["Normal"], facing.inputs[0])
    narrow = nodes.new("ShaderNodeMapRange")
    narrow.inputs["From Min"].default_value = 0.95
    narrow.inputs["From Max"].default_value = 0.995
    links.new(facing.outputs["Value"], narrow.inputs["Value"])
    strength = nodes.new("ShaderNodeMath")
    strength.operation = "MULTIPLY"
    strength.inputs[1].default_value = 0.4
    links.new(narrow.outputs["Result"], strength.inputs[0])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs[6].default_value = (*GLASS[kind], 1)
    mix.inputs[7].default_value = (0.95, 0.93, 0.88, 1)
    links.new(strength.outputs[0], mix.inputs["Factor"])
    links.new(mix.outputs[2], shader.inputs["Base Color"])
    return mat


def bottle(name, profile, glass, label, capsule, collection, squareness=1.0, label_span=(0.08, 0.2), neck_label=None, cap_length=0.052, light=False):
    """Botella completa: vidrio con fondo hundido, etiqueta apenas despegada y cápsula en el pico.
    light: versión con menos lados para los estantes del fondo, que desde la mesa se ve igual."""
    segments, label_segments = (10, 6) if light else (28, 16)
    shape = smooth_profile(profile, steps=1 if light else 4)
    widest = max(r for r, _ in profile)
    shoulder = next(z for r, z in profile[3:] if r < widest * 0.95)
    revolve(f"{name}_vidrio", shape, glass_material(glass), collection, segments=segments, squareness=squareness, round_from=shoulder)
    top = max(profile[-2][1], profile[-1][1])
    if capsule:
        # Tapa cilíndrica, apenas más ancha que el pico, con el borde de arriba redondeado.
        r = max(radius_at(shape, top - cap_length + cap_length * t / 8) for t in range(9)) + 0.0012
        cap_shape = [(r - 0.0006, top - cap_length), (r, top - cap_length + 0.0015), (r, top - 0.002), (r - 0.0015, top + 0.0008), (0.0, top + 0.0012)]
        # La tapa sigue el cuello, que siempre es redondo aunque la botella sea cuadrada.
        revolve(f"{name}_capsula", cap_shape, material(f"capsula_{name}", capsule, roughness=0.35), collection, segments=segments)
    if label:
        z0, z1 = label_span
        label_shape = [(radius_at(shape, z0 + (z1 - z0) * t / 6), z0 + (z1 - z0) * t / 6) for t in range(7)]
        span = math.radians(150)
        revolve(f"{name}_etiqueta", label_shape, label, collection, segments=label_segments, squareness=squareness, a0=-math.pi / 2 - span, a1=-math.pi / 2 + span, offset=0.0008)
    if neck_label:
        z0, z1, mat = neck_label
        neck = [(radius_at(shape, z0 + (z1 - z0) * t / 3), z0 + (z1 - z0) * t / 3) for t in range(4)]
        revolve(f"{name}_collarin", neck, mat, collection, segments=label_segments, offset=0.0006)


def paper(name, base, bands):
    return material(f"etiqueta_{name}", base, roughness=0.75, bands=bands)


WINE_RED = (0.32, 0.03, 0.04)


def botella_vino(collection_name="botella_vino", light=False):
    """Bordelesa de 75 cl: hombros marcados y cuello largo."""
    collection = bpy.data.collections.new(collection_name)
    profile = [(0.0, 0.004), (0.02, 0.0), (0.0365, 0.001), (0.0375, 0.012), (0.0375, 0.2), (0.034, 0.215), (0.022, 0.228),
               (0.0145, 0.24), (0.0135, 0.28), (0.0145, 0.292), (0.0155, 0.296), (0.0135, 0.3), (0.0, 0.3)]
    label = paper("vino", (0.78, 0.7, 0.52), [(0.142, 0.012, WINE_RED), (0.09, 0.006, GOLD), (0.19, 0.004, GOLD)])
    bottle("vino", profile, "verde", label, WINE_RED, collection, label_span=(0.07, 0.2), light=light)
    return collection


def botella_borgona(collection_name="botella_borgona", light=False):
    """Borgoña: hombros caídos, para blancos y rosados."""
    collection = bpy.data.collections.new(collection_name)
    profile = [(0.0, 0.004), (0.02, 0.0), (0.0395, 0.002), (0.04, 0.014), (0.0395, 0.15), (0.034, 0.19), (0.022, 0.222),
               (0.0145, 0.245), (0.0138, 0.282), (0.0152, 0.292), (0.0152, 0.297), (0.0132, 0.3), (0.0, 0.3)]
    label = paper("borgona", (0.84, 0.8, 0.7), [(0.1, 0.03, (0.16, 0.3, 0.2)), (0.125, 0.004, GOLD)])
    bottle("borgona", profile, "verde_claro", label, GOLD, collection, label_span=(0.06, 0.14), light=light)
    return collection


def botella_fernet(collection_name="botella_fernet", light=False):
    """La de fernet: oscura, panzona abajo, etiqueta crema y cuello rojo."""
    collection = bpy.data.collections.new(collection_name)
    profile = [(0.0, 0.004), (0.025, 0.0), (0.04, 0.002), (0.041, 0.014), (0.04, 0.175), (0.035, 0.2), (0.023, 0.222),
               (0.016, 0.24), (0.015, 0.28), (0.017, 0.287), (0.017, 0.292), (0.014, 0.295), (0.0, 0.295)]
    label = paper("fernet", (0.86, 0.8, 0.64), [(0.125, 0.01, (0.05, 0.04, 0.03)), (0.08, 0.008, WINE_RED), (0.165, 0.008, WINE_RED)])
    neck = material("collarin_fernet", WINE_RED, roughness=0.5)
    bottle("fernet", profile, "oscuro", label, WINE_RED, collection, label_span=(0.065, 0.18), neck_label=(0.243, 0.262, neck), light=light)
    return collection


def botella_gin(collection_name="botella_gin", light=False):
    """Gin: vidrio claro, cuadrada de cantos redondos, hombro corto."""
    collection = bpy.data.collections.new(collection_name)
    profile = [(0.0, 0.004), (0.02, 0.0), (0.034, 0.002), (0.035, 0.012), (0.035, 0.2), (0.031, 0.214), (0.018, 0.224),
               (0.013, 0.232), (0.013, 0.258), (0.016, 0.262), (0.016, 0.27), (0.0, 0.272)]
    blue = (0.1, 0.2, 0.4)
    label = paper("gin", (0.9, 0.9, 0.86), [(0.12, 0.02, blue), (0.095, 0.003, blue), (0.145, 0.003, blue)])
    bottle("gin", profile, "cristal", label, (0.6, 0.6, 0.62), collection, squareness=2.4, label_span=(0.07, 0.17), cap_length=0.022, light=light)
    return collection


def botella_vermu(collection_name="botella_vermu", light=False):
    """Vermú: ámbar, redonda y ancha, etiqueta grande."""
    collection = bpy.data.collections.new(collection_name)
    profile = [(0.0, 0.004), (0.025, 0.0), (0.042, 0.002), (0.043, 0.014), (0.043, 0.18), (0.038, 0.2), (0.024, 0.218),
               (0.016, 0.232), (0.0155, 0.27), (0.0175, 0.276), (0.0175, 0.282), (0.0, 0.284)]
    label = paper("vermu", (0.9, 0.85, 0.72), [(0.115, 0.03, WINE_RED), (0.115, 0.012, GOLD), (0.078, 0.004, WINE_RED), (0.152, 0.004, WINE_RED)])
    bottle("vermu", profile, "ambar", label, GOLD, collection, label_span=(0.06, 0.17), cap_length=0.035, light=light)
    return collection


def botella_whisky(collection_name="botella_whisky", light=False):
    """Whisky: cuadrada, petisa y de hombro alto."""
    collection = bpy.data.collections.new(collection_name)
    profile = [(0.0, 0.004), (0.02, 0.0), (0.037, 0.002), (0.038, 0.012), (0.038, 0.17), (0.034, 0.182), (0.02, 0.19),
               (0.015, 0.196), (0.015, 0.222), (0.018, 0.226), (0.018, 0.236), (0.0, 0.238)]
    label = paper("whisky", (0.92, 0.88, 0.78), [(0.1, 0.014, (0.06, 0.06, 0.06)), (0.06, 0.006, GOLD), (0.14, 0.006, GOLD)])
    bottle("whisky", profile, "ambar", label, (0.06, 0.06, 0.06), collection, squareness=3.2, label_span=(0.04, 0.16), cap_length=0.024, light=light)
    return collection


def botella_licor(collection_name="botella_licor", light=False):
    """Licor de color, angosta y alta: la fila turquesa de la barra."""
    collection = bpy.data.collections.new(collection_name)
    profile = [(0.0, 0.004), (0.018, 0.0), (0.03, 0.002), (0.031, 0.012), (0.031, 0.21), (0.026, 0.228), (0.015, 0.25),
               (0.0115, 0.27), (0.0115, 0.3), (0.0135, 0.305), (0.0135, 0.312), (0.0, 0.314)]
    bottle("licor", profile, "turquesa", None, (0.75, 0.72, 0.65), collection, cap_length=0.03, light=light)
    return collection


BOTTLES = ["botella_vino", "botella_borgona", "botella_fernet", "botella_gin", "botella_vermu", "botella_whisky", "botella_licor"]

BUILDERS = {
    "cuadro_camiseta": cuadro_camiseta,
    "botella_vino": botella_vino,
    "botella_borgona": botella_borgona,
    "botella_fernet": botella_fernet,
    "botella_gin": botella_gin,
    "botella_vermu": botella_vermu,
    "botella_whisky": botella_whisky,
    "botella_licor": botella_licor,
}
# Materiales con dibujo fino: reciben más resolución en la textura horneada.
DETAILED = {"camiseta_bastones", "camiseta_manga", "camiseta_negro", "bordado_oro"}


def build(name, **options):
    """Arma un objeto y devuelve su colección, sin colgarla de ninguna escena."""
    return BUILDERS[name](**options)
