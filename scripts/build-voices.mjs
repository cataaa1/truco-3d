// Limpia y comprime los audios de design/voces/vozN para el juego.
// Corta silencios, empareja el volumen y deja MP3 mono liviano, que suena en todos los navegadores.
// Correr con: npm run voices
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, parse } from 'node:path';
import ffmpeg from 'ffmpeg-static';

const SOURCE = process.env.VOICES_SOURCE ?? 'design/voces';
const OUT = process.env.VOICES_OUT ?? 'src/client/game/assets/voces';
const FILTER = [
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03',
  'areverse',
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08',
  'areverse',
  'loudnorm=I=-16:TP=-1.5:LRA=7',
].join(',');

if (!existsSync(SOURCE)) {
  console.error(`No existe ${SOURCE}. Dejá los audios en ${SOURCE}/voz1, ${SOURCE}/voz2, etc.`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
let count = 0;
let bytes = 0;
const problems = [];
for (const voice of readdirSync(SOURCE).filter((name) => /^voz\d+$/.test(name)).sort()) {
  mkdirSync(join(OUT, voice), { recursive: true });
  for (const file of readdirSync(join(SOURCE, voice)).filter((name) => /\.(mp3|wav|m4a|ogg|flac)$/i.test(name))) {
    const output = join(OUT, voice, `${parse(file).name.toLowerCase()}.mp3`);
    const result = spawnSync(
      ffmpeg,
      ['-y', '-loglevel', 'error', '-i', join(SOURCE, voice, file), '-af', FILTER, '-ac', '1', '-ar', '32000', '-b:a', '48k', output],
      { encoding: 'utf8' },
    );
    if (result.status !== 0 || !existsSync(output) || statSync(output).size < 500) {
      problems.push(`${voice}/${file}: ${result.stderr?.trim() || 'quedó vacío'}`);
      continue;
    }
    count += 1;
    bytes += statSync(output).size;
  }
}

console.log(`${count} audios, ${(bytes / 1024).toFixed(0)} KB en total`);
if (problems.length > 0) {
  console.error(`Con problemas:\n${problems.join('\n')}`);
  process.exit(1);
}
