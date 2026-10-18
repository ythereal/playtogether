/*
 * Chess rules — pure functions, no DOM, no networking.
 * Board: array of 64, index = rank*8 + file, 0 = a1, 7 = h1, 56 = a8, 63 = h8.
 * Pieces: 'wP', 'bK', … (colour + type). White pawns move +8.
 * Every function returns new objects; nothing mutates the state it is given.
 */
(function (root) {
  'use strict';

  const FILES = 'abcdefgh';
  const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const KING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const CORNERS = { 0: 'wQ', 7: 'wK', 56: 'bQ', 63: 'bK' };

  const opp = c => (c === 'w' ? 'b' : 'w');
  const sqName = i => FILES[i & 7] + ((i >> 3) + 1);
  const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

  function startBoard() {
    const b = Array(64).fill(null);
    const back = 'RNBQKBNR';
    for (let f = 0; f < 8; f++) {
      b[f] = 'w' + back[f]; b[8 + f] = 'wP';
      b[48 + f] = 'bP'; b[56 + f] = 'b' + back[f];
    }
    return b;
  }

  function posKey(s) {
    const c = s.castling;
    return s.board.map(p => p || '-').join('') + s.turn +
      (c.wK ? 'K' : '') + (c.wQ ? 'Q' : '') + (c.bK ? 'k' : '') + (c.bQ ? 'q' : '') + s.ep;
  }

  // prev: previous game's state (for the rematch); colours swap and the score carries over.
  function newState(prev) {
    const s = {
      board: startBoard(), turn: 'w',
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      ep: -1, halfmove: 0, fullmove: 1,
      moves: [], positions: [],
      result: null, drawOffer: null, lastMove: null,
      hostColor: prev ? opp(prev.hostColor) : 'w',
      score: prev ? prev.score : { host: 0, guest: 0, draws: 0 },
    };
    s.positions = [posKey(s)];
    return s;
  }

  function fromFEN(fen) {
    const [placement, turn, cast, ep, half, full] = fen.trim().split(/\s+/);
    const s = newState();
    s.board = Array(64).fill(null);
    placement.split('/').forEach((row, i) => {
      let f = 0; const r = 7 - i;
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') f += +ch;
        else { s.board[r * 8 + f] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase(); f++; }
      }
    });
    s.turn = turn || 'w';
    s.castling = { wK: /K/.test(cast), wQ: /Q/.test(cast), bK: /k/.test(cast), bQ: /q/.test(cast) };
    s.ep = !ep || ep === '-' ? -1 : FILES.indexOf(ep[0]) + (ep[1] - 1) * 8;
    s.halfmove = +half || 0; s.fullmove = +full || 1;
    s.positions = [posKey(s)];
    return s;
  }

  // Is square sq attacked by colour `by`?
  function attacked(b, sq, by) {
    const f = sq & 7, r = sq >> 3;
    const pr = r + (by === 'w' ? -1 : 1);
    for (const df of [-1, 1]) if (onBoard(f + df, pr) && b[pr * 8 + f + df] === by + 'P') return true;
    for (const [df, dr] of KNIGHT) if (onBoard(f + df, r + dr) && b[(r + dr) * 8 + f + df] === by + 'N') return true;
    for (const [df, dr] of KING) if (onBoard(f + df, r + dr) && b[(r + dr) * 8 + f + df] === by + 'K') return true;
    for (const [dirs, types] of [[BISHOP, 'BQ'], [ROOK, 'RQ']]) {
      for (const [df, dr] of dirs) {
        let ff = f + df, rr = r + dr;
        while (onBoard(ff, rr)) {
          const p = b[rr * 8 + ff];
          if (p) { if (p[0] === by && types.includes(p[1])) return true; break; }
          ff += df; rr += dr;
        }
      }
    }
    return false;
  }

  function kingSq(b, c) { return b.indexOf(c + 'K'); }
  function inCheck(s, c) {
    c = c || s.turn;
    const k = kingSq(s.board, c);
    return k >= 0 && attacked(s.board, k, opp(c));
  }

  // Moves ignoring whether they leave the own king in check (castling checks are complete).
  function pseudoMoves(s, from) {
    const b = s.board, p = b[from];
    if (!p) return [];
    const c = p[0], t = p[1], f = from & 7, r = from >> 3, out = [];
    const add = (to, extra) => out.push(Object.assign({ from, to }, extra));
    const addPawn = (to, last, extra) => { if (last) for (const promo of 'QRBN') add(to, Object.assign({ promo }, extra)); else add(to, extra); };

    if (t === 'P') {
      const dir = c === 'w' ? 1 : -1, start = c === 'w' ? 1 : 6, lastRank = c === 'w' ? 7 : 0;
      const r1 = r + dir;
      if (r1 >= 0 && r1 < 8) {
        const one = r1 * 8 + f;
        if (!b[one]) {
          addPawn(one, r1 === lastRank);
          if (r === start && !b[one + dir * 8]) add(one + dir * 8, { double: true });
        }
        for (const df of [-1, 1]) {
          if (!onBoard(f + df, r1)) continue;
          const to = r1 * 8 + f + df;
          if (b[to] && b[to][0] !== c) addPawn(to, r1 === lastRank);
          else if (to === s.ep && !b[to]) add(to, { ep: true });
        }
      }
    } else if (t === 'N' || t === 'K') {
      for (const [df, dr] of t === 'N' ? KNIGHT : KING) {
        if (!onBoard(f + df, r + dr)) continue;
        const to = (r + dr) * 8 + f + df;
        if (!b[to] || b[to][0] !== c) add(to);
      }
      if (t === 'K') {
        const home = c === 'w' ? 4 : 60, o = opp(c);
        if (from === home && !attacked(b, home, o)) {
          if (s.castling[c + 'K'] && b[home + 3] === c + 'R' && !b[home + 1] && !b[home + 2] &&
              !attacked(b, home + 1, o) && !attacked(b, home + 2, o)) add(home + 2, { castle: 'K' });
          if (s.castling[c + 'Q'] && b[home - 4] === c + 'R' && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
              !attacked(b, home - 1, o) && !attacked(b, home - 2, o)) add(home - 2, { castle: 'Q' });
        }
      }
    } else {
      const dirs = t === 'B' ? BISHOP : t === 'R' ? ROOK : BISHOP.concat(ROOK);
      for (const [df, dr] of dirs) {
        let ff = f + df, rr = r + dr;
        while (onBoard(ff, rr)) {
          const to = rr * 8 + ff;
          if (b[to]) { if (b[to][0] !== c) add(to); break; }
          add(to); ff += df; rr += dr;
        }
      }
    }
    return out;
  }

  // Apply a (pseudo-)legal move. Returns a new state; moves/positions/result are left to play().
  function applyMove(s, m) {
    const b = s.board.slice();
    const p = b[m.from], c = p[0], t = p[1];
    const captured = m.ep ? b[m.to + (c === 'w' ? -8 : 8)] : b[m.to];
    const n = {
      board: b, turn: opp(c),
      castling: Object.assign({}, s.castling),
      ep: m.double ? (m.from + m.to) / 2 : -1,
      halfmove: (t === 'P' || captured) ? 0 : s.halfmove + 1,
      fullmove: s.fullmove + (c === 'b' ? 1 : 0),
      moves: s.moves, positions: s.positions,
      result: null, drawOffer: null,
      lastMove: { from: m.from, to: m.to },
      hostColor: s.hostColor, score: s.score,
    };
    b[m.to] = m.promo ? c + m.promo : p;
    b[m.from] = null;
    if (m.ep) b[m.to + (c === 'w' ? -8 : 8)] = null;
    if (m.castle === 'K') { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = null; }
    if (m.castle === 'Q') { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = null; }
    if (t === 'K') { n.castling[c + 'K'] = false; n.castling[c + 'Q'] = false; }
    if (CORNERS[m.from]) n.castling[CORNERS[m.from]] = false;
    if (CORNERS[m.to]) n.castling[CORNERS[m.to]] = false;
    return n;
  }

  function legalMoves(s, from) {
    const p = s.board[from];
    if (!p || p[0] !== s.turn) return [];
    return pseudoMoves(s, from).filter(m => !inCheck(applyMove(s, m), s.turn));
  }
  function allLegalMoves(s) {
    const out = [];
    for (let i = 0; i < 64; i++) if (s.board[i] && s.board[i][0] === s.turn) out.push(...legalMoves(s, i));
    return out;
  }

  function insufficientMaterial(b) {
    const rest = [];
    b.forEach((p, i) => { if (p && p[1] !== 'K') rest.push({ t: p[1], dark: ((i & 7) + (i >> 3)) & 1 }); });
    if (!rest.length) return true;
    if (rest.length === 1) return rest[0].t === 'B' || rest[0].t === 'N';
    return rest.every(x => x.t === 'B') && rest.every(x => x.dark === rest[0].dark);
  }

  function outcome(n) {
    if (!allLegalMoves(n).length) {
      return inCheck(n) ? { winner: opp(n.turn), reason: 'checkmate' } : { winner: 'd', reason: 'stalemate' };
    }
    if (n.halfmove >= 100) return { winner: 'd', reason: 'fifty' };
    const key = n.positions[n.positions.length - 1];
    if (n.positions.filter(k => k === key).length >= 3) return { winner: 'd', reason: 'repetition' };
    if (insufficientMaterial(n.board)) return { winner: 'd', reason: 'material' };
    return null;
  }

  function toSAN(s, m, n) {
    const p = s.board[m.from], t = p[1];
    let san;
    if (m.castle) san = m.castle === 'K' ? 'O-O' : 'O-O-O';
    else {
      const capture = s.board[m.to] || m.ep;
      if (t === 'P') {
        san = (capture ? FILES[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo : '');
      } else {
        const others = [];
        for (let i = 0; i < 64; i++) {
          if (i !== m.from && s.board[i] === p && legalMoves(s, i).some(x => x.to === m.to)) others.push(i);
        }
        let dis = '';
        if (others.length) {
          const sameFile = others.some(i => (i & 7) === (m.from & 7));
          const sameRank = others.some(i => (i >> 3) === (m.from >> 3));
          dis = !sameFile ? FILES[m.from & 7] : !sameRank ? String((m.from >> 3) + 1) : sqName(m.from);
        }
        san = t + dis + (capture ? 'x' : '') + sqName(m.to);
      }
    }
    if (inCheck(n)) san += allLegalMoves(n).length ? '+' : '#';
    return san;
  }

  // The one entry point games use. m = { from, to, promo? }. Returns the new state, or null if illegal.
  function play(s, m) {
    if (s.result) return null;
    const legal = legalMoves(s, m.from).find(x => x.to === m.to && (x.promo || null) === (m.promo || null));
    if (!legal) return null;
    const n = applyMove(s, legal);
    n.moves = s.moves.concat(toSAN(s, legal, n));
    n.positions = s.positions.concat(posKey(n));
    n.result = outcome(n);
    return n;
  }

  // Pieces each side has lost, as a string of types (for the captured-pieces display), plus material balance.
  const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
  function material(b) {
    const start = { P: 8, N: 2, B: 2, R: 2, Q: 1 };
    const have = { w: { P: 0, N: 0, B: 0, R: 0, Q: 0 }, b: { P: 0, N: 0, B: 0, R: 0, Q: 0 } };
    let diff = 0;
    for (const p of b) if (p) { if (p[1] !== 'K') have[p[0]][p[1]]++; diff += (p[0] === 'w' ? 1 : -1) * VALUE[p[1]]; }
    const lost = { w: '', b: '' };
    for (const c of 'wb') for (const t of 'QRBNP') lost[c] += t.repeat(Math.max(0, start[t] - have[c][t]));
    return { lost, diff };   // diff > 0: white is ahead
  }

  const api = { newState, fromFEN, play, legalMoves, allLegalMoves, inCheck, kingSq, sqName, material, opp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChessRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
