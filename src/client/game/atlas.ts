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

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, eye: Eye): void {
  ctx.strokeStyle = '#1c1410';
  ctx.lineCap = 'round';
  if (eye === 'open') {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(x, y, 30, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c1410';
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.lineWidth = 10;
    ctx.beginPath();
    if (eye === 'wink') {
      ctx.moveTo(x - 28, y - 12);
      ctx.lineTo(x + 28, y + 8);
      ctx.moveTo(x - 28, y + 22);
      ctx.lineTo(x + 28, y + 8);
    } else {
      ctx.moveTo(x - 30, y);
      ctx.quadraticCurveTo(x, y + 18, x + 30, y);
    }
    ctx.stroke();
  }
}

function drawMouth(ctx: CanvasRenderingContext2D, mouth: Mouth): void {
  const y = 196;
  ctx.strokeStyle = '#6e1f1a';
  ctx.fillStyle = '#6e1f1a';
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.beginPath();
  switch (mouth) {
    case 'neutral':
      ctx.moveTo(98, y);
      ctx.lineTo(158, y);
      ctx.stroke();
      break;
    case 'left': // Su izquierda, a la derecha de la imagen.
      ctx.moveTo(112, y + 6);
      ctx.quadraticCurveTo(160, y + 6, 198, y - 22);
      ctx.stroke();
      break;
    case 'right': // Su derecha, a la izquierda de la imagen.
      ctx.moveTo(144, y + 6);
      ctx.quadraticCurveTo(96, y + 6, 58, y - 22);
      ctx.stroke();
      break;
    case 'bite':
      ctx.moveTo(84, y - 8);
      ctx.lineTo(172, y - 8);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillRect(100, y - 8, 56, 22);
      ctx.strokeStyle = '#1c1410';
      ctx.lineWidth = 3;
      ctx.strokeRect(100, y - 8, 56, 22);
      break;
    case 'kiss':
      ctx.ellipse(128, y, 20, 26, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'open':
      ctx.ellipse(128, y, 34, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}

/** Caras con trazos exagerados para que se lean de lejos. */
export function buildFaceAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = FACE_GRID.cols * FACE;
  canvas.height = FACE_GRID.rows * FACE;
  const ctx = canvas.getContext('2d')!;
  const ids: (SenaId | 'neutral')[] = ['neutral', ...SENAS.map((s) => s.id)];
  ids.forEach((id, slot) => {
    const expression = EXPRESSIONS[id];
    ctx.save();
    ctx.translate((slot % FACE_GRID.cols) * FACE, Math.floor(slot / FACE_GRID.cols) * FACE);
    const browY = expression.brows ? 48 : 76;
    ctx.strokeStyle = '#2a1a10';
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    for (const x of [78, 178]) {
      ctx.beginPath();
      ctx.moveTo(x - 28, browY + 4);
      ctx.quadraticCurveTo(x, browY - 8, x + 28, browY + 4);
      ctx.stroke();
    }
    drawEye(ctx, 78, 112, expression.rightEye ?? 'open');
    drawEye(ctx, 178, 112, expression.leftEye ?? 'open');
    ctx.strokeStyle = '#8a5a3a';
    ctx.lineWidth = 8;
    ctx.beginPath();
    if (expression.nose) {
      for (const offset of [0, 11, 22]) {
        ctx.moveTo(108, 130 + offset);
        ctx.lineTo(148, 130 + offset);
      }
    } else {
      ctx.moveTo(128, 124);
      ctx.lineTo(120, 158);
      ctx.lineTo(136, 158);
    }
    ctx.stroke();
    drawMouth(ctx, expression.mouth ?? 'neutral');
    ctx.restore();
  });
  return canvas;
}

/** Dibuja una cara en un canvas chico, para la guía de señas. */
export function faceThumbnail(atlas: HTMLCanvasElement, slot: number, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e0b48c';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(atlas, (slot % FACE_GRID.cols) * FACE, Math.floor(slot / FACE_GRID.cols) * FACE, FACE, FACE, 0, 0, size, size);
  return canvas;
}
