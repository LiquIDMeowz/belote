'use strict';

// ── Config ────────────────────────────────────────────────────────────────
const socket   = io();
const _params  = new URLSearchParams(window.location.search);
const roomCode = _params.get('room') || sessionStorage.getItem('belote_room');
const myName   = _params.get('name') || sessionStorage.getItem('belote_name') || 'Player';

if (!roomCode) { window.location.href = '/'; }

// ── Mutable state ─────────────────────────────────────────────────────────
let gameState     = null;
let currentMySeat = -1;
let selectedBidSuit  = null;
let selectedBidValue = null;

// ── Suit helpers ──────────────────────────────────────────────────────────
const SUIT_SYM  = { H: '♥', D: '♦', C: '♣', S: '♠' };
const TRUMP_LABEL = {
  H: '♥ Купи',   D: '♦ Каро',
  C: '♣ Спатии', S: '♠ Пики',
  NT: 'Без коз', AT: 'Всичко коз',
};

function suitColor(suit) { return (suit === 'H' || suit === 'D') ? 'red' : 'black'; }

// ── Seat → display position ───────────────────────────────────────────────
function posForSeat(seat, numPlayers) {
  if (numPlayers === 2) {
    // In 1v1: I am always South, opponent is always North
    return seat === currentMySeat ? 'south' : 'north';
  }
  const positions = ['south', 'west', 'north', 'east'];
  const offset    = (seat - currentMySeat + 4) % 4;
  return positions[offset];
}

// ── Build a card DOM element ──────────────────────────────────────────────
function buildCard(card, legalIds = []) {
  const div = document.createElement('div');

  if (!card || card.hidden) {
    div.className = 'card back';
    return div;
  }

  const cc      = suitColor(card.suit);
  const isLegal = legalIds.includes(card.id);
  div.className = `card ${cc}${isLegal ? ' playable' : ''}`;
  div.dataset.id = card.id;

  const top    = document.createElement('div');
  top.className = 'card-rank-top';
  top.textContent = card.rank;

  const center = document.createElement('div');
  center.className = 'card-suit-center';
  center.textContent = SUIT_SYM[card.suit];

  const bot = document.createElement('div');
  bot.className = 'card-rank-bot';
  bot.textContent = card.rank;

  div.append(top, center, bot);

  if (isLegal && gameState?.phase === 'playing') {
    div.addEventListener('click', () => socket.emit('play_card', { roomCode, cardId: card.id }));
  }
  return div;
}

