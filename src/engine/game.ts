import { envidoPoints, hasFlor, shuffledDeck, strength, type CardId } from './cards';

export type Team = 0 | 1;
export type PlayerCount = 2 | 4 | 6;
export type EnvidoCall = 'envido' | 'real' | 'falta';

export interface Config {
  players: PlayerCount;
  target: 15 | 30;
  flor: boolean;
}

export type Action =
  | { t: 'play'; card: CardId }
  | { t: 'envido'; call: EnvidoCall }
  | { t: 'truco' }
  | { t: 'quiero' }
  | { t: 'noquiero' }
  | { t: 'mazo' }
  | { t: 'flor' }
  | { t: 'contraflor' }
  | { t: 'contraflor_resto' };

export type GameEvent =
  | { e: 'deal'; dealer: number; mano: number }
  | { e: 'play'; seat: number; card: CardId }
  | { e: 'canto'; seat: number; canto: string }
  | { e: 'answer'; seat: number; quiero: boolean; what: 'truco' | 'envido' | 'flor' }
  | { e: 'mazo'; seat: number }
  | { e: 'envido'; team: Team; seat: number; tantos: number; points: number }
  | { e: 'flor'; team: Team; points: number }
  | { e: 'round'; winner: Team | null }
  | { e: 'hand'; team: Team; points: number; reason: 'rounds' | 'rejected' | 'mazo' }
  | { e: 'game'; team: Team };

export interface Play {
  seat: number;
  card: CardId;
}

export type FlorStage = 'flor' | 'contra' | 'resto';

export interface HandState {
  dealt: CardId[][];
  cards: CardId[][];
  mano: number;
  turn: number;
  rounds: Play[][];
  roundWinners: (Team | null)[];
  folded: boolean[];
  trucoLevel: number;
  /** Equipo que tiene el quiero y puede subir la apuesta. */
  trucoHolder: Team | null;
  trucoPending: { level: number; by: Team } | null;
  envidoPending: { calls: EnvidoCall[]; by: Team } | null;
  envidoDone: boolean;
  florSung: boolean[];
  florPending: { stage: FlorStage; by: Team; seat: number } | null;
  florDone: boolean;
}

export interface GameState {
  config: Config;
  scores: [number, number];
  dealer: number;
  phase: 'playing' | 'handOver' | 'gameOver';
  winner: Team | null;
  hand: HandState;
  events: GameEvent[];
}

export const teamOf = (seat: number): Team => (seat % 2) as Team;
const otherTeam = (team: Team): Team => (team === 0 ? 1 : 0);
/** Valor de la mano según el nivel: sin cantar, truco, retruco, vale cuatro. */
const TRUCO_VALUE = [1, 2, 3, 4] as const;
const trucoValue = (level: number): number => TRUCO_VALUE[level]!;

export function createGame(config: Config, random: () => number = Math.random): GameState {
  const dealer = Math.floor(random() * config.players);
  const state: GameState = {
    config,
    scores: [0, 0],
    dealer,
    phase: 'playing',
    winner: null,
    hand: deal(config.players, dealer, random),
    events: [],
  };
  state.events.push({ e: 'deal', dealer, mano: state.hand.mano });
  return state;
}

function deal(players: number, dealer: number, random: () => number): HandState {
  const deck = shuffledDeck(random);
  const dealt = Array.from({ length: players }, (_, seat) => deck.slice(seat * 3, seat * 3 + 3));
  const mano = (dealer + 1) % players;
  return {
    dealt,
    cards: dealt.map((hand) => [...hand]),
    mano,
    turn: mano,
    rounds: [[]],
    roundWinners: [],
    folded: Array<boolean>(players).fill(false),
    trucoLevel: 0,
    trucoHolder: null,
    trucoPending: null,
    envidoPending: null,
    envidoDone: false,
    florSung: Array<boolean>(players).fill(false),
    florPending: null,
    florDone: false,
  };
}

/** Reparte la mano siguiente: reparte quien está a la derecha del repartidor anterior. */
export function nextHand(state: GameState, random: () => number = Math.random): void {
  if (state.phase !== 'handOver') return;
  state.dealer = (state.dealer + 1) % state.config.players;
  state.hand = deal(state.config.players, state.dealer, random);
  state.phase = 'playing';
  state.events.push({ e: 'deal', dealer: state.dealer, mano: state.hand.mano });
}

