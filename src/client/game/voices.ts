import { bearingTo } from '../../shared/protocol';
import barUrl from './assets/ambiente-bar.mp3?url';

// Solo son direcciones de archivo: cada audio se baja recién cuando su voz está en la mesa.
const FILES = import.meta.glob('./assets/voces/*/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const LIBRARY = new Map<string, Map<string, string>>();
for (const [path, url] of Object.entries(FILES)) {
  const match = /\/(voz\d+)\/([^/]+)\.mp3$/.exec(path);
  if (!match) continue;
  const clips = LIBRARY.get(match[1]!) ?? new Map<string, string>();
  clips.set(match[2]!, url);
  LIBRARY.set(match[1]!, clips);
}
// El ruido del bar queda bien de fondo: las voces de la mesa tienen que oírse encima.
const BAR_VOLUME = 0.25;

const VOICE_NAMES = [...LIBRARY.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Voz provisoria del navegador, para las frases que todavía no tienen audio. */
function speakFallback(text: string): void {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-AR';
  utterance.rate = 1.15;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

export class TableVoices {
  private isMuted = false;
  private readonly context = window.AudioContext ? new AudioContext() : null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly playing = new Map<number, AudioBufferSourceNode>();
  private readonly resume = () => void this.context?.resume();
  private closed = false;
  private barGain: GainNode | null = null;

  constructor(
    private readonly code: string,
    private readonly players: number,
    private readonly me: number,
  ) {
    document.addEventListener('pointerdown', this.resume);
    document.addEventListener('keydown', this.resume);
    this.scheduleLoading();
  }

  get muted(): boolean {
    return this.isMuted;
  }

  set muted(value: boolean) {
    this.isMuted = value;
    if (this.barGain) this.barGain.gain.value = value ? 0 : BAR_VOLUME;
    if (value) for (const source of this.playing.values()) source.stop();
  }

  /** Empieza a sonar con el primer clic: antes el navegador no deja reproducir nada. */
  private async startBar(): Promise<void> {
    if (!this.context) return;
    try {
      const response = await fetch(barUrl);
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      if (this.closed) return;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      // El relleno que agrega el formato mp3 en las puntas queda afuera del bucle.
      source.loopStart = 0.06;
      source.loopEnd = buffer.duration - 0.06;
      this.barGain = this.context.createGain();
      this.barGain.gain.value = this.isMuted ? 0 : BAR_VOLUME;
      source.connect(this.barGain).connect(this.context.destination);
      source.start(0, 0.06);
    } catch {
      // Sin ruido de fondo se juega igual.
    }
  }

  /**
   * Cada personaje tiene una voz exclusiva, igual en todas las pantallas.
   * Si hay menos voces que asientos, los que sobran quedan sin voz en lugar de compartir una.
   */
  private voiceOf(seat: number): string | undefined {
    return VOICE_NAMES[(hash(this.code) + seat) % this.players];
  }

  /** Se baja después de que la mesa ya se puede usar: primero los cantos, después el resto. */
  private scheduleLoading(): void {
    // Con tiempo máximo: si el navegador nunca queda libre, los audios igual se bajan.
    const load = () => void this.loadAll();
    if (window.requestIdleCallback) window.requestIdleCallback(load, { timeout: 1200 });
    else setTimeout(load, 300);
  }

  private async loadAll(): Promise<void> {
    const seats = Array.from({ length: this.players }, (_, seat) => seat);
    const voices = seats.flatMap((seat) => this.voiceOf(seat) ?? []);
    const queue = voices.flatMap((voice) => [...(LIBRARY.get(voice ?? '') ?? new Map<string, string>())].map(([clip, url]) => ({ key: `${voice}/${clip}`, url })));
    for (let worker = 0; worker < 4; worker++) void this.drain(queue);
    void this.startBar();
  }

  private async drain(queue: { key: string; url: string }[]): Promise<void> {
    while (!this.closed && this.context && queue.length > 0) {
      const { key, url } = queue.shift()!;
      try {
        const response = await fetch(url);
        this.buffers.set(key, await this.context.decodeAudioData(await response.arrayBuffer()));
      } catch {
        // Si un audio falla, esa frase usa la voz del navegador.
      }
    }
  }

  has(seat: number, clip: string): boolean {
    return this.buffers.has(`${this.voiceOf(seat)}/${clip}`);
  }

  /** Reproduce la frase de un asiento. Sin audio, usa `fallback` si lo hay; si no, queda en silencio. */
  play(seat: number, clip: string, fallback?: string): void {
    if (this.muted || this.closed) return;
    const buffer = this.buffers.get(`${this.voiceOf(seat)}/${clip}`);
    if (!buffer || !this.context) {
      // La voz del navegador sería la misma para todos: solo se usa si todavía no hay ninguna grabada.
      if (fallback && VOICE_NAMES.length === 0) speakFallback(fallback);
      return;
    }
    void this.context.resume();
    this.playing.get(seat)?.stop();
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const pan = this.context.createStereoPanner();
    // Cada voz suena del lado de la mesa donde está sentado ese jugador.
    pan.pan.value = seat === this.me ? 0 : Math.max(-0.75, Math.min(0.75, bearingTo(this.me, seat, this.players) / (Math.PI / 2)));
    source.connect(pan).connect(this.context.destination);
    source.onended = () => {
      if (this.playing.get(seat) === source) this.playing.delete(seat);
    };
    this.playing.set(seat, source);
    source.start();
  }

  /** Elige igual en todas las pantallas, a partir de datos que comparten. */
  pick(salt: string, options: readonly string[]): string {
    return options[hash(`${this.code}:${salt}`) % options.length]!;
  }

  dispose(): void {
    this.closed = true;
    document.removeEventListener('pointerdown', this.resume);
    document.removeEventListener('keydown', this.resume);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    void this.context?.close();
  }
}
