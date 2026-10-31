import { describe, expect, it } from 'vitest';
import { botAction } from '../src/engine/bot';
import { envidoPoints, hasFlor, makeCard, strength } from '../src/engine/cards';
import {
  applyAction,
  createGame,
  decideHand,
  envidoAccepted,
  envidoRejected,
  legalActions,
  nextHand,

  timeoutAction,
  viewFor,
  type Config,
  type GameState,
} from '../src/engine/game';
import { bearingTo, canSee } from '../src/shared/protocol';

const c = makeCard;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Partida con manos fijas: la mano es el asiento 0. */
function rigged(hands: number[][], config: Partial<Config> = {}): GameState {
  const players = hands.length as 2 | 4 | 6;
  const state = createGame({ players, target: 30, flor: false, ...config }, seeded(1));
  state.dealer = players - 1;
  state.hand.mano = 0;
  state.hand.turn = 0;
  state.hand.dealt = hands.map((h) => [...h]);
  state.hand.cards = hands.map((h) => [...h]);
  state.events = [];
  return state;
}

describe('jerarquía y tantos', () => {
  it('respeta el orden de las cartas', () => {
    const order = [
      c('espada', 1), c('basto', 1), c('espada', 7), c('oro', 7), c('copa', 3), c('copa', 2),
      c('oro', 1), c('oro', 12), c('oro', 11), c('oro', 10), c('copa', 7), c('oro', 6), c('oro', 5), c('oro', 4),
    ];
    for (let i = 1; i < order.length; i++) expect(strength(order[i - 1]!)).toBeGreaterThan(strength(order[i]!));
    expect(strength(c('copa', 1))).toBe(strength(c('oro', 1)));
  });

  it('calcula los tantos', () => {
    expect(envidoPoints([c('oro', 7), c('oro', 6), c('copa', 1)])).toBe(33);
    expect(envidoPoints([c('oro', 10), c('oro', 12), c('copa', 1)])).toBe(20);
    expect(envidoPoints([c('oro', 7), c('copa', 5), c('espada', 3)])).toBe(7);
    expect(envidoPoints([c('oro', 7), c('oro', 5), c('oro', 3)])).toBe(32);
    expect(hasFlor([c('oro', 7), c('oro', 5), c('oro', 3)])).toBe(true);
  });
});

describe('parda', () => {
  it('parda la primera: decide la segunda, luego la tercera, luego la mano', () => {
    expect(decideHand([null, 1], 0)).toBe(1);
    expect(decideHand([null, null], 0)).toBe(null);
    expect(decideHand([null, null, 1], 0)).toBe(1);
    expect(decideHand([null, null, null], 1)).toBe(1);
  });

  it('parda la segunda o la tercera: gana quien ganó la primera', () => {
    expect(decideHand([0, null], 1)).toBe(0);
    expect(decideHand([0, 1, null], 1)).toBe(0);
    expect(decideHand([0, 0], 1)).toBe(0);
    expect(decideHand([0, 1], 1)).toBe(null);
    expect(decideHand([0, 1, 1], 0)).toBe(1);
  });

  it('dos cartas iguales del mismo equipo no son parda', () => {
    const s = rigged([
      [c('oro', 3), c('oro', 4), c('oro', 5)],
      [c('copa', 4), c('copa', 5), c('copa', 6)],
      [c('copa', 3), c('espada', 4), c('espada', 5)],
      [c('basto', 4), c('basto', 5), c('basto', 6)],
    ]);
    applyAction(s, 0, { t: 'play', card: c('oro', 3) });
    applyAction(s, 1, { t: 'play', card: c('copa', 4) });
    applyAction(s, 2, { t: 'play', card: c('copa', 3) });
    applyAction(s, 3, { t: 'play', card: c('basto', 4) });
    expect(s.hand.roundWinners).toEqual([0]);
  });
});

