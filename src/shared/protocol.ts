import type { Action, GameEvent, PlayerCount, PlayerView } from '../engine/game';

export const SENAS = [
  { id: 'ancho_espada', card: 'Ancho de espada', gesture: 'Levantar las cejas' },
  { id: 'ancho_basto', card: 'Ancho de basto', gesture: 'Guiñar el ojo derecho' },
  { id: 'siete_espada', card: '7 de espada', gesture: 'Torcer la boca a la derecha' },
  { id: 'siete_oro', card: '7 de oro', gesture: 'Torcer la boca a la izquierda' },
  { id: 'tres', card: 'Un 3', gesture: 'Morder el labio inferior' },
  { id: 'dos', card: 'Un 2', gesture: 'Tirar un beso' },
  { id: 'ancho_falso', card: 'Ancho falso', gesture: 'Abrir un poco la boca' },
  { id: 'nada', card: 'Nada que valga', gesture: 'Cerrar los ojos' },
  { id: 'envido', card: 'Tengo envido (30 o más)', gesture: 'Fruncir la nariz' },
] as const;

export type SenaId = (typeof SENAS)[number]['id'];
export const isSena = (id: unknown): id is SenaId => SENAS.some((s) => s.id === id);
export const SENA_MS = 1400;

export const PHRASES = [
  '¡Dale, que se hace tarde!',
  '¡Vamos, compañero!',
  'Mirá vos...',
  'Buena esa',
  '¡Uh, la pucha!',
  '¿Y ahora?',
] as const;

export interface SeatInfo {
  name: string;
  bot: boolean;
  connected: boolean;
}

export interface RoomInfo {
  code: string;
  public: boolean;
  players: PlayerCount;
  target: 15 | 30;
  status: 'lobby' | 'playing' | 'finished';
  host: number;
  seats: (SeatInfo | null)[];
  /** Momento en que una sala de "jugar ya" se completa sola con bots. */
  autoStartAt: number | null;
}

export interface PublicRoom {
  code: string;
  players: PlayerCount;
  target: 15 | 30;
  taken: number;
  quick: boolean;
}

export type ClientMessage =
  | { t: 'act'; a: Action }
  | { t: 'gaze'; y: number; p: number }
  | { t: 'sena'; id: SenaId }
  | { t: 'phrase'; i: number }
  | { t: 'start'; fill: boolean };

export type ServerMessage =
  | { t: 'room'; room: RoomInfo; you: number; token: string }
  | { t: 'game'; view: PlayerView; events: GameEvent[]; deadline: number | null }
  | { t: 'gaze'; s: number; y: number; p: number }
  | { t: 'sena'; s: number; id: SenaId; ms: number }
  | { t: 'phrase'; s: number; i: number }
  | { t: 'err'; msg: string };

export const MAX_YAW = (115 * Math.PI) / 180;
export const MIN_PITCH = (-65 * Math.PI) / 180;
export const MAX_PITCH = (25 * Math.PI) / 180;
const CONE_YAW = (35 * Math.PI) / 180;
const MIN_READ_PITCH = (-20 * Math.PI) / 180;

/**
 * Dirección hacia otro asiento desde `observer`, con 0 mirando al centro de la mesa
 * y positivo hacia la derecha. Los asientos forman un círculo y el siguiente queda a la derecha.
 */
export function bearingTo(observer: number, target: number, players: number): number {
  const delta = (((target - observer + players) % players) * 2 * Math.PI) / players;
  return Math.atan2(Math.sin(delta), 1 - Math.cos(delta));
}

/** Decide en el servidor si un jugador alcanza a ver la cara de otro. */
export function canSee(
  observer: number,
  target: number,
  players: number,
  yaw: number,
  pitch: number,
): boolean {
  if (observer === target || pitch < MIN_READ_PITCH) return false;
  return Math.abs(yaw - bearingTo(observer, target, players)) <= CONE_YAW;
}

export function cleanName(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} _.-]/gu, '').trim() : '';
  return text.slice(0, 16) || 'Invitado';
}
