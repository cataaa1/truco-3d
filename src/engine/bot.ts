import { envidoPoints, strength, type CardId } from './cards';
import { legalActions, teamOf, type Action, type GameState } from './game';

/** Decide usando solo la información que tendría ese jugador: sus cartas y lo que está en la mesa. */
export function botAction(state: GameState, seat: number, random: () => number = Math.random): Action | null {
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
    return tantos >= 26 || random() < 0.1 ? { t: 'quiero' } : { t: 'noquiero' };
  }

  if (hand.trucoPending) {
    if (tantos >= 28) {
      const open = envidoCall('envido');
      if (open) return open;
    }
    if (has('truco') && power >= 11 && random() < 0.5) return { t: 'truco' };
    return power >= 7.5 || random() < 0.12 ? { t: 'quiero' } : { t: 'noquiero' };
  }

  if (hand.turn !== seat) return null;

  if (tantos >= 28 && random() < 0.8) {
    const open = envidoCall(tantos >= 31 ? 'real' : 'envido');
    if (open) return open;
  }
  if (has('truco') && (power >= 11 ? random() < 0.5 : random() < 0.06)) return { t: 'truco' };

  const card = chooseCard(state, seat, remaining);
  return card === undefined ? null : { t: 'play', card };
}

function chooseCard(state: GameState, seat: number, cards: readonly CardId[]): CardId | undefined {
  const sorted = [...cards].sort((a, b) => strength(a) - strength(b));
  const round = state.hand.rounds[state.hand.rounds.length - 1]!;
  if (round.length === 0) return sorted[sorted.length - 1];
  const best = round.reduce((a, b) => (strength(b.card) > strength(a.card) ? b : a));
  if (teamOf(best.seat) === teamOf(seat)) return sorted[0];
  return sorted.find((c) => strength(c) > strength(best.card)) ?? sorted[0];
}
