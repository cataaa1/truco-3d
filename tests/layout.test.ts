import { describe, expect, it } from 'vitest';
import { PLAYED_H, PLAYED_W, playedCard, tableSize, type PlayedCard } from '../src/client/game/layout';

function corners(card: PlayedCard): [number, number][] {
  const w = (PLAYED_W * card.scale) / 2;
  const h = (PLAYED_H * card.scale) / 2;
  const cos = Math.cos(card.yaw);
  const sin = Math.sin(card.yaw);
  return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([a, b]) => [card.x + a! * cos + b! * sin, card.z - a! * sin + b! * cos]);
}

/** Separación entre dos rectángulos; negativa si se pisan. */
function gap(a: PlayedCard, b: PlayedCard): number {
  const [pa, pb] = [corners(a), corners(b)];
  let best = -Infinity;
  for (const yaw of [a.yaw, b.yaw]) {
    for (const [ax, az] of [[Math.cos(yaw), -Math.sin(yaw)], [Math.sin(yaw), Math.cos(yaw)]] as const) {
      const project = (points: [number, number][]) => points.map(([x, z]) => x * ax + z * az);
      const [ra, rb] = [project(pa), project(pb)];
      best = Math.max(best, Math.min(...rb) - Math.max(...ra), Math.min(...ra) - Math.max(...rb));
    }
  }
  return best;
}

describe.each([2, 4, 6])('cartas jugadas en mesa de %i', (players) => {
  const cards = Array.from({ length: players }, (_, slot) => [0, 1, 2].map((round) => playedCard(players, slot, round))).flat();

  it('ninguna pisa a otra', () => {
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) expect(gap(cards[i]!, cards[j]!)).toBeGreaterThan(0.015);
    }
  });

  it('todas quedan adentro de la mesa', () => {
    const { tableRadius } = tableSize(players);
    for (const card of cards) for (const [x, z] of corners(card)) expect(Math.hypot(x, z)).toBeLessThan(tableRadius - 0.04);
  });

  it('las mías quedan de mi lado de la mesa', () => {
    for (const round of [0, 1, 2]) expect(playedCard(players, 0, round).z).toBeGreaterThan(0.3);
  });
});
