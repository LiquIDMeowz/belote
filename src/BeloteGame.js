'use strict';

const { Deck } = require('./Deck');

const getTeam = (seat) => seat % 2;  // even seats = team 0, odd = team 1

const SUIT_NAMES = { H: 'Купи ♥', D: 'Каро ♦', C: 'Спатии ♣', S: 'Пики ♠', NT: 'Без коз', AT: 'Всичко коз' };

// Bulgarian Belote suit rank: ♣ < ♦ < ♥ < ♠ < NT < AT
const SUIT_RANK = { C: 1, D: 2, H: 3, S: 4, NT: 5, AT: 6 };

class BeloteGame {
  /**
   * mode: '1v1' = 2 humans, no bots (seats 0 & 1)
   *       '2v2' = 2 humans (opponents, seats 0 & 1) + 2 bots (partners, seats 2 & 3)
   */
  constructor(mode = '2v2') {
    this.mode = mode;
    this._buildPlayers();
    this.dealer        = 0;
    this.gameScores    = [0, 0];
    this.hangingPoints = [0, 0];
    this.phase         = 'waiting';
    this.message       = 'Waiting for players...';
  }

  _buildPlayers() {
    if (this.mode === '1v1') {
      this.numPlayers = 2;
      this.players = [
        { seat: 0, name: 'South', isBot: false, socketId: null, connected: false, hand: [] },
        { seat: 1, name: 'North', isBot: false, socketId: null, connected: false, hand: [] },
      ];
    } else {
      // 2v2: humans at 0 (South) and 2 (North) — partners; bots at 1 (West) and 3 (East) — partners
      this.numPlayers = 4;
      this.players = [
        { seat: 0, name: 'South',     isBot: false, socketId: null, connected: false, hand: [] },
        { seat: 1, name: 'Bot West',  isBot: true,  socketId: null, connected: true,  hand: [] },
        { seat: 2, name: 'North',     isBot: false, socketId: null, connected: false, hand: [] },
        { seat: 3, name: 'Bot East',  isBot: true,  socketId: null, connected: true,  hand: [] },
      ];
    }
  }

  // ── Connection ─────────────────────────────────────────────────────────────
  connectPlayer(socketId, name, seat) {
    const validSeats = this.mode === '1v1' ? [0, 1] : [0, 2];
    if (!validSeats.includes(seat)) return { error: 'Invalid seat' };
    const p = this.players[seat];
    if (p.connected && p.socketId !== socketId) return { error: 'Seat already taken' };
    p.socketId  = socketId;
    p.name      = name;
    p.connected = true;

    const humansReady = this.players.filter(p => !p.isBot && p.connected).length;
    if (humansReady === 2 && this.phase === 'waiting') this._startHand();
    return { success: true, seat };
  }

  disconnectPlayer(socketId) {
    const p = this.players.find(p => p.socketId === socketId);
    if (p) p.connected = false;
  }

  getSocketForSeat(seat) { return this.players[seat]?.socketId || null; }

  // ── Hand lifecycle ─────────────────────────────────────────────────────────
  _startHand() {
    this.dealer             = (this.dealer + 1) % this.numPlayers;
    this.trump              = null;
    this.contract           = null;
    this.bids               = [];
    this.consecutivePasses  = 0;
    this.currentTrick       = [];
    this.tricksDone         = 0;
    this.handPoints         = [0, 0];
    this.declarationPoints  = [0, 0];
    this.declarationSummary = [];
    this.announcement       = null;
    this.lastTrickWinner    = null;
    this.beloteState        = { holders: [], played: {} };
    this.scoreResult        = null;
    this.finalHandPoints    = null;
    this.pendingDeal        = [];
    this._lastTrick         = null;

    const deck = Deck.shuffle(Deck.createDeck());

    // Deal 5 cards per player — bidding happens with 5-card hand
    this.players.forEach((p, i) => {
      p.hand = Deck.sortHand(deck.slice(i * 5, (i + 1) * 5));
    });
    // Keep remaining cards to deal 3 more after bidding
    this.pendingDeal = deck.slice(this.numPlayers * 5);

    this.phase         = 'bidding';
    this.currentPlayer = (this.dealer + 1) % this.numPlayers;
    this.message       = `${this.players[this.currentPlayer].name}: обявете`;
  }

  startNewHand() { this._startHand(); }

