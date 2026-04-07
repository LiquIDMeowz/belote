'use strict';

const socket = io();
let roomCode    = null;
let selectedMode = '1v1'; // default: no bots

// ── Mode picker ──────────────────────────────────────────────────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMode = btn.dataset.mode;
  });
});

// ── Particles ───────────────────────────────────────────────────────────────
const symbols = ['♠','♥','♦','♣'];
const container = document.getElementById('particles');
for (let i = 0; i < 18; i++) {
  const el = document.createElement('div');
  el.className = 'particle';
  el.textContent = symbols[i % 4];
  el.style.left = `${Math.random() * 100}%`;
  el.style.animationDuration = `${8 + Math.random() * 14}s`;
  el.style.animationDelay = `${Math.random() * 12}s`;
  el.style.fontSize = `${1.2 + Math.random() * 2}rem`;
  el.style.color = (i % 4 < 2) ? '#e53e3e' : '#f0ece0';
  container.appendChild(el);
}

// ── Create room ─────────────────────────────────────────────────────────────
document.getElementById('create-btn').addEventListener('click', () => {
  const name = document.getElementById('player-name').value.trim();
  if (!name) { showError('Please enter your name!'); return; }
  socket.emit('create_room', { name, mode: selectedMode });
});

// ── Join room ────────────────────────────────────────────────────────────────
document.getElementById('join-btn').addEventListener('click', joinRoom);
document.getElementById('room-code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});

function joinRoom() {
  const name = document.getElementById('player-name').value.trim();
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!name) { showError('Please enter your name!'); return; }
  if (!code) { showError('Enter a room code!'); return; }
  socket.emit('join_room', { name, roomCode: code });
}

// ── Copy code ────────────────────────────────────────────────────────────────
document.getElementById('copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(roomCode || '').then(() => {
    const btn = document.getElementById('copy-btn');
    btn.textContent = '✅';
    setTimeout(() => { btn.textContent = '📋'; }, 1500);
  });
});

// ── Socket events ─────────────────────────────────────────────────────────────
socket.on('room_created', ({ roomCode: code, seat, name }) => {
  roomCode = code;
  sessionStorage.setItem('belote_room', code);
  sessionStorage.setItem('belote_seat', seat);
  sessionStorage.setItem('belote_name', name);

  document.getElementById('setup-panel').classList.add('hidden');
  document.getElementById('waiting-panel').classList.remove('hidden');
  document.getElementById('display-room-code').textContent = code;
});

socket.on('room_joined', ({ roomCode: code, seat, name }) => {
  sessionStorage.setItem('belote_room', code);
  sessionStorage.setItem('belote_seat', seat);
  sessionStorage.setItem('belote_name', name);
  // Redirect straight to game with params in URL
  window.location.href = `game.html?room=${code}&name=${encodeURIComponent(name)}`;
});

socket.on('game_state', (state) => {
  // Creator gets redirected when game starts (bidding begins)
  if (state.phase !== 'waiting' && roomCode) {
    const name = document.getElementById('player-name').value.trim() ||
      sessionStorage.getItem('belote_name') || 'Player';
    window.location.href = `game.html?room=${roomCode}&name=${encodeURIComponent(name)}`;
  }
});


socket.on('error', ({ message }) => showError(message));

function showError(msg) {
  const toast = document.getElementById('error-toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}
