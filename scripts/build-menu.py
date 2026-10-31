# Recorta el cartel y los paneles de design/menu/inicio.webp, con fondo transparente.
# Uso: python scripts/build-menu.py  (necesita opencv-python-headless y numpy)
import cv2
import numpy as np
from pathlib import Path

SOURCE = Path("design/menu/inicio.webp")
OUT = Path("src/client/assets")

# (nombre, izquierda, arriba, derecha, abajo, eje de simetría x, simétrica también en vertical)
# en píxeles de la imagen original. Las piezas son simétricas: cada lado completa al otro
# donde el borde se confunde con el fondo, como el cartel contra la pared clara.
LAYERS = [
    ("menu-logo", 398, 8, 1284, 410, 840, False),
    ("menu-entrar", 178, 426, 580, 804, 379, True),
    ("menu-crear", 588, 424, 1100, 806, 844, True),
    ("menu-salas", 1110, 426, 1488, 804, 1299, True),
]
MARGIN = 6


def symmetric(mask, axis, vertical):
    height, width = mask.shape
    flipped = np.zeros_like(mask)
    xs = np.arange(width)
    mirror = 2 * axis - xs
    valid = (mirror >= 0) & (mirror < width)
    flipped[:, xs[valid]] = mask[:, mirror[valid]]
    result = cv2.bitwise_or(mask, flipped)
    if vertical:
        ys, _ = np.where(result > 0)
        center = (ys.min() + ys.max()) // 2
        rows = np.arange(height)
        mirrored = 2 * center - rows
        valid_rows = (mirrored >= 0) & (mirrored < height)
        down = np.zeros_like(result)
        down[rows[valid_rows], :] = result[mirrored[valid_rows], :]
        # La mitad de abajo tiene el borde más fiel: se recorta al cruce para no sumar fondo.
        result = cv2.bitwise_and(result, down)
    return result


def cut(image, left, top, right, bottom, axis, vertical):
    x0, y0 = max(0, left - 30), max(0, top - 30)
    x1, y1 = min(image.shape[1], right + 30), min(image.shape[0], bottom + 30)
    crop = image[y0:y1, x0:x1]
    mask = np.full(crop.shape[:2], cv2.GC_BGD, np.uint8)
    # Todo lo que está dentro del recuadro es "probablemente" el cartel; el centro, seguro.
    mask[top - y0 : bottom - y0, left - x0 : right - x0] = cv2.GC_PR_FGD
    h, w = bottom - top, right - left
    mask[top - y0 + h // 6 : bottom - y0 - h // 6, left - x0 + w // 6 : right - x0 - w // 6] = cv2.GC_FGD
    back, fore = np.zeros((1, 65)), np.zeros((1, 65))
    cv2.grabCut(crop, mask, None, back, fore, 8, cv2.GC_INIT_WITH_MASK)
    solid = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

    # Se queda con la pieza principal y rellena huecos: el interior del cartel nunca es transparente.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(solid)
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    solid = np.where(labels == biggest, 255, 0).astype(np.uint8)
    contours, _ = cv2.findContours(solid, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    solid = cv2.drawContours(np.zeros_like(solid), contours, -1, 255, cv2.FILLED)
    solid = symmetric(solid, axis - x0, vertical)
    solid = cv2.morphologyEx(solid, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    solid = cv2.erode(solid, np.ones((2, 2), np.uint8))
    alpha = cv2.GaussianBlur(solid, (3, 3), 0)

    ys, xs = np.where(alpha > 8)
    bx0, bx1 = max(0, xs.min() - MARGIN), min(alpha.shape[1], xs.max() + MARGIN)
    by0, by1 = max(0, ys.min() - MARGIN), min(alpha.shape[0], ys.max() + MARGIN)
    rgba = np.dstack((crop, alpha))[by0:by1, bx0:bx1]
    return rgba, (x0 + bx0, y0 + by0, x0 + bx1, y0 + by1)


def main():
    image = cv2.imdecode(np.fromfile(SOURCE, np.uint8), cv2.IMREAD_COLOR)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, left, top, right, bottom, axis, vertical in LAYERS:
        rgba, box = cut(image, left, top, right, bottom, axis, vertical)
        ok, data = cv2.imencode(".webp", rgba, [cv2.IMWRITE_WEBP_QUALITY, 92])
        assert ok
        data.tofile(OUT / f"{name}.webp")
        print(f"{name}: caja {tuple(int(v) for v in box)}, {rgba.shape[1]}x{rgba.shape[0]}, {len(data) // 1024} KB")


main()
