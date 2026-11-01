import { cardRank, cardSuit, SUITS, type CardId, type Suit } from '../../engine/cards';
import { SENAS, type SenaId } from '../../shared/protocol';

export const CARD_GRID = { cols: 7, rows: 6 } as const;
export const BACK_SLOT = 40;
const CARD_W = 256;
const CARD_H = 400;

const INK: Record<Suit, string> = { espada: '#2b5c8a', basto: '#3f7a3a', oro: '#c8901a', copa: '#b5322c' };

function drawSuit(ctx: CanvasRenderingContext2D, suit: Suit, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.fillStyle = INK[suit];
  ctx.beginPath();
  switch (suit) {
    case 'oro':
      ctx.arc(0, 0, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f4d67a';
      ctx.beginPath();
      ctx.arc(0, 0, 0.28, 0, Math.PI * 2);
      break;
    case 'copa':
      ctx.moveTo(-0.42, -0.5);
      ctx.lineTo(0.42, -0.5);
      ctx.quadraticCurveTo(0.42, 0.1, 0.1, 0.14);
      ctx.lineTo(0.1, 0.34);
      ctx.lineTo(0.3, 0.5);
      ctx.lineTo(-0.3, 0.5);
      ctx.lineTo(-0.1, 0.34);
      ctx.lineTo(-0.1, 0.14);
      ctx.quadraticCurveTo(-0.42, 0.1, -0.42, -0.5);
      break;
    case 'espada':
      ctx.moveTo(0, -0.6);
      ctx.lineTo(0.1, -0.42);
      ctx.lineTo(0.1, 0.22);
      ctx.lineTo(0.32, 0.22);
      ctx.lineTo(0.32, 0.32);
      ctx.lineTo(0.08, 0.32);
      ctx.lineTo(0.08, 0.6);
      ctx.lineTo(-0.08, 0.6);
      ctx.lineTo(-0.08, 0.32);
      ctx.lineTo(-0.32, 0.32);
      ctx.lineTo(-0.32, 0.22);
      ctx.lineTo(-0.1, 0.22);
      ctx.lineTo(-0.1, -0.42);
      break;
    case 'basto':
      ctx.moveTo(-0.08, 0.6);
      ctx.lineTo(0.08, 0.6);
      ctx.lineTo(0.2, -0.3);
      ctx.quadraticCurveTo(0.28, -0.62, 0, -0.62);
      ctx.quadraticCurveTo(-0.28, -0.62, -0.2, -0.3);
      break;
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[0, -0.5], [0, 0.5]],
  3: [[0, -0.6], [0, 0], [0, 0.6]],
  4: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
  5: [[-0.5, -0.6], [0.5, -0.6], [0, 0], [-0.5, 0.6], [0.5, 0.6]],
  6: [[-0.5, -0.6], [0.5, -0.6], [-0.5, 0], [0.5, 0], [-0.5, 0.6], [0.5, 0.6]],
  7: [[-0.5, -0.65], [0.5, -0.65], [-0.5, -0.05], [0.5, -0.05], [0, -0.35], [-0.5, 0.6], [0.5, 0.6]],
};

const FIGURES: Record<number, string> = { 10: 'SOTA', 11: 'CABALLO', 12: 'REY' };

function drawCard(ctx: CanvasRenderingContext2D, card: CardId, x: number, y: number): void {
  const suit = cardSuit(card);
  const rank = cardRank(card);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#f6efdf';
  ctx.fillRect(4, 4, CARD_W - 8, CARD_H - 8);
  ctx.strokeStyle = INK[suit];
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, CARD_W - 28, CARD_H - 28);
  ctx.fillStyle = INK[suit];
  ctx.font = '700 64px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(String(rank), 28, 24);
  const cx = CARD_W / 2;
  const cy = CARD_H / 2 + 22;
  if (rank <= 7) {
    const size = rank === 1 ? 150 : 62;
    for (const [px, py] of PIPS[rank]!) drawSuit(ctx, suit, cx + px * 72, cy + py * 120, size);
  } else {
    drawSuit(ctx, suit, cx, cy - 18, 150);
    ctx.fillStyle = INK[suit];
    ctx.font = '700 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(FIGURES[rank]!, cx, CARD_H - 70);
  }
  ctx.restore();
}

