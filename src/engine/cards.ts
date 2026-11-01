export type Suit = 'espada' | 'basto' | 'oro' | 'copa';
export const SUITS: readonly Suit[] = ['espada', 'basto', 'oro', 'copa'];
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12] as const;

/** Carta como entero 0..39: palo * 10 + índice de rango. */
export type CardId = number;

export const cardSuit = (c: CardId): Suit => SUITS[Math.floor(c / 10)]!;
export const cardRank = (c: CardId): number => RANKS[c % 10]!;
export const makeCard = (suit: Suit, rank: number): CardId =>
  SUITS.indexOf(suit) * 10 + RANKS.indexOf(rank as (typeof RANKS)[number]);

/** Jerarquía del truco: 14 es el ancho de espada, 1 son los cuatros. */
export function strength(c: CardId): number {
  const suit = cardSuit(c);
  const rank = cardRank(c);
  if (rank === 1 && suit === 'espada') return 14;
  if (rank === 1 && suit === 'basto') return 13;
  if (rank === 7 && suit === 'espada') return 12;
  if (rank === 7 && suit === 'oro') return 11;
  switch (rank) {
    case 3: return 10;
    case 2: return 9;
    case 1: return 8;
    case 12: return 7;
    case 11: return 6;
    case 10: return 5;
    case 7: return 4;
    case 6: return 3;
    case 5: return 2;
    default: return 1;
  }
}

const tanto = (c: CardId): number => (cardRank(c) <= 7 ? cardRank(c) : 0);

/** Tantos de una mano. Con tres del mismo palo cuentan las dos más altas. */
export function envidoPoints(cards: readonly CardId[]): number {
  let best = 0;
  for (const suit of SUITS) {
    const values = cards.filter((c) => cardSuit(c) === suit).map(tanto).sort((a, b) => b - a);
    if (values.length >= 2) best = Math.max(best, 20 + values[0]! + values[1]!);
    else if (values.length === 1) best = Math.max(best, values[0]!);
  }
  return best;
}

/** Las cartas con las que se cantan esos tantos: el par del mismo palo o, si no hay, la más alta. */
export function envidoCards(cards: readonly CardId[]): CardId[] {
  const points = envidoPoints(cards);
  for (let a = 0; a < cards.length; a++) {
    for (let b = a + 1; b < cards.length; b++) {
      if (envidoPoints([cards[a]!, cards[b]!]) === points && cardSuit(cards[a]!) === cardSuit(cards[b]!)) return [cards[a]!, cards[b]!];
    }
  }
  return [cards.find((card) => envidoPoints([card]) === points)!];
}

export const hasFlor = (cards: readonly CardId[]): boolean =>
  cards.length === 3 && cards.every((c) => cardSuit(c) === cardSuit(cards[0]!));

export function cardName(c: CardId): string {
  const rank = cardRank(c);
  const figure = rank === 10 ? 'Sota' : rank === 11 ? 'Caballo' : rank === 12 ? 'Rey' : String(rank);
  return `${figure} de ${cardSuit(c)}`;
}

export function shuffledDeck(random: () => number): CardId[] {
  const deck = Array.from({ length: 40 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}
