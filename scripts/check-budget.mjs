// Falla el build si la carga supera los límites del proyecto.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const LIMITS = { entry: 25 * KB, game: 230 * KB, ambience: 300 * KB, total: 2048 * KB };

const dir = 'dist/assets';
const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
const sizes = files.map((f) => {
  const data = readFileSync(join(dir, f));
  // La fuente ya viene comprimida: no se le suma nada por gzip.
  return { f, gz: f.endsWith('.woff2') ? data.length : gzipSync(data).length };
});
const html = gzipSync(readFileSync('dist/index.html')).length;
const sum = (test) => sizes.filter(({ f }) => test(f)).reduce((s, x) => s + x.gz, 0);

// Entrada: lo que hace falta para poner el código. Mesa: lo necesario para jugar.
// Ambiente: el boliche, que llega cuando la mesa ya se puede usar.
const isEntry = (f) => f.startsWith('index-');
const isGame = (f) => /^(game|three|scene)/.test(f) && f.endsWith('.js');
const entry = html + sum(isEntry);
const game = sum(isGame);
const ambience = sum((f) => !isEntry(f) && !isGame(f));
const total = entry + game + ambience;

const report = (name, value, limit) => {
  const ok = value <= limit;
  console.log(`${ok ? 'OK ' : 'MAL'} ${name}: ${(value / KB).toFixed(1)} KB (límite ${(limit / KB).toFixed(0)} KB)`);
  return ok;
};

const results = [
  report('entrada, sin 3D', entry, LIMITS.entry),
  report('mesa jugable', game, LIMITS.game),
  report('boliche y fuente', ambience, LIMITS.ambience),
  report('total', total, LIMITS.total),
];
if (results.includes(false)) process.exit(1);