describe('envido', () => {
  it('acumula según la tabla', () => {
    expect(envidoAccepted(['envido'], 0)).toBe(2);
    expect(envidoAccepted(['real'], 0)).toBe(3);
    expect(envidoAccepted(['envido', 'envido'], 0)).toBe(4);
    expect(envidoAccepted(['envido', 'real'], 0)).toBe(5);
    expect(envidoAccepted(['envido', 'envido', 'real'], 0)).toBe(7);
    expect(envidoRejected(['envido'])).toBe(1);
    expect(envidoRejected(['real'])).toBe(1);
    expect(envidoRejected(['envido', 'envido'])).toBe(2);
    expect(envidoRejected(['envido', 'real'])).toBe(2);
    expect(envidoRejected(['envido', 'envido', 'real'])).toBe(4);
    expect(envidoRejected(['falta'])).toBe(1);
  });

  const hands = [
    [c('oro', 7), c('oro', 6), c('copa', 1)],
    [c('espada', 7), c('espada', 6), c('copa', 2)],
  ];

  it('el empate lo gana la mano', () => {
    const s = rigged(hands);
    applyAction(s, 0, { t: 'envido', call: 'envido' });
    applyAction(s, 1, { t: 'quiero' });
    expect(s.scores).toEqual([2, 0]);
    expect(legalActions(s, 0).some((a) => a.t === 'envido')).toBe(false);
  });

  it('falta: si gana el líder gana la partida, si no suma lo que le falta al líder', () => {
    const leader = rigged(hands);
    leader.scores = [20, 10];
    applyAction(leader, 0, { t: 'envido', call: 'falta' });
    applyAction(leader, 1, { t: 'quiero' });
    expect(leader.scores[0]).toBe(30);
    expect(leader.phase).toBe('gameOver');

    const trailing = rigged(hands);
    trailing.scores = [10, 20];
    applyAction(trailing, 0, { t: 'envido', call: 'falta' });
    applyAction(trailing, 1, { t: 'quiero' });
    expect(trailing.scores).toEqual([20, 20]);
    expect(trailing.phase).toBe('playing');
  });

  it('el envido está primero y después sigue el truco pendiente', () => {
    const s = rigged(hands);
    applyAction(s, 0, { t: 'truco' });
    expect(applyAction(s, 1, { t: 'envido', call: 'envido' })).toBe(true);
    applyAction(s, 0, { t: 'noquiero' });
    expect(s.scores).toEqual([0, 1]);
    expect(s.hand.trucoPending?.level).toBe(1);
    expect(legalActions(s, 1).some((a) => a.t === 'quiero')).toBe(true);
  });

  it('no se puede abrir después de jugar la carta propia ni con truco aceptado', () => {
    const s = rigged(hands);
    applyAction(s, 0, { t: 'play', card: c('copa', 1) });
    expect(legalActions(s, 0).some((a) => a.t === 'envido')).toBe(false);
    expect(legalActions(s, 1).some((a) => a.t === 'envido')).toBe(true);
    applyAction(s, 1, { t: 'truco' });
    applyAction(s, 0, { t: 'quiero' });
    expect(legalActions(s, 1).some((a) => a.t === 'envido')).toBe(false);
  });
});

describe('truco', () => {
  const hands = [
    [c('espada', 1), c('basto', 1), c('espada', 7)],
    [c('oro', 4), c('oro', 5), c('oro', 6)],
  ];

  it('solo sube quien tiene el quiero, y los valores son 2, 3 y 4', () => {
    const s = rigged(hands);
    applyAction(s, 0, { t: 'truco' });
    applyAction(s, 1, { t: 'quiero' });
    expect(s.hand.trucoHolder).toBe(1);
    expect(legalActions(s, 0).some((a) => a.t === 'truco')).toBe(false);
    applyAction(s, 1, { t: 'truco' });
    applyAction(s, 0, { t: 'truco' });
    expect(s.hand.trucoPending?.level).toBe(3);
    applyAction(s, 1, { t: 'quiero' });
    applyAction(s, 0, { t: 'play', card: c('espada', 1) });
    applyAction(s, 1, { t: 'play', card: c('oro', 4) });
    applyAction(s, 0, { t: 'play', card: c('basto', 1) });
    applyAction(s, 1, { t: 'play', card: c('oro', 5) });
    expect(s.scores).toEqual([4, 0]);
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
  ])('rechazar el nivel %i da %i', (level, points) => {
    const s = rigged(hands);
    applyAction(s, 0, { t: 'truco' });
    if (level >= 2) applyAction(s, 1, { t: 'truco' });
    if (level >= 3) applyAction(s, 0, { t: 'truco' });
    const answerSeat = level % 2 === 1 ? 1 : 0;
    applyAction(s, answerSeat, { t: 'noquiero' });
    expect(s.scores[level % 2 === 1 ? 0 : 1]).toBe(points);
  });

  it('sin truco la mano vale 1', () => {
    const s = rigged(hands);
    applyAction(s, 0, { t: 'play', card: c('espada', 1) });
    applyAction(s, 1, { t: 'play', card: c('oro', 4) });
    applyAction(s, 0, { t: 'play', card: c('basto', 1) });
    applyAction(s, 1, { t: 'play', card: c('oro', 5) });
    expect(s.scores).toEqual([1, 0]);
  });
});

