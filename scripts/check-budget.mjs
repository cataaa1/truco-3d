// Falla el build si la carga supera los límites del proyecto.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const LIMITS = { entry: 25 * KB, game: 230 * KB, total: 2048 * KB };

const dir = 'dist/assets';
const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
const size = (f) => gzipSync(readFileSync(join(dir, f))).length;
const sizes = files.map((f) => ({ f, gz: size(f) }));
const html = gzipSync(readFileSync('dist/index.html')).length;

const entry = sizes.filter(({ f }) => f.startsWith('index-')).reduce((s, x) => s + x.gz, html);
const game = sizes.filter(({ f }) => !f.startsWith('index-')).reduce((s, x) => s + x.gz, 0);
const total = entry + game;

const report = (name, value, limit) => {
  const ok = value <= limit;
  console.log(`${ok ? 'OK ' : 'MAL'} ${name}: ${(value / KB).toFixed(1)} KB gzip (límite ${(limit / KB).toFixed(0)} KB)`);
  return ok;
};

const results = [
  report('entrada, sin 3D', entry, LIMITS.entry),
  report('mesa 3D', game, LIMITS.game),
  report('total', total, LIMITS.total),
];
if (results.includes(false)) process.exit(1);
