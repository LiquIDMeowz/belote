'use strict';

// Bulgarian Belote — 32 card deck
const SUITS = ['H', 'D', 'C', 'S'];
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Card rank order when suit is trump: J > 9 > A > 10 > K > Q > 8 > 7
const TRUMP_ORDER  = { '7': 0, '8': 1, 'Q': 2, 'K': 3, '10': 4, 'A': 5, '9': 6, 'J': 7 };
// Card rank order non-trump AND for NT: A > 10 > K > Q > J > 9 > 8 > 7
const NORMAL_ORDER = { '7': 0, '8': 1, '9': 2, 'J': 3, 'Q': 4, 'K': 5, '10': 6, 'A': 7 };

// Points when played as trump suit
const TRUMP_POINTS  = { '7': 0, '8': 0, '9': 14, '10': 10, 'J': 20, 'Q': 3, 'K': 4, 'A': 11 };
// Points when NOT trump (also used for NT)
const NORMAL_POINTS = { '7': 0, '8': 0, '9': 0,  '10': 10, 'J': 2,  'Q': 3, 'K': 4, 'A': 11 };

// Canonical sequence order for declarations (7=0 … A=7)
const RANK_VALUE_FOR_SEQ = { '7': 0, '8': 1, '9': 2, '10': 3, 'J': 4, 'Q': 5, 'K': 6, 'A': 7 };

// Suit display priority for hand sorting: ♦ > ♣ > ♥ > ♠
const SUIT_SORT_ORDER = { D: 0, C: 1, H: 2, S: 3 };

class Deck {
  static createDeck() {
    const cards = [];
    for (const suit of SUITS)
      for (const rank of RANKS)
        cards.push({ rank, suit, id: `${rank}${suit}` });
    return cards;
  }

