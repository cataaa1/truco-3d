// Falla el build si la carga supera los límites del proyecto.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const LIMITS = { entry: 25 * KB, game: 230 * KB, ambience: 300 * KB, deck: 400 * KB, menu: 260 * KB, total: 2048 * KB };

const dir = 'dist/assets';
const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
const sizes = files.map((f) => {
  const data = readFileSync(join(dir, f));
  // Fuentes e imágenes ya vienen comprimidas: gzip no les cambia nada.
  return { f, gz: /\.(woff2|webp)$/.test(f) ? data.length : gzipSync(data).length };
});
const html = gzipSync(readFileSync('dist/index.html')).length;
const sum = (test) => sizes.filter(({ f }) => test(f)).reduce((s, x) => s + x.gz, 0);

// Entrada: lo que hace falta para poner el código. Mesa: lo necesario para jugar.
// Ambiente: el boliche, que llega cuando la mesa ya se puede usar.
const isEntry = (f) => f.startsWith('index-');
const isGame = (f) => /^(game|three|scene)/.test(f) && f.endsWith('.js');
const entry = html + sum(isEntry);
const game = sum(isGame);
const isDeck = (f) => f.startsWith('cartas-');
const deck = sum(isDeck);
const isMenu = (f) => f.startsWith('menu-') && f.endsWith('.webp');
const menu = sum(isMenu);
const ambience = sum((f) => !isEntry(f) && !isGame(f) && !isDeck(f) && !isMenu(f));
const total = entry + game + ambience + deck + menu;

const report = (name, value, limit) => {
  const ok = value <= limit;
  console.log(`${ok ? 'OK ' : 'MAL'} ${name}: ${(value / KB).toFixed(1)} KB (límite ${(limit / KB).toFixed(0)} KB)`);
  return ok;
};

const results = [
  report('entrada, sin 3D', entry, LIMITS.entry),
  report('mesa jugable', game, LIMITS.game),
  report('boliche y fuente', ambience, LIMITS.ambience),
  report('mazo de cartas', deck, LIMITS.deck),
  report('carteles del inicio', menu, LIMITS.menu),
  report('total', total, LIMITS.total),
];
if (results.includes(false)) process.exit(1);
