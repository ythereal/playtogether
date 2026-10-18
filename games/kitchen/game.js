// Kitchen Rush: networking, prediction, rendering, input and UI.
// The host runs the simulation (rules.js) at a fixed tick and broadcasts 20 Hz snapshots.
// The guest sends its input state, predicts its own chef locally and interpolates everything else.
(async () => {
  'use strict';
  const KR = window.KR, KA = window.KA;
  const { T, W, H, MAP, OY } = Object.assign({}, KR, { OY: KA.OY });
  const DIRS = ['down', 'up', 'left', 'right'];
  const TICK = 1 / 60, SNAP_HZ = 20, INTERP_MS = 100;
  const $ = id => document.getElementById(id);

  const room = await PT.room({ game: 'kitchen', title: 'Kitchen Rush' });
  const host = room.role === 'host';
  const ME = host ? 0 : 1, FRIEND = 1 - ME;

  // ============================ state ============================
  let state = null;          // host only: the authoritative state
  let view = null;           // what we render from (host: state; guest: latest snapshot)
  const snaps = [];          // guest: [recvTime, snapshot]
  const me = { x: KR.SPAWN[ME].x, y: KR.SPAWN[ME].y, d: KR.SPAWN[ME].d, mv: 0, anim: 0 };      // my chef (guest: predicted)
  const friend = { x: KR.SPAWN[FRIEND].x, y: KR.SPAWN[FRIEND].y, d: KR.SPAWN[FRIEND].d, mv: 0, anim: 0 };
  let lastPhase = null, roundStartedAt = 0;

  if (host) {
    state = room.saved || KR.newState();
    state.in = [{ x: 0, y: 0, c: 0 }, { x: 0, y: 0, c: 0 }]; state.ev = [];
    view = state;
  }

  // ============================ input ============================
  const inp = { x: 0, y: 0, c: 0 };
  const keys = new Set();
  const joy = { x: 0, y: 0 };
  let touchChop = 0;
  const panelOpen = () => !$('legend').hidden || !$('over').hidden;
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' && e.key === ' ') return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (k === 'escape') { $('legend').hidden = true; setStatus(); return; }
    if (k === 'h' || k === '?') { if (!e.repeat) toggleLegend(); return; }
    if (panelOpen()) return;
    if (k === ' ' || k === 'enter') { if (!e.repeat) doAction('grab'); return; }
    if (k === 'e' || k === 'shift' || k === 'f') { if (!e.repeat) doAction('chop'); keys.add('chop'); return; }
    keys.add(k);
  });
  addEventListener('keyup', e => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'e' || k === 'shift' || k === 'f') keys.delete('chop'); });
  addEventListener('blur', () => { keys.clear(); touchChop = 0; });

  // touch joystick (left) + two buttons (right)
  const joyEl = $('joy'), knob = $('knob');
  let joyId = null, joyC = null;
  joyEl.addEventListener('pointerdown', e => { joyId = e.pointerId; try { joyEl.setPointerCapture(e.pointerId); } catch (err) {} const r = joyEl.getBoundingClientRect(); joyC = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; joyMove(e); });
  joyEl.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
  const joyEnd = e => { if (e.pointerId === joyId) { joyId = null; joy.x = joy.y = 0; knob.style.transform = ''; } };
  joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);
  function joyMove(e) {
    let dx = e.clientX - joyC.x, dy = e.clientY - joyC.y; const d = Math.hypot(dx, dy), m = joyC.r * 0.75;
    if (d > m) { dx = dx / d * m; dy = dy / d * m; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    joy.x = Math.abs(dx) > 5 ? dx / m : 0; joy.y = Math.abs(dy) > 5 ? dy / m : 0;
  }
  const press = (el, down, up) => {
    el.addEventListener('pointerdown', e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (err) {} el.classList.add('down'); down(); });
    const end = () => { el.classList.remove('down'); if (up) up(); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  };
  press($('btnGrab'), () => doAction('grab'));
  press($('btnChop'), () => { doAction('chop'); touchChop = 1; }, () => { touchChop = 0; });

  function readInput() {
    let x = 0, y = 0;
    if (!panelOpen()) {
      if (keys.has('arrowleft') || keys.has('a')) x -= 1;
      if (keys.has('arrowright') || keys.has('d')) x += 1;
      if (keys.has('arrowup') || keys.has('w')) y -= 1;
      if (keys.has('arrowdown') || keys.has('s')) y += 1;
      x += joy.x; y += joy.y;
    }
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, c: !panelOpen() && (keys.has('chop') || touchChop) ? 1 : 0 };
  }
  let lastSentInput = '', lastInputAt = 0;
  function pushInput(now) {
    const n = readInput();
    inp.x = n.x; inp.y = n.y; inp.c = n.c;
    if (host) { state.in[0] = { x: n.x, y: n.y, c: n.c }; return; }
    const key = n.x + ',' + n.y + ',' + n.c;
    if (room.connected && (key !== lastSentInput && now - lastInputAt > 33 || now - lastInputAt > 1000)) {
      lastSentInput = key; lastInputAt = now; room.send({ t: 'i', x: n.x, y: n.y, c: n.c });
    }
  }
  function doAction(kind) {
    if (!view || view.ph !== 'play') return;
    if (host) { KR.action(state, 0, kind); drainEvents(); }
    else if (room.connected) room.send({ t: 'a', k: kind, x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, d: me.d });
    bump = 0.12;
  }
  let bump = 0;

  // ============================ networking ============================
  function snapshot() {
    const s = state, r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
    const sl = {}; for (const i in s.slots) { const x = s.slots[i]; if (x.it) sl[i] = [x.it, r2(x.p), r2(x.b)]; }
    return { t: 's', ph: s.ph, tm: r1(s.tm), cd: r1(s.cd), sc: s.sc, cb: s.cb, rd: s.round,
      ch: s.ch.map(c => [r1(c.x), r1(c.y), c.d, c.mv, c.it, c.ca > 0 ? 1 : 0]), sl,
      or: s.orders.map(o => [o.id, o.d, r1(o.t), o.lim]), st: [s.served, s.lost, s.tips, s.best].concat(s.stats), ev: pendingEv.splice(0) };
  }
  let pendingEv = [];
  function drainEvents() {
    if (!state.ev.length) return;
    const evs = state.ev.splice(0);
    for (const e of evs) onEvent(e);
    pendingEv.push(...evs);
    if (evs.some(e => ['served', 'lost', 'over', 'go'].includes(e.k))) room.save(state);
  }
  room.on('connected', () => {
    if (host) { pendingEv = []; room.send(snapshot()); }
    setStatus();
  });
  room.on('disconnected', () => { if (host) state.in[1] = { x: 0, y: 0, c: 0 }; snaps.length = 0; setStatus(); });
  room.on('message', m => {
    if (host) {
      if (m.t === 'i') state.in[1] = { x: clamp(+m.x || 0, -1, 1), y: clamp(+m.y || 0, -1, 1), c: m.c ? 1 : 0 };
      else if (m.t === 'a') { KR.action(state, 1, m.k === 'chop' ? 'chop' : 'grab', { x: +m.x, y: +m.y, d: [0, 1, 2, 3].includes(m.d) ? m.d : state.ch[1].d }); drainEvents(); }
      else if (m.t === 'start') hostStart();
    } else if (m.t === 's') {
      snaps.push([performance.now(), m]); while (snaps.length > 40) snaps.shift();
      applySnap(m);
    }
  });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function hostStart() { if (!room.connected) return; KR.start(state); drainEvents(); onPhase(); room.save(state); }
  function requestStart() { if (host) hostStart(); else if (room.connected) room.send({ t: 'start' }); }

  function applySnap(m) {
    const prev = view;
    const slots = {}; for (const i in m.sl) slots[i] = { it: m.sl[i][0], p: m.sl[i][1], b: m.sl[i][2] };
    view = { ph: m.ph, tm: m.tm, cd: m.cd, sc: m.sc, cb: m.cb, round: m.rd, slots, at: performance.now(),
      orders: m.or.map(o => ({ id: o[0], d: o[1], t: o[2], lim: o[3] })),
      served: m.st[0], lost: m.st[1], tips: m.st[2], best: m.st[3], stats: m.st.slice(4),
      ch: m.ch.map(c => ({ x: c[0], y: c[1], d: c[2], mv: c[3], it: c[4], ca: c[5] })) };
    const mine = view.ch[ME];
    // reconcile my predicted chef with the host: only snap on big divergence (teleport at round start, blocked moves)
    if (!prev || prev.ph !== view.ph || Math.hypot(mine.x - me.x, mine.y - me.y) > 20) { me.x = mine.x; me.y = mine.y; me.d = mine.d; }
    for (const e of m.ev || []) onEvent(e);
    onPhase();
  }

  // ============================ host loop ============================
  let acc = 0, lastTick = performance.now(), lastSnap = 0, lastSave = 0;
  setInterval(() => {
    const now = performance.now();
    let dt = Math.min((now - lastTick) / 1000, 0.1); lastTick = now;
    pushInput(now);
    if (!host) return;
    const paused = !room.connected && state.ph !== 'over';
    if (!paused) {
      acc += dt;
      while (acc >= TICK) { KR.step(state, TICK); acc -= TICK; }
      drainEvents(); onPhase();
    } else acc = 0;
    if (room.connected && now - lastSnap >= 1000 / SNAP_HZ) { lastSnap = now; room.send(snapshot()); }
    if (now - lastSave > 1000) { lastSave = now; room.save(state); }
  }, 1000 / 120);

  // ============================ events, HUD, panels ============================
  const floaters = [], parts = [], hints = [{}, {}];
  const toastsEl = $('toasts');
  function toast(text, cls) {
    const t = document.createElement('div'); t.className = 'toast ' + (cls || ''); t.textContent = text;
    toastsEl.appendChild(t); setTimeout(() => t.classList.add('out'), 2200); setTimeout(() => t.remove(), 2800);
    while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
  }
  const slotPos = i => ({ x: (i % W) * T + 8, y: Math.floor(i / W) * T + 4 });
  const SERVE = { x: 3 * T, y: 0 };
  function onEvent(e) {
    const D = KR.DISHES[e.d];
    switch (e.k) {
      case 'served': {
        floaters.push({ x: SERVE.x, y: SERVE.y + 4, txt: '+' + e.pts, col: '#ffe36b', life: 1.6, big: true });
        if (e.tip) floaters.push({ x: SERVE.x, y: SERVE.y + 16, txt: 'tip +' + e.tip + (e.cb > 1 ? ' ×' + Math.min(e.cb, 4) : ''), col: '#9fe6a0', life: 1.6, delay: 0.25 });
        toast('✓ ' + D.name + '  +' + e.pts, 'good'); bell = 0.6;
        parts.push({ kind: 'deliver', x: SERVE.x - 6, y: SERVE.y - 2, spr: KA.item('plate:' + D.tokens.join(',')), life: 0.7 });
        for (let i = 0; i < 10; i++) parts.push({ kind: 'spark', x: SERVE.x + (Math.random() - .5) * 20, y: SERVE.y + Math.random() * 10, vx: (Math.random() - .5) * 30, vy: -20 - Math.random() * 30, life: 0.6 + Math.random() * .4, col: '#ffe36b' });
        markOrder(e.id, 'done'); break;
      }
      case 'lost': toast('✗ Order lost: ' + D.name, 'bad'); markOrder(e.id, 'lost'); break;
      case 'wrong': flash = 0.4; break;
      case 'hint': hints[e.p] = { m: e.m, t: 1.6 }; break;
      case 'cooked': { const p = slotPos(e.i); for (let i = 0; i < 6; i++) parts.push({ kind: 'spark', x: p.x + (Math.random() - .5) * 10, y: p.y, vx: (Math.random() - .5) * 20, vy: -15 - Math.random() * 20, life: 0.5, col: '#fff5c0' }); floaters.push({ x: p.x, y: p.y - 8, txt: 'Ding!', col: '#fff5c0', life: 1 }); break; }
      case 'burnt': { const p = slotPos(e.i); toast('🔥 Burnt! Bin it', 'bad'); for (let i = 0; i < 8; i++) parts.push({ kind: 'smoke', x: p.x + (Math.random() - .5) * 8, y: p.y, vx: (Math.random() - .5) * 8, vy: -12 - Math.random() * 10, life: 1 + Math.random(), col: '#3a3a40' }); break; }
      case 'chopped': { const p = slotPos(e.i); for (let i = 0; i < 4; i++) parts.push({ kind: 'spark', x: p.x + (Math.random() - .5) * 8, y: p.y, vx: (Math.random() - .5) * 24, vy: -10 - Math.random() * 20, life: 0.4, col: '#ffffff' }); break; }
      case 'go': floaters.push({ x: W * T / 2, y: H * T / 2 - 10, txt: 'GO!', col: '#ffe36b', life: 1, big: true }); break;
      case 'order': break;
      case 'over': setTimeout(showOver, 900); break;
    }
  }
  let bell = 0, flash = 0;

  // orders strip
  const ordersEl = $('orders'), cards = new Map();
  function iconCanvas(tok, px) { const c = document.createElement('canvas'); c.width = c.height = px; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(KA.item(tok), 0, 0, px, px); return c; }
  function markOrder(id, cls) { const c = cards.get(id); if (c) { c.el.classList.add(cls); c.leaving = true; setTimeout(() => { c.el.remove(); cards.delete(id); }, 450); } }
  function renderOrders() {
    if (!view) return;
    const seen = new Set();
    for (const o of view.orders) {
      seen.add(o.id);
      let c = cards.get(o.id);
      if (!c) {
        const el = document.createElement('div'); el.className = 'order';
        el.append(iconCanvas('plate:' + KR.DISHES[o.d].tokens.join(','), 36));
        const body = document.createElement('div'); body.className = 'ob';
        const name = document.createElement('b'); name.textContent = KR.DISHES[o.d].name;
        const bar = document.createElement('div'); bar.className = 'bar'; const fill = document.createElement('i'); bar.append(fill);
        body.append(name, bar); el.append(body); ordersEl.append(el);
        c = { el, fill }; cards.set(o.id, c);
      }
      if (c.leaving) continue;
      const k = Math.max(0, o.t / o.lim);
      c.fill.style.width = (k * 100).toFixed(1) + '%';
      c.el.classList.toggle('urgent', k < 0.3);
    }
    for (const [id, c] of cards) if (!seen.has(id) && !c.leaving) { c.leaving = true; c.el.classList.add('lost'); setTimeout(() => { c.el.remove(); cards.delete(id); }, 450); }
  }
  let hudCache = '';
  function renderHud() {
    if (!view) return;
    const tm = Math.max(0, Math.ceil(view.tm)), key = [view.ph, tm, view.sc, view.cb, view.round].join('|');
    if (key === hudCache) return; hudCache = key;
    $('hudTimer').textContent = Math.floor(tm / 60) + ':' + String(tm % 60).padStart(2, '0');
    $('hudTimer').classList.toggle('low', view.ph === 'play' && tm <= 20);
    $('hudScore').textContent = view.sc;
    $('hudCombo').textContent = view.cb > 1 ? '×' + Math.min(view.cb, 4) + ' combo' : '';
    $('hudRound').textContent = 'Round ' + view.round;
  }
  let statusKey = '';
  function setStatus() {
    let s;
    if (!room.connected) s = 'Waiting for your friend to join…' + (view && view.ph === 'play' ? ' (paused)' : '');
    else if (!view) s = 'Syncing…';
    else if (view.ph === 'ready') s = host ? 'Press Start when you\'re both ready.' : 'Waiting for the host to start the round…';
    else if (view.ph === 'countdown') s = 'Get ready…';
    else if (view.ph === 'play') s = 'Cook together! Deliver plates at the window ↖';
    else s = 'Service over.';
    if (s !== statusKey) { statusKey = s; $('status').textContent = s; }
    const canStart = host && view && (view.ph === 'ready' || view.ph === 'over');
    $('startBtn').hidden = !canStart; $('startBtn').disabled = !room.connected;
    $('startBtn2').hidden = !(canStart && $('legend').hidden && $('over').hidden); $('startBtn2').disabled = !room.connected;
    $('legendNote').textContent = !view || view.ph !== 'ready' ? '' : !room.connected ? 'Waiting for your friend to join…' : host ? 'Your friend is here. Start when you\'re both ready.' : 'The host starts the round.';
  }
  function onPhase() {
    if (!view) return;
    setStatus();
    if (view.ph !== lastPhase) {
      if (view.ph === 'countdown') { roundStartedAt = performance.now(); $('over').hidden = true; $('legend').hidden = true; cards.forEach(c => c.el.remove()); cards.clear(); floaters.length = 0; parts.length = 0; }
      if (view.ph === 'ready' && lastPhase === null) $('legend').hidden = false;
      if (view.ph === 'over' && lastPhase === null) showOver();
      lastPhase = view.ph;
    }
  }

  // legend / tutorial panel
  function buildLegend() {
    const rows = [
      [0, [['lettuce', 'knife'], ['tomato', 'knife']]],
      [1, [['meat', 'knife', 'pan'], ['onion', 'knife']]],
      [2, [['tomato', 'knife'], ['onion', 'knife'], ['pot']]],
      [3, [['bun'], ['meat', 'knife', 'pan'], ['lettuce', 'knife']]],
    ];
    const el = $('recipes'); el.replaceChildren();
    for (const [d, groups] of rows) {
      const D = KR.DISHES[d], row = document.createElement('div'); row.className = 'recipe';
      row.append(iconCanvas('plate:' + D.tokens.join(','), 44));
      const body = document.createElement('div');
      const name = document.createElement('b'); name.textContent = D.name + ' · ' + D.base + ' pts'; body.append(name);
      const steps = document.createElement('div'); steps.className = 'steps';
      groups.forEach((g, gi) => {
        if (gi) { const plus = document.createElement('span'); plus.textContent = g[0] === 'pot' ? '→' : '+'; steps.append(plus); }
        const grp = document.createElement('span'); grp.className = 'grp';
        g.forEach(tok => { const c = iconCanvas(tok, 24); c.title = tok === 'knife' ? 'chop' : tok === 'pan' ? 'fry' : tok === 'pot' ? 'boil' : tok; grp.append(c); });
        steps.append(grp);
      });
      body.append(steps); row.append(body); el.append(row);
    }
    const ex = $('legendIcons'); ex.replaceChildren();
    for (const [tok, label] of [['knife', 'chop on a board'], ['pan', 'fry (watch the burn bar)'], ['pot', 'boil tomato + onion'], ['plate', 'plate, then serve']]) {
      const s = document.createElement('span'); s.className = 'lg'; s.append(iconCanvas(tok, 22), ' ' + label); ex.append(s);
    }
  }
  buildLegend();
  function toggleLegend() { if ($('legend').hidden) { $('over').hidden = true; $('legend').hidden = false; } else $('legend').hidden = true; setStatus(); }
  $('helpBtn').addEventListener('click', toggleLegend);
  $('legendClose').addEventListener('click', () => { $('legend').hidden = true; setStatus(); });
  $('startBtn').addEventListener('click', requestStart);
  $('startBtn2').addEventListener('click', requestStart);
  $('ovAgain').addEventListener('click', () => { requestStart(); if (!host) { $('ovAgain').textContent = 'Asked the host…'; setTimeout(() => ($('ovAgain').textContent = 'Play again'), 2000); } });
  $('ovClose').addEventListener('click', () => { $('over').hidden = true; setStatus(); });

  function showOver() {
    if (!view || view.ph !== 'over') return;
    $('legend').hidden = true;
    const st = KR.stars(view.sc);
    $('ovStars').textContent = '★'.repeat(st) + '☆'.repeat(3 - st);
    $('ovTitle').textContent = st === 3 ? 'Michelin material!' : st === 2 ? 'Great service!' : st === 1 ? 'Not bad, chefs.' : 'The kitchen survived… barely.';
    $('ovScore').textContent = view.sc;
    const dishes = $('ovDishes'); dishes.replaceChildren();
    KR.DISHES.forEach((D, i) => { const n = (view.stats || [])[i] || 0; if (!n) return; const s = document.createElement('span'); s.className = 'lg'; s.append(iconCanvas('plate:' + D.tokens.join(','), 26), ' ×' + n); dishes.append(s); });
    if (!dishes.children.length) dishes.textContent = 'No dishes served';
    $('ovStat').innerHTML = `<span><b>${view.served}</b> served</span><span><b>${view.lost}</b> lost</span><span><b>${view.tips}</b> in tips</span><span>best combo <b>×${Math.min(view.best || 0, 4)}</b></span>`;
    $('over').hidden = false;
  }

  // ============================ rendering ============================
  const cv = $('view'), ctx = cv.getContext('2d');
  const mapC = KA.mapCanvas(MAP, W, H);
  const BW = W * T, BH = H * T + OY;
  const [buf, bctx] = KA.canvas(BW, BH);
  let S = 3, OX = 0, OYpx = 0;
  function resize() {
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    S = Math.min(cv.width / BW, cv.height / BH);
    if (S >= 3) S = Math.floor(S * 2) / 2;
    OX = Math.floor((cv.width - BW * S) / 2); OYpx = Math.floor((cv.height - BH * S) / 2);
  }
  addEventListener('resize', resize); resize(); setTimeout(resize, 300);

  const tiles = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (MAP[r][c] !== '.') tiles.push({ c, r, ty: MAP[r][c], i: r * W + c });
  const panSpr = (() => { const [c, x] = KA.canvas(16, 12); KA.drawPan(x, 1, 1); return KA.outline(c); })();
  const potSpr = (() => { const [c, x] = KA.canvas(16, 12); KA.drawPot(x, 1, 0); return KA.outline(c); })();
  const knifeSpr = KA.item('knife');
  const chopSeen = {};  // slot index -> [lastProgress, lastChangeTime]
  const P = (x, y, w, h, col) => { bctx.fillStyle = col; bctx.fillRect(x, y, w, h); };

  function drawFlames(x, y, t, hot) {
    for (let i = 0; i < 6; i++) {
      const ph = Math.floor(t * 12 + i * 1.7) % 3, h = 1 + ph + (hot ? 1 : 0);
      P(x + 2 + i * 2, y - h, 1, h, i % 2 ? '#ff8c2a' : '#ffd94a');
      if (ph === 2) P(x + 2 + i * 2, y - h - 1, 1, 1, '#ffe9a0');
    }
    P(x + 1, y - 1, 13, 1, '#e04020');
  }
  function drawBar(x, y, p, col, flashing, t) {
    P(x, y, 16, 5, '#1b1720'); P(x + 1, y + 1, 14, 3, '#3a3340');
    const w = Math.round(14 * clamp(p, 0, 1));
    if (w > 0) P(x + 1, y + 1, w, 3, flashing && Math.floor(t * 8) % 2 ? '#ffffff' : col);
    P(x + 1, y + 1, w, 1, 'rgba(255,255,255,.35)');
  }
  function drawTile(tl, t) {
    const X = tl.c * T, Y = tl.r * T, ty = tl.ty, sl = view && view.slots[tl.i];
    bctx.drawImage(KA.tile(ty, tl.c, tl.r), X, Y);
    if (ty === 'V' && tl.c === 3 && bell > 0) { bctx.drawImage(KA.tile('V', 3, 0), X, Y - Math.round(Math.sin(bell * 20) * 1.5)); }
    if (ty === 'C' || ty === 'B') {
      if (sl && sl.it) {
        bctx.drawImage(KA.item(sl.it), X + (ty === 'B' ? 1 : 2), Y - 1);
        if (ty === 'B') {
          const cs = chopSeen[tl.i] || (chopSeen[tl.i] = [0, -9]);
          if (sl.p !== cs[0]) { if (sl.p > cs[0]) cs[1] = t; cs[0] = sl.p; }
          if (t - cs[1] < 0.18 || (sl.p > 0 && sl.p < 1 && t - cs[1] < 0.08)) {
            const up = Math.floor(t * 14) % 2 ? 3 : 0;
            bctx.drawImage(knifeSpr, X + 5, Y - 9 - up);
          }
          if (sl.p > 0 && sl.p < 1) drawBar(X, Y - 7, sl.p, '#7ee081', false, t);
        }
      }
    } else if (ty === 'S') {
      const it = sl && sl.it;
      if (it === 'meat+' || it === 'meat*') drawFlames(X + 1, Y + 9, t, it === 'meat*');
      bctx.drawImage(panSpr, X, Y);
      if (it) bctx.drawImage(KA.item(it), X + 1, Y - 1);
      if (it === 'meat+') drawBar(X, Y - 7, sl.p, '#ffb347', false, t);
      else if (it === 'meat*') drawBar(X, Y - 7, sl.b, '#e5443a', sl.b > 0.6, t);
    } else if (ty === 'P') {
      const it = sl && sl.it, tk = it ? KR.tokens(it) : [];
      const cooking = tk.length === 2 || tk[0] === 'soup';
      if (cooking) drawFlames(X + 1, Y + 10, t, tk[0] === 'soup');
      bctx.drawImage(potSpr, X, Y);
      // contents in the pot opening (centre 8,3)
      if (tk.length) {
        if (tk[0] === 'soup') {
          KA.blob(bctx, X + 8, Y + 3, 4.2, 1.2, '#e8702a', { flat: true });
          const b = Math.floor(t * 5) % 3; P(X + 5 + b, Y + 2 + (b % 2), 1, 1, '#f6a660'); P(X + 10 - b, Y + 3, 1, 1, '#f8ddb4');
        } else if (tk[0] === 'burnt') { KA.blob(bctx, X + 8, Y + 3, 4.2, 1.2, '#2b2b2e', { flat: true }); P(X + 7, Y + 3, 1, 1, '#55555a'); }
        else {
          KA.blob(bctx, X + 8, Y + 3, 4.2, 1.2, '#7a6a5a', { flat: true });
          if (tk.includes('tomato+')) { P(X + 5, Y + 2, 2, 1, '#e03a2d'); P(X + 8, Y + 3, 2, 1, '#f28577'); P(X + 6, Y + 3, 1, 1, '#e03a2d'); }
          if (tk.includes('onion+')) { P(X + 9, Y + 2, 2, 1, '#e5bddf'); P(X + 7, Y + 2, 1, 1, '#a6509b'); P(X + 10, Y + 3, 1, 1, '#a6509b'); }
        }
      }
      if (tk.length === 2) drawBar(X, Y - 7, sl.p, '#ffb347', false, t);
      else if (tk[0] === 'soup') drawBar(X, Y - 7, sl.b, '#e5443a', sl.b > 0.6, t);
      else if (tk.length === 1) drawBar(X, Y - 7, 0.5, '#9aa3ad', false, t);
    }
  }
  const sheets = [KA.chefSheet(0, false), KA.chefSheet(1, false)], sheetsHold = [KA.chefSheet(0, true), KA.chefSheet(1, true)];
  function drawChef(p, ch, t) {
    const hold = !!ch.it, sh = (hold ? sheetsHold : sheets)[p][DIRS[ch.d] || 'down'];
    const frame = ch.mv ? [1, 0, 2, 0][Math.floor(ch.anim * 9) % 4] : 0;
    const bob = ch.ca ? (Math.floor(t * 14) % 2) : 0;
    const x = Math.round(ch.x), y = Math.round(ch.y);
    bctx.fillStyle = 'rgba(0,0,0,.28)'; bctx.beginPath(); bctx.ellipse(x, y + 3, 6, 2.2, 0, 0, Math.PI * 2); bctx.fill();
    const sq = p === ME && bump > 0 ? 1 : 0;
    if (hold && ch.d === 1) bctx.drawImage(KA.item(ch.it), x - 6, y - 26);
    bctx.drawImage(sh[frame], x - 8, y - 20 + bob + sq);
    if (hold && ch.d !== 1) bctx.drawImage(KA.item(ch.it), ch.d === 2 ? x - 15 : ch.d === 3 ? x + 3 : x - 6, y - 11 + bob);
  }
  function chefsForRender() {
    if (host) return [view.ch[0], view.ch[1]];
    // guest: friend interpolated from the last two snapshots, me predicted locally (held item from the host)
    const mine = Object.assign({}, view.ch[ME], { x: me.x, y: me.y, d: me.d, mv: me.mv });
    let fr = view.ch[FRIEND];
    if (snaps.length >= 2) {
      const tt = performance.now() - INTERP_MS;
      let a = snaps[0], b = snaps[snaps.length - 1];
      for (let i = snaps.length - 1; i > 0; i--) if (snaps[i - 1][0] <= tt) { a = snaps[i - 1]; b = snaps[i]; break; }
      const span = b[0] - a[0], k = span > 0 ? clamp((tt - a[0]) / span, 0, 1) : 1;
      const A = a[1].ch[FRIEND], B = b[1].ch[FRIEND];
      const jump = Math.hypot(A[0] - B[0], A[1] - B[1]) > 40;
      fr = Object.assign({}, fr, { x: jump ? B[0] : A[0] + (B[0] - A[0]) * k, y: jump ? B[1] : A[1] + (B[1] - A[1]) * k, d: B[2], mv: B[3], it: B[4], ca: B[5] });
    }
    return ME === 0 ? [mine, fr] : [fr, mine];
  }
  const animT = [0, 0];
  let fontOk = false;
  function render(t, dt) {
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.drawImage(mapC, 0, 0);
    bctx.setTransform(1, 0, 0, 1, 0, OY);
    const chefs = view ? chefsForRender() : null;
    const objs = tiles.map(tl => ({ y: (tl.r + 1) * T, draw: () => drawTile(tl, t) }));
    if (chefs) chefs.forEach((ch, p) => { animT[p] = ch.mv ? animT[p] + dt : 0; ch.anim = animT[p]; objs.push({ y: ch.y + 4.5, draw: () => drawChef(p, ch, t) }); });
    objs.sort((a, b) => a.y - b.y).forEach(o => o.draw());

    // target highlight for my chef
    if (chefs && view.ph === 'play') {
      const tg = KR.targetOf(chefs[ME]);
      if (tg) { bctx.strokeStyle = `rgba(255,240,150,${0.55 + Math.sin(t * 8) * 0.25})`; bctx.lineWidth = 1; bctx.strokeRect(tg.c * T + 0.5, tg.r * T + 0.5, 15, 15); }
      if (performance.now() - roundStartedAt < 5000) {
        const m = chefs[ME], up = Math.floor(t * 3) % 2;
        const mx = Math.round(m.x), my = Math.round(m.y) - 30 + up, col = ME === 0 ? '#ff6b57' : '#3cc6bb';
        P(mx - 3, my - 1, 7, 5, '#1b1720'); P(mx - 2, my, 5, 1, col); P(mx - 1, my + 1, 3, 1, col); P(mx, my + 2, 1, 1, col);
      }
    }
    // particles
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.life -= dt; if (q.life <= 0) { parts.splice(i, 1); continue; }
      if (q.kind === 'deliver') { bctx.globalAlpha = clamp(q.life / 0.4, 0, 1); bctx.drawImage(q.spr, Math.round(q.x), Math.round(q.y - (0.7 - q.life) * 24)); bctx.globalAlpha = 1; continue; }
      q.x += q.vx * dt; q.y += q.vy * dt; if (q.kind === 'smoke') { q.vx += Math.sin(t * 6 + q.y) * 6 * dt; q.vy -= 3 * dt; }
      bctx.globalAlpha = clamp(q.life, 0, 1); P(Math.round(q.x), Math.round(q.y), q.kind === 'smoke' ? 2 : 1, q.kind === 'smoke' ? 2 : 1, q.col); bctx.globalAlpha = 1;
    }
    // steam from cooking stations
    if (view && Math.random() < 0.5) for (const i in view.slots) {
      const sl = view.slots[i], ty = MAP[Math.floor(i / W)][i % W];
      if ((ty === 'P' && (KR.tokens(sl.it).length === 2 || sl.it === 'pot:soup')) || (ty === 'S' && (sl.it === 'meat+' || sl.it === 'meat*'))) {
        const p = slotPos(+i), burning = sl.b > 0.5;
        parts.push({ kind: burning ? 'smoke' : 'steam', x: p.x + (Math.random() - .5) * 8, y: p.y - 2, vx: (Math.random() - .5) * 6, vy: -8 - Math.random() * 8, life: burning ? 1.2 : 0.8, col: burning ? '#3a3a40' : 'rgba(255,255,255,.7)' });
      }
    }
    if (bell > 0) bell -= dt;
    if (bump > 0) bump -= dt;

    // ---- blit ----
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#111'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, OX, OYpx, Math.round(BW * S), Math.round(BH * S));
    if (flash > 0) { ctx.fillStyle = `rgba(229,68,58,${flash * 0.5})`; ctx.fillRect(OX, OYpx, BW * S, BH * S); flash -= dt; }

    // ---- crisp overlays in device space ----
    const font = (px, w) => `${w || 700} ${Math.max(10, Math.round(px * S))}px 'Pixelify Sans', sans-serif`;
    const toX = x => OX + x * S, toY = y => OYpx + (y + OY) * S;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.life -= dt; if (f.life <= 0) { floaters.splice(i, 1); continue; }
      const rise = (1.6 - Math.min(f.life, 1.6)) * 10;
      ctx.globalAlpha = clamp(f.life * 2, 0, 1); ctx.font = font(f.big ? 9 : 5.5);
      ctx.lineWidth = Math.max(2, S * 0.8); ctx.strokeStyle = '#1b1720'; ctx.strokeText(f.txt, toX(f.x), toY(f.y - rise)); ctx.fillStyle = f.col; ctx.fillText(f.txt, toX(f.x), toY(f.y - rise));
      ctx.globalAlpha = 1;
    }
    if (chefs) for (let p = 0; p < 2; p++) {
      const h = hints[p]; if (!h.t) continue; h.t -= dt; if (h.t <= 0) { h.t = 0; continue; }
      const ch = chefs[p]; ctx.font = font(4.6, 600);
      const w = ctx.measureText(h.m).width + 8 * S, x = clamp(toX(ch.x), OX + w / 2, OX + BW * S - w / 2), y = toY(ch.y - 32);
      ctx.globalAlpha = clamp(h.t * 3, 0, 1);
      ctx.fillStyle = '#1b1720'; ctx.beginPath(); ctx.roundRect(x - w / 2 - S, y - 4 * S, w + 2 * S, 8 * S, 2 * S); ctx.fill();
      ctx.fillStyle = '#fff6e0'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 3 * S, w, 6 * S, 1.5 * S); ctx.fill();
      ctx.fillStyle = '#1b1720'; ctx.fillText(h.m, x, y + S * 0.2);
      ctx.globalAlpha = 1;
    }
    if (view && view.ph === 'countdown') {
      const n = Math.ceil(view.cd - (host ? 0 : (performance.now() - view.at) / 1000));
      ctx.font = font(26); ctx.lineWidth = S * 1.5; ctx.strokeStyle = '#1b1720';
      const txt = n > 0 ? String(n) : 'GO!';
      ctx.strokeText(txt, toX(BW / 2), toY(H * T / 2 - 10)); ctx.fillStyle = '#ffe36b'; ctx.fillText(txt, toX(BW / 2), toY(H * T / 2 - 10));
    }
    if (!room.connected || !view) {
      ctx.fillStyle = 'rgba(20,16,24,.45)'; ctx.fillRect(OX, OYpx, BW * S, BH * S);
    }
  }

  // ============================ main loop ============================
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (!host && view && view.ph !== 'over') {
      // predict my own chef; the partner's interpolated position blocks me the same way the host's does
      const fr = chefsForRender()[FRIEND];
      KR.moveChef(me, inp.x, inp.y, dt, [fr]);
    } else if (!host && view) me.mv = 0;
    if (!host && view && view.ph === 'play') { view.tm = Math.max(0, view.tm - dt); for (const o of view.orders) o.t = Math.max(0, o.t - dt); }
    render(now / 1000, dt);
    renderHud(); renderOrders();
    requestAnimationFrame(frame);
  }
  if (host) onPhase();
  setStatus();
  requestAnimationFrame(frame);

  // test hook (read-only)
  window.__kr = { get view() { return view; }, me, role: room.role, _state: host ? () => state : undefined, snaps };
})();
