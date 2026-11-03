# Arma los ocho personajes en una escena "Personajes" de Blender, uno al lado del otro, para mirarlos.
# Se usa desde el MCP de Blender: importar este módulo y llamar a mostrar().
# Los modelos salen de boliche.py, los mismos que exporta npm run models.
import importlib
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.append(str(HERE))

# Colores de muestra, del mismo estilo que los de characters.ts.
SKIN = [(0.93, 0.76, 0.62), (0.55, 0.36, 0.24), (0.92, 0.74, 0.58), (0.74, 0.5, 0.34), (0.95, 0.8, 0.68), (0.8, 0.58, 0.42), (0.88, 0.68, 0.52), (0.45, 0.29, 0.19)]
HAIR = [(0.17, 0.1, 0.06), (0.1, 0.06, 0.04), (0.3, 0.19, 0.11), (0.07, 0.05, 0.04), (0.66, 0.5, 0.29), (0.6, 0.58, 0.54), (0.24, 0.12, 0.06), (0.08, 0.05, 0.03)]
CLOTH = [(0.85, 0.63, 0.15), (0.24, 0.55, 0.37), (0.42, 0.3, 0.63), (0.88, 0.48, 0.24), (0.16, 0.65, 0.63), (0.71, 0.32, 0.48), (0.18, 0.43, 0.62), (0.79, 0.73, 0.58)]
ACCENT = (0.12, 0.16, 0.23)
SPACING = 0.72


def _material(name, color, vertex=True, roughness=0.75):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for node in [n for n in nodes if n.type not in ("OUTPUT_MATERIAL", "BSDF_PRINCIPLED")]:
        nodes.remove(node)
    shader = nodes["Principled BSDF"]
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Base Color"].default_value = (*color, 1)
    if vertex:
        paint = nodes.new("ShaderNodeVertexColor")
        paint.layer_name = "Color"
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        links.new(paint.outputs["Color"], mix.inputs[6])
        mix.inputs[7].default_value = (*color, 1)
        links.new(mix.outputs[2], shader.inputs["Base Color"])
    return mat


def _paint_face(size=512):
    """La cara en reposo, igual que en atlas.ts: ojos punto, cejas finas y sonrisa con dientes."""
    k = size / 256
    img = np.zeros((size, size, 4), dtype=np.float32)
    yy, xx = np.mgrid[0:size, 0:size] / k

    def put(mask, color, alpha=1.0):
        a = np.clip(mask, 0, 1)[..., None] * alpha
        img[..., :3] = img[..., :3] * (1 - a) + np.array(color) * a
        img[..., 3:] = np.maximum(img[..., 3:], a)

    def soft(inside, width=0.8):
        return np.clip(0.5 + inside / width, 0, 1)

    for side in (-1, 1):
        x0 = 128 + side * 40
        put(np.exp(-(((xx - (128 + side * 58)) / 20) ** 2 + ((yy - 158) / 13) ** 2)), (0.91, 0.43, 0.38), 0.12)
        eye = 1 - np.sqrt(((xx - x0) / 8.5) ** 2 + ((yy - 104) / 11) ** 2)
        put(soft(eye * 8.5), (0.07, 0.05, 0.035))
        put(soft((1 - np.hypot(xx - (x0 - 3), yy - 99.5) / 2.6) * 2.6), (1.0, 0.99, 0.97), 0.95)
        brow_y = 76 + 3 - 8 * (1 - ((xx - x0) / 15.5) ** 2)
        brow = (3 - np.abs(yy - brow_y)) * (np.abs(xx - x0) < 16)
        put(soft(brow), (0.16, 0.1, 0.06))
    top = 186 + 7 * (1 - ((xx - 128) / 40) ** 2)
    bottom = 186 + 40 * (1 - ((xx - 128) / 40) ** 2) / 2
    mouth = np.minimum(yy - top, bottom - yy) * (np.abs(xx - 128) < 40)
    put(soft(mouth), (0.35, 0.1, 0.08))
    teeth = np.minimum(yy - top, 199 - yy) * (np.abs(xx - 128) < 40) * (mouth > 0)
    put(soft(teeth), (0.98, 0.97, 0.94))
    image = bpy.data.images.get("cara_reposo") or bpy.data.images.new("cara_reposo", size, size, alpha=True)
    image.pixels.foreach_set(img.reshape(-1))
    image.pack()
    return image