function drawBack(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#14100c';
  ctx.fillRect(4, 4, CARD_W - 8, CARD_H - 8);
  ctx.strokeStyle = '#58b7e6';
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, CARD_W - 28, CARD_H - 28);
  ctx.strokeStyle = '#e3a93c';
  ctx.lineWidth = 4;
  ctx.strokeRect(28, 28, CARD_W - 56, CARD_H - 56);
  ctx.fillStyle = '#b3261e';
  ctx.beginPath();
  ctx.ellipse(CARD_W / 2, CARD_H / 2, 84, 52, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4e6c4';
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TRUCO', CARD_W / 2, CARD_H / 2);
  ctx.restore();
}

/**
 * Cartas provisorias generadas por código: no se descargan.
 * Para usar arte final alcanza con dibujar cada imagen en su celda.
 */
export function buildCardAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_GRID.cols * CARD_W;
  canvas.height = CARD_GRID.rows * CARD_H;
  const ctx = canvas.getContext('2d')!;
  for (let slot = 0; slot < SUITS.length * 10; slot++) {
    drawCard(ctx, slot, (slot % CARD_GRID.cols) * CARD_W, Math.floor(slot / CARD_GRID.cols) * CARD_H);
  }
  drawBack(ctx, (BACK_SLOT % CARD_GRID.cols) * CARD_W, Math.floor(BACK_SLOT / CARD_GRID.cols) * CARD_H);
  return canvas;
}

export const FACE_GRID = { cols: 5, rows: 2 } as const;
export const NEUTRAL_FACE = 0;
export const faceSlot = (id: SenaId): number => SENAS.findIndex((s) => s.id === id) + 1;
const FACE = 256;
const FACE_SCALE = 1.5;

type Eye = 'open' | 'closed' | 'wink';
type Mouth = 'neutral' | 'right' | 'left' | 'bite' | 'kiss' | 'open';
interface Expression {
  brows?: boolean;
  leftEye?: Eye;
  rightEye?: Eye;
  mouth?: Mouth;
  nose?: boolean;
}

const EXPRESSIONS: Record<SenaId | 'neutral', Expression> = {
  neutral: {},
  ancho_espada: { brows: true },
  // Mirando la cara de frente, su ojo derecho queda a la izquierda de la imagen.
  ancho_basto: { rightEye: 'wink' },
  siete_espada: { mouth: 'right' },
  siete_oro: { mouth: 'left' },
  tres: { mouth: 'bite' },
  dos: { mouth: 'kiss' },
  ancho_falso: { mouth: 'open' },
  nada: { leftEye: 'closed', rightEye: 'closed' },
  envido: { nose: true },
};

/** Colores que el juego reemplaza por los de cada personaje; la guía usa los naturales. */
interface FacePalette {
  brows: string;
  iris: string;
  lips: string;
  lipsDark: string;
}
const KEYED: FacePalette = { brows: '#0000ff', iris: '#00ff00', lips: '#ff0000', lipsDark: '#b00000' };
const NATURAL: FacePalette = { brows: '#35210f', iris: '#553518', lips: '#a8504a', lipsDark: '#7a342f' };