  // ── Bidding ────────────────────────────────────────────────────────────────
  placeBid(playerIndex, bidData) {
    if (this.phase !== 'bidding') return { error: 'Not bidding phase' };
    if (playerIndex !== this.currentPlayer) return { error: 'Not your turn' };

    if (bidData.pass) {
      this.bids.push({ playerIndex, pass: true });
      this.consecutivePasses++;

      const hasBid = this.bids.some(b => !b.pass);
      const needed = hasBid ? this.numPlayers - 1 : this.numPlayers;

      if (this.consecutivePasses >= needed) {
        if (!hasBid) {
          this.message = 'Всички пасуваха — преразпределяне...';
          this.phase = 'redeal';
          return { success: true, redeal: true };
        }
        this._finalizeBidding();
        return { success: true };
      }
    } else {
      const { suit } = bidData;
      if (!SUIT_RANK[suit]) return { error: 'Invalid suit' };

      const best    = this._getBestBid();
      const bestLvl = best ? SUIT_RANK[best.suit] : 0;
      if (SUIT_RANK[suit] <= bestLvl) return { error: 'Must bid a higher suit' };

      this.bids.push({ playerIndex, suit });
      this.consecutivePasses = 0;
    }

    this.currentPlayer = (this.currentPlayer + 1) % this.numPlayers;
    this.message = `${this.players[this.currentPlayer].name}: обявете`;
    return { success: true };
  }

  _getBestBid() {
    const real = this.bids.filter(b => !b.pass);
    return real.length ? real[real.length - 1] : null;
  }

  _finalizeBidding() {
    this.contract = this._getBestBid();
    this.trump    = this.contract.suit;

    // Deal 3 more cards to each player now that trump is known
    this.players.forEach(p => {
      const three = this.pendingDeal.splice(0, 3);
      p.hand = Deck.sortHand([...p.hand, ...three], this.trump);
    });
    this.pendingDeal = [];

    this._findBeloteHolders();
    this._resolveDeclarations();

    this.phase         = 'declarations';
    this.currentPlayer = (this.dealer + 1) % this.numPlayers;
    this.message       = `Коз: ${SUIT_NAMES[this.trump]} — Обява: ${this._contractLabel()} от ${this.players[this.contract.playerIndex].name}`;
  }

  _contractLabel() {
    const c = this.contract;
    return SUIT_NAMES[c.suit] || c.suit;
  }

  _findBeloteHolders() {
    this.beloteState = { holders: [], played: {} };
    const trumpSuits = this.trump === 'AT' ? ['H','D','C','S']
                     : this.trump !== 'NT'  ? [this.trump]
                     : [];
    for (let i = 0; i < this.numPlayers; i++) {
      const h = this.players[i].hand;
      for (const ts of trumpSuits) {
        if (h.some(c => c.rank === 'K' && c.suit === ts) &&
            h.some(c => c.rank === 'Q' && c.suit === ts)) {
          this.beloteState.holders.push({ playerIndex: i, suit: ts });
          this.beloteState.played[`${i}_${ts}`] = { k: false, q: false };
        }
      }
    }
  }

  _resolveDeclarations() {
    this.declarationSummary = [];
    this.declarationPoints  = [0, 0];
    if (this.trump === 'NT') return; // No declarations in No Trump

    const allDecls = this.players.map((p, i) => ({
      playerIndex: i,
      decls: Deck.getDeclarations(p.hand, this.trump).filter(d => d.type !== 'belote'),
    }));

    let winningTeam = null, bestDecl = null;
    for (const pd of allDecls) {
      for (const d of pd.decls) {
        if (!bestDecl || Deck.compareDeclarations(d, bestDecl, this.trump) > 0) {
          bestDecl    = d;
          winningTeam = getTeam(pd.playerIndex);
        }
      }
    }

    if (winningTeam !== null) {
      for (const pd of allDecls) {
        if (getTeam(pd.playerIndex) === winningTeam) {
          for (const d of pd.decls) {
            this.declarationPoints[winningTeam] += d.value;
            this.declarationSummary.push({
              playerIndex: pd.playerIndex,
              type: d.type, value: d.value,
              label: this._declLabel(d),
            });
          }
        }
      }
    }
  }

  _declLabel(d) {
    const n = { tierce: 'Терца', quarte: 'Кварта', quinte: 'Квинта', four: 'Каре', belote: 'Белот' };
    return `${n[d.type] || d.type} (${d.value}т)`;
  }

  startPlaying() {
    this.phase         = 'playing';
    this.currentPlayer = (this.dealer + 1) % this.numPlayers;
    this.message       = `${this.players[this.currentPlayer].name} играе пръв`;
  }

