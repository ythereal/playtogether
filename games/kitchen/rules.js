// Kitchen Rush rules: pure game logic. No DOM, no networking.
// Loads in the browser as window.KR and in Node (module.exports) so the simulation can be tested headless.
(function (root) {
  'use strict';
  const T = 16, W = 13, H = 9;
  // C counter · V serving window · S stove+pan · P stove+pot · B cutting board · L plate stack · X trash
  // t/l/o/p/b crates: tomato, lettuce, onion, potato, bun · '.' floor
  // D decor counter (solid, nothing to interact with)
  const MAP = [
    'DCVVCCSCPCCCD',
    't...........B',
    'l...........B',
    'o...........C',
    'D...CCCCC...X',
    'p...........C',
    'b...........C',
    'D...........D',
    'DCCCLLCCCCCCD',
  ];
  const ROUND = 180, CHOP_TIME = 1.5, COOK = { tikki: 5, soup: 7 }, BURN = { tikki: 7, soup: 8 };
  const SPEED = 66, MAX_ORDERS = 4;
  const RAW = ['tomato', 'lettuce', 'onion', 'potato', 'bun'];
  const CRATE = { t: 'tomato', l: 'lettuce', o: 'onion', p: 'potato', b: 'bun' };
  const SOUP = ['onion+', 'tomato+'];
  const DISHES = [
    { id: 'salad',  name: 'Garden Salad',   tokens: ['lettuce+', 'tomato+'],       base: 20, time: 60 },
    { id: 'tikki',  name: 'Aloo Tikki',     tokens: ['potato*', 'onion+'],         base: 30, time: 75 },
    { id: 'soup',   name: 'Tomato Soup',    tokens: ['soup'],                      base: 35, time: 85 },
    { id: 'burger', name: 'Tikki Burger',   tokens: ['bun', 'lettuce+', 'potato*'], base: 40, time: 95 },
  ];
  const NAMES = { tomato: 'tomato', lettuce: 'lettuce', onion: 'onion', potato: 'potato', bun: 'bun', 'tomato+': 'chopped tomato',
    'lettuce+': 'chopped lettuce', 'onion+': 'chopped onion', 'potato+': 'tikki (raw)', 'potato*': 'fried tikki', burnt: 'burnt mess', soup: 'soup' };
  const SPAWN = [{ x: 2.5 * T, y: 2.5 * T, d: 3 }, { x: 10.5 * T, y: 6.5 * T, d: 2 }];
  const DV = [[0, 1], [0, -1], [-1, 0], [1, 0]];
  const HW = 5, HH = 4; // chef footprint half-size

  const tileAt = (c, r) => (r < 0 || r >= H || c < 0 || c >= W) ? 'C' : MAP[r][c];
  const idx = (c, r) => r * W + c;
  const isFloor = ch => ch === '.';

  // ---------- items are strings ----------
  // raw: 'tomato' · chopped: 'tomato+' · cooked: 'potato*' · 'burnt' · 'soup' (only on plates/in pot)
  // plate: 'plate' or 'plate:bun,lettuce+,potato*' (sorted tokens) · pot: 'pot' or 'pot:onion+,tomato+'
  const isPlate = it => !!it && it.startsWith('plate');
  const isPot = it => !!it && it.startsWith('pot');
  const tokens = it => (isPlate(it) ? it.slice(6) : isPot(it) ? it.slice(4) : '').split(',').filter(Boolean);
  const plate = toks => 'plate' + (toks.length ? ':' + toks.slice().sort().join(',') : '');
  const pot = toks => 'pot' + (toks.length ? ':' + toks.slice().sort().join(',') : '');
  const choppable = it => RAW.includes(it) && it !== 'bun';
  const same = (a, b) => a.length === b.length && a.slice().sort().join(',') === b.slice().sort().join(',');
  function dishOf(it) { const t = tokens(it); return isPlate(it) ? DISHES.findIndex(d => same(d.tokens, t)) : -1; }
  function canAdd(toks, tok) {
    if (!tok || tok === 'burnt' || toks.includes(tok)) return false;
    const all = toks.concat(tok);
    return DISHES.some(d => all.every(x => d.tokens.includes(x)));
  }

  // ---------- state ----------
  function newState(prev) {
    return {
      ph: 'ready', tm: ROUND, cd: 0, sc: 0, cb: 0, best: 0, served: 0, lost: 0, tips: 0, round: prev ? prev.round + 1 : 1,
      ch: SPAWN.map(s => ({ x: s.x, y: s.y, d: s.d, it: null, mv: 0, ca: 0 })),
      in: [{ x: 0, y: 0, c: 0 }, { x: 0, y: 0, c: 0 }],
      slots: {}, orders: [], nextId: 1, since: 99, ev: [], stats: [0, 0, 0, 0],
      pl: [{ n: '', l: '' }, { n: '', l: '' }],   // player name + character, kept across rounds
    };
  }
  function start(s) {
    if (s.ph !== 'ready' && s.ph !== 'over') return;
    const r = s.ph === 'over' ? s.round + 1 : s.round;
    Object.assign(s, newState(), { round: r, pl: s.pl }); s.ph = 'countdown'; s.cd = 3.2;
  }
  const LOOKS = ['max', 'mia'];
  function cleanName(n) { return String(n || '').replace(/[^\p{L}\p{N} .'\-]/gu, '').trim().slice(0, 12); }
  function setPlayer(s, p, n, l) { if (!s.pl) s.pl = [{ n: '', l: '' }, { n: '', l: '' }]; s.pl[p] = { n: cleanName(n), l: LOOKS.includes(l) ? l : '' }; }

  // ---------- movement ----------
  function free(x, y) {
    const c0 = Math.floor((x - HW) / T), c1 = Math.floor((x + HW - 0.01) / T), r0 = Math.floor((y - HH) / T), r1 = Math.floor((y + HH - 0.01) / T);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (!isFloor(tileAt(c, r))) return false;
    return true;
  }
  function tryMove(ch, dx, dy, others) {
    if (!dx && !dy) return;
    let nx = ch.x + dx, ny = ch.y + dy;
    if (!free(nx, ny)) {
      const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2);
      nx = ch.x; ny = ch.y;
      for (let i = 0; i < steps; i++) { const tx = nx + dx / steps, ty = ny + dy / steps; if (!free(tx, ty)) break; nx = tx; ny = ty; }
    }
    for (const o of others || []) {
      const dn = Math.hypot(nx - o.x, ny - o.y), dc = Math.hypot(ch.x - o.x, ch.y - o.y);
      if (dn < 11 && dn < dc) return; // don't walk into your partner
    }
    ch.x = nx; ch.y = ny;
  }
  function moveChef(ch, ix, iy, dt, others) {
    const mag = Math.hypot(ix, iy);
    if (mag < 0.15) { ch.mv = 0; return; }
    const k = Math.min(1, mag) / mag;
    ch.d = Math.abs(ix) > Math.abs(iy) * 1.2 ? (ix < 0 ? 2 : 3) : (Math.abs(iy) > Math.abs(ix) * 1.2 ? (iy < 0 ? 1 : 0) : ch.d);
    ch.mv = 1;
    tryMove(ch, ix * k * SPEED * dt, 0, others);
    tryMove(ch, 0, iy * k * SPEED * dt, others);
  }
  function targetOf(ch) {
    const v = DV[ch.d], px = ch.x + v[0] * 12, py = ch.y + v[1] * 12;
    const c = Math.floor(px / T), r = Math.floor(py / T), ty = tileAt(c, r);
    if (isFloor(ty) || c < 0 || c >= W || r < 0 || r >= H) return null;
    return { c, r, i: idx(c, r), ty };
  }
  const slotOf = (s, i) => s.slots[i] || (s.slots[i] = { it: null, p: 0, b: 0 });
  function clean(s, i) { const sl = s.slots[i]; if (sl && !sl.it) delete s.slots[i]; }

  // ---------- orders ----------
  function spawnOrder(s) {
    const counts = [0, 0, 0, 0]; s.orders.forEach(o => counts[o.d]++);
    let pool;
    if (s.nextId <= 2) pool = [0, 1];                 // ease in: salad and tikki first
    else pool = [0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 3];
    pool = pool.filter(d => counts[d] < 2);
    const d = pool[Math.floor(Math.random() * pool.length)];
    s.orders.push({ id: s.nextId++, d, t: DISHES[d].time, lim: DISHES[d].time });
    s.since = 0;
    s.ev.push({ k: 'order', d });
  }

  // ---------- actions ----------
  function hint(s, p, m) { s.ev.push({ k: 'hint', p, m }); }
  function chopAt(s, p, amt, tg) {
    const ch = s.ch[p]; tg = tg || targetOf(ch);
    if (!tg || tg.ty !== 'B') return false;
    const sl = s.slots[tg.i];
    if (!sl || !choppable(sl.it)) return false;
    sl.p = Math.min(1, sl.p + amt); ch.ca = Math.max(ch.ca, 0.2);
    if (sl.p >= 1) { sl.it += '+'; sl.p = 0; s.ev.push({ k: 'chopped', i: tg.i }); }
    return true;
  }
  function deliver(s, p, it) {
    const d = dishOf(it);
    const o = d >= 0 ? s.orders.filter(o => o.d === d).sort((a, b) => a.t - b.t)[0] : null;
    if (!o) { s.cb = 0; s.ev.push({ k: 'wrong', p }); hint(s, p, d >= 0 ? 'Nobody ordered that!' : 'That\'s not a dish'); return; }
    s.orders.splice(s.orders.indexOf(o), 1);
    s.cb++; s.best = Math.max(s.best, s.cb);
    const base = DISHES[d].base, mult = Math.min(s.cb, 4);
    const tip = Math.round(base * 0.5 * (o.t / o.lim)) * mult;
    s.sc += base + tip; s.tips += tip; s.served++; s.stats[d]++;
    s.ev.push({ k: 'served', p, d, id: o.id, pts: base + tip, tip, cb: s.cb });
  }
  function grab(s, p, tg) {
    const ch = s.ch[p], h = ch.it, ty = tg.ty;
    if (h === null) {
      if (CRATE[ty]) { ch.it = CRATE[ty]; s.ev.push({ k: 'take', p }); return; }
      if (ty === 'L') { ch.it = 'plate'; s.ev.push({ k: 'take', p }); return; }
      if (ty === 'C' || ty === 'B') { const sl = s.slots[tg.i]; if (sl && sl.it) { ch.it = sl.it; sl.it = null; sl.p = 0; clean(s, tg.i); s.ev.push({ k: 'take', p }); } return; }
      if (ty === 'S') { const sl = s.slots[tg.i]; if (sl && sl.it) { ch.it = sl.it; sl.it = null; sl.p = sl.b = 0; clean(s, tg.i); s.ev.push({ k: 'take', p }); } return; }
      if (ty === 'P') {
        const sl = s.slots[tg.i]; if (!sl || !sl.it) return;
        const tk = tokens(sl.it);
        if (tk[0] === 'burnt') { ch.it = 'burnt'; sl.it = null; sl.p = sl.b = 0; clean(s, tg.i); s.ev.push({ k: 'take', p }); }
        else if (tk[0] === 'soup') hint(s, p, 'Needs a plate');
        else hint(s, p, 'It\'s in the pot now');
        return;
      }
      return;
    }
    // holding something
    if (ty === 'X') { ch.it = isPlate(h) ? 'plate' : null; s.ev.push({ k: 'trash', p }); return; }
    if (CRATE[ty]) { if (h === CRATE[ty]) { ch.it = null; } else hint(s, p, 'Wrong crate'); return; }
    if (ty === 'L') { if (h === 'plate') ch.it = null; else hint(s, p, 'Only clean plates here'); return; }
    if (ty === 'V') {
      if (isPlate(h) && tokens(h).length) { deliver(s, p, h); ch.it = null; }
      else hint(s, p, isPlate(h) ? 'Empty plate' : 'Put it on a plate first');
      return;
    }
    if (ty === 'C' || ty === 'B') {
      const sl = slotOf(s, tg.i);
      if (!sl.it) {
        if (ty === 'B' && h === 'bun') { hint(s, p, 'Buns don\'t need chopping'); clean(s, tg.i); return; }
        sl.it = h; sl.p = 0; ch.it = null; s.ev.push({ k: 'put', p, i: tg.i }); return;
      }
      if (isPlate(sl.it) && !isPlate(h) && canAdd(tokens(sl.it), h)) { sl.it = plate(tokens(sl.it).concat(h)); ch.it = null; s.ev.push({ k: 'put', p, i: tg.i }); return; }
      if (isPlate(h) && !isPlate(sl.it) && canAdd(tokens(h), sl.it)) { ch.it = plate(tokens(h).concat(sl.it)); sl.it = null; sl.p = 0; clean(s, tg.i); s.ev.push({ k: 'take', p }); return; }
      if (isPlate(h) || isPlate(sl.it)) hint(s, p, h === 'burnt' || sl.it === 'burnt' ? 'Bin that' : choppable(h) || choppable(sl.it) ? 'Chop it first' : h === 'potato+' || sl.it === 'potato+' ? 'Fry it first' : 'That doesn\'t go together');
      else hint(s, p, 'No room');
      return;
    }
    if (ty === 'S') {
      const sl = slotOf(s, tg.i);
      if (!sl.it) {
        if (h === 'potato+') { sl.it = h; sl.p = 0; sl.b = 0; ch.it = null; s.ev.push({ k: 'put', p, i: tg.i }); }
        else { hint(s, p, h === 'potato' ? 'Shape the tikki on a board first' : 'Only tikkis go in the pan'); clean(s, tg.i); }
        return;
      }
      if (isPlate(h) && canAdd(tokens(h), sl.it)) { ch.it = plate(tokens(h).concat(sl.it)); sl.it = null; sl.p = sl.b = 0; clean(s, tg.i); s.ev.push({ k: 'take', p }); return; }
      hint(s, p, sl.it === 'burnt' ? 'Burnt! Bin it' : sl.it === 'potato*' ? 'Grab it or use a plate' : 'Pan is busy');
      return;
    }
    if (ty === 'P') {
      const sl = slotOf(s, tg.i), tk = tokens(sl.it || 'pot');
      if (tk[0] === 'soup') {
        if (isPlate(h) && canAdd(tokens(h), 'soup')) { ch.it = plate(tokens(h).concat('soup')); sl.it = null; sl.p = sl.b = 0; clean(s, tg.i); s.ev.push({ k: 'take', p }); }
        else hint(s, p, 'Soup needs a clean plate');
        return;
      }
      if (tk[0] === 'burnt') { hint(s, p, 'Burnt! Empty the pot'); return; }
      if (SOUP.includes(h) && !tk.includes(h)) { sl.it = pot(tk.concat(h)); sl.p = 0; ch.it = null; s.ev.push({ k: 'put', p, i: tg.i }); return; }
      hint(s, p, tk.includes(h) ? 'Already in the pot' : h === 'tomato' || h === 'onion' ? 'Chop it first' : 'Soup: tomato + onion, chopped');
      if (!sl.it) clean(s, tg.i);
      return;
    }
  }
  function action(s, p, kind, at) {
    if (s.ph !== 'play') return;
    const ch = s.ch[p];
    const probe = at && Number.isFinite(at.x) && Math.hypot(at.x - ch.x, at.y - ch.y) < 24 ? { x: at.x, y: at.y, d: at.d } : ch;
    const tg = targetOf(probe);
    if (!tg) return;
    if (kind === 'chop') { if (chopAt(s, p, 0.12, tg)) ch.ca = 0.25; return; }
    if (kind === 'grab') grab(s, p, tg);
  }

  // ---------- simulation step ----------
  function step(s, dt) {
    if (s.ph === 'countdown') { s.cd -= dt; if (s.cd <= 0) { s.ph = 'play'; s.cd = 0; s.ev.push({ k: 'go' }); } }
    if (s.ph !== 'over') for (let p = 0; p < 2; p++) moveChef(s.ch[p], s.in[p].x, s.in[p].y, dt, [s.ch[1 - p]]);
    if (s.ph !== 'play') return;
    s.tm -= dt;
    for (let p = 0; p < 2; p++) { const ch = s.ch[p]; ch.ca = Math.max(0, ch.ca - dt); if (s.in[p].c && !ch.mv) chopAt(s, p, dt / CHOP_TIME); }
    for (const i in s.slots) {
      const sl = s.slots[i], ty = MAP[Math.floor(i / W)][i % W];
      if (ty === 'S') {
        if (sl.it === 'potato+') { sl.p += dt / COOK.tikki; if (sl.p >= 1) { sl.it = 'potato*'; sl.p = 1; sl.b = 0; s.ev.push({ k: 'cooked', i: +i }); } }
        else if (sl.it === 'potato*') { sl.b += dt / BURN.tikki; if (sl.b >= 1) { sl.it = 'burnt'; sl.b = 1; s.ev.push({ k: 'burnt', i: +i }); } }
      } else if (ty === 'P' && sl.it) {
        const tk = tokens(sl.it);
        if (same(tk, SOUP)) { sl.p += dt / COOK.soup; if (sl.p >= 1) { sl.it = 'pot:soup'; sl.p = 1; sl.b = 0; s.ev.push({ k: 'cooked', i: +i }); } }
        else if (tk[0] === 'soup') { sl.b += dt / BURN.soup; if (sl.b >= 1) { sl.it = 'pot:burnt'; sl.b = 1; s.ev.push({ k: 'burnt', i: +i }); } }
      }
    }
    for (let k = s.orders.length - 1; k >= 0; k--) {
      const o = s.orders[k]; o.t -= dt;
      if (o.t <= 0) { s.orders.splice(k, 1); s.lost++; s.cb = 0; s.ev.push({ k: 'lost', d: o.d, id: o.id }); }
    }
    s.since += dt;
    const gap = s.orders.length === 0 ? 0 : s.orders.length === 1 ? 8 : 15;
    if (s.orders.length < MAX_ORDERS && s.since >= gap && s.tm > 20) spawnOrder(s);
    if (s.tm <= 0) { s.tm = 0; s.ph = 'over'; s.ev.push({ k: 'over' }); }
  }
  const stars = sc => (sc >= 450 ? 3 : sc >= 300 ? 2 : sc >= 150 ? 1 : 0);

  const api = { T, W, H, MAP, ROUND, SPEED, RAW, CRATE, DISHES, NAMES, SOUP, SPAWN, DV, HW, HH, CHOP_TIME, COOK, BURN,
    tileAt, idx, isFloor, isPlate, isPot, tokens, plate, choppable, dishOf, canAdd, newState, start, setPlayer, cleanName, LOOKS, moveChef, targetOf, action, step, stars, free };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KR = api;
})(typeof window !== 'undefined' ? window : globalThis);
