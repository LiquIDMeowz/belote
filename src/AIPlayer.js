'use strict';

const { Deck, TRUMP_ORDER, NORMAL_ORDER } = require('./Deck');

// Mirrors the SUIT_RANK from BeloteGame: ♣<♦<♥<♠<NT<AT
const SUIT_RANK = { C: 1, D: 2, H: 3, S: 4, NT: 5, AT: 6 };

class AIPlayer {
  // Returns { pass: true } or { suit } — no numerical values any more
  static chooseBid(hand, currentBid) {
    let bestSuit  = null;
    let bestScore = 0;

    for (const suit of ['C', 'D', 'H', 'S']) {
      const score = AIPlayer._evalHandForTrump(hand, suit);
      if (score > bestScore) { bestScore = score; bestSuit = suit; }
    }

    const currentRank = currentBid ? SUIT_RANK[currentBid.suit] : 0;

    const ntScore = AIPlayer._evalHandForNT(hand);
    const atScore = AIPlayer._evalHandForAT(hand);

    const options = [
      { suit: bestSuit, score: bestScore,  rank: SUIT_RANK[bestSuit] || 0 },
      { suit: 'NT',     score: ntScore,    rank: SUIT_RANK['NT'] },
      { suit: 'AT',     score: atScore,    rank: SUIT_RANK['AT'] },
    ]
      .filter(o => o.suit && o.score >= 3.5 && o.rank > currentRank)
      .sort((a, b) => b.score - a.score);

    if (options.length === 0) return { pass: true };
    return { suit: options[0].suit };
  }

  static _evalHandForTrump(hand, suit) {
    const trumpScores  = { J: 4, '9': 3, A: 2, '10': 1.5, K: 1, Q: 0.5, '8': 0, '7': 0 };
    const normalScores = { A: 1, '10': 0.7, K: 0.5, Q: 0.3, J: 0.2, '9': 0, '8': 0, '7': 0 };
    return hand.reduce((s, c) => s + (c.suit === suit ? (trumpScores[c.rank] || 0) : (normalScores[c.rank] || 0)), 0);
  }

  static _evalHandForNT(hand) {
    // Good NT hand: lots of Aces and 10s spread across suits
    const scores = { A: 2, '10': 1.5, K: 1, Q: 0.7, J: 0.3, '9': 0, '8': 0, '7': 0 };
    return hand.reduce((s, c) => s + (scores[c.rank] || 0), 0) - 4; // baseline subtract to raise threshold
  }

  static _evalHandForAT(hand) {
    // Good AT hand: Jacks and 9s across multiple suits
    const scores = { J: 3, '9': 2, A: 1, '10': 0.5, K: 0.3, Q: 0.2, '8': 0, '7': 0 };
    return hand.reduce((s, c) => s + (scores[c.rank] || 0), 0) - 5; // higher threshold
  }

  // --- Card play ---
  static chooseCard(legalCards, currentTrick, trump, hand, partnerIndex) {
    if (legalCards.length === 1) return legalCards[0];

    const isLeading = currentTrick.length === 0;

    if (isLeading) {
      // Lead with highest non-trump if possible; for NT/AT lead highest overall
      const nonTrump = (trump === 'NT' || trump === 'AT')
        ? []
        : legalCards.filter(c => c.suit !== trump);
      return nonTrump.length > 0
        ? AIPlayer._highest(nonTrump, trump)
        : AIPlayer._highest(legalCards, trump);
    }

    const winnerIdx    = Deck.getCurrentTrickWinnerIdx(currentTrick, trump);
    const partnerWins  = winnerIdx === partnerIndex;

    return partnerWins
      ? AIPlayer._lowest(legalCards, trump)   // Partner winning — preserve cards
      : AIPlayer._highest(legalCards, trump); // Need to win — play highest
  }

  static _highest(cards, trump) {
    return cards.reduce((best, c) => {
      const bo = (trump !== 'NT' && best.suit === trump) ? TRUMP_ORDER[best.rank] + 100 : NORMAL_ORDER[best.rank];
      const co = (trump !== 'NT' && c.suit    === trump) ? TRUMP_ORDER[c.rank]   + 100 : NORMAL_ORDER[c.rank];
      return co > bo ? c : best;
    });
  }

  static _lowest(cards, trump) {
    return cards.reduce((best, c) => {
      const bo = (trump !== 'NT' && best.suit === trump) ? TRUMP_ORDER[best.rank] + 100 : NORMAL_ORDER[best.rank];
      const co = (trump !== 'NT' && c.suit    === trump) ? TRUMP_ORDER[c.rank]   + 100 : NORMAL_ORDER[c.rank];
      return co < bo ? c : best;
    });
  }
}

module.exports = AIPlayer;
