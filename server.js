'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const BeloteGame = require('./src/BeloteGame');
const AIPlayer = require('./src/AIPlayer');
const { TRUMP_ORDER } = require('./src/Deck');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Rooms: Map<roomCode, { game, seatMap: Map<socketId, seat> }>
const rooms = new Map();

function genCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Broadcast personalized game state to all clients in a room
function emitState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const { game, seatMap } = room;

  // Use seatMap (always current socket IDs) — not game.players[i].socketId
  // which can be stale during the lobby→game.html redirect window
  seatMap.forEach((seat, socketId) => {
    const state = game.getState(seat);
    io.to(socketId).emit('game_state', { ...state, mySeat: seat, roomCode });
  });
}

// Schedule an AI move after a short delay so it feels natural
function scheduleAIMoves(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const { game } = room;

  const p = game.players[game.currentPlayer];
  if (!p || !p.isBot) return;

  setTimeout(() => {
    const room2 = rooms.get(roomCode);
    if (!room2) return;
    const g = room2.game;
    if (g.players[g.currentPlayer]?.isBot !== true) return;

    if (g.phase === 'bidding') {
      const best = g._getBestBid();
      // For NT/AT bids the value field is 0; pass the suit only
      const bid = AIPlayer.chooseBid(p.hand, best);
      const result = g.placeBid(g.currentPlayer, bid);
      emitState(roomCode);
      if (!result.redeal) scheduleAIMoves(roomCode);
      else emitState(roomCode);

    } else if (g.phase === 'playing') {
      const pi = g.currentPlayer;
      const legal = g._getLegal(pi);
      const partnerIdx = (pi + 2) % g.numPlayers;
      const card = AIPlayer.chooseCard(legal, g.currentTrick, g.trump, g.players[pi].hand, partnerIdx);
      g.playCard(pi, card.id);
      emitState(roomCode);

      if (g.phase === 'trick_complete') {
        handleTrickComplete(roomCode);
      } else {
        scheduleAIMoves(roomCode);
      }
    }
  }, 900);
}

function handleTrickComplete(roomCode) {
  emitState(roomCode);
  setTimeout(() => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const { game } = room;
    if (game.phase !== 'trick_complete') return;
    game.advanceTrick();
    emitState(roomCode);

    if (game.phase === 'playing') {
      scheduleAIMoves(roomCode);
    } else if (game.phase === 'scoring' || game.phase === 'gameover') {
      emitState(roomCode);
    }
  }, 2000);
}