  // ── Card play ──────────────────────────────────────────────────────────────
  playCard(playerIndex, cardId) {
    if (this.phase !== 'playing')           return { error: 'Not in playing phase' };
    if (playerIndex !== this.currentPlayer) return { error: 'Not your turn' };

    const player  = this.players[playerIndex];
    const cardIdx = player.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return { error: 'Card not in hand' };

    const card  = player.hand[cardIdx];
    const legal = this._getLegal(playerIndex);
    if (!legal.some(c => c.id === cardId)) return { error: 'Незаконен ход — проверете правилата' };

    player.hand.splice(cardIdx, 1);

    // Белот announcement
    this.announcement = null;
    for (const h of this.beloteState.holders) {
      if (h.playerIndex === playerIndex &&
          (card.rank === 'K' || card.rank === 'Q') && card.suit === h.suit) {
        const key = `${playerIndex}_${h.suit}`;
        const st  = this.beloteState.played[key];
        st[card.rank === 'K' ? 'k' : 'q'] = true;
        if (st.k && st.q) this.announcement = `${player.name}: Белот!`;
        break;
      }
    }

    this.currentTrick.push({ playerIndex, card });

    if (this.currentTrick.length === this.numPlayers) {
      this._resolveTrick();
    } else {
      this.currentPlayer = (this.currentPlayer + 1) % this.numPlayers;
      this.message       = `Ход на ${this.players[this.currentPlayer].name}`;
    }

    return { success: true };
  }

  _getLegal(playerIndex) {
    const hand  = this.players[playerIndex].hand;
    const trump = this.trump;
    const { TRUMP_ORDER } = require('./Deck');

    if (this.currentTrick.length === 0) return hand;

    const ledSuit   = this.currentTrick[0].card.suit;
    const suitCards = hand.filter(c => c.suit === ledSuit);

    // No trump: only follow suit
    if (trump === 'NT') return suitCards.length > 0 ? suitCards : hand;

    // All trump: must follow suit AND overtrump
    if (trump === 'AT') {
      if (suitCards.length === 0) return hand;
      const highVal = Math.max(...this.currentTrick
        .filter(p => p.card.suit === ledSuit).map(p => TRUMP_ORDER[p.card.rank]));
      const over = suitCards.filter(c => TRUMP_ORDER[c.rank] > highVal);
      return over.length > 0 ? over : suitCards;
    }

    // Color trump
    if (ledSuit === trump) {
      if (suitCards.length === 0) return hand;
      const highVal = Math.max(...this.currentTrick
        .filter(p => p.card.suit === trump).map(p => TRUMP_ORDER[p.card.rank]));
      const over = suitCards.filter(c => TRUMP_ORDER[c.rank] > highVal);
      return over.length > 0 ? over : suitCards;
    }

    if (suitCards.length > 0) return suitCards;

    const trumpCards = hand.filter(c => c.suit === trump);
    if (trumpCards.length === 0) return hand;

    // In 1v1 there's no partner — always try to trump
    const partnerIdx = this.numPlayers === 4 ? (playerIndex + 2) % 4 : -1;
    const winnerIdx  = Deck.getCurrentTrickWinnerIdx(this.currentTrick, trump);
    if (partnerIdx !== -1 && winnerIdx === partnerIdx) return hand; // Partner winning — free choice

    const highTrumpVal = Math.max(...this.currentTrick
      .filter(p => p.card.suit === trump).map(p => TRUMP_ORDER[p.card.rank]), -1);
    if (highTrumpVal === -1) return trumpCards;
    const over = trumpCards.filter(c => TRUMP_ORDER[c.rank] > highTrumpVal);
    return over.length > 0 ? over : trumpCards;
  }

  _resolveTrick() {
    const winner  = Deck.getCurrentTrickWinnerIdx(this.currentTrick, this.trump);
    const winTeam = getTeam(winner);
    const pts     = this.currentTrick.reduce((s, p) => s + Deck.getPoints(p.card, this.trump), 0);

    this.handPoints[winTeam] += pts;
    this.tricksDone++;
    this.lastTrickWinner = winner;

    if (this.tricksDone === 8) this.handPoints[winTeam] += 10; // last trick bonus

    this.phase   = 'trick_complete';
    this.message = `${this.players[winner].name} взима взятката! (${pts}т)`;
    this._lastTrick = { winner, cards: [...this.currentTrick] };
  }

  advanceTrick() {
    this.currentTrick = [];
    this.announcement = null;
    if (this.tricksDone === 8) {
      this._calculateScore();
    } else {
      this.phase         = 'playing';
      this.currentPlayer = this.lastTrickWinner;
      this.message       = `${this.players[this.currentPlayer].name} играе`;
    }
  }

