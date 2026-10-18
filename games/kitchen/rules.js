// Kitchen Rush rules: pure game logic. No DOM, no networking.
// Loads in the browser as window.KR and in Node (module.exports) so the simulation can be tested headless.
(function (root) {
  'use strict';
  const T = 16, W = 13, H = 9;
  // C counter · V serving window · S stove+pan · P stove+pot · B cutting board · L plate stack · X trash
  // crates (left column): p potato, o onion, f tofu, r rice, n noodles, w nori, h herbs · '.' floor
  // D decor counter (solid, nothing to interact with)
  const MAP = [
    'DCVVCCSCPCCCD',
    'p...........B',
    'o...........B',
    'f...........C',
    'r...CCCCC...X',
    'n...........C',
    'w...........C',
    'h...........D',
    'DCCCLLCCCCCCD',
  ];
  const ROUND = 180, CHOP_TIME = 1.5, SPEED = 66, MAX_ORDERS = 4;
  const RAW = ['potato', 'onion', 'tofu', 'rice', 'noodles', 'nori', 'herbs'];
  const CRATE = { p: 'potato', o: 'onion', f: 'tofu', r: 'rice', n: 'noodles', w: 'nori', h: 'herbs' };
  const CHOP = ['potato', 'onion', 'tofu', 'herbs'];                       // board: raw -> raw+
  const FRY = { 'potato+': 'potato*', 'tofu+': 'tofu*' };                  // pan: chopped -> cooked
  const BOIL = { rice: 'rice*', noodles: 'noodles*' };                     // pot: raw -> cooked
  const COOK = { potato: 5, tofu: 4, rice: 6, noodles: 4 }, BURN = { potato: 7, tofu: 6, rice: 8, noodles: 6 };
  const DISHES = [
    { id: 'onigiri',   name: 'Onigiri',        cuisine: 'Japanese',   tokens: ['nori', 'rice*'],               base: 25, time: 60 },
    { id: 'tikki',     name: 'Aloo Tikki',     cuisine: 'Indian',     tokens: ['onion+', 'potato*'],           base: 30, time: 75 },
    { id: 'pho',       name: 'Veggie Pho',     cuisine: 'Vietnamese', tokens: ['herbs+', 'noodles*', 'onion+'], base: 40, time: 85, bowl: true },
    { id: 'friedrice', name: 'Fried Rice',     cuisine: 'Chinese',    tokens: ['onion+', 'rice*', 'tofu*'],    base: 40, time: 90 },
    { id: 'padthai',   name: 'Pad Thai',       cuisine: 'Thai',       tokens: ['herbs+', 'noodles*', 'tofu*'], base: 45, time: 95 },
  ];
  const NAMES = { potato: 'potato', onion: 'onion', tofu: 'tofu', rice: 'rice', noodles: 'noodles', nori: 'nori', herbs: 'herbs',
    'potato+': 'tikki (raw)', 'potato*': 'fried tikki', 'onion+': 'chopped onion', 'tofu+': 'tofu cubes', 'tofu*': 'fried tofu',
    'herbs+': 'chopped herbs', 'rice*': 'steamed rice', 'noodles*': 'noodles', burnt: 'burnt mess' };
  const base = it => String(it || '').replace(/[+*]$/, '');
  const SPAWN = [{ x: 2.5 * T, y: 2.5 * T, d: 3 }, { x: 10.5 * T, y: 6.5 * T, d: 2 }];
  const DV = [[0, 1], [0, -1], [-1, 0], [1, 0]];
  const HW = 5, HH = 4; // chef footprint half-size

  const tileAt = (c, r) => (r < 0 || r >= H || c < 0 || c >= W) ? 'C' : MAP[r][c];
  const idx = (c, r) => r * W + c;
  const isFloor = ch => ch === '.';

  // ---------- items are strings ----------
  // raw: 'tofu' · chopped: 'tofu+' · cooked: 'tofu*' / 'rice*' · 'burnt'
  // plate: 'plate' or 'plate:nori,rice*' (sorted tokens). Pan and pot slots hold a plain token.
  const isPlate = it => !!it && it.startsWith('plate');
  const tokens = it => (isPlate(it) ? it.slice(6) : '').split(',').filter(Boolean);
  const plate = toks => 'plate' + (toks.length ? ':' + toks.slice().sort().join(',') : '');
  const choppable = it => CHOP.includes(it);
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
      in: [{ x: 0, y: 0, c: 0, f: -1 }, { x: 0, y: 0, c: 0, f: -1 }],
      slots: {}, orders: [], nextId: 1, since: 99, ev: [], stats: DISHES.map(() => 0),
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
  function moveChef(ch, ix, iy, dt, others, face) {
    const mag = Math.hypot(ix, iy);
    if (mag < 0.15) { ch.mv = 0; if (face >= 0 && face <= 3) ch.d = face; return; } // standing still: may turn in place
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
    const counts = DISHES.map(() => 0); s.orders.forEach(o => counts[o.d]++);
    let pool;
    if (s.nextId <= 2) pool = [0, 1];                 // ease in: onigiri and tikki first
    else pool = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4];
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
      if (ty === 'S' || ty === 'P') {
        const sl = s.slots[tg.i]; if (!sl || !sl.it) return;
        if (BOIL[sl.it] || FRY[sl.it]) { hint(s, p, 'Still cooking'); return; }
        ch.it = sl.it; sl.it = null; sl.p = sl.b = 0; clean(s, tg.i); s.ev.push({ k: 'take', p }); return;
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
    const whyNot = (a, b) => a === 'burnt' || b === 'burnt' ? 'Bin that' : choppable(a) || choppable(b) ? 'Chop it first'
      : FRY[a] || FRY[b] ? 'Fry it first' : BOIL[a] || BOIL[b] ? 'Boil it first' : 'That doesn\'t go together';
    if (ty === 'C' || ty === 'B') {
      const sl = slotOf(s, tg.i);
      if (!sl.it) {
        if (ty === 'B' && (h === 'nori' || BOIL[h])) { hint(s, p, h === 'nori' ? 'Nori is ready as it is' : 'Boil it in the pot'); clean(s, tg.i); return; }
        sl.it = h; sl.p = 0; ch.it = null; s.ev.push({ k: 'put', p, i: tg.i }); return;
      }
      if (isPlate(sl.it) && !isPlate(h) && canAdd(tokens(sl.it), h)) { sl.it = plate(tokens(sl.it).concat(h)); ch.it = null; s.ev.push({ k: 'put', p, i: tg.i }); return; }
      if (isPlate(h) && !isPlate(sl.it) && canAdd(tokens(h), sl.it)) { ch.it = plate(tokens(h).concat(sl.it)); sl.it = null; sl.p = 0; clean(s, tg.i); s.ev.push({ k: 'take', p }); return; }
      hint(s, p, isPlate(h) || isPlate(sl.it) ? whyNot(h, sl.it) : 'No room');
      return;
    }
    if (ty === 'S' || ty === 'P') {
      const sl = slotOf(s, tg.i), accepts = ty === 'S' ? FRY : BOIL;
      if (!sl.it) {
        if (accepts[h]) { sl.it = h; sl.p = 0; sl.b = 0; ch.it = null; s.ev.push({ k: 'put', p, i: tg.i }); }
        else {
          hint(s, p, ty === 'S' ? (choppable(h) ? 'Chop it first' : BOIL[h] ? 'That goes in the pot' : 'Only tikkis and tofu go in the pan')
                               : (FRY[h] ? 'That goes in the pan' : 'Only rice or noodles go in the pot'));
          clean(s, tg.i);
        }
        return;
      }
      if (isPlate(h) && canAdd(tokens(h), sl.it)) { ch.it = plate(tokens(h).concat(sl.it)); sl.it = null; sl.p = sl.b = 0; clean(s, tg.i); s.ev.push({ k: 'take', p }); return; }
      hint(s, p, sl.it === 'burnt' ? 'Burnt! Bin it' : accepts[sl.it] ? (ty === 'S' ? 'Pan is busy' : 'Pot is busy') : 'Grab it or use a plate');
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
    if (s.ph !== 'over') for (let p = 0; p < 2; p++) moveChef(s.ch[p], s.in[p].x, s.in[p].y, dt, [s.ch[1 - p]], s.in[p].f);
    if (s.ph !== 'play') return;
    s.tm -= dt;
    for (let p = 0; p < 2; p++) { const ch = s.ch[p]; ch.ca = Math.max(0, ch.ca - dt); if (s.in[p].c && !ch.mv) chopAt(s, p, dt / CHOP_TIME); }
    for (const i in s.slots) {
      const sl = s.slots[i], ty = MAP[Math.floor(i / W)][i % W];
      if (ty !== 'S' && ty !== 'P') continue;
      const table = ty === 'S' ? FRY : BOIL, k = base(sl.it);
      if (table[sl.it]) { sl.p += dt / COOK[k]; if (sl.p >= 1) { sl.it = table[sl.it]; sl.p = 1; sl.b = 0; s.ev.push({ k: 'cooked', i: +i }); } }
      else if (sl.it && sl.it !== 'burnt' && sl.it.endsWith('*')) { sl.b += dt / BURN[k]; if (sl.b >= 1) { sl.it = 'burnt'; sl.b = 1; s.ev.push({ k: 'burnt', i: +i }); } }
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

  const api = { T, W, H, MAP, ROUND, SPEED, RAW, CRATE, CHOP, FRY, BOIL, DISHES, NAMES, SPAWN, DV, HW, HH, CHOP_TIME, COOK, BURN,
    tileAt, idx, isFloor, isPlate, tokens, plate, choppable, base, dishOf, canAdd, newState, start, setPlayer, cleanName, LOOKS, moveChef, targetOf, action, step, stars, free };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KR = api;
})(typeof window !== 'undefined' ? window : globalThis);