// ── Main render ───────────────────────────────────────────────────────────
function render(state) {
  if (state.mySeat !== undefined && state.mySeat !== null) {
    currentMySeat = state.mySeat;
  }
  if (currentMySeat === -1) return;
  gameState = state;

  const { numPlayers, players, phase, trump, contract, currentPlayer,
          currentTrick, tricksDone, gameScores, announcement, message,
          legalCards = [], declarationSummary, declarationPoints,
          scoreResult, finalHandPoints } = state;

  // ── Score bar ──
  document.getElementById('score0').textContent = gameScores[0];
  document.getElementById('score1').textContent = gameScores[1];
  document.getElementById('score-team0').classList.toggle('winning', gameScores[0] > gameScores[1]);
  document.getElementById('score-team1').classList.toggle('winning', gameScores[1] > gameScores[0]);
  // Teams: in 1v1 each player is their own team; in 2v2 pair by seat parity
  let h0, h1;
  if (numPlayers === 2) {
    h0 = players[0]?.name || 'Играч 1';
    h1 = players[1]?.name || 'Играч 2';
  } else {
    h0 = players.filter((p,i) => !p.isBot && i % 2 === 0).map(p => p.name).join(' & ') || 'South & North';
    h1 = players.filter((p,i) => !p.isBot && i % 2 === 1).map(p => p.name).join(' & ') || 'West & East';
  }
  document.getElementById('team0-label').textContent = h0;
  document.getElementById('team1-label').textContent = h1;

  // ── Trump / Contract display ──
  const trumpEl = document.getElementById('trump-display');
  if (trump) {
    trumpEl.classList.remove('hidden');
    document.getElementById('trump-suit-icon').textContent = TRUMP_LABEL[trump] || trump;
    trumpEl.style.color = (trump === 'H' || trump === 'D') ? '#fca5a5'
                        : (trump === 'NT') ? '#a5d8ff'
                        : (trump === 'AT') ? '#d8b4fe'
                        : '#f0ece0';
  } else {
    trumpEl.classList.add('hidden');
  }
  const contractEl = document.getElementById('contract-display');
  if (contract) {
    contractEl.classList.remove('hidden');
    const contractSuit = contract.suit;
    const label = contractSuit === 'NT' ? 'Без коз'
                : contractSuit === 'AT' ? 'Всичко коз'
                : `${TRUMP_LABEL[contractSuit] || contractSuit}`;
    document.getElementById('contract-val').textContent = `${label} (${players[contract.playerIndex]?.name})`;
  } else {
    contractEl.classList.add('hidden');
  }

  document.getElementById('trick-count').textContent = `Взятки: ${tricksDone}/8`;

  // Hide west/east zones in 1v1 mode
  ['west', 'east'].forEach(pos => {
    const z = document.getElementById(`zone-${pos}`);
    if (z) z.classList.toggle('hidden', numPlayers === 2);
  });

  // ── Seat → zone rendering ──
  const posMap = {};
  players.forEach((p, i) => { posMap[posForSeat(i, numPlayers)] = { player: p, idx: i }; });

  for (const pos of ['south', 'west', 'north', 'east']) {
    const info = posMap[pos];
    if (!info) continue;
    const { player, idx } = info;

    const labelEl = document.getElementById(`label-${pos}`);
    if (labelEl) {
      labelEl.textContent = player.name + (player.isBot ? ' 🤖' : '');
      labelEl.classList.toggle('you-label', idx === currentMySeat);
      labelEl.classList.toggle('active-turn', idx === currentPlayer && phase === 'playing');
    }

    const handEl = document.getElementById(`hand-${pos}`);
    if (!handEl) continue;
    handEl.innerHTML = '';

    const isMe = (idx === currentMySeat);
    (player.hand || []).forEach(card => {
      handEl.appendChild(isMe ? buildCard(card, legalCards) : buildCard(card));
    });
  }

  // ── Trick area ──
  const trickSlot = { south: 'trick-south', west: 'trick-west', north: 'trick-north', east: 'trick-east' };
  Object.values(trickSlot).forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  (currentTrick || []).forEach(({ playerIndex, card }) => {
    const pos  = posForSeat(playerIndex, numPlayers);
    const slot = document.getElementById(trickSlot[pos]);
    if (slot) {
      const el = buildCard(card);
      if (phase === 'trick_complete' && state.lastTrickWinner === playerIndex) el.classList.add('winner-flash');
      slot.appendChild(el);
    }
  });

  // ── Message bar ──
  document.getElementById('message-bar').textContent = message || '';

  // ── Announcement overlay ──
  const annEl = document.getElementById('announcement');
  if (announcement) {
    annEl.textContent = announcement;
    annEl.classList.remove('hidden');
    setTimeout(() => annEl.classList.add('hidden'), 2500);
  }

  // ── Modals ──
  closeAllModals();
  if      (phase === 'bidding'      && currentPlayer === currentMySeat) openBidModal(state);
  else if (phase === 'declarations') openDeclModal(declarationSummary, declarationPoints, players);
  else if (phase === 'scoring')      openScoreModal(scoreResult, finalHandPoints, gameScores, players);
  else if (phase === 'gameover')     openGameoverModal(state);
}

