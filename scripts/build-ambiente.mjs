// Corta el ruido de bar en un bucle sin costura. Uso: npm run ambiente -- "<audio largo>" [segundo de inicio]
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';

const [source, startAt = '240'] = process.argv.slice(2);
if (!source) throw new Error('Falta el archivo de audio');
const OUT = 'src/client/game/assets/ambiente-bar.mp3';
const LOOP = 40;
const FADE = 3;
const start = Number(startAt);

// El final se funde con el principio: al repetir, el audio sigue justo donde estaba.
const filter = [
  `[0:a]aformat=channel_layouts=mono,highpass=f=110,lowpass=f=7000,acompressor=threshold=0.08:ratio=4:attack=20:release=400,asplit=3[a][b][c]`,
  `[a]atrim=${LOOP}:${LOOP + FADE},asetpts=PTS-STARTPTS[tail]`,
  `[b]atrim=0:${FADE},asetpts=PTS-STARTPTS[head]`,
  `[c]atrim=${FADE}:${LOOP},asetpts=PTS-STARTPTS[body]`,
  `[tail]afade=t=out:d=${FADE}[out1]`,
  `[head]afade=t=in:d=${FADE}[in1]`,
  `[out1][in1]amix=inputs=2:normalize=0[seam]`,
  `[seam][body]concat=n=2:v=0:a=1[out]`,
].join(';');

execFileSync(
  ffmpeg,
  ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-t', String(LOOP + FADE), '-i', source, '-filter_complex', filter, '-map', '[out]', '-ar', '32000', '-b:a', '48k', '-map_metadata', '-1', OUT],
  { stdio: 'inherit' },
);
console.log(`${OUT}: ${(statSync(OUT).size / 1024).toFixed(0)} KB`);