const LINE = '#241610';
const SHADOW = '84,52,38';
const EYE_Y = 110;
const EYE_X = 52;
const EYE_W = 23;
const EYE_H = 11.5;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function softSpot(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rgb: string, alpha: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** side: -1 a la izquierda de la imagen, 1 a la derecha. El lagrimal queda hacia la nariz. */
function drawEye(ctx: CanvasRenderingContext2D, side: number, eye: Eye, palette: FacePalette): void {
  const x = 128 + side * EYE_X;
  const y = EYE_Y;
  const inner = x - side * EYE_W;
  const outer = x + side * EYE_W;
  softSpot(ctx, x, y - 4, 34, 22, SHADOW, 0.3);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = LINE;
  if (eye === 'open') {
    const almond = new Path2D();
    almond.moveTo(inner, y + 2);
    almond.bezierCurveTo(x - side * 10, y - EYE_H * 1.55, x + side * 12, y - EYE_H * 1.5, outer, y);
    almond.bezierCurveTo(x + side * 10, y + EYE_H * 1.05, x - side * 10, y + EYE_H * 1.05, inner, y + 2);
    ctx.save();
    ctx.fillStyle = '#efe7da';
    ctx.fill(almond);
    ctx.clip(almond);
    ctx.fillStyle = palette.iris;
    ctx.beginPath();
    ctx.arc(x, y - 1, 11.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d0806';
    ctx.beginPath();
    ctx.arc(x, y - 1, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,250,240,0.95)';
    ctx.beginPath();
    ctx.arc(x - 3.5, y - 5, 2.4, 0, Math.PI * 2);
    ctx.fill();
    // El párpado le da sombra a la parte de arriba del ojo.
    const lid = ctx.createLinearGradient(0, y - EYE_H, 0, y - 1);
    lid.addColorStop(0, 'rgba(30,18,12,0.55)');
    lid.addColorStop(1, 'rgba(30,18,12,0)');
    ctx.fillStyle = lid;
    ctx.fillRect(x - EYE_W - 2, y - EYE_H - 8, EYE_W * 2 + 4, EYE_H + 8);
    ctx.restore();
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.moveTo(inner, y + 2);
    ctx.bezierCurveTo(x - side * 10, y - EYE_H * 1.55, x + side * 12, y - EYE_H * 1.5, outer + side * 2, y + 0.5);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${SHADOW},0.7)`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(outer, y + 1);
    ctx.bezierCurveTo(x + side * 10, y + EYE_H * 1.05, x - side * 10, y + EYE_H * 1.05, inner, y + 2);
    ctx.stroke();
    // Pliegue del párpado.
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(inner + side * 3, y - 11);
    ctx.quadraticCurveTo(x, y - 20, outer - side * 2, y - 8);
    ctx.stroke();
    return;
  }
  ctx.lineWidth = 5;
  ctx.beginPath();
  if (eye === 'wink') {
    // Guiño apretado: el párpado baja y la mejilla sube, para que se note de lejos.
    ctx.moveTo(inner, y - 3);
    ctx.quadraticCurveTo(x, y + 9, outer, y - 6);
    ctx.stroke();
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(outer + side * 2, y - 4);
    ctx.lineTo(outer + side * 10, y - 9);
    ctx.moveTo(outer + side * 2, y);
    ctx.lineTo(outer + side * 11, y + 1);
    ctx.moveTo(x - side * 8, y + 11);
    ctx.quadraticCurveTo(x, y + 15, x + side * 10, y + 10);
    ctx.stroke();
  } else {
    ctx.moveTo(inner, y);
    ctx.quadraticCurveTo(x, y + 10, outer, y);
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (const t of [0.2, 0.5, 0.8]) {
      const px = lerp(inner, outer, t);
      ctx.moveTo(px, y + 6);
      ctx.lineTo(px + side * 2, y + 10);
    }
    ctx.stroke();
  }
}

function drawBrow(ctx: CanvasRenderingContext2D, side: number, raised: boolean, frown: boolean, color: string): void {
  const x = 128 + side * EYE_X;
  const y = raised ? 56 : frown ? 88 : 80;
  const inner = x - side * 27;
  const outer = x + side * 29;
  const innerDrop = frown ? 7 : raised ? 2 : 3;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(inner, y + innerDrop - 5);
  ctx.quadraticCurveTo(x + side * 4, y - (raised ? 16 : 10), outer, y + 5);
  ctx.quadraticCurveTo(x + side * 4, y - (raised ? 6 : 0), inner, y + innerDrop + 6);
  ctx.closePath();
  ctx.fill();
}

function drawNose(ctx: CanvasRenderingContext2D, wrinkled: boolean): void {
  // La forma es de verdad; acá van las sombras de las aletas y los orificios.
  for (const side of [-1, 1]) softSpot(ctx, 128 + side * 15, 140, 7, 26, SHADOW, 0.26);
  softSpot(ctx, 128 - 12, 168, 10, 8, SHADOW, 0.4);
  softSpot(ctx, 128 + 12, 168, 10, 8, SHADOW, 0.4);
  ctx.fillStyle = 'rgba(46,24,16,0.8)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(128 + side * 8, wrinkled ? 170 : 174, 4.4, 2.4, side * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!wrinkled) return;
  // Nariz fruncida: arrugas marcadas sobre el tabique y a los costados.
  ctx.strokeStyle = 'rgba(52,28,18,0.9)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const [y, half] of [[118, 11], [127, 14], [136, 16]] as const) {
    ctx.moveTo(128 - half, y + 3);
    ctx.quadraticCurveTo(128, y - 4, 128 + half, y + 3);
  }
  for (const side of [-1, 1]) {
    ctx.moveTo(128 + side * 20, 146);
    ctx.quadraticCurveTo(128 + side * 26, 158, 128 + side * 24, 172);
  }
  ctx.stroke();
}

function drawMouth(ctx: CanvasRenderingContext2D, mouth: Mouth, palette: FacePalette): void {
  const y = 209;
  const lips = (points: () => void, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    points();
    ctx.closePath();
    ctx.fill();
  };
  const seam = (points: () => void, width = 2.6) => {
    ctx.strokeStyle = '#3b1712';
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    points();
    ctx.stroke();
  };
  softSpot(ctx, 128, y + 21, 26, 7, SHADOW, 0.34);
  switch (mouth) {
    case 'neutral':
      lips(() => {
        ctx.moveTo(128 - 26, y);
        ctx.quadraticCurveTo(128 - 12, y - 8, 128 - 3, y - 6);
        ctx.quadraticCurveTo(128, y - 4, 128 + 3, y - 6);
        ctx.quadraticCurveTo(128 + 12, y - 8, 128 + 26, y);
      }, palette.lipsDark);
      lips(() => {
        ctx.moveTo(128 - 26, y);
        ctx.quadraticCurveTo(128, y + 13, 128 + 26, y);
      }, palette.lips);
      seam(() => {
        ctx.moveTo(128 - 27, y);
        ctx.quadraticCurveTo(128, y + 2, 128 + 27, y);
      });
      break;
    case 'left': // Su izquierda, a la derecha de la imagen.
    case 'right': {
      // Toda la boca tira con fuerza hacia un costado y sube esa comisura.
      const side = mouth === 'left' ? 1 : -1;
      const near = 128 + side * 58;
      const far = 128 - side * 6;
      lips(() => {
        ctx.moveTo(far, y + 3);
        ctx.quadraticCurveTo(128 + side * 30, y - 7, near, y - 20);
        ctx.quadraticCurveTo(128 + side * 34, y + 12, far, y + 3);
      }, palette.lips);
      seam(() => {
        ctx.moveTo(far, y + 3);
        ctx.quadraticCurveTo(128 + side * 32, y + 3, near, y - 20);
      }, 3.2);
      seam(() => {
        ctx.moveTo(near + side * 3, y - 28);
        ctx.quadraticCurveTo(near + side * 8, y - 20, near + side * 2, y - 12);
      }, 2.2);
      break;
    }
    case 'bite':
      // Dientes de arriba sobre el labio de abajo.
      lips(() => {
        ctx.moveTo(128 - 28, y - 4);
        ctx.quadraticCurveTo(128, y + 22, 128 + 28, y - 4);
      }, palette.lips);
      ctx.fillStyle = '#f2ecdf';
      ctx.beginPath();
      ctx.moveTo(128 - 22, y - 6);
      ctx.lineTo(128 + 22, y - 6);
      ctx.quadraticCurveTo(128 + 20, y + 9, 128, y + 9);
      ctx.quadraticCurveTo(128 - 20, y + 9, 128 - 22, y - 6);
      ctx.fill();
      seam(() => {
        for (const x of [-11, 0, 11]) {
          ctx.moveTo(128 + x, y - 5);
          ctx.lineTo(128 + x, y + 7);
        }
      }, 1.2);
      lips(() => {
        ctx.moveTo(128 - 28, y - 4);
        ctx.quadraticCurveTo(128, y - 15, 128 + 28, y - 4);
        ctx.quadraticCurveTo(128, y - 7, 128 - 28, y - 4);
      }, palette.lipsDark);
      break;
    case 'kiss':
      // Beso: labios juntos y bien salidos, con la comisura hundida a cada lado.
      softSpot(ctx, 128, y, 34, 30, SHADOW, 0.3);
      ctx.fillStyle = palette.lips;
      ctx.beginPath();
      ctx.ellipse(128, y - 6, 15, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(128, y + 6, 17, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      seam(() => {
        ctx.moveTo(128 - 11, y);
        ctx.quadraticCurveTo(128, y + 3, 128 + 11, y);
      }, 3);
      seam(() => {
        for (const side of [-1, 1]) {
          ctx.moveTo(128 + side * 25, y - 7);
          ctx.quadraticCurveTo(128 + side * 29, y, 128 + side * 25, y + 8);
        }
      }, 1.8);
      break;
    case 'open':
      ctx.fillStyle = palette.lips;
      ctx.beginPath();
      ctx.ellipse(128, y + 2, 24, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#28120e';
      ctx.beginPath();
      ctx.ellipse(128, y + 2, 18.5, 17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f2ecdf';
      ctx.beginPath();
      ctx.ellipse(128, y - 11, 13, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}

/** Caras con los gestos marcados para que se lean desde el otro lado de la mesa. */
export function buildFaceAtlas(palette: FacePalette = KEYED): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = FACE_GRID.cols * FACE * FACE_SCALE;
  canvas.height = FACE_GRID.rows * FACE * FACE_SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(FACE_SCALE, FACE_SCALE);
  const ids: (SenaId | 'neutral')[] = ['neutral', ...SENAS.map((s) => s.id)];
  ids.forEach((id, slot) => {
    const expression = EXPRESSIONS[id];
    ctx.save();
    ctx.translate((slot % FACE_GRID.cols) * FACE, Math.floor(slot / FACE_GRID.cols) * FACE);
    // Hueco bajo los pómulos.
    for (const side of [-1, 1]) softSpot(ctx, 128 + side * 74, 192, 26, 34, SHADOW, 0.08);
    // Surco que baja de la nariz a la boca.
    ctx.strokeStyle = `rgba(${SHADOW},0.11)`;
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(128 + side * 22, 178);
      ctx.quadraticCurveTo(128 + side * 33, 192, 128 + side * 34, 206);
    }
    ctx.stroke();
    for (const side of [-1, 1]) drawBrow(ctx, side, Boolean(expression.brows), Boolean(expression.nose), palette.brows);
    drawEye(ctx, -1, expression.rightEye ?? 'open', palette);
    drawEye(ctx, 1, expression.leftEye ?? 'open', palette);
    drawNose(ctx, Boolean(expression.nose));
    drawMouth(ctx, expression.mouth ?? 'neutral', palette);
    ctx.restore();
  });
  return canvas;
}

let naturalAtlas: HTMLCanvasElement | null = null;

/** Dibuja una cara en un canvas chico, para la guía de señas. */
export function faceThumbnail(slot: number, size: number): HTMLCanvasElement {
  naturalAtlas ??= buildFaceAtlas(NATURAL);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e0b48c';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const cell = FACE * FACE_SCALE;
  ctx.drawImage(naturalAtlas, (slot % FACE_GRID.cols) * cell, Math.floor(slot / FACE_GRID.cols) * cell, cell, cell, 0, 0, size, size);
  return canvas;
}