describe('mazo', () => {
  const hands = [
    [c('espada', 1), c('basto', 1), c('espada', 7)],
    [c('oro', 4), c('oro', 5), c('oro', 6)],
  ];

  it('antes del envido pierde 1 por envido y 1 por truco', () => {
    const s = rigged(hands);
    applyAction(s, 0, { t: 'mazo' });
    expect(s.scores).toEqual([0, 2]);
  });

  it('con el envido pasado pierde solo el truco', () => {
    const s = rigged(hands);
    applyAction(s, 0, { t: 'play', card: c('espada', 1) });
    applyAction(s, 1, { t: 'play', card: c('oro', 4) });
    applyAction(s, 0, { t: 'mazo' });
    expect(s.scores).toEqual([0, 1]);
  });
});

describe('información oculta', () => {
  it('la vista no incluye cartas ajenas', () => {
    const s = createGame({ players: 4, target: 30, flor: false }, seeded(5));
    const view = viewFor(s, 0);
    const text = JSON.stringify(view);
    expect(text).not.toContain('"dealt"');
    expect(text).not.toContain('"cards"');
    expect(view.myCards).toEqual(s.hand.cards[0]);
  });
});

describe('visión de las señas', () => {
  it('ubica a los demás en el arco correcto', () => {
    expect(bearingTo(0, 2, 4)).toBeCloseTo(0);
    expect(bearingTo(0, 1, 4)).toBeCloseTo(Math.PI / 4);
    expect(bearingTo(0, 3, 4)).toBeCloseTo(-Math.PI / 4);
    expect(bearingTo(0, 2, 6)).toBeCloseTo(Math.PI / 6);
    expect(bearingTo(0, 3, 6)).toBeCloseTo(0);
  });

  it('solo se ve con la cabeza levantada y apuntando', () => {
    expect(canSee(0, 2, 4, 0, 0)).toBe(true);
    expect(canSee(0, 2, 4, 0, -0.6)).toBe(false);
    expect(canSee(0, 2, 4, 1.2, 0)).toBe(false);
    expect(canSee(0, 1, 4, 0, 0)).toBe(false);
    expect(canSee(0, 0, 4, 0, 0)).toBe(false);
  });
});

describe('simulación', () => {
  it.each([2, 4, 6] as const)('%i jugadores: 400 partidas con jugadas al azar y con bots', (players) => {
    for (let game = 0; game < 400; game++) {
      const random = seeded(game * 31 + players);
      const flor = game % 2 === 0;
      const useBots = game % 4 < 2;
      const s = createGame({ players, target: game % 3 === 0 ? 15 : 30, flor }, random);
      let steps = 0;
      while (s.phase !== 'gameOver') {
        expect(++steps).toBeLessThan(20_000);
        if (s.phase === 'handOver') {
          nextHand(s, random);
          continue;
        }
        const before = [...s.scores];
        const seat = pickActor(s, random);
        const action = useBots ? botAction(s, seat, random) : null;
        const legal = legalActions(s, seat);
        const chosen = action ?? legal[Math.floor(random() * legal.length)];
        if (chosen) expect(applyAction(s, seat, chosen)).toBe(true);
        else {
          const timeout = timeoutAction(s);
          expect(timeout).not.toBeNull();
          expect(applyAction(s, timeout!.seat, timeout!.action)).toBe(true);
        }
        expect(s.scores[0]).toBeGreaterThanOrEqual(before[0]!);
        expect(s.scores[1]).toBeGreaterThanOrEqual(before[1]!);
        const allCards = [...s.hand.cards.flat(), ...s.hand.rounds.flat().map((p) => p.card)];
        expect(new Set(allCards).size).toBe(allCards.length);
      }
      expect(s.winner).not.toBeNull();
      expect(s.scores[s.winner!]).toBe(s.config.target);
    }
  }, 120_000);
});

function pickActor(s: GameState, random: () => number): number {
  const responders = Array.from({ length: s.config.players }, (_, seat) => seat).filter(
    (seat) => legalActions(s, seat).some((a) => a.t === 'quiero'),
  );
  if (responders.length > 0) return responders[Math.floor(random() * responders.length)]!;
  if (random() < 0.1) {
    const seat = Math.floor(random() * s.config.players);
    if (legalActions(s, seat).length > 0) return seat;
  }
  return s.hand.turn;
}

