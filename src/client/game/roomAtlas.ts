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

/** Camiseta celeste y blanca enmarcada, con la 10 en la espalda. */
function drawLandscape(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#20252b';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(w * 0.36, h * 0.13);
  ctx.quadraticCurveTo(w * 0.5, h * 0.2, w * 0.64, h * 0.13);
  ctx.lineTo(w * 0.92, h * 0.3);
  ctx.lineTo(w * 0.82, h * 0.45);
  ctx.lineTo(w * 0.72, h * 0.4);
  ctx.lineTo(w * 0.72, h * 0.9);
  ctx.lineTo(w * 0.28, h * 0.9);
  ctx.lineTo(w * 0.28, h * 0.4);
  ctx.lineTo(w * 0.18, h * 0.45);
  ctx.lineTo(w * 0.08, h * 0.3);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#74acdf';
  for (let i = 0; i < 5; i++) ctx.fillRect(w * (0.12 + i * 0.18), 0, w * 0.09, h);
  ctx.restore();
  ctx.fillStyle = '#14100c';
  ctx.font = '700 72px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('10', w / 2, h * 0.66);
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

/** Vitral del arco: cielo, ciudad con el Obelisco y marco de hojas, dividido por varillas de plomo. */
function drawArchGlass(ctx: Ctx, w: number, h: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#2f7fb8');
  sky.addColorStop(0.55, '#a8d4e0');
  sky.addColorStop(1, '#f2deaa');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const ground = h * 0.82;
  const random = seeded(29);
  ctx.fillStyle = '#6d6a78';
  for (let x = 0; x < w; ) {
    const bw = 28 + random() * 56;
    const bh = 42 + random() * 86;
    ctx.fillStyle = ['#7b7686', '#8d8373', '#5f6b80', '#a08a6e'][Math.floor(random() * 4)]!;
    ctx.fillRect(x, ground - bh, bw, bh);
    ctx.fillStyle = '#f2d98a';
    for (let wy = ground - bh + 10; wy < ground - 8; wy += 17) {
      for (let wx = x + 7; wx < x + bw - 6; wx += 13) ctx.fillRect(wx, wy, 5, 7);
    }
    if (random() < 0.34) {
      ctx.fillStyle = '#5b8f8a';
      ctx.beginPath();
      ctx.arc(x + bw / 2, ground - bh, bw * 0.34, Math.PI, 0);
      ctx.fill();
    }
    x += bw + 2;
  }
  // Obelisco a los dos lados del medallón.
  for (const cx of [w * 0.27, w * 0.73]) {
    ctx.fillStyle = '#efe8d6';
    ctx.beginPath();
    ctx.moveTo(cx - 13, ground);
    ctx.lineTo(cx - 7, ground * 0.27);
    ctx.lineTo(cx, ground * 0.2);
    ctx.lineTo(cx + 7, ground * 0.27);
    ctx.lineTo(cx + 13, ground);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#3f7d3e';
  ctx.fillRect(0, ground, w, h - ground);
  // Guirnalda de hojas siguiendo el arco, y cuentas doradas abajo.
  for (let i = 0; i <= 44; i++) {
    const t = i / 44;
    const angle = Math.PI * (1 - t);
    const x = w / 2 + Math.cos(angle) * w * 0.46;
    const y = h - Math.sin(angle) * h * 0.86 - 10;
    ctx.fillStyle = i % 3 === 0 ? '#2f8a4e' : i % 3 === 1 ? '#57b06a' : '#1f6b45';
    ctx.beginPath();
    ctx.ellipse(x, y, 24, 11, angle + Math.PI / 2 + (i % 2 ? 0.5 : -0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = i % 2 ? '#d9a93f' : '#c8352a';
    ctx.beginPath();
    ctx.arc(((i + 0.5) / 26) * w, h - 17, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  // Varillas de plomo.
  ctx.strokeStyle = 'rgba(16, 12, 8, 0.82)';
  ctx.lineWidth = 3.5;
  for (let i = 1; i < 18; i++) {
    const x = (i / 18) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(w / 2 + (x - w / 2) * 1.04, h);
    ctx.stroke();
  }
  for (let j = 1; j < 7; j++) {
    ctx.beginPath();
    ctx.moveTo(0, (j / 7) * h);
    ctx.lineTo(w, (j / 7) * h);
    ctx.stroke();
  }
}

function drawMedallion(ctx: Ctx, w: number, h: number): void {
  const { black, cream, red, gold } = FILETE;
  ctx.fillStyle = gold;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = black;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2 - 8, h / 2 - 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cream;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2 - 16, h / 2 - 16, 0, 0, Math.PI * 2);
  ctx.fill();
  lettering(ctx, 'CAFÉ', w / 2, h * 0.34, 60, red, gold, black, w * 0.78);
  lettering(ctx, 'BAR', w / 2, h * 0.66, 66, red, gold, black, w * 0.72);
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

/** Ventana a la calle de noche, con el nombre del bar pintado en dorado sobre el vidrio. */
function drawGlass(ctx: Ctx, w: number, h: number, word: string, tint: string): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#101c2e');
  sky.addColorStop(0.6, '#26364a');
  sky.addColorStop(1, '#3d3a38');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const random = seeded(word.length * 37 + 5);
  // Frente de enfrente, con algunas ventanas encendidas.
  ctx.fillStyle = '#141a22';
  ctx.fillRect(0, h * 0.42, w, h * 0.58);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = random() < 0.4 ? '#d9b24a' : '#232c38';
    ctx.fillRect(14 + (i % 9) * (w / 9), h * 0.47 + Math.floor(i / 9) * 44, 24, 30);
  }
  // Faroles de la vereda, fuera de foco.
  for (const [x, y, size] of [[w * 0.2, h * 0.36, 70], [w * 0.8, h * 0.3, 90]] as const) {
    const glow = ctx.createRadialGradient(x, y, 2, x, y, size);
    glow.addColorStop(0, 'rgba(255,224,160,.95)');
    glow.addColorStop(0.18, 'rgba(255,200,120,.45)');
    glow.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.textAlign = 'center';
  ctx.font = '400 92px Rye, Georgia, serif';
  ctx.lineWidth = 7;
  ctx.strokeStyle = tint;
  ctx.strokeText(word, w / 2, 118, w - 60);
  ctx.fillStyle = FILETE.gold;
  ctx.fillText(word, w / 2, 118, w - 60);
}

function drawPoster(ctx: Ctx, w: number, h: number): void {
  const { sky, cream, black, red, gold } = FILETE;
  signFrame(ctx, w, h, cream, sky, black);
  lettering(ctx, 'GRAN', w / 2, 66, 40, red, gold, black, 200);
  lettering(ctx, 'TORNEO', w / 2, 118, 42, red, gold, black, 210);
  flower(ctx, w / 2, 214, 44, sky, gold);
  lettering(ctx, 'a 30', w / 2, 316, 44, black, gold, black, 180);
}

/** Chapa estampada del techo: una cuadrícula con una flor en relieve. */
function drawTin(ctx: Ctx, w: number): void {
  ctx.fillStyle = '#e6dcc4';
  ctx.fillRect(0, 0, w, w);
  const c = w / 2;
  const emboss = (light: string, dark: string, draw: () => void) => {
    ctx.save();
    ctx.translate(-2, -2);
    ctx.strokeStyle = light;
    draw();
    ctx.translate(4, 4);
    ctx.strokeStyle = dark;
    draw();
    ctx.restore();
  };
  ctx.lineWidth = 6;
  emboss('#fff8e6', '#a8987a', () => {
    ctx.strokeRect(14, 14, w - 28, w - 28);
    ctx.strokeRect(38, 38, w - 76, w - 76);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.ellipse(c + Math.cos(a) * 44, c + Math.sin(a) * 44, 34, 15, a, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(c, c, 15, 0, Math.PI * 2);
    ctx.stroke();
    for (const [x, y] of [[26, 26], [w - 26, 26], [26, w - 26], [w - 26, w - 26]] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/** Empapelado antiguo con un adamascado de dos tonos. */
function drawWallpaper(ctx: Ctx, w: number): void {
  ctx.fillStyle = '#a4553f';
  ctx.fillRect(0, 0, w, w);
  ctx.fillStyle = '#bb6b52';
  const motif = (x: number, y: number, size: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size, size);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, -1);
      ctx.bezierCurveTo(side * 0.7, -0.6, side * 0.25, -0.25, side * 0.62, 0);
      ctx.bezierCurveTo(side * 0.25, 0.25, side * 0.7, 0.6, 0, 1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };
  for (const [x, y] of [[64, 64], [192, 192], [-64, 192], [320, 64], [64, 320], [192, -64]] as const) motif(x, y, 54);
  ctx.fillStyle = '#a4553f';
  for (const [x, y] of [[64, 64], [192, 192]] as const) motif(x, y, 22);
  ctx.fillStyle = '#c67a60';
  for (const [x, y] of [[192, 64], [64, 192]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawChalkboard(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#23302a';
  ctx.fillRect(0, 0, w, h);
  const random = seeded(11);
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(230,235,225,${random() * 0.05})`;
    ctx.lineWidth = 10 + random() * 16;
    ctx.beginPath();
    const x = random() * w;
    const y = random() * h;
    ctx.moveTo(x, y);
    ctx.lineTo(x + 60 + random() * 90, y + random() * 16 - 8);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f0ead6';
  ctx.font = '400 48px Rye, Georgia, serif';
  ctx.fillText('HOY', w / 2, 52);
  ctx.fillStyle = '#e8e2cc';
  ctx.font = 'italic 30px Georgia, serif';
  const lines = ['Fernet con coca', 'Vermú con soda', 'Empanadas de carne', 'Choripán al pan'];
  lines.forEach((line, i) => ctx.fillText(line, w / 2, 100 + i * 39));
  ctx.strokeStyle = '#d9c98f';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, w - 20, h - 20);
}

/** Vidrio de la puerta: la calle de noche detrás del nombre pintado. */
function drawDoorGlass(ctx: Ctx, w: number, h: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, '#16263a');
  gradient.addColorStop(0.7, '#2c3a4a');
  gradient.addColorStop(1, '#4a4238');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * 0.72, h * 0.32, 4, w * 0.72, h * 0.32, 90);
  glow.addColorStop(0, 'rgba(255,220,150,.95)');
  glow.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#10161e';
  ctx.fillRect(w * 0.71, h * 0.34, 5, h * 0.66);
  ctx.fillRect(0, h * 0.62, w * 0.45, h * 0.38);
  ctx.fillStyle = '#d9b24a';
  for (const [x, y] of [[18, 0.68], [52, 0.68], [84, 0.68], [18, 0.8], [52, 0.8]] as const) ctx.fillRect(x, h * y, 18, 26);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e3a93c';
  ctx.font = '400 42px Rye, Georgia, serif';
  ctx.fillText('BAR', w / 2, 64);
}

/** Fotos viejas de equipos y familias, sin nadie reconocible. */
function drawPhotos(ctx: Ctx, w: number): void {
  const cell = w / 3;
  const random = seeded(23);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      ctx.save();
      ctx.translate(col * cell, row * cell);
      ctx.fillStyle = '#e7dcc0';
      ctx.fillRect(0, 0, cell, cell);
      ctx.fillStyle = `rgb(${150 + random() * 40},${122 + random() * 30},${86 + random() * 20})`;
      ctx.fillRect(7, 7, cell - 14, cell - 14);
      const people = 1 + Math.floor(random() * 5);
      ctx.fillStyle = '#3a2a1c';
      for (let i = 0; i < people; i++) {
        const x = 7 + ((i + 0.5) * (cell - 14)) / people;
        const tall = cell * (0.3 + random() * 0.1);
        ctx.beginPath();
        ctx.arc(x, cell - 9 - tall, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x - 6, cell - 7 - tall, 12, tall);
      }
      ctx.restore();
    }
  }
}

function drawCalendar(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#f0e6cc';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = FILETE.red;
  ctx.fillRect(0, 0, w, 40);
  ctx.fillStyle = '#f0e6cc';
  ctx.textAlign = 'center';
  ctx.font = '400 26px Rye, Georgia, serif';
  ctx.fillText('ALMANAQUE', w / 2, 29);
  ctx.fillStyle = '#3a2a1c';
  ctx.font = '700 18px Georgia, serif';
  for (let i = 0; i < 28; i++) ctx.fillText(String(i + 1), 24 + (i % 7) * 34, 62 + Math.floor(i / 7) * 21);
}

/** Dial de la radio a válvulas, encendido. */
function drawDial(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#d9a648';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3a2412';
  ctx.font = '700 16px Georgia, serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < 7; i++) {
    const x = 26 + i * 34;
    ctx.fillRect(x, 54, 2, 22);
    ctx.fillText(String(55 + i * 15), x, 46);
  }
  ctx.fillStyle = FILETE.red;
  ctx.fillRect(112, 28, 4, 80);
  ctx.fillStyle = '#3a2412';
  ctx.fillText('ONDA LARGA', w / 2, 104);
}

/** Dicho pintado con letra de cartel antiguo. */
function drawDicho(ctx: Ctx, w: number, h: number, text: string, ground: string, band: string, ink: string): void {
  signFrame(ctx, w, h, ground, band, FILETE.black);
  lettering(ctx, text, w / 2, h / 2 + 10, 30, ink, FILETE.gold, FILETE.black, w - 70);
}

/** Etiquetas de fernet y yerba, sin ninguna marca real. */
function drawLabels2(ctx: Ctx, w: number, h: number): void {
  const half = w / 2;
  ctx.fillStyle = '#efe6cf';
  ctx.fillRect(0, 0, half, h);
  ctx.fillStyle = '#7a1f1a';
  ctx.fillRect(0, 0, half, 22);
  ctx.fillRect(0, h - 22, half, 22);
  ctx.fillStyle = '#14100c';
  ctx.textAlign = 'center';
  ctx.font = '400 24px Rye, Georgia, serif';
  ctx.fillText('FERNET', half / 2, h / 2 + 8);
  ctx.fillStyle = '#2f7d3a';
  ctx.fillRect(half, 0, half, h);
  ctx.fillStyle = '#f4e6c4';
  ctx.font = '400 30px Rye, Georgia, serif';
  ctx.fillText('YERBA', half * 1.5, h / 2 - 2);
  ctx.font = 'italic 18px Georgia, serif';
  ctx.fillText('con palo', half * 1.5, h / 2 + 26);
}

const PHOTO_REGIONS = [
  { name: 'brick', x: 0, y: 0, w: 512, h: 512 },
  { name: 'table', x: 512, y: 0, w: 512, h: 512 },
  { name: 'wood', x: 0, y: 512, w: 512, h: 256 },
  { name: 'wood_dark', x: 0, y: 768, w: 512, h: 256 },
  { name: 'plaster', x: 512, y: 512, w: 256, h: 256 },
] as const;

/** Texturas del boliche: las pinturas se generan en el navegador y las maderas y el ladrillo son fotos. */
export function buildRoomAtlas(photos?: HTMLImageElement): HTMLCanvasElement {
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
  within(ctx, 'arch_glass', (w, h) => drawArchGlass(ctx, w, h));
  within(ctx, 'medallion', (w, h) => drawMedallion(ctx, w, h));
  within(ctx, 'sign_red', (w, h) => drawRedSign(ctx, w, h));
  within(ctx, 'sign_small', (w, h) => drawSmallSign(ctx, w, h));
  within(ctx, 'glass_bar', (w, h) => drawGlass(ctx, w, h, 'BAR', FILETE.red));
  within(ctx, 'glass_cafe', (w, h) => drawGlass(ctx, w, h, 'CAFÉ', '#1f5f86'));
  within(ctx, 'poster', (w, h) => drawPoster(ctx, w, h));
  within(ctx, 'tin', (w) => drawTin(ctx, w));
  within(ctx, 'wallpaper', (w) => drawWallpaper(ctx, w));
  within(ctx, 'chalkboard', (w, h) => drawChalkboard(ctx, w, h));
  within(ctx, 'door_glass', (w, h) => drawDoorGlass(ctx, w, h));
  within(ctx, 'photos', (w) => drawPhotos(ctx, w));
  within(ctx, 'calendar', (w, h) => drawCalendar(ctx, w, h));
  within(ctx, 'dial', (w, h) => drawDial(ctx, w, h));
  within(ctx, 'dicho_a', (w, h) => drawDicho(ctx, w, h, 'Hoy no se fía, mañana sí', FILETE.cream, FILETE.red, FILETE.red));
  within(ctx, 'dicho_b', (w, h) => drawDicho(ctx, w, h, 'Truco, mate y vino', FILETE.black, FILETE.sky, FILETE.cream));
  within(ctx, 'etiquetas', (w, h) => drawLabels2(ctx, w, h));
  if (photos) {
    for (const { name, x, y, w, h } of PHOTO_REGIONS) {
      within(ctx, name, (rw, rh) => ctx.drawImage(photos, x, y, w, h, 0, 0, rw, rh));
    }
  }
  return canvas;
}