const hasPlayedFirst = (hand: HandState, seat: number): boolean =>
  hand.rounds[0]!.some((p) => p.seat === seat);

/** Equipo que tiene que responder, si hay un canto sin contestar. */
export function respondingTeam(hand: HandState): Team | null {
  if (hand.florPending) return otherTeam(hand.florPending.by);
  if (hand.envidoPending) return otherTeam(hand.envidoPending.by);
  if (hand.trucoPending) return otherTeam(hand.trucoPending.by);
  return null;
}

function nextEnvidoCalls(calls: readonly EnvidoCall[]): EnvidoCall[] {
  if (calls.includes('falta')) return [];
  if (calls.includes('real')) return ['falta'];
  return calls.length >= 2 ? ['real', 'falta'] : ['envido', 'real', 'falta'];
}

/** De a 4 o 6 el envido lo abren solo los dos últimos de la ronda: los pies de cada equipo. */
function isLastTwo(state: GameState, seat: number): boolean {
  const { players } = state.config;
  return players <= 2 || (seat - state.hand.mano + players) % players >= players - 2;
}

export function canOpenEnvido(state: GameState, seat: number): boolean {
  const { hand } = state;
  if (!isLastTwo(state, seat)) return false;
  if (hand.roundWinners.length > 0 || hand.envidoDone || hand.florDone) return false;
  if (hand.trucoLevel > 0 || hand.envidoPending || hand.florPending) return false;
  if (hasPlayedFirst(hand, seat)) return false;
  // "El envido está primero": se puede cantar en respuesta al truco.
  if (hand.trucoPending) return hand.trucoPending.level === 1 && hand.trucoPending.by !== teamOf(seat);
  return true;
}

function canSingFlor(state: GameState, seat: number): boolean {
  const { hand, config } = state;
  if (!config.flor || hand.florDone || hand.florPending || hand.florSung[seat]) return false;
  if (hand.roundWinners.length > 0 || hand.trucoLevel > 0 || hand.trucoPending) return false;
  if (hand.envidoDone && !hand.florSung.some(Boolean)) return false;
  return !hasPlayedFirst(hand, seat) && hasFlor(hand.dealt[seat]!);
}

export function legalActions(state: GameState, seat: number): Action[] {
  if (state.phase !== 'playing') return [];
  const { hand } = state;
  if (hand.folded[seat]) return [];
  const team = teamOf(seat);
  const actions: Action[] = [];
  const responding = respondingTeam(hand);

  if (canSingFlor(state, seat)) actions.push({ t: 'flor' });

  if (responding === team) {
    actions.push({ t: 'quiero' }, { t: 'noquiero' });
    if (hand.florPending) {
      if (hand.florPending.stage === 'flor') actions.push({ t: 'contraflor' });
      if (hand.florPending.stage !== 'resto') actions.push({ t: 'contraflor_resto' });
    } else if (hand.envidoPending) {
      for (const call of nextEnvidoCalls(hand.envidoPending.calls)) actions.push({ t: 'envido', call });
    } else if (hand.trucoPending) {
      if (hand.trucoPending.level < 3) actions.push({ t: 'truco' });
      if (canOpenEnvido(state, seat)) {
        for (const call of nextEnvidoCalls([])) actions.push({ t: 'envido', call });
      }
    }
    actions.push({ t: 'mazo' });
    return actions;
  }
  if (responding !== null) return actions;

  if (canOpenEnvido(state, seat)) {
    for (const call of nextEnvidoCalls([])) actions.push({ t: 'envido', call });
  }
  // El truco se canta solo en el turno propio. Responder subiendo se resuelve arriba.
  if (hand.turn === seat && hand.trucoLevel < 3 && (hand.trucoHolder === null || hand.trucoHolder === team)) {
    actions.push({ t: 'truco' });
  }
  if (hand.turn === seat) {
    for (const card of hand.cards[seat]!) actions.push({ t: 'play', card });
    actions.push({ t: 'mazo' });
  }
  return actions;
}

