import layout from './assets/room-atlas.json';

type Region = keyof typeof layout.regions;
type Ctx = CanvasRenderingContext2D;

export const FILETE = {
  black: '#14100c',
  red: '#b3261e',
  sky: '#58b7e6',
  gold: '#e3a93c',
  cream: '#f4e6c4',
  green: '#2f7d62',
} as const;

const LETTERING = 'Rye, Georgia, serif';

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Dibuja dentro de una región, recortando para que nada invada a la vecina. */
function within(ctx: Ctx, name: Region, draw: (w: number, h: number) => void): void {
  const [x, y, w, h] = layout.regions[name] as [number, number, number, number];
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);
  draw(w, h);
  ctx.restore();
}

function drawTile(ctx: Ctx, w: number): void {
  // Calcáreo gris con flores chicas, como los pisos de los cafés viejos.
  const n = 8;
  const size = w / n;
  const random = seeded(11);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const base = 158 + random() * 22;
      ctx.fillStyle = `rgb(${base + 6},${base},${base - 12})`;
      ctx.fillRect(i * size, j * size, size, size);
      const cx = (i + 0.5) * size;
      const cy = (j + 0.5) * size;
      ctx.fillStyle = (i + j) % 2 ? '#2d2a26' : '#5a544a';
      ctx.beginPath();
      ctx.moveTo(cx, cy - size * 0.24);
      ctx.lineTo(cx + size * 0.24, cy);
      ctx.lineTo(cx, cy + size * 0.24);
      ctx.lineTo(cx - size * 0.24, cy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2d2a26';
      for (const [px, py] of [[0, 0], [size, 0], [0, size], [size, size]] as const) {
        ctx.beginPath();
        ctx.arc(i * size + px, j * size + py, size * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.strokeStyle = 'rgba(40,36,30,.45)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * size, 0);
    ctx.lineTo(i * size, w);
    ctx.moveTo(0, i * size);
    ctx.lineTo(w, i * size);
    ctx.stroke();
  }
}

function drawBrick(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#3f3027';
  ctx.fillRect(0, 0, w, h);
  const rows = 12;
  const rowH = h / rows;
  const brickW = w / 5;
  const random = seeded(23);
  for (let r = 0; r < rows; r++) {
    for (let c = -1; c < 6; c++) {
      const x = c * brickW + (r % 2 ? brickW / 2 : 0);
      const tone = random();
      ctx.fillStyle = `rgb(${132 + tone * 54},${74 + tone * 30},${52 + tone * 18})`;
      ctx.fillRect(x + 2, r * rowH + 2, brickW - 4, rowH - 4);
    }
  }
}

function drawGrain(ctx: Ctx, w: number, h: number, base: [number, number, number], planks: number, seed: number): void {
  const random = seeded(seed);
  const plankH = h / planks;
  for (let p = 0; p < planks; p++) {
    const shift = (random() - 0.5) * 22;
    ctx.fillStyle = `rgb(${base[0] + shift},${base[1] + shift * 0.7},${base[2] + shift * 0.5})`;
    ctx.fillRect(0, p * plankH, w, plankH);
    for (let i = 0; i < 26; i++) {
      const y = p * plankH + random() * plankH;
      ctx.strokeStyle = `rgba(30,14,4,${0.08 + random() * 0.18})`;
      ctx.lineWidth = 0.6 + random() * 1.6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + (random() - 0.5) * 12, w * 0.7, y + (random() - 0.5) * 12, w, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(15,6,2,.55)';
    ctx.fillRect(0, p * plankH, w, 2);
  }
}

function drawRug(ctx: Ctx, w: number): void {
  ctx.fillStyle = '#5b1a18';
  ctx.fillRect(0, 0, w, w);
  const c = w / 2;
  for (const [inset, color, line] of [
    [8, '#1e2a4a', 26],
    [44, '#c9a15a', 5],
    [58, '#7a2320', 18],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = line;
    ctx.strokeRect(inset, inset, w - inset * 2, w - inset * 2);
  }
  for (let i = 0; i < 24; i++) {
    const t = ((i + 0.5) / 24) * (w - 150);
    ctx.fillStyle = i % 2 ? '#c9a15a' : '#2c4a6e';
    for (const [x, y] of [[75 + t, 28], [75 + t, w - 28], [28, 75 + t], [w - 28, 75 + t]] as const) {
      ctx.fillRect(x - 5, y - 5, 10, 10);
    }
  }
  ctx.fillStyle = '#7a2320';
  ctx.fillRect(90, 90, w - 180, w - 180);
  for (let ring = 6; ring >= 1; ring--) {
    const radius = ring * 28;
    ctx.fillStyle = ['#1e2a4a', '#c9a15a', '#5b1a18', '#2c4a6e', '#c9a15a', '#7a2320'][ring - 1]!;
    ctx.beginPath();
    for (let a = 0; a < 16; a++) {
      const angle = (a / 16) * Math.PI * 2;
      const r = a % 2 ? radius : radius * 0.78;
      ctx.lineTo(c + Math.cos(angle) * r, c + Math.sin(angle) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function drawMirror(ctx: Ctx, w: number, h: number): void {
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, '#6f7a78');
  gradient.addColorStop(0.45, '#c2c8bd');
  gradient.addColorStop(0.55, '#8b938d');
  gradient.addColorStop(1, '#4f5654');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(w * 0.1, h * 0.55);
  ctx.lineTo(w * 0.7, h * 0.05);
  ctx.stroke();
}

function drawPortrait(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#c4ab7d';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3a2a1c';
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 1.02, w * 0.36, h * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7a5f42';
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.44, w * 0.17, h * 0.21, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#20160e';
  ctx.fillRect(w * 0.28, h * 0.25, w * 0.44, h * 0.05);
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.24, w * 0.16, h * 0.13, 0, Math.PI, 0);
  ctx.fill();
}

function drawLandscape(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#b89a64';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#8a6d3e';
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
  ctx.fillStyle = '#4a3820';
  for (let i = 0; i < 6; i++) ctx.fillRect(w * (0.08 + i * 0.15), h * (0.3 + (i % 2) * 0.06), w * 0.12, h * 0.34);
  ctx.fillRect(w * 0.42, h * 0.14, w * 0.05, h * 0.2);
}

function drawClock(ctx: Ctx, w: number): void {
  const c = w / 2;
  ctx.clearRect(0, 0, w, w);
  ctx.fillStyle = '#20150d';
  ctx.fillRect(0, 0, w, w);
  ctx.fillStyle = '#efe6cf';
  ctx.beginPath();
  ctx.arc(c, c, c * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#20150d';
  ctx.font = `700 ${w * 0.1}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let hour = 1; hour <= 12; hour++) {
    const angle = (hour / 12) * Math.PI * 2;
    ctx.fillText(String(hour), c + Math.sin(angle) * c * 0.72, c - Math.cos(angle) * c * 0.72);
  }
  ctx.strokeStyle = '#20150d';
  ctx.lineCap = 'round';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.lineTo(c + c * 0.32, c - c * 0.28);
  ctx.moveTo(c, c);
  ctx.lineTo(c - c * 0.1, c - c * 0.6);
  ctx.stroke();
}

function drawLabels(ctx: Ctx, w: number): void {
  const random = seeded(7);
  const cell = w / 4;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      ctx.fillStyle = ['#f0e4c6', '#d9c28d', '#b83a2c', '#1f3a5a', '#f6f1e1'][Math.floor(random() * 5)]!;
      ctx.fillRect(i * cell, j * cell, cell, cell);
      ctx.fillStyle = ['#7a1f18', '#20150d', '#c79a45'][Math.floor(random() * 3)]!;
      ctx.fillRect(i * cell + cell * 0.14, j * cell + cell * 0.25, cell * 0.72, cell * 0.2);
      ctx.fillRect(i * cell + cell * 0.25, j * cell + cell * 0.58, cell * 0.5, cell * 0.1);
    }
  }
}

function drawStained(ctx: Ctx, w: number, h: number): void {
  const random = seeded(41);
  ctx.fillStyle = '#123a2c';
  ctx.fillRect(0, 0, w, h);
  const greens = ['#2f9a6a', '#57b98a', '#8fd0a5', '#1f7a58', '#c7e0a8'];
  const cols = 22;
  const rows = 6;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      ctx.fillStyle = greens[Math.floor(random() * greens.length)]!;
      ctx.fillRect((i * w) / cols + 1, (j * h) / rows + 1, w / cols - 2, h / rows - 2);
    }
  }
  // Guirnalda ondulada de cuentas claras, como los vitrales de las referencias.
  for (let i = 0; i < 19; i++) {
    const x = ((i + 0.5) / 19) * w;
    const y = h * 0.5 + Math.sin(i * 0.65) * h * 0.2;
    ctx.fillStyle = i % 4 === 0 ? '#d65a78' : i % 4 === 2 ? '#e8c35a' : '#f4f1dc';
    ctx.beginPath();
    ctx.ellipse(x, y, w / 42, h * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#102018';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  ctx.strokeStyle = '#102018';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, w - 8, h - 8);
}

/** Voluta fileteada: una espiral con hojas, el gesto base del filete porteño. */
function scroll(ctx: Ctx, x: number, y: number, size: number, flip: number, color: string, shade: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip, 1);
  ctx.lineCap = 'round';
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(size * 0.3, -size * 0.5, size * 0.95, -size * 0.45, size, 0);
    ctx.bezierCurveTo(size * 1.03, size * 0.28, size * 0.62, size * 0.32, size * 0.6, size * 0.05);
    ctx.bezierCurveTo(size * 0.6, -size * 0.08, size * 0.78, -size * 0.08, size * 0.79, size * 0.03);
  };
  ctx.strokeStyle = shade;
  ctx.lineWidth = size * 0.13;
  ctx.translate(size * 0.02, size * 0.03);
  path();
  ctx.stroke();
  ctx.translate(-size * 0.02, -size * 0.03);
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.08;
  path();
  ctx.stroke();
  ctx.fillStyle = color;
  for (const [lx, ly, angle] of [[0.3, -0.42, -0.7], [0.58, -0.5, -0.2], [0.14, -0.2, -1.1]] as const) {
    ctx.save();
    ctx.translate(size * lx, size * ly);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.12, size * 0.055, size * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function flower(ctx: Ctx, x: number, y: number, r: number, petal: string, center: string): void {
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(angle) * r * 0.62, y + Math.sin(angle) * r * 0.62, r * 0.46, r * 0.32, angle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

/** Letras de cartel: sombra corrida, filo oscuro y relleno claro. */
function lettering(ctx: Ctx, text: string, x: number, y: number, size: number, fill: string, shade: string, outline: string, maxWidth: number): void {
  ctx.font = `${size}px ${LETTERING}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const depth = Math.max(2, size * 0.055);
  ctx.fillStyle = shade;
  for (let i = depth; i > 0; i -= 1) ctx.fillText(text, x + i, y + i, maxWidth);
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(2, size * 0.05);
  ctx.strokeText(text, x, y, maxWidth);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y, maxWidth);
}

function signFrame(ctx: Ctx, w: number, h: number, ground: string, band: string, line: string): void {
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = ground;
  ctx.fillRect(14, 14, w - 28, h - 28);
  ctx.strokeStyle = line;
  ctx.lineWidth = 5;
  ctx.strokeRect(24, 24, w - 48, h - 48);
}

function drawMainSign(ctx: Ctx, w: number, h: number): void {
  const { black, sky, gold, cream, red } = FILETE;
  signFrame(ctx, w, h, black, sky, gold);
  for (const flip of [1, -1]) {
    const x = flip === 1 ? 60 : w - 60;
    scroll(ctx, x, 92, 130, flip, gold, red);
    scroll(ctx, x, h - 72, 130, flip, sky, '#1c5a7c');
  }
  lettering(ctx, 'BOLICHE', w / 2, 76, 58, cream, red, black, 520);
  lettering(ctx, 'TRICK', w / 2, 192, 138, cream, sky, black, 660);
  lettering(ctx, 'truco, grapa y señas', w / 2, 306, 42, gold, red, black, 640);
  flower(ctx, 196, h / 2 + 2, 28, cream, gold);
  flower(ctx, w - 196, h / 2 + 2, 28, cream, gold);
}

function drawRedSign(ctx: Ctx, w: number, h: number): void {
  const { red, gold, cream, black, sky, green } = FILETE;
  signFrame(ctx, w, h, red, '#6b1612', gold);
  ctx.fillStyle = cream;
  ctx.beginPath();
  ctx.roundRect(150, 92, w - 300, 200, 90);
  ctx.fill();
  lettering(ctx, 'SE JUEGA', w / 2, 142, 66, red, green, black, 620);
  lettering(ctx, 'AL TRUCO', w / 2, 232, 88, sky, black, black, 660);
  scroll(ctx, 56, 150, 86, 1, gold, black);
  scroll(ctx, w - 56, 150, 86, -1, gold, black);
  flower(ctx, 92, 278, 26, sky, gold);
  flower(ctx, w - 92, 278, 26, sky, gold);
}

function drawSmallSign(ctx: Ctx, w: number, h: number): void {
  const { black, cream, sky, red, gold } = FILETE;
  signFrame(ctx, w, h, black, gold, sky);
  lettering(ctx, 'PROHIBIDO', w / 2, 76, 44, cream, red, black, 400);
  lettering(ctx, 'mentir sin gracia', w / 2, 158, 40, sky, '#1c5a7c', black, 430);
}

function drawGlass(ctx: Ctx, w: number, h: number, word: string, tint: string): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, '#f3ead0');
  gradient.addColorStop(1, '#d5cdb2');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = tint;
  ctx.fillRect(16, 16, w - 32, 54);
  ctx.fillRect(16, h - 70, w - 32, 54);
  scroll(ctx, 30, 58, 58, 1, FILETE.gold, '#3a2410');
  scroll(ctx, w - 30, 58, 58, -1, FILETE.gold, '#3a2410');
  lettering(ctx, word, w / 2, h / 2 + 4, 118, tint, FILETE.gold, FILETE.black, w - 60);
}

function drawPoster(ctx: Ctx, w: number, h: number): void {
  const { sky, cream, black, red, gold } = FILETE;
  signFrame(ctx, w, h, cream, sky, black);
  lettering(ctx, 'GRAN', w / 2, 66, 40, red, gold, black, 200);
  lettering(ctx, 'TORNEO', w / 2, 118, 42, red, gold, black, 210);
  flower(ctx, w / 2, 214, 44, sky, gold);
  lettering(ctx, 'a 30', w / 2, 316, 44, black, gold, black, 180);
}

/** Texturas del boliche. Se generan en el navegador: no se descargan. */
export function buildRoomAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = layout.size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#20150d';
  ctx.fillRect(0, 0, layout.size, layout.size);
  within(ctx, 'tile', (w) => drawTile(ctx, w));
  within(ctx, 'brick', (w, h) => drawBrick(ctx, w, h));
  within(ctx, 'plaster', (w, h) => {
    ctx.fillStyle = '#d8c7a2';
    ctx.fillRect(0, 0, w, h);
    const random = seeded(3);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(90,60,30,${random() * 0.06})`;
      ctx.fillRect(random() * w, random() * h, 14, 14);
    }
  });
  within(ctx, 'white', (w, h) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  });
  within(ctx, 'wood', (w, h) => drawGrain(ctx, w, h, [146, 92, 54], 5, 5));
  within(ctx, 'wood_dark', (w, h) => drawGrain(ctx, w, h, [82, 48, 28], 4, 9));
  within(ctx, 'table', (w, h) => drawGrain(ctx, w, h, [132, 80, 44], 9, 17));
  within(ctx, 'rug', (w) => drawRug(ctx, w));
  within(ctx, 'mirror', (w, h) => drawMirror(ctx, w, h));
  within(ctx, 'portrait', (w, h) => drawPortrait(ctx, w, h));
  within(ctx, 'landscape', (w, h) => drawLandscape(ctx, w, h));
  within(ctx, 'clock', (w) => drawClock(ctx, w));
  within(ctx, 'labels', (w) => drawLabels(ctx, w));
  within(ctx, 'stained', (w, h) => drawStained(ctx, w, h));
  within(ctx, 'sign_main', (w, h) => drawMainSign(ctx, w, h));
  within(ctx, 'sign_red', (w, h) => drawRedSign(ctx, w, h));
  within(ctx, 'sign_small', (w, h) => drawSmallSign(ctx, w, h));
  within(ctx, 'glass_bar', (w, h) => drawGlass(ctx, w, h, 'BAR', FILETE.red));
  within(ctx, 'glass_cafe', (w, h) => drawGlass(ctx, w, h, 'CAFÉ', '#1f5f86'));
  within(ctx, 'poster', (w, h) => drawPoster(ctx, w, h));
  return canvas;
}
