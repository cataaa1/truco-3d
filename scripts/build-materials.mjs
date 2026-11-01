// Arma la lámina de materiales del boliche a partir de fotos CC0 de Poly Haven (polyhaven.com).
// Uso: npm run materials -- <carpeta con los *_diff_1k.jpg>
import { statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const dir = process.argv[2];
if (!dir) throw new Error('Falta la carpeta con las texturas');
const OUT = 'src/client/game/assets/materiales.webp';
const photo = (name) => sharp(join(dir, `${name}_diff_1k.jpg`));

/** Solo la veta y el grano, con brillo parejo: el color lo pone cada pieza del modelo. */
async function grain(name, width, height) {
  const small = photo(name).resize(width, height, { fit: 'fill' }).grayscale();
  const { channels } = await small.clone().stats();
  const gain = 205 / channels[0].mean;
  return small.linear(gain, 0).toColourspace('srgb').png().toBuffer();
}

const inPlace = async (input, left, top) => ({ input: await input, left, top });
const layers = await Promise.all([
  inPlace(photo('red_brick_03').resize(512, 512).modulate({ brightness: 1.3, saturation: 1.1 }).png().toBuffer(), 0, 0),
  inPlace(photo('dark_wood').resize(512, 512).modulate({ brightness: 1.55 }).png().toBuffer(), 512, 0),
  inPlace(grain('dark_wood', 512, 256), 0, 512),
  inPlace(grain('wood_table_001', 512, 256), 0, 768),
  inPlace(grain('beige_wall_001', 256, 256), 512, 512),
]);
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#000' } })
  .composite(layers)
  .webp({ quality: 74, effort: 6 })
  .toFile(OUT);
console.log(`${OUT}: ${(statSync(OUT).size / 1024).toFixed(0)} KB`);