const sameAction = (a: Action, b: Action): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Aplica una acción si es legal. Devuelve false, sin tocar el estado, si no lo es. */
export function applyAction(state: GameState, seat: number, action: Action): boolean {
  if (!legalActions(state, seat).some((legal) => sameAction(legal, action))) return false;
  switch (action.t) {
    case 'play': playCard(state, seat, action.card); break;
    case 'envido': callEnvido(state, seat, action.call); break;
    case 'truco': callTruco(state, seat); break;
    case 'quiero': answer(state, seat, true); break;
    case 'noquiero': answer(state, seat, false); break;
    case 'mazo': fold(state, seat); break;
    case 'flor': singFlor(state, seat); break;
    case 'contraflor': raiseFlor(state, seat, 'contra'); break;
    case 'contraflor_resto': raiseFlor(state, seat, 'resto'); break;
  }
  return true;
}

/** Suma puntos y cierra la partida si llegó al objetivo. Devuelve true si terminó. */
function addPoints(state: GameState, team: Team, points: number): boolean {
  state.scores[team] = Math.min(state.config.target, state.scores[team] + points);
  if (state.scores[team] >= state.config.target) {
    state.phase = 'gameOver';
    state.winner = team;
    state.events.push({ e: 'game', team });
    return true;
  }
  return false;
}

function endHand(state: GameState, team: Team, points: number, reason: 'rounds' | 'rejected' | 'mazo'): void {
  state.events.push({ e: 'hand', team, points, reason });
  if (!addPoints(state, team, points)) state.phase = 'handOver';
}

function nextActiveSeat(state: GameState, from: number): number {
  const { players } = state.config;
  let seat = from;
  for (let i = 0; i < players; i++) {
    seat = (seat + 1) % players;
    if (!state.hand.folded[seat]) return seat;
  }
  return from;
}

function playCard(state: GameState, seat: number, card: CardId): void {
  const { hand } = state;
  hand.cards[seat] = hand.cards[seat]!.filter((c) => c !== card);
  hand.rounds[hand.rounds.length - 1]!.push({ seat, card });
  state.events.push({ e: 'play', seat, card });
  advanceTurn(state, seat);
}

function advanceTurn(state: GameState, seat: number): void {
  const { hand, config } = state;
  const round = hand.rounds[hand.rounds.length - 1]!;
  const active = Array.from({ length: config.players }, (_, s) => s).filter((s) => !hand.folded[s]);
  if (active.every((s) => round.some((p) => p.seat === s))) closeRound(state, round);
  else {
    let next = nextActiveSeat(state, seat);
    while (round.some((p) => p.seat === next)) next = nextActiveSeat(state, next);
    hand.turn = next;
  }
}

function closeRound(state: GameState, round: Play[]): void {
  const { hand } = state;
  const best = round.reduce((a, b) => (strength(b.card) > strength(a.card) ? b : a));
  const top = strength(best.card);
  const teamsOnTop = new Set(round.filter((p) => strength(p.card) === top).map((p) => teamOf(p.seat)));
  const winner: Team | null = teamsOnTop.size === 1 ? teamOf(best.seat) : null;
  hand.roundWinners.push(winner);
  state.events.push({ e: 'round', winner });

  const handWinner = decideHand(hand.roundWinners, teamOf(hand.mano));
  if (handWinner !== null) {
    endHand(state, handWinner, trucoValue(hand.trucoLevel), 'rounds');
    return;
  }
  hand.rounds.push([]);
  hand.turn = hand.folded[best.seat] ? nextActiveSeat(state, best.seat) : best.seat;
}

/**
 * Ganador de la mano según las bazas jugadas, o null si sigue.
 * Parda la primera, decide la siguiente. Parda la segunda o la tercera, gana
 * quien ganó la primera. Todas pardas, gana el equipo que es mano.
 */
export function decideHand(rounds: readonly (Team | null)[], manoTeam: Team): Team | null {
  const [first, second, third] = rounds;
  if (rounds.length < 2) return null;
  if (first === null) {
    if (second !== null) return second!;
    if (rounds.length < 3) return null;
    return third !== null ? third! : manoTeam;
  }
  if (second === null || second === first) return first!;
  if (rounds.length < 3) return null;
  return third === null ? first! : third!;
}

function callTruco(state: GameState, seat: number): void {
  const { hand } = state;
  const team = teamOf(seat);
  let level = hand.trucoLevel + 1;
  if (hand.trucoPending) {
    // Subir en respuesta implica aceptar lo cantado.
    hand.trucoLevel = hand.trucoPending.level;
    level = hand.trucoLevel + 1;
  }
  hand.trucoPending = { level, by: team };
  state.events.push({ e: 'canto', seat, canto: level === 1 ? 'truco' : level === 2 ? 'retruco' : 'vale4' });
}