// ── Socket.io events ──────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  // Create a new room
  socket.on('create_room', ({ name, mode }) => {
    const roomCode = genCode();
    const game = new BeloteGame(mode || '2v2');
    rooms.set(roomCode, { game, seatMap: new Map() });

    const seat = 0;
    const result = game.connectPlayer(socket.id, name, seat);
    if (result.error) { socket.emit('error', { message: result.error }); return; }

    rooms.get(roomCode).seatMap.set(socket.id, seat);
    socket.join(roomCode);
    socket.emit('room_created', { roomCode, seat, name, mode: game.mode });
    emitState(roomCode);
    console.log(`[room] ${roomCode} created by ${name} (${game.mode})`);
  });

  // Join an existing room
  socket.on('join_room', ({ name, roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) { socket.emit('error', { message: 'Room not found' }); return; }

    const { game } = room;

    // Check if this is a reconnect: find existing seat by name
    let seat = null;
    let isReconnect = false;
    game.players.forEach((p, i) => {
      if (!p.isBot && p.name === name) { seat = i; isReconnect = true; }
    });

    if (!isReconnect) {
      // New joiner — always seat 1 (opponent of creator)
      seat = 1;
    }

    const result = game.connectPlayer(socket.id, name, seat);
    if (result.error && !isReconnect) { socket.emit('error', { message: result.error }); return; }

    // Update socket mapping even on reconnect
    if (isReconnect) {
      game.players[seat].socketId = socket.id;
      game.players[seat].connected = true;
      room.seatMap.set(socket.id, seat);
    } else {
      room.seatMap.set(socket.id, seat);
    }

    socket.join(roomCode);
    socket.emit('room_joined', { roomCode, seat, name });
    emitState(roomCode);
    console.log(`[room] ${name} ${isReconnect ? 'reconnected to' : 'joined'} ${roomCode} at seat ${seat}`);

    // Trigger AI if game is in a phase where a bot should move
    if ((game.phase === 'bidding') && !isReconnect) {
      scheduleAIMoves(roomCode);
    }
  });

  // Player places a bid (2v2 only)
  socket.on('bid', ({ roomCode, suit, value, pass }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const { game } = room;
    const seat = room.seatMap.get(socket.id);
    if (seat === undefined) return;

    const result = game.placeBid(seat, pass ? { pass: true } : { suit, value });
    if (result?.error) { socket.emit('error', { message: result.error }); return; }

    emitState(roomCode);
    if (result?.redeal) {
      setTimeout(() => {
        const r = rooms.get(roomCode);
        if (r && r.game.phase === 'redeal') {
          r.game.startNewHand();
          emitState(roomCode);
          scheduleAIMoves(roomCode);
        }
      }, 2000);
      return;
    }

    if (game.phase === 'declarations') {
      // Auto-advance to playing after declarations display
      setTimeout(() => {
        const r = rooms.get(roomCode);
        if (!r || r.game.phase !== 'declarations') return;
        r.game.startPlaying();
        emitState(roomCode);
        scheduleAIMoves(roomCode);
      }, 3000);
    } else {
      scheduleAIMoves(roomCode);
    }
  });

  // Player selects trump (1v1 only — replaces bidding)
  socket.on('select_trump', ({ roomCode, suit }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const { game } = room;
    const seat = room.seatMap.get(socket.id);
    if (seat === undefined) return;

    const result = game.selectTrump(seat, suit);
    if (result?.error) { socket.emit('error', { message: result.error }); return; }

    emitState(roomCode);
    // Auto-advance declarations after a short display
    setTimeout(() => {
      const r = rooms.get(roomCode);
      if (!r || r.game.phase !== 'declarations') return;
      r.game.startPlaying();
      emitState(roomCode);
    }, 3000);
  });

  // Player acknowledges declarations and is ready to play
  socket.on('ready_to_play', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.game.phase === 'declarations') {
      room.game.startPlaying();
      emitState(roomCode);
      scheduleAIMoves(roomCode);
    }
  });

  // Player plays a card
  socket.on('play_card', ({ roomCode, cardId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const { game } = room;
    const seat = room.seatMap.get(socket.id);
    if (seat === undefined) return;

    const result = game.playCard(seat, cardId);
    if (result?.error) { socket.emit('error', { message: result.error }); return; }

    emitState(roomCode);

    if (game.phase === 'trick_complete') {
      handleTrickComplete(roomCode);
    } else {
      scheduleAIMoves(roomCode);
    }
  });

  // Start a new hand after scoring or game over
  socket.on('new_hand', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const { game } = room;
    if (game.phase !== 'scoring' && game.phase !== 'gameover') return;
    if (game.phase === 'gameover') {
      game.gameScores = [0, 0];
      game.hangingPoints = [0, 0];
    }
    game.startNewHand();
    emitState(roomCode);
    scheduleAIMoves(roomCode);
  });

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    rooms.forEach((room, code) => {
      if (room.seatMap.has(socket.id)) {
        room.game.disconnectPlayer(socket.id);
        room.seatMap.delete(socket.id);
        emitState(code);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let lanIp = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) { lanIp = net.address; break; }
    }
  }
  console.log(`\n🃏 Belote server running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${lanIp}:${PORT}  ← share this with your partner\n`);
});
