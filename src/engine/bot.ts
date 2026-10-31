import { cardRank, cardSuit, envidoPoints, strength, type CardId } from './cards';
import type { SenaId } from '../shared/protocol';
import { legalActions, teamOf, type Action, type GameState } from './game';

/** Lo que el bot sabe por las señas de su compañero. */
export interface BotHints {
  partnerHasEnvido?: boolean;
}

/** Decide usando solo la información que tendría ese jugador: sus cartas, la mesa y las señas que vio. */
export function botAction(
  state: GameState,
  seat: number,
  random: () => number = Math.random,
  hints: BotHints = {},
): Action | null {
  const legal = legalActions(state, seat);
  if (legal.length === 0) return null;
  const { hand } = state;
  const has = (t: Action['t']) => legal.some((a) => a.t === t);
  const tantos = envidoPoints(hand.dealt[seat]!);
  const remaining = hand.cards[seat]!;
  const power = remaining.reduce((sum, c) => sum + strength(c), 0) / Math.max(1, remaining.length);
  const envidoCall = (call: 'envido' | 'real' | 'falta'): Action | undefined =>
    legal.find((a) => a.t === 'envido' && a.call === call);

  if (has('flor')) return { t: 'flor' };

  if (hand.florPending) return random() < 0.6 ? { t: 'quiero' } : { t: 'noquiero' };

  if (hand.envidoPending) {
    if (tantos >= 32) return envidoCall('falta') ?? { t: 'quiero' };
    if (tantos >= 30) return envidoCall('real') ?? { t: 'quiero' };
    return hints.partnerHasEnvido || tantos >= 26 || random() < 0.1 ? { t: 'quiero' } : { t: 'noquiero' };
  }

  if (hand.trucoPending) {
    if (hints.partnerHasEnvido || tantos >= 28) {
      const open = envidoCall('envido');
      if (open) return open;
    }
    if (has('truco') && power >= 11 && random() < 0.5) return { t: 'truco' };
    // Pesa la mejor carta que le queda y cómo viene la mano; a veces acepta de farol.
    const best = Math.max(...remaining.map(strength), 0);
    const won = hand.roundWinners.filter((w) => w === teamOf(seat)).length;
    const lost = hand.roundWinners.filter((w) => w !== null && w !== teamOf(seat)).length;
    const want = best * 0.6 + power * 0.4 + (won - lost) * 2;
    return want >= 8 || random() < 0.25 ? { t: 'quiero' } : { t: 'noquiero' };
  }

  if (hand.turn !== seat) return null;

  if (hints.partnerHasEnvido) {
    const open = envidoCall('envido');
    if (open) return open;
  }
  if (tantos >= 28 && random() < 0.8) {
    const open = envidoCall(tantos >= 31 ? 'real' : 'envido');
    if (open) return open;
  }
  if (has('truco') && (power >= 11 ? random() < 0.5 : random() < 0.06)) return { t: 'truco' };

  const card = chooseCard(state, seat, remaining);
  return card === undefined ? null : { t: 'play', card };
}

function senaForCard(card: CardId): SenaId {
  const rank = cardRank(card);
  const suit = cardSuit(card);
  if (rank === 1 && suit === 'espada') return 'ancho_espada';
  if (rank === 1 && suit === 'basto') return 'ancho_basto';
  if (rank === 7 && suit === 'espada') return 'siete_espada';
  if (rank === 7 && suit === 'oro') return 'siete_oro';
  if (rank === 3) return 'tres';
  if (rank === 2) return 'dos';
  if (rank === 1) return 'ancho_falso';
  return 'nada';
}

/** La próxima seña verdadera para el compañero: primero el envido y después la mejor carta. */
export function botSena(state: GameState, seat: number, done: ReadonlySet<SenaId>): SenaId | null {
  const { hand } = state;
  const canUseEnvido = hand.roundWinners.length === 0 && !hand.envidoDone && !hand.florDone;
  if (canUseEnvido && envidoPoints(hand.dealt[seat]!) >= 30 && !done.has('envido')) return 'envido';
  const remaining = hand.cards[seat]!;
  if (remaining.length === 0) return null;
  const best = remaining.reduce((a, b) => (strength(b) > strength(a) ? b : a));
  const sena = senaForCard(best);
  return done.has(sena) ? null : sena;
}

function chooseCard(state: GameState, seat: number, cards: readonly CardId[]): CardId | undefined {
  const sorted = [...cards].sort((a, b) => strength(a) - strength(b));
  const round = state.hand.rounds[state.hand.rounds.length - 1]!;
  if (round.length === 0) return sorted[sorted.length - 1];
  const best = round.reduce((a, b) => (strength(b.card) > strength(a.card) ? b : a));
  if (teamOf(best.seat) === teamOf(seat)) return sorted[0];
  return sorted.find((c) => strength(c) > strength(best.card)) ?? sorted[0];
}