function callEnvido(state: GameState, seat: number, call: EnvidoCall): void {
  const { hand } = state;
  const calls = hand.envidoPending ? [...hand.envidoPending.calls, call] : [call];
  hand.envidoPending = { calls, by: teamOf(seat) };
  state.events.push({ e: 'canto', seat, canto: call });
}

function answer(state: GameState, seat: number, quiero: boolean): void {
  const { hand } = state;
  const what = hand.florPending ? 'flor' : hand.envidoPending ? 'envido' : 'truco';
  state.events.push({ e: 'answer', seat, quiero, what });
  if (hand.florPending) answerFlor(state, quiero);
  else if (hand.envidoPending) answerEnvido(state, quiero);
  else if (hand.trucoPending) answerTruco(state, quiero);
}

function answerTruco(state: GameState, quiero: boolean): void {
  const { hand } = state;
  const pending = hand.trucoPending!;
  hand.trucoPending = null;
  if (quiero) {
    hand.trucoLevel = pending.level;
    hand.trucoHolder = otherTeam(pending.by);
  } else {
    endHand(state, pending.by, trucoValue(pending.level - 1), 'rejected');
  }
}

/** Lo que falta para que el líder llegue al objetivo: si gana el líder, gana la partida. */
function faltaPoints(state: GameState, winner: Team): number {
  const leader: Team = state.scores[0] >= state.scores[1] ? 0 : 1;
  const leaderTied = state.scores[0] === state.scores[1];
  const base = leaderTied || winner === leader ? winner : leader;
  return state.config.target - state.scores[base];
}

export const envidoAccepted = (calls: readonly EnvidoCall[], falta: number): number =>
  calls.includes('falta')
    ? falta
    : calls.reduce((sum, call) => sum + (call === 'envido' ? 2 : 3), 0);

export function envidoRejected(calls: readonly EnvidoCall[]): number {
  const previous = calls.slice(0, -1);
  if (previous.length === 0) return 1;
  return previous.reduce((sum, call) => sum + (call === 'envido' ? 2 : 3), 0);
}

/** Mejores tantos o flor por equipo; en empate gana el más cercano a la mano. */
function bestFromMano(state: GameState, eligible: (seat: number) => boolean): { seat: number; tantos: number } {
  const { hand, config } = state;
  let best = { seat: hand.mano, tantos: -1 };
  for (let i = 0; i < config.players; i++) {
    const seat = (hand.mano + i) % config.players;
    if (!eligible(seat)) continue;
    const tantos = envidoPoints(hand.dealt[seat]!);
    if (tantos > best.tantos) best = { seat, tantos };
  }
  return best;
}

function answerEnvido(state: GameState, quiero: boolean): void {
  const { hand } = state;
  const { calls, by } = hand.envidoPending!;
  hand.envidoPending = null;
  hand.envidoDone = true;
  if (!quiero) {
    const points = envidoRejected(calls);
    state.events.push({ e: 'envido', team: by, seat: -1, tantos: -1, points });
    addPoints(state, by, points);
    return;
  }
  const best = bestFromMano(state, (seat) => !hand.folded[seat]);
  const team = teamOf(best.seat);
  const points = envidoAccepted(calls, faltaPoints(state, team));
  state.events.push({ e: 'envido', team, seat: best.seat, tantos: best.tantos, points });
  addPoints(state, team, points);
}

function singFlor(state: GameState, seat: number): void {
  const { hand, config } = state;
  const team = teamOf(seat);
  hand.florSung[seat] = true;
  hand.envidoPending = null;
  hand.envidoDone = true;
  state.events.push({ e: 'canto', seat, canto: 'flor' });
  const rivalHasFlor = Array.from({ length: config.players }, (_, s) => s).some(
    (s) => teamOf(s) !== team && !hand.folded[s] && hasFlor(hand.dealt[s]!),
  );
  if (rivalHasFlor) {
    hand.florPending = { stage: 'flor', by: team, seat };
    return;
  }
  state.events.push({ e: 'flor', team, points: 3 });
  addPoints(state, team, 3);
}

function raiseFlor(state: GameState, seat: number, stage: FlorStage): void {
  const { hand } = state;
  hand.florPending = { stage, by: teamOf(seat), seat };
  state.events.push({ e: 'canto', seat, canto: stage === 'contra' ? 'contraflor' : 'contraflor_resto' });
}