  // ── Scoring ────────────────────────────────────────────────────────────────
  _calculateScore() {
    this.phase = 'scoring';

    const attackTeam = getTeam(this.contract.playerIndex);
    const defTeam    = 1 - attackTeam;

    const hp = [...this.handPoints];
    hp[0] += this.declarationPoints[0];
    hp[1] += this.declarationPoints[1];

    // Белот bonuses
    for (const h of this.beloteState.holders) {
      const st = this.beloteState.played[`${h.playerIndex}_${h.suit}`];
      if (st && st.k && st.q) hp[getTeam(h.playerIndex)] += 20;
    }

    // Валат (all tricks to one team)
    if (this.handPoints[0] === 0 || this.handPoints[1] === 0) {
      const vt = this.handPoints[0] > 0 ? 0 : 1;
      hp[vt] += 90;
    }

    // NT: double all card points
    if (this.trump === 'NT') { hp[0] *= 2; hp[1] *= 2; }

    this.finalHandPoints = [...hp];

    const attackPts   = hp[attackTeam];
    const defPts      = hp[defTeam];
    const hanging     = attackPts === defPts;
    const contractMet = attackPts > defPts;

    let scoreAdded = [0, 0];

    if (hanging) {
      const defR = Math.round(defPts / 10);
      this.gameScores[defTeam] += defR;
      this.hangingPoints[attackTeam] += Math.round(attackPts / 10);
      scoreAdded[defTeam] = defR;
      this.message = `🤝 Висяща! ${this._teamName(defTeam)} записва ${defR}т`;
    } else if (contractMet) {
      const atkR = Math.round(attackPts / 10);
      const defR = Math.round(defPts / 10);
      scoreAdded[attackTeam] = atkR + this.hangingPoints[attackTeam];
      scoreAdded[defTeam]    = defR + this.hangingPoints[defTeam];
      this.gameScores[attackTeam] += scoreAdded[attackTeam];
      this.gameScores[defTeam]    += scoreAdded[defTeam];
      this.hangingPoints = [0, 0];
      this.message = `✅ Изкарана! ${this._teamName(attackTeam)} записва ${scoreAdded[attackTeam]}т`;
    } else {
      const totalR = Math.round((attackPts + defPts) / 10);
      scoreAdded[defTeam] = totalR + this.hangingPoints[defTeam];
      this.gameScores[defTeam] += scoreAdded[defTeam];
      for (const h of this.beloteState.holders) {
        const st = this.beloteState.played[`${h.playerIndex}_${h.suit}`];
        if (st && st.k && st.q && getTeam(h.playerIndex) === attackTeam) {
          this.gameScores[attackTeam] += 2;
          scoreAdded[attackTeam] = (scoreAdded[attackTeam] || 0) + 2;
        }
      }
      this.hangingPoints = [0, 0];
      this.message = `❌ Вкарана! ${this._teamName(defTeam)} взима всичко (${scoreAdded[defTeam]}т)`;
    }

    this.scoreResult = { contractMet, hanging, attackTeam, defTeam, attackPts, defPts, handPoints: hp, scoreAdded };

    const WIN = 151;
    if (this.gameScores[0] >= WIN || this.gameScores[1] >= WIN) {
      if (this.gameScores[0] === this.gameScores[1]) {
        this.message = `🤝 Равно по ${this.gameScores[0]}т — продължаваме!`;
      } else {
        const w      = this.gameScores[0] > this.gameScores[1] ? 0 : 1;
        this.phase   = 'gameover';
        this.message = `🏆 ${this._teamName(w)} печели с ${this.gameScores[w]}т!`;
      }
    }
  }

  _teamName(team) {
    return this.players.filter((p, i) => !p.isBot && getTeam(i) === team)
      .map(p => p.name).join(' & ') || (team === 0 ? 'Отбор А' : 'Отбор Б');
  }

  // ── State snapshot ─────────────────────────────────────────────────────────
  getState(forPlayerIndex = null) {
    return {
      mode:               this.mode,
      numPlayers:         this.numPlayers,
      phase:              this.phase,
      mySeat:             forPlayerIndex,
      players:            this.players.map((p, i) => ({
        seat:      p.seat,
        name:      p.name,
        isBot:     p.isBot,
        connected: p.connected,
        handCount: p.hand.length,
        hand: (forPlayerIndex === null || i === forPlayerIndex)
          ? p.hand
          : Array(p.hand.length).fill({ hidden: true }),
      })),
      dealer:             this.dealer,
      currentPlayer:      this.currentPlayer,
      trump:              this.trump,
      contract:           this.contract,
      bids:               this.bids,
      currentTrick:       this.currentTrick,
      lastTrick:          this._lastTrick || null,
      tricksDone:         this.tricksDone,
      handPoints:         this.handPoints,
      declarationPoints:  this.declarationPoints,
      declarationSummary: this.declarationSummary || [],
      finalHandPoints:    this.finalHandPoints || null,
      scoreResult:        this.scoreResult || null,
      gameScores:         this.gameScores,
      hangingPoints:      this.hangingPoints,
      beloteState:        this.beloteState,
      announcement:       this.announcement,
      lastTrickWinner:    this.lastTrickWinner,
      message:            this.message,
      legalCards: forPlayerIndex !== null && this.phase === 'playing' && forPlayerIndex === this.currentPlayer
        ? this._getLegal(forPlayerIndex).map(c => c.id)
        : [],
    };
  }

  getBidValues() { return [80, 90, 100, 110, 120, 130, 140, 150, 160]; }
}

module.exports = BeloteGame;
