// Genera los modelos con Blender y los comprime. Para usar otra instalación, definí la variable BLENDER.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, quantize, reorder, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = 'C:/Program Files/Blender Foundation';
const RAW = 'scripts/blender/.out/boliche.raw.glb';
const OUT = 'src/client/game/assets/boliche.glb';
const LIGHT_RAW = 'scripts/blender/.out/luz.png';
const LIGHT_OUT = 'src/client/game/assets/luz.avif';
const PROPS_RAW = 'scripts/blender/.out/utileria.png';
const PROPS_OUT = 'src/client/game/assets/utileria.avif';
const BOTTLES_RAW = 'scripts/blender/.out/botellas.png';
const BOTTLES_OUT = 'src/client/game/assets/botellas.avif';
const BOTTLES_JSON = 'src/client/game/assets/botellas.json';

function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  if (!existsSync(ROOT)) return null;
  const versions = readdirSync(ROOT).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const latest = versions.at(-1);
  return latest ? join(ROOT, latest, 'blender.exe') : null;
}

const blender = findBlender();
if (!blender || !existsSync(blender)) {
  console.error('No encontré Blender. Instalalo o definí la variable BLENDER con su ruta.');
  process.exit(1);
}

mkdirSync('scripts/blender/.out', { recursive: true });
const result = spawnSync(
  blender,
  [
    '--background', '--factory-startup', '--python-exit-code', '1',
    '--python', 'scripts/blender/boliche.py', '--', RAW, 'src/client/game/assets/room-atlas.json', LIGHT_RAW, PROPS_RAW, BOTTLES_RAW, BOTTLES_JSON,
  ],
  { encoding: 'utf8' },
);
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
if (result.status !== 0) {
  console.error(output);
  process.exit(result.status ?? 1);
}
console.log(output.split('\n').filter((line) => line.endsWith(' caras') || line.startsWith('Horneado')).join('\n'));

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const document = await io.read(RAW);
await document.transform(
  weld(),
  dedup(),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizePosition: 14, quantizeTexcoord: 13, quantizeColor: 8 }),
);
document
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(OUT, document);

// Un desenfoque mínimo se lleva el grano que deja el horneado.
// AVIF pesa la mitad que WebP con la misma calidad a la vista; de paso se lleva el grano del horneado.
await sharp(LIGHT_RAW).blur(0.7).avif({ quality: 45, effort: 7 }).toFile(LIGHT_OUT);
await sharp(PROPS_RAW).avif({ quality: 45, effort: 7 }).toFile(PROPS_OUT);
await sharp(BOTTLES_RAW).avif({ quality: 50, effort: 7 }).toFile(BOTTLES_OUT);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
console.log(`${OUT}: ${kb(statSync(OUT).size)}, con gzip ${kb(gzipSync(readFileSync(OUT)).length)} (sin comprimir ${kb(statSync(RAW).size)})`);
console.log(`${LIGHT_OUT}: ${kb(statSync(LIGHT_OUT).size)}`);
console.log(`${PROPS_OUT}: ${kb(statSync(PROPS_OUT).size)}`);
console.log(`${BOTTLES_OUT}: ${kb(statSync(BOTTLES_OUT).size)}`);