  static shuffle(deck) {
    const cards = [...deck];
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  static deal(shuffledDeck, numPlayers) {
    const hands = Array.from({ length: numPlayers }, () => []);
    shuffledDeck.forEach((c, i) => hands[i % numPlayers].push(c));
    return hands;
  }

  /**
   * Sort a hand by suit priority (D>C>H>S), then rank within each suit.
   * trump can be: a suit letter, 'NT', 'AT', or null.
   * AT → trump order for all suits; NT/null → normal order for all suits.
   */
  static sortHand(hand, trump = null) {
    return [...hand].sort((a, b) => {
      const sa = SUIT_SORT_ORDER[a.suit];
      const sb = SUIT_SORT_ORDER[b.suit];
      if (sa !== sb) return sa - sb;
      // Same suit
      const useT = trump === 'AT' || a.suit === trump;
      const order = useT ? TRUMP_ORDER : NORMAL_ORDER;
      return order[a.rank] - order[b.rank];
    });
  }

  /**
   * Point value of a card.
   * trump: suit letter → trump card if same suit
   *        'NT'        → all cards use NORMAL_POINTS
   *        'AT'        → all cards use TRUMP_POINTS
   */
  static getPoints(card, trump) {
    if (trump === 'NT') return NORMAL_POINTS[card.rank];
    if (trump === 'AT') return TRUMP_POINTS[card.rank];
    return card.suit === trump ? TRUMP_POINTS[card.rank] : NORMAL_POINTS[card.rank];
  }

  static getTrumpOrder(rank)  { return TRUMP_ORDER[rank]; }
  static getNormalOrder(rank) { return NORMAL_ORDER[rank]; }
  static getRankSeqVal(rank)  { return RANK_VALUE_FOR_SEQ[rank]; }

  /**
   * Determine winner of a trick (returns playerIndex of winner).
   * Handles NT (no trump) and AT (all trump) modes.
   */
  static getCurrentTrickWinnerIdx(currentTrick, trump) {
    if (currentTrick.length === 0) return -1;
    const ledSuit = currentTrick[0].card.suit;
    let winner = currentTrick[0];
    for (let i = 1; i < currentTrick.length; i++) {
      if (Deck.cardBeats(currentTrick[i].card, winner.card, ledSuit, trump)) {
        winner = currentTrick[i];
      }
    }
    return winner.playerIndex;
  }

  /**
   * Returns true if newCard beats the current champion.
   * trump: suit letter, 'NT', or 'AT'
   */
  static cardBeats(newCard, champion, ledSuit, trump) {
    if (trump === 'NT') {
      // No trump: only led-suit cards can win; higher NORMAL_ORDER wins
      if (newCard.suit === ledSuit && champion.suit !== ledSuit) return true;
      if (newCard.suit !== ledSuit) return false;
      return NORMAL_ORDER[newCard.rank] > NORMAL_ORDER[champion.rank];
    }

    if (trump === 'AT') {
      // All trump: all suits share TRUMP_ORDER within their own suit;
      // no suit dominates another — only led-suit cards can win
      if (newCard.suit === ledSuit && champion.suit !== ledSuit) return true;
      if (newCard.suit !== ledSuit) return false;
      return TRUMP_ORDER[newCard.rank] > TRUMP_ORDER[champion.rank];
    }

    // Normal trump game
    const nT = newCard.suit === trump;
    const cT = champion.suit === trump;
    if (nT && !cT) return true;
    if (!nT && cT) return false;
    if (nT && cT)  return TRUMP_ORDER[newCard.rank]  > TRUMP_ORDER[champion.rank];
    if (newCard.suit === ledSuit && champion.suit !== ledSuit) return true;
    if (newCard.suit !== ledSuit) return false;
    return NORMAL_ORDER[newCard.rank] > NORMAL_ORDER[champion.rank];
  }

  // Declarations (not used in NT games)
  static getDeclarations(hand, trump) {
    const declarations = [];

    for (const suit of SUITS) {
      const suitCards = hand
        .filter(c => c.suit === suit)
        .sort((a, b) => RANK_VALUE_FOR_SEQ[a.rank] - RANK_VALUE_FOR_SEQ[b.rank]);
      if (suitCards.length < 3) continue;

      let runStart = 0;
      for (let i = 1; i <= suitCards.length; i++) {
        const isConsec = i < suitCards.length &&
          RANK_VALUE_FOR_SEQ[suitCards[i].rank] === RANK_VALUE_FOR_SEQ[suitCards[i-1].rank] + 1;
        if (!isConsec) {
          const runLen = i - runStart;
          if (runLen >= 3) {
            const runCards = suitCards.slice(runStart, i);
            const topCard  = runCards[runCards.length - 1];
            let value, type;
            if      (runLen === 3) { value = 20;  type = 'tierce'; }
            else if (runLen === 4) { value = 50;  type = 'quarte'; }
            else                   { value = 100; type = 'quinte'; }
            declarations.push({ type, cards: runCards, value, suit, topRank: topCard.rank });
          }
          runStart = i;
        }
      }
    }

    for (const rank of RANKS) {
      const matching = hand.filter(c => c.rank === rank);
      if (matching.length === 4) {
        const value = rank === 'J' ? 200 : rank === '9' ? 150 : 100;
        declarations.push({ type: 'four', cards: matching, value, rank });
      }
    }

    // Белот: K+Q of trump; for AT, any suit counts
    const trumpSuits = trump === 'AT' ? SUITS : (trump && trump !== 'NT' ? [trump] : []);
    for (const ts of trumpSuits) {
      const hasK = hand.some(c => c.rank === 'K' && c.suit === ts);
      const hasQ = hand.some(c => c.rank === 'Q' && c.suit === ts);
      if (hasK && hasQ) {
        declarations.push({
          type: 'belote',
          cards: [hand.find(c => c.rank === 'K' && c.suit === ts), hand.find(c => c.rank === 'Q' && c.suit === ts)],
          value: 20,
          suit: ts,
        });
      }
    }

    return declarations;
  }

  static compareDeclarations(a, b, trump) {
    const typeRank = d => {
      if (d.type === 'four')   return 10;
      if (d.type === 'quinte') return 5;
      if (d.type === 'quarte') return 4;
      if (d.type === 'tierce') return 3;
      return 0;
    };
    const tr = typeRank(a) - typeRank(b);
    if (tr !== 0) return tr > 0 ? 1 : -1;
    if (a.type === 'four') {
      const rA = RANK_VALUE_FOR_SEQ[a.rank], rB = RANK_VALUE_FOR_SEQ[b.rank];
      return rA > rB ? 1 : rA < rB ? -1 : 0;
    }
    const topA = RANK_VALUE_FOR_SEQ[a.topRank], topB = RANK_VALUE_FOR_SEQ[b.topRank];
    if (topA !== topB) return topA > topB ? 1 : -1;
    // Tie-break: trump suit beats non-trump (for AT, all suits equal)
    const aT = (trump === 'AT' || a.suit === trump) ? 1 : 0;
    const bT = (trump === 'AT' || b.suit === trump) ? 1 : 0;
    return aT - bT;
  }
}

module.exports = { Deck, TRUMP_ORDER, NORMAL_ORDER, TRUMP_POINTS, NORMAL_POINTS, SUITS, RANKS };
