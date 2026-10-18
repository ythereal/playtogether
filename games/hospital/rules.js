// Rival Hospital rules: pure simulation. No DOM, no networking.
// Loads in the browser as window.RH and in Node (module.exports) so the economy can be tuned headless.
//
// Layout (tiles, 16px): 22 wide x 11 tall. Rooms are 4x4 and sit in ten slots: five above the corridor
// (rows 0-3) and five below (rows 7-10). The corridor is rows 4-6; everyone walks along LANE (y = 88px).
// The entrance is the left edge of the corridor; the reception desk sits at the bottom-left of it.
(function (root) {
  'use strict';
  const T = 16, W = 22, H = 11, LANE = 88, SLOTS = 10;
  const MONTH = 60;                 // real seconds per in-game month (a year is 12 minutes)
  const MONTHS = 24;                // two years, then the better hospital wins
  const EXIT = [-16, LANE], RECEP = [34, 98];
  const PSPEED = 30, SSPEED = 40, BUILD_TIME = 4;
  const START_CASH = 30000, START_REP = 500;
  const TARGETS = { cured: 120, rep: 800, cash: 60000 };   // meet all three first to win early
  const DEATH_REP = 15, ANGRY_REP = 3, UNCURED_REP = 3, HOME_REP = 1, NOGP_REP = 2, CROWD_REP = 1, CROWD = 16;

  const ROOMS = {
    gp:     { name: "GP's Office",      cost: 1500, staff: 'd', short: 'GP' },
    pharm:  { name: 'Pharmacy',          cost: 2000, staff: 'n', short: 'Pharmacy' },
    ward:   { name: 'Ward',              cost: 2500, staff: 'n', short: 'Ward' },
    psych:  { name: 'Psychiatry',        cost: 3000, staff: 'd', short: 'Psych' },
    infl:   { name: 'Inflation Clinic',  cost: 3500, staff: 'd', short: 'Inflation' },
    tongue: { name: 'Tongue Clinic',     cost: 4000, staff: 'd', short: 'Tongue' },
    hair:   { name: 'Hair Restorer',     cost: 4000, staff: 'd', short: 'Hair' },
    elec:   { name: 'Electrolysis',      cost: 4500, staff: 'd', short: 'Electro' },
    op:     { name: 'Operating Theatre', cost: 6000, staff: 'd', short: 'Theatre' },
  };
  const ROOM_ORDER = ['gp', 'pharm', 'ward', 'psych', 'infl', 'tongue', 'hair', 'elec', 'op'];
  // w: relative frequency · from: first month it appears · time: base treatment seconds
  const DISEASES = [
    { id: 'cold',    name: 'Uncommon Cold',     room: 'pharm',  fee: 400,  time: 2.5, w: 20, from: 0,  rep: 2, desc: 'Sniffles of unusual size. One spoon of syrup and a stern look.' },
    { id: 'gut',     name: 'Gut Rot',           room: 'pharm',  fee: 550,  time: 3, w: 12, from: 0,  rep: 3, desc: 'Too much of everything. A fizzing tonic settles things.' },
    { id: 'balloon', name: 'Balloon Head',      room: 'infl',   fee: 900,  time: 4, w: 12, from: 1,  rep: 4, desc: 'The head swells to twice its size. Pop it with the inflation machine.' },
    { id: 'royal',   name: 'Royal Delusion',    room: 'psych',  fee: 800,  time: 4.5, w: 9,  from: 2,  rep: 4, desc: 'Believes they are the monarch. A long chat on the couch helps.' },
    { id: 'sleep',   name: 'Sleeping Sickness', room: 'ward',   fee: 650,  time: 5, w: 8,  from: 2,  rep: 3, desc: 'Nods off mid-sentence. Bed rest and a loud alarm clock.' },
    { id: 'tongue',  name: 'Loose Tongue',      room: 'tongue', fee: 1000, time: 4.5, w: 8,  from: 3,  rep: 4, desc: 'The tongue grows and flops about. The clinic trims it back.' },
    { id: 'bones',   name: 'Broken Bones',      room: 'ward',   fee: 750,  time: 5, w: 7,  from: 4,  rep: 3, desc: 'Fell off something. A cast and a few days in bed.' },
    { id: 'invis',   name: 'Invisibility',      room: 'pharm',  fee: 800,  time: 4, w: 5,  from: 6,  rep: 4, desc: 'Entirely see-through, which is awkward. A coloured pill restores them.' },
    { id: 'bald',    name: 'Baldness',          room: 'hair',   fee: 1050, time: 4.5, w: 5,  from: 7,  rep: 5, desc: 'Lost every hair overnight. The restorer grows it all back.' },
    { id: 'tv',      name: 'TV Head',           room: 'psych',  fee: 850,  time: 4.5, w: 6,  from: 8,  rep: 4, desc: 'Watched too much television. Needs talking down from the aerial.' },
    { id: 'fur',     name: 'Fur Fever',         room: 'elec',   fee: 1100, time: 4.5, w: 5,  from: 9,  rep: 5, desc: 'Thick fur from head to toe. Electrolysis, one hair at a time.' },
    { id: 'ribs',    name: 'Extra Ribs',        room: 'op',     fee: 1500, time: 6, w: 4,  from: 12, rep: 6, desc: 'Grew a few extra ribs. Surgery removes the spares.' },
  ];
  const FIRST = ['Ada', 'Bob', 'Cleo', 'Dev', 'Elsa', 'Fitz', 'Gus', 'Hana', 'Igor', 'Jo', 'Kit', 'Lou', 'Mo', 'Nia', 'Olly', 'Pip', 'Quin', 'Rae', 'Sid', 'Tia',
    'Uma', 'Vic', 'Wes', 'Xan', 'Yuki', 'Zed', 'Bea', 'Cal', 'Dot', 'Eli', 'Flo', 'Gil', 'Ida', 'Jax', 'Kai', 'Lia', 'Max', 'Ned', 'Oz', 'Pat'];
  const LAST = ['Appleby', 'Bunting', 'Crumb', 'Dithers', 'Earwig', 'Fossil', 'Gristle', 'Hogg', 'Inkpen', 'Jolly', 'Kettle', 'Lumb', 'Mudd', 'Nettle',
    'Oddment', 'Pickle', 'Quibble', 'Rumble', 'Snood', 'Tuttle', 'Umble', 'Vole', 'Wobble', 'Yarrow', 'Zouch'];

  const rnd = () => Math.random();
  const pick = a => a[Math.floor(rnd() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r2 = v => Math.round(v * 100) / 100;

  // ---------- geometry ----------
  const slotTop = k => k < 5;
  const slotX0 = k => 2 + 4 * (k % 5);
  const slotY0 = k => (slotTop(k) ? 0 : 7);
  const slotCx = k => slotX0(k) * T + 32;
  // q: head of the queue (corridor) · in: patient spot inside · st: staff spot inside
  function spots(k) {
    const cx = slotCx(k);
    return slotTop(k) ? { q: [cx, 76], in: [cx + 9, 54], st: [cx - 9, 50] } : { q: [cx, 104], in: [cx + 9, 168], st: [cx - 9, 164] };
  }
  const QUEUE_GAP = 11;
  const queuePos = (k, i) => { const sp = spots(k); return [Math.max(8, sp.q[0] - QUEUE_GAP * i), sp.q[1]]; };
  const idlePos = i => [14 + 10 * (i % 5), 74 + 12 * Math.floor(i / 5)];

  // ---------- movement ----------
  function walk(e, speed, dt) {
    if (!e.path.length) { e.mv = 0; return true; }
    const [tx, ty] = e.path[0];
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy), step = speed * dt;
    if (d <= step) { e.x = tx; e.y = ty; e.path.shift(); if (!e.path.length) { e.mv = 0; return true; } return false; }
    e.x += dx / d * step; e.y += dy / d * step; e.mv = 1;
    e.f = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0);
    return false;
  }
  // Path along the corridor to (gx, gy). `via` is the room's centre x when leaving the inside of a room.
  function route(e, gx, gy, via) {
    const p = [];
    let x = e.x, y = e.y;
    if (via !== undefined && Math.abs(x - via) > 0.5) { p.push([via, y]); x = via; }
    if (Math.abs(y - LANE) > 0.5) { p.push([x, LANE]); y = LANE; }
    if (Math.abs(x - gx) > 0.5) { p.push([gx, LANE]); x = gx; }
    if (Math.abs(y - gy) > 0.5 || !p.length) p.push([gx, gy]);
    e.path = p;
  }

  // ---------- state ----------
  const newCand = (k, id) => {
    const sk = r2(0.3 + rnd() * 0.7);
    return { id, k, nm: (k === 'd' ? 'Dr ' : 'Nurse ') + pick(LAST), sk, sal: Math.round((k === 'd' ? 500 + 700 * sk : 300 + 400 * sk) / 10) * 10 };
  };
  function newPool(s) { return { d: [0, 1, 2].map(() => newCand('d', s.nextId++)), n: [0, 1].map(() => newCand('n', s.nextId++)) }; }
  function newHospital(s) {
    return { cash: START_CASH, rep: START_REP, cured: 0, died: 0, angry: 0, home: 0, treated: 0, income: 0,
      rooms: {}, staff: [], pats: [], pool: newPool(s), acc: 0.5 + rnd() * 0.5 };
  }
  function newState() {
    const s = { ph: 'ready', t: 0, month: 0, nextId: 1, ev: [], h: null, winner: -1, why: '', prof: [{ nm: '', av: 0 }, { nm: '', av: 1 }] };
    s.h = [newHospital(s), newHospital(s)];
    return s;
  }
  function start(s) {
    if (s.ph === 'play') return;
    const fresh = newState(), prof = s.prof;
    Object.assign(s, fresh);
    if (prof) s.prof = prof;
    s.ph = 'play';
    s.ev.push({ k: 'start' });
  }
  const score = h => Math.round(h.cash + h.cured * 250 + (h.rep - 500) * 50);
  const metTargets = h => h.cured >= TARGETS.cured && h.rep >= TARGETS.rep && h.cash >= TARGETS.cash;
  const staffById = (h, id) => h.staff.find(x => x.id === id);
  const patById = (h, id) => h.pats.find(x => x.id === id);
  const addRep = (h, d) => { h.rep = clamp(Math.round(h.rep + d), 0, 1000); };
  const yearMonth = m => ({ year: Math.floor(m / 12) + 1, month: m % 12 });
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- staffing ----------
  function assign(h) {
    for (const st of h.staff) if (st.slot != null && (!h.rooms[st.slot] || h.rooms[st.slot].st !== st.id)) st.slot = null;
    const slots = Object.keys(h.rooms).map(Number).sort((a, b) => a - b);
    for (const k of slots) {
      const r = h.rooms[k];
      if (r.st != null && staffById(h, r.st)) continue;
      r.st = null;
      const need = ROOMS[r.k].staff;
      const cand = h.staff.filter(x => !x.gone && x.slot == null && x.k === need).sort((a, b) => b.sk - a.sk)[0];
      if (!cand) continue;
      r.st = cand.id; cand.slot = k;
      const sp = spots(k);
      route(cand, slotCx(k), sp.st[1], cand.inRoom != null ? slotCx(cand.inRoom) : undefined);
      cand.path.push(sp.st);
      cand.inRoom = k;
    }
    let i = 0;
    for (const st of h.staff) {
      if (st.gone || st.slot != null) continue;
      const [ix, iy] = idlePos(i++);
      if (st.idle !== i && (st.x !== ix || st.y !== iy)) { route(st, ix, iy, st.inRoom != null ? slotCx(st.inRoom) : undefined); st.inRoom = null; st.idle = i; }
    }
  }

  // ---------- patients ----------
  function pickDisease(s) {
    const pool = DISEASES.filter(d => d.from <= s.month);
    let tot = 0; for (const d of pool) tot += d.w;
    let r = rnd() * tot;
    for (let i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) return DISEASES.indexOf(pool[i]); }
    return DISEASES.indexOf(pool[pool.length - 1]);
  }
  function spawnPatient(s, p) {
    const h = s.h[p];
    const pt = { id: s.nextId++, nm: pick(FIRST), dis: pickDisease(s), dx: false, x: EXIT[0], y: LANE, path: [], st: 'enter', slot: null, t: 0,
      pat: 45 + rnd() * 30, f: 3, mv: 0, look: Math.floor(rnd() * 8), inRoom: null };
    route(pt, RECEP[0], RECEP[1]);
    h.pats.push(pt);
  }
  function reQueue(h, k) {
    const r = h.rooms[k]; if (!r) return;
    r.q.forEach((id, i) => {
      const pt = patById(h, id); if (!pt) return;
      const [x, y] = queuePos(k, i);
      if (pt.path.length) pt.path[pt.path.length - 1] = [x, y];
      else if (pt.x !== x || pt.y !== y) pt.path = [[x, y]];
    });
  }
  function leave(s, p, pt, why) {
    const h = s.h[p];
    if (pt.slot != null && h.rooms[pt.slot]) {
      const r = h.rooms[pt.slot];
      const qi = r.q.indexOf(pt.id); if (qi >= 0) { r.q.splice(qi, 1); reQueue(h, pt.slot); }
      if (r.p === pt.id) { r.p = null; r.prog = 0; }
    }
    pt.slot = null; pt.st = 'leave'; pt.why = why;
    route(pt, EXIT[0], EXIT[1], pt.inRoom != null ? slotCx(pt.inRoom) : undefined);
    pt.inRoom = null;
  }
  function toRoom(s, p, pt, kind) {
    const h = s.h[p];
    const cands = Object.keys(h.rooms).map(Number).filter(k => h.rooms[k].k === kind);
    if (!cands.length) {
      if (kind === 'gp') { addRep(h, -NOGP_REP); h.angry++; s.ev.push({ k: 'nogp', p, nm: pt.nm }); leave(s, p, pt, 'nogp'); }
      else { addRep(h, -HOME_REP); h.home++; s.ev.push({ k: 'home', p, nm: pt.nm, dis: pt.dis }); leave(s, p, pt, 'home'); }
      return;
    }
    const staffed = k => (h.rooms[k].st != null ? 0 : 1);
    cands.sort((a, b) => staffed(a) - staffed(b) || h.rooms[a].q.length - h.rooms[b].q.length || a - b);
    const k = cands[0], r = h.rooms[k];
    r.q.push(pt.id);
    const [qx, qy] = queuePos(k, r.q.length - 1);
    route(pt, qx, qy, pt.inRoom != null ? slotCx(pt.inRoom) : undefined);
    pt.inRoom = null; pt.slot = k; pt.st = 'queue';
  }
  function finishRoom(s, p, k) {
    const h = s.h[p], r = h.rooms[k], pt = patById(h, r.p);
    r.p = null; r.prog = 0; r.n++;
    if (!pt) return;
    pt.slot = null;
    if (r.k === 'gp') {
      pt.dx = true; h.treated++;
      s.ev.push({ k: 'diag', p, id: pt.id, nm: pt.nm, dis: pt.dis });
      toRoom(s, p, pt, DISEASES[pt.dis].room);
      return;
    }
    const d = DISEASES[pt.dis], st = staffById(h, r.st), sk = st ? st.sk : 0.3;
    if (rnd() < 0.7 + 0.3 * sk) {
      h.cash += d.fee; h.income += d.fee; h.cured++; addRep(h, d.rep);
      s.ev.push({ k: 'cured', p, id: pt.id, nm: pt.nm, dis: pt.dis, fee: d.fee, x: pt.x, y: pt.y, slot: k });
      leave(s, p, pt, 'cured');
    } else if (rnd() < 0.4) {
      h.died++; addRep(h, -DEATH_REP);
      s.ev.push({ k: 'died', p, id: pt.id, nm: pt.nm, dis: pt.dis, x: pt.x, y: pt.y, slot: k });
      h.pats.splice(h.pats.indexOf(pt), 1);
    } else {
      addRep(h, -UNCURED_REP);
      s.ev.push({ k: 'uncured', p, id: pt.id, nm: pt.nm, dis: pt.dis });
      leave(s, p, pt, 'uncured');
    }
  }
  const treatTime = (r, sk) => (r.k === 'gp' ? 2 : DISEASES[r.dis].time) * (1.4 - 0.6 * sk);

  // ---------- actions (host validates; p = 0 host, 1 guest) ----------
  function build(s, p, k, kind) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p];
    if (!(k >= 0 && k < SLOTS) || !ROOMS[kind]) return 'Bad request';
    if (h.rooms[k]) return 'That slot is taken';
    if (h.cash < ROOMS[kind].cost) return 'Not enough cash';
    h.cash -= ROOMS[kind].cost;
    h.rooms[k] = { k: kind, bt: BUILD_TIME, st: null, p: null, prog: 0, dur: 1, n: 0, q: [], dis: -1 };
    assign(h);
    s.ev.push({ k: 'built', p, slot: k, kind });
    return null;
  }
  function demolish(s, p, k) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], r = h.rooms[k];
    if (!r) return 'No room there';
    const kind = r.k;
    const ids = r.q.slice(); if (r.p != null) ids.push(r.p);
    delete h.rooms[k];
    h.cash += Math.round(ROOMS[kind].cost / 2);
    for (const id of ids) {
      const pt = patById(h, id); if (!pt) continue;
      pt.slot = null; pt.st = 'recep'; pt.t = 0.3;
      if (pt.inRoom === k) { route(pt, pt.x < slotCx(k) ? slotCx(k) - 16 : slotCx(k) + 16, LANE, slotCx(k)); pt.inRoom = null; }
      else { pt.path = []; }
    }
    for (const st of h.staff) if (st.slot === k) st.slot = null;
    assign(h);
    s.ev.push({ k: 'razed', p, slot: k, kind });
    return null;
  }
  function hire(s, p, type, id) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], list = h.pool[type]; if (!list) return 'Bad request';
    const i = list.findIndex(c => c.id === id); if (i < 0) return 'Already gone';
    const c = list[i];
    if (h.cash < c.sal) return 'Not enough cash for the first month';
    list.splice(i, 1);
    h.staff.push(Object.assign({}, c, { slot: null, x: EXIT[0], y: LANE, path: [], f: 3, mv: 0, gone: false, inRoom: null, idle: -1, look: Math.floor(rnd() * 8) }));
    assign(h);
    s.ev.push({ k: 'hired', p, nm: c.nm, type });
    return null;
  }
  function fire(s, p, id) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], st = staffById(h, id);
    if (!st || st.gone) return 'Not on staff';
    st.gone = true;
    if (st.slot != null && h.rooms[st.slot]) h.rooms[st.slot].st = null;
    st.slot = null;
    route(st, EXIT[0], EXIT[1], st.inRoom != null ? slotCx(st.inRoom) : undefined);
    st.inRoom = null;
    assign(h);
    s.ev.push({ k: 'fired', p, nm: st.nm });
    return null;
  }

  // player name + avatar (0 or 1): cosmetic, but kept in state so both sides agree
  function setProfile(s, p, nm, av) {
    if (!s.prof) s.prof = [{ nm: '', av: 0 }, { nm: '', av: 1 }];
    s.prof[p] = { nm: String(nm == null ? '' : nm).replace(/[^\p{L}\p{N} '.-]/gu, '').trim().slice(0, 12), av: av === 1 ? 1 : 0 };
    s.ev.push({ k: 'profile', p });
  }

  // ---------- time ----------
  const arrivals = m => 16 + 0.9 * m;      // patients per month for the whole town
  function monthTick(s) {
    s.month++;
    for (let p = 0; p < 2; p++) {
      const h = s.h[p];
      let sal = 0; for (const st of h.staff) if (!st.gone) sal += st.sal;
      h.cash -= sal;
      s.ev.push({ k: 'month', p, m: s.month, sal, income: h.income });
      h.income = 0;
      h.pool = newPool(s);
    }
    const met = [0, 1].filter(p => metTargets(s.h[p]));
    if (met.length || s.month >= MONTHS) {
      const sc = [score(s.h[0]), score(s.h[1])];
      s.winner = met.length === 1 ? met[0] : sc[0] === sc[1] ? -1 : (sc[0] > sc[1] ? 0 : 1);
      s.why = met.length ? 'targets' : 'time';
      s.ph = 'over';
      s.ev.push({ k: 'over', winner: s.winner, why: s.why });
    }
  }
  function step(s, dt) {
    if (s.ph !== 'play') return;
    s.t += dt;
    const repSum = s.h[0].rep + s.h[1].rep || 1;
    for (let p = 0; p < 2; p++) {
      const h = s.h[p];
      // arrivals: the town's patients choose a hospital by reputation
      h.acc += dt * arrivals(s.month) * (h.rep / repSum) / MONTH;
      while (h.acc >= 1 && h.pats.length < 60) { h.acc -= 1; spawnPatient(s, p); }
      if (h.acc >= 1) h.acc = 0.99;
      // staff
      for (let i = h.staff.length - 1; i >= 0; i--) {
        const st = h.staff[i];
        if (walk(st, SSPEED, dt) && st.gone) h.staff.splice(i, 1);
      }
      // patients
      for (let i = h.pats.length - 1; i >= 0; i--) {
        const pt = h.pats[i];
        const arrived = walk(pt, DISEASES[pt.dis].id === 'sleep' ? PSPEED * 0.6 : PSPEED, dt);
        if (pt.st === 'enter') { if (arrived) { pt.st = 'recep'; pt.t = 0.8; } }
        else if (pt.st === 'recep') {
          pt.t -= dt;
          if (pt.t <= 0) {
            if (!pt.dx && h.pats.filter(x => x.st === 'queue' || x.st === 'recep').length > CROWD) { h.angry++; addRep(h, -CROWD_REP); s.ev.push({ k: 'crowd', p, nm: pt.nm }); leave(s, p, pt, 'crowd'); }
            else toRoom(s, p, pt, pt.dx ? DISEASES[pt.dis].room : 'gp');
          }
        }
        else if (pt.st === 'queue') { pt.pat -= dt; if (pt.pat <= 0) { h.angry++; addRep(h, -ANGRY_REP); s.ev.push({ k: 'angry', p, nm: pt.nm, id: pt.id, x: pt.x, y: pt.y }); leave(s, p, pt, 'angry'); } }
        else if (pt.st === 'leave') { if (arrived) h.pats.splice(i, 1); }
      }
      // rooms
      for (const key in h.rooms) {
        const k = +key, r = h.rooms[k];
        if (r.bt > 0) { r.bt -= dt; continue; }
        const st = r.st != null ? staffById(h, r.st) : null;
        const ready = st && !st.gone && st.slot === k && !st.path.length;
        if (r.p != null) {
          const pt = patById(h, r.p);
          if (!pt) { r.p = null; r.prog = 0; continue; }
          if (!ready || pt.path.length) continue;
          r.prog += dt / r.dur;
          if (r.prog >= 1) finishRoom(s, p, k);
        } else if (ready && r.q.length) {
          const pt = patById(h, r.q[0]);
          if (!pt) { r.q.shift(); reQueue(h, k); continue; }
          if (pt.path.length) continue;
          r.q.shift(); reQueue(h, k);
          r.p = pt.id; r.dis = pt.dis; r.dur = treatTime(r, st.sk); r.prog = 0;
          const sp = spots(k);
          pt.st = 'in'; pt.inRoom = k; pt.path = [[slotCx(k), sp.in[1]], sp.in];
        }
      }
    }
    while (s.ph === 'play' && s.t >= (s.month + 1) * MONTH) monthTick(s);
  }

  const api = { T, W, H, LANE, SLOTS, MONTH, MONTHS, EXIT, RECEP, TARGETS, START_CASH, START_REP, ROOMS, ROOM_ORDER, DISEASES, MONTH_NAMES,
    slotTop, slotX0, slotY0, slotCx, spots, queuePos, idlePos, yearMonth, score, metTargets, arrivals, treatTime,
    newState, start, step, build, demolish, hire, fire, setProfile, staffById, patById };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RH = api;
})(typeof window !== 'undefined' ? window : globalThis);