function answerFlor(state: GameState, quiero: boolean): void {
  const { hand } = state;
  const { stage, by } = hand.florPending!;
  hand.florPending = null;
  hand.florDone = true;
  if (!quiero) {
    const points = stage === 'flor' ? 3 : 4;
    state.events.push({ e: 'flor', team: by, points });
    addPoints(state, by, points);
    return;
  }
  const best = bestFromMano(state, (seat) => !hand.folded[seat] && hasFlor(hand.dealt[seat]!));
  const team = teamOf(best.seat);
  const points = stage === 'flor' ? 4 : stage === 'contra' ? 6 : faltaPoints(state, team);
  state.events.push({ e: 'flor', team, points });
  addPoints(state, team, points);
}

function fold(state: GameState, seat: number): void {
  const { hand, config } = state;
  const team = teamOf(seat);
  hand.folded[seat] = true;
  state.events.push({ e: 'mazo', seat });
  const teamSeats = Array.from({ length: config.players }, (_, s) => s).filter((s) => teamOf(s) === team);
  if (teamSeats.every((s) => hand.folded[s])) {
    const envidoStillOpen =
      hand.roundWinners.length === 0 &&
      !hand.envidoDone &&
      !hand.florDone &&
      hand.trucoLevel === 0 &&
      !hand.trucoPending &&
      teamSeats.some((s) => !hasPlayedFirst(hand, s));
    const trucoPoints = hand.trucoPending
      ? trucoValue(hand.trucoPending.level - 1)
      : trucoValue(hand.trucoLevel);
    hand.trucoPending = null;
    hand.envidoPending = null;
    hand.florPending = null;
    endHand(state, otherTeam(team), trucoPoints + (envidoStillOpen ? 1 : 0), 'mazo');
    return;
  }
  if (hand.turn === seat) advanceTurn(state, seat);
}

/** Lo que hace el servidor cuando se vence el tiempo de un turno o un canto. */
export function timeoutAction(state: GameState): { seat: number; action: Action } | null {
  if (state.phase !== 'playing') return null;
  const { hand, config } = state;
  const responding = respondingTeam(hand);
  if (responding !== null) {
    for (let seat = 0; seat < config.players; seat++) {
      if (teamOf(seat) === responding && !hand.folded[seat]) return { seat, action: { t: 'noquiero' } };
    }
    return null;
  }
  const cards = hand.cards[hand.turn]!;
  if (cards.length === 0) return null;
  const lowest = cards.reduce((a, b) => (strength(b) < strength(a) ? b : a));
  return { seat: hand.turn, action: { t: 'play', card: lowest } };
}

export interface PlayerView {
  seat: number;
  config: Config;
  scores: [number, number];
  phase: GameState['phase'];
  winner: Team | null;
  dealer: number;
  mano: number;
  turn: number;
  myCards: CardId[];
  cardCounts: number[];
  rounds: Play[][];
  roundWinners: (Team | null)[];
  folded: boolean[];
  trucoLevel: number;
  responding: Team | null;
  pendingLabel: string | null;
  legal: Action[];
}

function pendingLabel(hand: HandState): string | null {
  if (hand.florPending) {
    return hand.florPending.stage === 'flor' ? 'flor' : hand.florPending.stage === 'contra' ? 'contraflor' : 'contraflor_resto';
  }
  if (hand.envidoPending) return hand.envidoPending.calls[hand.envidoPending.calls.length - 1]!;
  if (hand.trucoPending) {
    return hand.trucoPending.level === 1 ? 'truco' : hand.trucoPending.level === 2 ? 'retruco' : 'vale4';
  }
  return null;
}

/** Vista de un jugador. Nunca incluye las cartas de otro: el servidor solo manda esto. */
export function viewFor(state: GameState, seat: number): PlayerView {
  const { hand } = state;
  return {
    seat,
    config: state.config,
    scores: state.scores,
    phase: state.phase,
    winner: state.winner,
    dealer: state.dealer,
    mano: hand.mano,
    turn: hand.turn,
    myCards: hand.cards[seat]!,
    cardCounts: hand.cards.map((cards) => cards.length),
    rounds: hand.rounds,
    roundWinners: hand.roundWinners,
    folded: hand.folded,
    trucoLevel: hand.trucoLevel,
    responding: respondingTeam(hand),
    pendingLabel: pendingLabel(hand),
    legal: legalActions(state, seat),
  };
}
