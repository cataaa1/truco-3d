// Recorta las láminas de design/cartas y arma la imagen del mazo que carga el juego.
// Correr con: npm run cards
import { mkdirSync, statSync } from 'node:fs';
import sharp from 'sharp';

const SOURCE = 'design/cartas';
const OUT = 'src/client/game/assets/cartas.webp';

// Tienen que coincidir con CARD_GRID y BACK_SLOT de atlas.ts, y con el orden de palos de cards.ts.
const COLS = 7;
const ROWS = 6;
const CELL_W = 224;
const CELL_H = 350;
const BACK_SLOT = 40;
const SUITS = ['espada', 'basto', 'oro', 'copa'];
const SHEET_RANKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // Índices de 1,2,3,4,5 / 6,7,10,11,12.
const QUALITY = 70;
const PAPER = { r: 251, g: 250, b: 245, alpha: 1 };
const RADIUS = 16;
// Margen entre el recuadro impreso y el borde de la carta, en fracción de la celda.
const MARGIN_X = 0.075;
const MARGIN_Y = 0.045;

async function loadRaw(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Busca el recuadro impreso: las líneas largas que cumplen `isLine` dentro del área dada. */
function findFrame(image, area, isLine) {
  const { data, width } = image;
  const hit = (x, y) => {
    const i = (y * width + x) * 3;
    return isLine(data[i], data[i + 1], data[i + 2]);
  };
  const columns = [];
  for (let x = area.left; x < area.right; x++) {
    let count = 0;
    for (let y = area.top; y < area.bottom; y++) if (hit(x, y)) count++;
    if (count > (area.bottom - area.top) * 0.6) columns.push(x);
  }
  const rows = [];
  for (let y = area.top; y < area.bottom; y++) {
    let count = 0;
    for (let x = area.left; x < area.right; x++) if (hit(x, y)) count++;
    if (count > (area.right - area.left) * 0.55) rows.push(y);
  }
  if (columns.length < 2 || rows.length < 2) throw new Error(`Sin recuadro en ${JSON.stringify(area)}`);
  return { left: columns[0], right: columns.at(-1), top: rows[0], bottom: rows.at(-1) };
}

/** Lleva el recuadro a una celda de tamaño uniforme, sobre papel limpio y con las esquinas redondeadas. */
async function cardCell(file, frame) {
  const innerW = Math.round(CELL_W * (1 - MARGIN_X * 2));
  const innerH = Math.round(CELL_H * (1 - MARGIN_Y * 2));
  const art = await sharp(file)
    .removeAlpha()
    .extract({ left: frame.left, top: frame.top, width: frame.right - frame.left + 1, height: frame.bottom - frame.top + 1 })
    .resize(innerW, innerH, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const mask = Buffer.from(
    `<svg width="${CELL_W}" height="${CELL_H}"><rect x="1" y="1" width="${CELL_W - 2}" height="${CELL_H - 2}" rx="${RADIUS}" ry="${RADIUS}"/></svg>`,
  );
  return sharp({ create: { width: CELL_W, height: CELL_H, channels: 4, background: PAPER } })
    .composite([
      { input: art, left: Math.round((CELL_W - innerW) / 2), top: Math.round((CELL_H - innerH) / 2) },
      { input: mask, blend: 'dest-in' },
    ])
    .png()
    .toBuffer();
}

const isInk = (r, g, b) => r < 110 && g < 110 && b < 110;
const isRed = (r, g, b) => r > 170 && g < 90 && b < 90;

const placed = [];
const place = (slot, input) =>
  placed.push({ input, left: (slot % COLS) * CELL_W, top: Math.floor(slot / COLS) * CELL_H });

for (let suit = 0; suit < SUITS.length; suit++) {
  const file = `${SOURCE}/${SUITS[suit]}.webp`;
  const image = await loadRaw(file);
  const cellW = image.width / 5;
  const cellH = image.height / 2;
  for (const position of SHEET_RANKS) {
    const col = position % 5;
    const row = Math.floor(position / 5);
    const frame = findFrame(
      image,
      {
        left: Math.round(col * cellW),
        right: Math.round((col + 1) * cellW),
        top: Math.round(row * cellH),
        bottom: Math.round((row + 1) * cellH),
      },
      isInk,
    );
    const ratio = (frame.right - frame.left) / (frame.bottom - frame.top);
    if (ratio < 0.5 || ratio > 0.65) throw new Error(`Recuadro raro en ${file}, carta ${position}: ${JSON.stringify(frame)}`);
    place(suit * 10 + position, await cardCell(file, frame));
  }
}

const backFile = `${SOURCE}/dorso.webp`;
const back = await loadRaw(backFile);
const backFrame = findFrame(back, { left: 0, right: back.width, top: 0, bottom: back.height }, isRed);
place(BACK_SLOT, await cardCell(backFile, backFrame));

mkdirSync('src/client/game/assets', { recursive: true });
await sharp({
  create: { width: COLS * CELL_W, height: ROWS * CELL_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite(placed)
  .webp({ quality: QUALITY, alphaQuality: 60, effort: 6 })
  .toFile(OUT);

console.log(`${OUT}: ${placed.length} cartas, ${(statSync(OUT).size / 1024).toFixed(0)} KB`);
