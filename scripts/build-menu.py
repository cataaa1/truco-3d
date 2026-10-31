# Recorta y comprime las imágenes de design/menu para el inicio.
# Uso: python scripts/build-menu.py  (necesita opencv-python-headless y numpy)
import cv2
import numpy as np
from pathlib import Path

SOURCE = Path("design/menu")
OUT = Path("src/client/assets")
QUALITY = 76

# (origen, destino, anchos a generar). Los anchos dobles son para pantallas de alta densidad.
CUTOUTS = [
    ("cartel.png", "menu-logo", {"": 1200, "-2x": 2172}),
    ("panel-azul.png", "menu-azul", {"": 500, "-2x": 1000}),
    ("panel-crema.png", "menu-crema", {"": 740, "-2x": 1400}),
    ("boton-rojo.png", "menu-boton", {"": 548}),
    ("campo.png", "menu-campo", {"": 744}),
    ("icono-grupo.png", "menu-icono-grupo", {"": 300}),
    ("icono-cartas.png", "menu-icono-cartas", {"": 300}),
    ("icono-mundo.png", "menu-icono-mundo", {"": 300}),
]


def read(path):
    return cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)


def from_edges(background):
    """Fondo real: lo conectado con el borde. Evita perforar colores parecidos del interior."""
    height, width = background.shape
    flood = background.astype(np.uint8) * 255
    mask = np.zeros((height + 2, width + 2), np.uint8)
    points = [(x, y) for x in range(0, width, 4) for y in (0, height - 1)]
    points += [(x, y) for y in range(0, height, 4) for x in (0, width - 1)]
    for x, y in points:
        if flood[y, x] == 255:
            cv2.floodFill(flood, mask, (x, y), 128)
    return (flood != 128).astype(np.uint8) * 255


def cut(image, light_background):
    b, g, r = [image[:, :, channel].astype(np.int16) for channel in range(3)]
    if light_background:
        background = (b > 232) & (g > 232) & (r > 232)
    else:
        background = (r > 135) & (b > 135) & (g < 115) & (r - g > 60) & (b - g > 60)
    solid = from_edges(background)
    solid = cv2.morphologyEx(solid, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(solid)
    solid = np.where(labels == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])), 255, 0).astype(np.uint8)
    inner = cv2.erode(solid, np.ones((3, 3), np.uint8), iterations=2)
    # El borde arrastra tinte del fondo: se repinta con el color del interior antes de recortar.
    band = cv2.subtract(cv2.dilate(solid, np.ones((5, 5), np.uint8)), cv2.erode(inner, np.ones((3, 3), np.uint8)))
    colors = cv2.inpaint(image, band, 3, cv2.INPAINT_TELEA)
    alpha = cv2.GaussianBlur(inner, (3, 3), 0)
    ys, xs = np.where(alpha > 8)
    return np.dstack((colors, alpha))[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def save(image, name, quality=QUALITY):
    ok, data = cv2.imencode(".webp", image, [cv2.IMWRITE_WEBP_QUALITY, quality])
    assert ok
    data.tofile(OUT / f"{name}.webp")
    print(f"{name}: {image.shape[1]}x{image.shape[0]}, {len(data) // 1024} KB")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for source, name, widths in CUTOUTS:
        rgba = cut(read(SOURCE / source), source == "cartel.png")
        for suffix, width in widths.items():
            width = min(width, rgba.shape[1])
            height = round(rgba.shape[0] * width / rgba.shape[1])
            resized = cv2.resize(rgba, (width, height), interpolation=cv2.INTER_AREA)
            save(resized, name + suffix)
    wood = read(SOURCE / "madera.png")
    save(cv2.resize(wood, (1600, 1067), interpolation=cv2.INTER_CUBIC), "menu-madera", 52)


main()
