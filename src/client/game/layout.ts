// Dónde queda cada carta jugada. Sin dependencias de Three.js para poder probarlo aparte.
export const PLAYED_W = 0.15;
export const PLAYED_H = 0.234;
const PLAYED_GAP = 0.03;
// Mi fila arranca justo delante de las cartas que tengo en la mano, para que no las tapen.
const MY_ROW_FROM_SEAT = 0.98;
const OTHERS_ROW = { 2: 0.5, 4: 0.5, 6: 0.66 } as Record<number, number>;
const CARD_Y = 0.003;

export interface TableSize {
  seatRadius: number;
  tableRadius: number;
}

export function tableSize(players: number): TableSize {
  const seatRadius = players === 6 ? 1.5 : 1.25;
  return { seatRadius, tableRadius: seatRadius - 0.34 };
}

export interface PlayedCard {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/** `slot` es la posición del asiento contando desde mí (0 soy yo) y `round` la ronda de la mano. */
export function playedCard(players: number, slot: number, round: number): PlayedCard {
  const { seatRadius, tableRadius } = tableSize(players);
  const angle = (slot * 2 * Math.PI) / players;
  const spot = slot === 0 ? seatRadius - MY_ROW_FROM_SEAT : tableRadius * OTHERS_ROW[players]!;
  const centerX = Math.sin(angle) * spot;
  const centerZ = Math.cos(angle) * spot;
  // Todas las cartas del mismo tamaño, mirando hacia quien las tiró (el borde de arriba de la carta apunta al centro
  // de la mesa). Cada jugador arma una fila recta a lo largo de su borde, con la primera carta en el centro del lugar.
  const offset = (round - 1) * (PLAYED_W + PLAYED_GAP);
  return {
    x: centerX + Math.cos(angle) * offset,
    y: CARD_Y + round * 0.001,
    z: centerZ - Math.sin(angle) * offset,
    yaw: angle,
    scale: 1,
  };
}