def _face_material():
    mat = bpy.data.materials.get("cara_dibujo") or bpy.data.materials.new("cara_dibujo")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes["Principled BSDF"]
    texture = nodes.get("dibujo") or nodes.new("ShaderNodeTexImage")
    texture.name = "dibujo"
    texture.image = _paint_face()
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
    shader.inputs["Roughness"].default_value = 0.8
    mat.surface_render_method = "BLENDED"
    return mat


def _decode(loop_uv):
    return round(loop_uv[0] * 8), round((1 - loop_uv[1]) * 8)


def _figure(source, variant, index, colors):
    """Copia de la malla con solo las piezas de esa variante, pintada con sus colores."""
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = obj.data.name = f"{source.name}_{variant}"
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.active
    drop, kinds = [], {}
    for face in bm.faces:
        kind, which = _decode(face.loops[0][uv].uv)
        if which not in (0, variant):
            drop.append(face)
        kinds[face] = kind
    keep = {f: kinds[f] for f in bm.faces if f not in drop}
    for face, kind in keep.items():
        face.material_index = min(kind, 4)
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    # En el juego las normales se promedian al cargar; acá se unen los puntos para verlo igual de suave.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00002)
    # Los materiales van antes de volcar la malla: si no, Blender recorta los índices a cero.
    obj.data.materials.clear()
    skin, hair, cloth = colors
    for name, color in (("fijo", (1, 1, 1)), ("piel", skin), ("pelo", hair), ("ropa", cloth), ("accesorio", ACCENT)):
        obj.data.materials.append(_material(f"{name}_{variant}", color, roughness=0.55 if name == "pelo" else 0.75))
    bm.to_mesh(obj.data)
    bm.free()
    obj.location.x = (index - 3.5) * SPACING
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def mostrar(scene_name="Personajes"):
    import boliche

    importlib.reload(boliche)
    scene = bpy.data.scenes.get(scene_name) or bpy.data.scenes.new(scene_name)
    bpy.context.window.scene = scene
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj)
    body = boliche.build_body().finish()
    head = boliche.build_head().finish()
    face = boliche.build_face().finish()
    face_mat = _face_material()
    for index, variant in enumerate(range(1, 9)):
        colors = (SKIN[index], HAIR[index], CLOTH[index])
        for source in (body, head):
            scene.collection.objects.link(_figure(source, variant, index, colors))
        copy = face.copy()
        copy.data = face.data.copy()
        copy.data.materials.clear()
        copy.data.materials.append(face_mat)
        copy.location.x = (index - 3.5) * SPACING
        for polygon in copy.data.polygons:
            polygon.use_smooth = True
        scene.collection.objects.link(copy)
    for obj in (body, head, face):
        bpy.data.objects.remove(obj)
    # Las copias quedaron en la colección de la escena; la cabeza va a la altura de los ojos.
    for obj in scene.objects:
        if obj.name.startswith(("cabeza", "cara")):
            obj.location.z = 1.22
    _stage(scene)
    return scene


def _stage(scene):
    from mathutils import Vector

    cam = bpy.data.objects.get("camara_personajes") or bpy.data.objects.new("camara_personajes", bpy.data.cameras.new("camara_personajes"))
    if cam.name not in scene.objects:
        scene.collection.objects.link(cam)
    cam.data.lens = 50
    scene.camera = cam
    for name, loc, power in (("luz_p1", (1.2, -2.2, 2.2), 70), ("luz_p2", (-2.2, -1.5, 1.4), 25), ("luz_p3", (0.0, 1.6, 2.0), 35)):
        light = bpy.data.objects.get(name) or bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
        if light.name not in scene.objects:
            scene.collection.objects.link(light)
        light.data.energy = power
        light.data.size = 1.5
        light.data.color = (1.0, 0.92, 0.84)
        light.location = loc
        light.rotation_euler = (Vector((0, 0, 1.1)) - light.location).to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.get("mundo_personajes") or bpy.data.worlds.new("mundo_personajes")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.2, 0.17, 0.15, 1)
    scene.world = world
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x, scene.render.resolution_y = 1600, 620


def encuadre(scene, x=0.0, distance=5.6, height=1.05, look=1.0, lens=50):
    """Pone la cámara de la escena frente a un punto."""
    from mathutils import Vector

    cam = scene.camera
    cam.data.lens = lens
    cam.location = (x, -distance, height)
    cam.rotation_euler = (Vector((x, 0, look)) - cam.location).to_track_quat("-Z", "Y").to_euler()
