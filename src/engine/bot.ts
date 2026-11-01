import { cardRank, cardSuit, envidoPoints, shuffledDeck, strength, type CardId } from './cards';
import type { SenaId } from '../shared/protocol';
import { canOpenEnvido, decideHand, legalActions, teamOf, type Action, type GameState } from './game';

/** Lo que el bot sabe por las señas de su compañero. */
export interface BotHints {
  partnerHasEnvido?: boolean;
}

// Tantos desde los que un bot avisa el envido o lo canta sin dudar.
const SURE_ENVIDO = 30;
// Pocas repeticiones: el plan gratis de Cloudflare da muy poco tiempo de cálculo por pedido.
const SAMPLES = 60;

/**
 * Probabilidad de ganar la mano con lo que este jugador ve: sus cartas y las que ya están sobre la mesa.
 * Reparte al azar las cartas que no vio y juega el resto de la mano muchas veces.
 */
export function winChance(state: GameState, seat: number, random: () => number = Math.random): number {
  const { hand, config } = state;
  const team = teamOf(seat);
  const seen = new Set<CardId>([...hand.dealt[seat]!, ...hand.rounds.flat().map((play) => play.card)]);
  const unseen = shuffledDeck(random).filter((card) => !seen.has(card));
  let wins = 0;
  for (let sample = 0; sample < SAMPLES; sample++) {
    let next = 0;
    const cards = hand.cards.map((held, s) => {
      if (s === seat) return [...held];
      const dealt: CardId[] = [];
      for (let i = 0; i < held.length; i++, next++) {
        const pick = next + Math.floor(random() * (unseen.length - next));
        [unseen[next], unseen[pick]] = [unseen[pick]!, unseen[next]!];
        dealt.push(unseen[next]!);
      }
      return dealt;
    });
    if (playOut(state, cards) === team) wins++;
  }
  return wins / SAMPLES;

  function playOut(current: GameState, held: CardId[][]): number | null {
    const winners = [...current.hand.roundWinners];
    const manoTeam = teamOf(current.hand.mano);
    let round = current.hand.rounds[current.hand.rounds.length - 1]!.map((play) => ({ ...play }));
    let turn = current.hand.turn;
    const active = Array.from({ length: config.players }, (_, s) => s).filter((s) => !current.hand.folded[s]);
    for (let guard = 0; guard < config.players * 3 + 1; guard++) {
      if (active.every((s) => round.some((play) => play.seat === s))) {
        const best = round.reduce((a, b) => (strength(b.card) > strength(a.card) ? b : a));
        const top = strength(best.card);
        const teams = new Set(round.filter((play) => strength(play.card) === top).map((play) => teamOf(play.seat)));
        winners.push(teams.size === 1 ? teamOf(best.seat) : null);
        const decided = decideHand(winners, manoTeam);
        if (decided !== null) return decided;
        round = [];
        turn = best.seat;
      }
      while (round.some((play) => play.seat === turn) || current.hand.folded[turn]) turn = (turn + 1) % config.players;
      const options = held[turn]!;
      const card = pickCard(round, turn, options);
      if (card === undefined) return null;
      held[turn] = options.filter((c) => c !== card);
      round.push({ seat: turn, card });
    }
    return null;
  }
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

  if (has('mostrar')) return { t: 'mostrar' };
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
    // Mira lo que hay en la mesa: una mano imposible no se acepta y una segura se sube.
    const chance = winChance(state, seat, random);
    if (has('truco') && chance >= 0.85 && random() < 0.6) return { t: 'truco' };
    // Quien ya perdió una baza y escucha truco desconfía más, y no acepta de farol.
    const behind = hand.roundWinners.some((w) => w !== null && w !== teamOf(seat));
    const needed = 0.42 + 0.08 * (hand.trucoPending.level - 1) + (behind ? 0.12 : 0);
    return chance >= needed || (!behind && chance >= 0.12 && random() < 0.2) ? { t: 'quiero' } : { t: 'noquiero' };
  }

  if (hand.turn !== seat) return null;

  if (hints.partnerHasEnvido) {
    const open = envidoCall('envido');
    if (open) return open;
  }
  if (tantos >= SURE_ENVIDO || (tantos >= 28 && random() < 0.8)) {
    const open = envidoCall(tantos >= 31 ? 'real' : 'envido');
    if (open) return open;
  }
  // Con envido para avisar no canta truco en la primera: si se lo aceptan, el envido ya no se puede cantar.
  const keepsEnvido = tantos >= SURE_ENVIDO && hand.roundWinners.length === 0 && !hand.envidoDone && !hand.florDone;
  if (has('truco') && !keepsEnvido) {
    const chance = winChance(state, seat, random);
    if (chance >= 0.72 ? random() < 0.6 : chance >= 0.2 && random() < 0.05) return { t: 'truco' };
  }

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
  // Solo sirve avisar si un compañero todavía lo puede cantar; si le toca a él, lo canta directamente.
  const partnerCanSing = hand.dealt.some((_, s) => s !== seat && teamOf(s) === teamOf(seat) && canOpenEnvido(state, s));
  if (partnerCanSing && envidoPoints(hand.dealt[seat]!) >= SURE_ENVIDO && !done.has('envido')) return 'envido';
  const remaining = hand.cards[seat]!;
  if (remaining.length === 0) return null;
  const best = remaining.reduce((a, b) => (strength(b) > strength(a) ? b : a));
  const sena = senaForCard(best);
  return done.has(sena) ? null : sena;
}

function chooseCard(state: GameState, seat: number, cards: readonly CardId[]): CardId | undefined {
  return pickCard(state.hand.rounds[state.hand.rounds.length - 1]!, seat, cards);
}

function pickCard(round: readonly { seat: number; card: CardId }[], seat: number, cards: readonly CardId[]): CardId | undefined {
  const sorted = [...cards].sort((a, b) => strength(a) - strength(b));
  if (round.length === 0) return sorted[sorted.length - 1];
  const best = round.reduce((a, b) => (strength(b.card) > strength(a.card) ? b : a));
  if (teamOf(best.seat) === teamOf(seat)) return sorted[0];
  return sorted.find((c) => strength(c) > strength(best.card)) ?? sorted[0];
}