// ── Bid modal ─────────────────────────────────────────────────────────────
function openBidModal(state) {
  document.getElementById('bid-modal').classList.remove('hidden');
  
  const bids = state.bids || [];
  const best = bids.filter(b => !b.pass).pop();

  const SUBMIT_SUIT_RANK = { C: 1, D: 2, H: 3, S: 4, NT: 5, AT: 6 };
  let bestLevel = 0;
  let bestLabel = 'Няма обява';

  if (best) {
    bestLevel = SUBMIT_SUIT_RANK[best.suit] || 0;
    bestLabel = `Текуща обява: ${TRUMP_LABEL[best.suit]}`;
  }
  document.getElementById('bid-current-info').textContent = bestLabel;

  const ntDisabled  = bestLevel >= SUBMIT_SUIT_RANK['NT'];
  const atDisabled  = bestLevel >= SUBMIT_SUIT_RANK['AT'];

  // ── Modals lock state to prevent double submits
  let isSubmitting = false;

  // ── Color suit buttons — click immediately submits ──
  const valueGrid = document.getElementById('value-grid');
  if(valueGrid) {
    valueGrid.style.display = 'none'; // hide the value/number grid entirely
  }

  ['C', 'D', 'H', 'S'].forEach(suit => {
    const btn = document.getElementById(`bid-${suit}`);
    if(!btn) return;
    const suitRank = { C: 1, D: 2, H: 3, S: 4 }[suit];
    const isDisabled = suitRank <= bestLevel;
    
    btn.classList.toggle('disabled-bid', isDisabled);
    btn.disabled = isDisabled;
    btn.classList.remove('selected');
    
    btn.onclick = isDisabled ? null : () => {
      if (isSubmitting) return;
      isSubmitting = true;
      document.querySelectorAll('#bid-modal .suit-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      socket.emit('bid', { roomCode, suit });
      document.getElementById('bid-modal').classList.add('hidden');
    };
  });

  // ── NT button ──
  const ntBtn = document.getElementById('bid-NT');
  ntBtn.classList.toggle('disabled-bid', ntDisabled);
  ntBtn.disabled = ntDisabled;
  ntBtn.classList.remove('selected');
  ntBtn.onclick = ntDisabled ? null : () => {
    if (isSubmitting) return;
    isSubmitting = true;
    document.querySelectorAll('#bid-modal .suit-btn').forEach(b => b.classList.remove('selected'));
    ntBtn.classList.add('selected');
    socket.emit('bid', { roomCode, suit: 'NT' });
    document.getElementById('bid-modal').classList.add('hidden');
  };

  // ── AT button ──
  const atBtn = document.getElementById('bid-AT');
  atBtn.classList.toggle('disabled-bid', atDisabled);
  atBtn.disabled = atDisabled;
  atBtn.classList.remove('selected');
  atBtn.onclick = atDisabled ? null : () => {
    if (isSubmitting) return;
    isSubmitting = true;
    document.querySelectorAll('#bid-modal .suit-btn').forEach(b => b.classList.remove('selected'));
    atBtn.classList.add('selected');
    socket.emit('bid', { roomCode, suit: 'AT' });
    document.getElementById('bid-modal').classList.add('hidden');
  };

  // ── Pass button ──
  const passBtn = document.getElementById('bid-pass');
  passBtn.onclick = () => {
    if (isSubmitting) return;
    isSubmitting = true;
    socket.emit('bid', { roomCode, pass: true });
    document.getElementById('bid-modal').classList.add('hidden');
  };
}

// ── Declarations modal ────────────────────────────────────────────────────
const DECL_NAMES = { tierce: 'Терца (20)', quarte: 'Кварта (50)', quinte: 'Квинта (100)', four: 'Каре', belote: 'Белот (20)' };

function openDeclModal(summary, points, players) {
  document.getElementById('decl-modal').classList.remove('hidden');
  const list = document.getElementById('decl-list');
  list.innerHTML = '';

  if (!summary || summary.length === 0) {
    const none = document.createElement('div');
    none.className   = 'decl-item';
    none.textContent = 'Няма анонси';
    list.appendChild(none);
  } else {
    summary.forEach(d => {
      const row  = document.createElement('div');
      row.className = 'decl-item';
      const team = d.playerIndex % 2 === 0 ? 'Юг & Север' : 'Запад & Изток';
      row.innerHTML = `<span>${players[d.playerIndex]?.name || team}: ${DECL_NAMES[d.type] || d.type}</span><span class="decl-pts">+${d.value}</span>`;
      list.appendChild(row);
    });
  }

  const tp = points || [0, 0];
  const numP = players.length;
  const t0 = numP === 2 ? players[0]?.name : (players.filter((p,i)=>!p.isBot&&i%2===0).map(p=>p.name).join(' & ') || 'Юг & Север');
  const t1 = numP === 2 ? players[1]?.name : (players.filter((p,i)=>!p.isBot&&i%2===1).map(p=>p.name).join(' & ') || 'Запад & Изток');
  document.getElementById('decl-total').textContent = `Анонси: ${t0} +${tp[0]} | ${t1} +${tp[1]}`;

  document.getElementById('decl-ok').onclick = () => {
    socket.emit('ready_to_play', { roomCode });
    document.getElementById('decl-modal').classList.add('hidden');
  };
}

// ── Score modal ───────────────────────────────────────────────────────────
function openScoreModal(result, hp, gameScores, players) {
  if (!result) return;
  document.getElementById('score-modal').classList.remove('hidden');

  const _numP = players.length;
  const t0 = _numP === 2 ? players[0]?.name : (players.filter((p,i)=>!p.isBot&&i%2===0).map(p=>p.name).join(' & ') || 'Юг & Север');
  const t1 = _numP === 2 ? players[1]?.name : (players.filter((p,i)=>!p.isBot&&i%2===1).map(p=>p.name).join(' & ') || 'Запад & Изток');

  const titleEl = document.getElementById('score-result-title');
  if (result.hanging)      titleEl.textContent = '🤝 Висяща игра!';
  else if (result.contractMet) titleEl.textContent = '✅ Изкарана!';
  else                          titleEl.textContent = '❌ Вкарана!';

  const c = gameState?.contract;
  const contractLabel = !c ? '' : c.suit === 'NT' ? 'Без коз' : c.suit === 'AT' ? 'Всичко коз' : `${c.value} ${TRUMP_LABEL[c.suit] || c.suit}`;

  document.getElementById('score-breakdown').innerHTML = `
    <div class="score-row"><span>Точки — ${t0}</span><span>${hp?.[0] ?? 0}</span></div>
    <div class="score-row"><span>Точки — ${t1}</span><span>${hp?.[1] ?? 0}</span></div>
    <div class="score-row" style="color:var(--muted);font-style:italic">
      <span>Обява: ${contractLabel}</span>
      <span>${result.contractMet ? 'изкарана ✓' : result.hanging ? 'висяща' : 'вкарана ✗'}</span>
    </div>`;

  document.getElementById('score-totals').innerHTML = `
    <div class="score-total-row"><span>${t0}</span><span>${gameScores[0]}</span></div>
    <div class="score-total-row"><span>${t1}</span><span>${gameScores[1]}</span></div>
    <div class="score-row" style="color:var(--muted);font-size:0.8rem;text-align:center">Печели първият с 151+ точки</div>`;

  document.getElementById('next-hand-btn').onclick = () => {
    socket.emit('new_hand', { roomCode });
    document.getElementById('score-modal').classList.add('hidden');
  };
}

// ── Game over modal ───────────────────────────────────────────────────────
function openGameoverModal(state) {
  document.getElementById('gameover-modal').classList.remove('hidden');
  document.getElementById('gameover-msg').textContent = state.message;

  const t0 = state.players.filter((p,i) => !p.isBot && i%2===0).map(p=>p.name).join(' & ') || 'Юг & Север';
  const t1 = state.players.filter((p,i) => !p.isBot && i%2===1).map(p=>p.name).join(' & ') || 'Запад & Изток';
  document.getElementById('final-scores').innerHTML = `
    <div class="final-score-item"><div class="fs-label">${t0}</div><div class="fs-val">${state.gameScores[0]}</div></div>
    <div class="final-score-item"><div class="fs-label">${t1}</div><div class="fs-val">${state.gameScores[1]}</div></div>`;

  document.getElementById('play-again-btn').onclick = () => {
    socket.emit('new_hand', { roomCode });
    document.getElementById('gameover-modal').classList.add('hidden');
  };
}

function closeAllModals() {
  ['bid-modal', 'decl-modal', 'score-modal', 'gameover-modal'].forEach(id =>
    document.getElementById(id)?.classList.add('hidden'));
}

// ── Socket events ─────────────────────────────────────────────────────────
socket.on('connect', () => { socket.emit('join_room', { name: myName, roomCode }); });
socket.on('room_joined', ({ seat }) => { currentMySeat = seat; });
socket.on('game_state', (state) => { render(state); });
socket.on('error', ({ message }) => {
  document.getElementById('message-bar').textContent = `⚠️ ${message}`;
});
