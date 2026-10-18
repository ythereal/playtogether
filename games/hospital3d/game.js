// Rival Hospital 3D: networking, rendering, input and UI.
// The host runs the simulation (rules.js) for both hospitals at 60 Hz and broadcasts 10 Hz snapshots.
// The guest sends intents (build / hire / fire / answer a fax / set prices …) and renders interpolated snapshots.
(async () => {
  'use strict';
  const RH = window.RH, HA = window.HA;
  const { T } = HA;
  const DIRS = ['down', 'up', 'left', 'right'];
  const TICK = 1 / 60, SNAP_HZ = 10;
  const PROTO = 2;   // snapshot format: bump whenever host and guest stop understanding each other
  let mismatch = '';   // who has the out-of-date copy: 'me' or 'friend'
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const money = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
  const qn = r => (Array.isArray(r.q) ? r.q.length : r.q);
  const un = r => (Array.isArray(r.users) ? r.users.length : r.users || 0);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const btn = (txt, cls, fn, dis) => { const b = el('button', cls || 'pt-btn pt-btn-small', txt); if (dis) b.disabled = true; b.addEventListener('click', fn); return b; };
  const meter = (v, cls) => { const m = el('span', 'meter' + (cls ? ' ' + cls : '')), i = el('i'); i.style.width = Math.round(clamp(v, 0, 1) * 100) + '%'; m.append(i); return m; };

  const room = await PT.room({ game: 'hospital3d', title: 'Rival Hospital 3D' });
  const host = room.role === 'host';
  const ME = host ? 0 : 1, FRIEND = 1 - ME;

  // ============================ state ============================
  let state = null;   // host only
  let view = null;    // what we render from: host → state, guest → normalised latest snapshot
  let tab = ME;       // which hospital is on screen
  let guestTab = 1;   // host: which hospital the guest is looking at (only that one's patients are sent)
  let lastPhase = null;
  if (host) {
    const sv = room.saved;
    state = sv && sv.v === RH.VERSION ? sv : RH.newState();
    state.ev = []; if (!state.prof) state.prof = [{ nm: '', av: 0 }, { nm: '', av: 1 }];
    view = state;
  }

  // ============================ profile (name + character) ============================
  const PROFILE_KEY = 'rh_profile';
  let profile = null;
  try { const j = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); if (j && typeof j.nm === 'string') profile = { nm: j.nm.slice(0, 12), av: j.av === 1 ? 1 : 0 }; } catch (e) {}
  let pickAv = profile ? profile.av : ME;
  const avOf = p => (view && view.prof && view.prof[p] ? view.prof[p].av : p);
  const nameOf = p => (view && view.prof && view.prof[p] && view.prof[p].nm) || HA.AVATARS[avOf(p)].name;
  function applyProfile() {
    if (!profile) return;
    if (host) { RH.setProfile(state, 0, profile.nm, profile.av); drainEvents(); hudKey = ''; }
    else if (room.connected) room.send({ t: 'profile', nm: profile.nm, av: profile.av, pv: PROTO });
    renderProfBtn();
  }
  function renderProfBtn() {
    const c = $('profMini'), x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.clearRect(0, 0, 18, 18);
    x.drawImage(HA.portrait(profile ? profile.av : ME, 18), 0, 0);
    $('profName2').textContent = profile ? (profile.nm || HA.AVATARS[profile.av].name) : 'You';
  }
  function openProfile() {
    const wrap = $('avatars'); wrap.replaceChildren();
    HA.AVATARS.forEach((A, i) => {
      const b = el('button', 'avatar' + (i === pickAv ? ' on' : ''));
      const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(HA.portrait(i, 96), 0, 0);
      b.append(c, el('b', null, A.name), el('small', null, i ? 'Runs a tight ship and a calm waiting room.' : 'Sharp suit, sharper clipboard.'));
      b.addEventListener('click', () => { pickAv = i; [...wrap.children].forEach((ch, k) => ch.classList.toggle('on', k === i)); if (!$('profInput').value.trim() || HA.AVATARS.some(a => a.name === $('profInput').value.trim())) $('profInput').value = A.name; });
      wrap.append(b);
    });
    $('profInput').value = profile ? profile.nm : HA.AVATARS[pickAv].name;
    $('profile').hidden = false;
    setTimeout(() => $('profInput').focus(), 50);
  }
  function saveProfile() {
    const nm = $('profInput').value.replace(/[^\p{L}\p{N} '.-]/gu, '').trim().slice(0, 12) || HA.AVATARS[pickAv].name;
    const first = !profile;
    profile = { nm, av: pickAv };
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (e) {}
    $('profile').hidden = true;
    applyProfile();
    if (first && view && view.ph === 'ready') $('legend').hidden = false;
  }

  // ============================ networking ============================
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  let pendingEv = [];
  function packH(h, full, ents) {
    const rm = {};
    for (const k in h.rooms) { const r = h.rooms[k]; rm[k] = { k: r.k, bt: r1(r.bt), sts: r.sts, p: r.p, prog: r2(r.prog), n: r.n, q: r.q.length, dis: r.dis, str: r.str, used: r.used, wreck: r.wreck ? 1 : 0, ex: r.ex, water: r2(r.water), users: r.users.length }; }
    const dry = []; for (const k in h.decor) if (h.decor[k] === 'plant' && (h.water[k] || 0) <= 0) dry.push(k);
    const ps = patStat(h.pats);
    const o = { cash: h.cash, loan: h.loan, rep: h.rep, cured: h.cured, died: h.died, angry: h.angry, home: h.home, seen: h.seen, visits: h.visits, open: h.open, desk: h.desk,
      comfort: h.comfort, warm: r2(h.warm), rads: h.rads, drinks: h.drinks, booms: h.booms, vipScore: h.vipScore, awards: h.awards, rooms: rm, decor: h.decor, dry, mess: h.mess,
      em: h.em ? { dis: h.em.dis, n: h.em.n, saved: h.em.saved, end: r1(h.em.end) } : null, epi: h.epi ? { phase: h.epi.phase, t: r1(h.epi.t), dis: h.epi.dis } : null, pstat: ps,
      res: { done: h.res.done, disc: h.res.disc },
      staff: h.staff.map(s => ({ id: s.id, k: s.k, nm: s.nm, sk: s.sk, q: s.q, sal: s.sal, slot: s.slot, desk: s.desk, room: s.room, x: r1(s.x), y: r1(s.y), f: s.f, mv: s.mv, gone: s.gone ? 1 : 0, look: s.look,
        cl: s.work > 0 ? 1 : 0, job: s.job ? s.job[0] : '', hap: r2(s.hap), tired: r2(s.tired), mode: s.mode, train: s.train, pri: s.pri, quit: s.quit, inRoom: s.inRoom })) };
    if (ents) {
      o.pats = h.pats.map(q => ({ id: q.id, nm: q.nm, dis: q.dis, dx: q.dx, x: r1(q.x), y: r1(q.y), f: q.f, mv: q.mv, st: q.st, slot: q.slot, pat: Math.round(q.pat), look: q.look, why: q.why,
        hp: r2(q.hp), dg: r2(q.dg), em: q.em, inf: q.inf, vax: q.vax, mk: q.mk, inRoom: q.inRoom }));
      o.vis = h.vis.map(v => ({ id: v.id, k: v.k, x: r1(v.x), y: r1(v.y), f: v.f, mv: v.mv }));
      o.rats = h.rats.map(v => ({ id: v.id, x: r1(v.x), y: r1(v.y), f: v.f }));
    }
    if (full) Object.assign(o, { pol: h.pol, price: h.price, dprice: h.dprice, res: h.res, known: h.known, cb: h.cb, fin: h.fin, owed: h.owed, fax: h.fax, specStr: h.specStr || {} });
    return o;
  }
  // average patient happiness, thirst and health, for the Status screen
  function patStat(pats) {
    const ps = { n: 0, pat: 0, th: 0, hp: 0 };
    for (const q of pats) { if (q.st === 'leave') continue; ps.n++; ps.pat += Math.min(1, q.pat / 150); ps.th += q.th; ps.hp += q.hp; }
    if (ps.n) { ps.pat = r2(ps.pat / ps.n); ps.th = r2(ps.th / ps.n); ps.hp = r2(ps.hp / ps.n); }
    return ps;
  }
  const snapshot = () => ({ t: 's', pv: PROTO, ph: state.ph, tm: r1(state.t), m: state.month, w: state.winner, why: state.why, pr: state.prof, pool: state.pool, qk: state.quake ? 1 : 0,
    h: [packH(state.h[0], false, guestTab === 0), packH(state.h[1], true, true)], ev: pendingEv.splice(0) });
  // guest interpolation: previous snapshot positions by entity id
  let prevPos = new Map(), curPos = new Map(), prevAt = 0, curAt = 0;
  function applySnap(m) {
    if (m.pv !== PROTO) { versionMismatch(!(m.pv > PROTO)); return; }
    if (mismatch) { mismatch = ''; statusKey = ''; }
    prevPos = curPos; prevAt = curAt; curPos = new Map(); curAt = performance.now();
    const old = view;
    view = { ph: m.ph, t: m.tm, month: m.m, winner: m.w, why: m.why, prof: m.pr, pool: m.pool || [], quake: m.qk, h: m.h };
    for (let p = 0; p < 2; p++) { const h = view.h[p]; if (!h.pats) { h.pats = []; h.vis = []; h.rats = []; } if (!h.fax) { h.fax = []; } }
    void old;
    for (const h of view.h) { for (const e of h.staff) curPos.set('s' + e.id, [e.x, e.y]); for (const e of h.pats) curPos.set('p' + e.id, [e.x, e.y]); for (const e of h.vis) curPos.set('v' + e.id, [e.x, e.y]); for (const e of h.rats) curPos.set('r' + e.id, [e.x, e.y]); }
    for (const e of m.ev || []) onEvent(e);
    onPhase(); refreshSheets();
  }
  const SAVE_EV = new Set(['month', 'over', 'built', 'hired', 'fired', 'razed', 'start', 'profile', 'decor', 'undecor', 'desk', 'extra', 'research', 'boom', 'replaced', 'raise', 'resigned', 'open']);
  // friendOld: the other player is running an older copy of the game than this one
  function versionMismatch(friendOld) {
    const who = friendOld ? 'friend' : 'me';
    if (mismatch === who) return;
    mismatch = who; statusKey = ''; setStatus();
    toast(mismatchText(), 'bad');
  }
  const mismatchText = () => (mismatch === 'friend' ? `${nameOf(FRIEND)} is running an old copy of the game. They need to reload their page (hold Shift while reloading).` : 'You\'re running an old copy of the game. Reload this page (hold Shift while reloading).');
  function drainEvents() {
    if (!state.ev.length) return;
    const evs = state.ev.splice(0);
    for (const e of evs) onEvent(e);
    pendingEv.push(...evs);
    if (pendingEv.length > 200) pendingEv.splice(0, pendingEv.length - 200);
    if (evs.some(e => SAVE_EV.has(e.k))) room.save(state);
  }
  let lastErr = null;
  function fail(msg) { lastErr = { m: msg, at: performance.now() }; refreshSheets(); toast(msg, 'bad'); }
  // every player intent goes through here, on the host for both players
  function doAct(p, m) {
    const s = state, n = v => (v == null ? -1 : +v | 0);
    switch (m.t) {
      case 'build': return RH.build(s, p, n(m.slot), String(m.kind));
      case 'raze': return RH.demolish(s, p, n(m.slot));
      case 'extra': return RH.buyExtra(s, p, n(m.slot), String(m.e));
      case 'replace': return RH.replaceMachine(s, p, n(m.slot));
      case 'hire': return RH.hire(s, p, n(m.id));
      case 'fire': return RH.fire(s, p, n(m.id));
      case 'place': return RH.place(s, p, n(m.id), n(m.slot));
      case 'train': return RH.setTrain(s, p, n(m.id), !!m.on);
      case 'pri': return RH.setPri(s, p, n(m.id), String(m.pri));
      case 'pay': return RH.pay(s, p, n(m.id), m.kind === 'bonus' ? 'bonus' : 'raise');
      case 'policy': return RH.setPolicy(s, p, m.pol || {});
      case 'price': return RH.setPrice(s, p, m.which === 'diag' ? 'diag' : n(m.which), +m.pct);
      case 'research': return RH.setResearch(s, p, m.alloc, m.spec == null ? null : n(m.spec));
      case 'loan': return RH.loan(s, p, m.dir > 0 ? 1 : -1);
      case 'open': return RH.openDoors(s, p);
      case 'decor': return RH.placeDecor(s, p, n(m.c), n(m.r), String(m.kind));
      case 'undecor': return RH.removeDecor(s, p, n(m.c), n(m.r));
      case 'desk': return RH.buyDesk(s, p);
      case 'shoot': return RH.shoot(s, p, n(m.id));
      case 'vax': return RH.vax(s, p, n(m.id));
      case 'fax': return RH.answerFax(s, p, n(m.id), String(m.c));
    }
    return 'Unknown';
  }
  function act(kind, payload) {
    if (!view || view.ph !== 'play') return;
    const m = Object.assign({ t: kind }, payload || {});
    if (host) { const err = doAct(0, m); if (err) fail(err); drainEvents(); refreshSheets(); }
    else if (room.connected) room.send(m);
  }
  room.on('connected', () => { if (host) { pendingEv = []; room.send(snapshot()); } else { applyProfile(); room.send({ t: 'tab', p: tab, pv: PROTO }); } setStatus(); });
  room.on('disconnected', () => { setStatus(); });
  room.on('message', m => {
    if (host) {
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'start') { hostStart(); return; }
      if (m.t === 'tab' || m.t === 'profile') { if (m.pv !== PROTO) { versionMismatch(!(m.pv > PROTO)); return; } if (mismatch) { mismatch = ''; statusKey = ''; } }
      if (m.t === 'tab') { guestTab = m.p === 0 ? 0 : 1; return; }
      if (m.t === 'profile') { RH.setProfile(state, 1, m.nm, m.av); drainEvents(); hudKey = ''; room.save(state); return; }
      if (state.ph !== 'play') return;
      const err = doAct(1, m);
      if (err && err !== 'Unknown') room.send({ t: 'err', m: err });
      drainEvents(); refreshSheets();
    } else if (m.t === 's') { try { applySnap(m); } catch (err) { console.error(err); } }
    else if (m.t === 'err') fail(String(m.m));
  });
  function hostStart() { if (!room.connected || !state) return; if (state.ph === 'play') return; RH.start(state); drainEvents(); onPhase(); room.save(state); }
  function requestStart() { if (host) hostStart(); else if (room.connected) room.send({ t: 'start' }); }

  // ============================ host loop ============================
  let acc = 0, lastTick = performance.now(), lastSnap = 0, lastSave = 0;
  if (host) setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - lastTick) / 1000, 0.1); lastTick = now;
    const paused = !room.connected && state.ph === 'play';
    if (!paused) { acc += dt; while (acc >= TICK) { RH.step(state, TICK); acc -= TICK; } drainEvents(); onPhase(); } else acc = 0;
    if (now - lastSnap >= 1000 / SNAP_HZ) { lastSnap = now; if (room.connected) room.send(snapshot()); refreshSheets(); }
    if (now - lastSave > 3000) { lastSave = now; room.save(state); }
  }, 1000 / 120);

  // ============================ events, toasts ============================
  const floaters = [], ghosts = [], sparks = [], smokes = [];
  let shake = 0, flash = null;
  const toastsEl = $('toasts');
  function toast(text, cls) {
    const t = document.createElement('div'); t.className = 'toast ' + (cls || ''); t.textContent = text;
    toastsEl.appendChild(t); setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3700);
    while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
  }
  const dname = i => RH.DISEASES[i].name;
  const rname = k => RH.ROOMS[k].name;
  const burst = (p, x, y, col, n, z) => { for (let i = 0; i < n; i++) sparks.push({ p, x: x + (Math.random() - .5) * 12, y: y + (Math.random() - .5) * 12, z: (z || 10) + Math.random() * 14, vx: (Math.random() - .5) * 30, vy: (Math.random() - .5) * 30, life: .5 + Math.random() * .4, col }); };
  const FIELD_DONE = { cure: 'New treatment', diag: 'New diagnosis equipment' };
  function onEvent(e) {
    const mine = e.p === ME;
    switch (e.k) {
      case 'cured':
        if (mine) toast(e.refuse ? `${e.nm} was cured of ${dname(e.dis)} but refused to pay: too expensive!` : `${e.nm} cured of ${dname(e.dis)} · +${money(e.fee)}`, e.refuse ? 'bad' : 'good');
        floaters.push({ p: e.p, x: e.x, y: e.y, txt: e.refuse ? 'no pay!' : '+' + money(e.fee), col: e.refuse ? '#ff6b57' : '#ffe36b', life: 1.6, big: true });
        burst(e.p, e.x, e.y, '#ffe36b', 8); break;
      case 'died':
        if (mine) toast(`${e.nm} died of ${dname(e.dis)} · reputation −12`, 'bad');
        ghosts.push({ p: e.p, x: e.x, y: e.y, life: 2.2 }); break;
      case 'uncured': if (mine) toast(`${e.nm}'s treatment for ${dname(e.dis)} didn't work: back to the GP`, 'dim'); break;
      case 'angry':
        if (mine) toast(`${e.nm} stormed out after waiting too long · reputation −3`, 'bad');
        floaters.push({ p: e.p, x: e.x, y: e.y, txt: '!!', col: '#ff6b57', life: 1.2 }); break;
      case 'home': if (mine) toast(e.why === 'diag' ? `${e.nm} sent home: diagnosis too uncertain` : e.why === 'nocure' ? `${e.nm} sent home: no ${rname(RH.DISEASES[e.dis].room)} for ${dname(e.dis)}` : `${e.nm} went home`, 'dim'); break;
      case 'nogp': if (mine) toast(`${e.nm} left: there's no GP's Office!`, 'bad'); break;
      case 'crowd': if (mine) toast(`${e.nm} turned away: every GP queue is full`, 'dim'); break;
      case 'diag': { const pos = curPosOf('p' + e.id); if (pos) floaters.push({ p: e.p, x: pos[0], y: pos[1], txt: dname(e.dis), col: '#fff6e0', life: 1.4 }); break; }
      case 'newdis': if (mine) { toast(`New disease discovered: ${dname(e.dis)}. It's in the Casebook.`, 'good'); flashBtn('caseBtn'); } break;
      case 'vomit': if (mine) toast(`${e.nm} was sick in the corridor`, 'dim'); floaters.push({ p: e.p, x: e.x, y: e.y, txt: 'bleurgh', col: '#b5d86a', life: 1.4 }); break;
      case 'wet': if (mine) toast(`${e.nm} couldn't find a toilet…`, 'bad'); floaters.push({ p: e.p, x: e.x, y: e.y, txt: 'oops', col: '#ecce48', life: 1.4 }); break;
      case 'cleaned': burst(e.p, e.x, e.y, '#9fd8ff', 6, 2); break;
      case 'repaired': if (mine) toast(`Machine repaired · strength now ${e.str}`, 'dim'); break;
      case 'boom': {
        if (mine) toast(`BOOM! The ${rname(e.kind)} machine exploded. Everyone inside died and the room is wrecked.`, 'bad');
        const cx = RH.slotCx(e.slot), cy = RH.slotY0(e.slot) * T + 32;
        for (let i = 0; i < 40; i++) sparks.push({ p: e.p, x: cx + (Math.random() - .5) * 40, y: cy + (Math.random() - .5) * 40, z: Math.random() * 30, vx: (Math.random() - .5) * 90, vy: (Math.random() - .5) * 90, life: .6 + Math.random() * .8, col: ['#ffd23f', '#ff6b57', '#f4f0e6', '#5a5246'][i % 4] });
        if (e.p === tab) { shake = 1.2; flash = { life: 0.4 }; }
        break;
      }
      case 'replaced': if (mine) toast(`New ${rname(e.kind)} machine installed`, 'dim'); break;
      case 'research':
        if (mine) {
          const W = { drugs: 'Drug research improved your medicines', strength: 'Improvements: every machine is stronger', cheaper: 'Improvements: rooms are now cheaper to build', spec: 'Specialisation research paid off', computer: 'Research computers installed: research is faster', atom: 'Atom analyser installed: research is faster' };
          toast(W[e.what] || `${FIELD_DONE[e.f] || 'Research'}: ${RH.ROOMS[e.what] ? rname(e.what) : e.what} is now available`, 'good'); flashBtn('resBtn');
        }
        break;
      case 'promoted': if (mine) toast(`${e.nm} is now a ${e.rank}`, 'good'); break;
      case 'qual': if (mine) toast(`${e.nm} qualified as a ${RH.QUAL_NAME[e.q]}`, 'good'); break;
      case 'decor': if (!mine) toast(`${nameOf(e.p)} added a ${RH.DECOR[e.kind].name.toLowerCase()}`, 'dim'); break;
      case 'month': if (mine) { const f = e.fin || {}; let inc = 0, out = 0; for (const k in f) { if (f[k] > 0) inc += f[k]; else out -= f[k]; } toast(`${RH.MONTH_NAMES[(e.m - 1) % 12]}: in ${money(inc)} · out ${money(out)}`, inc >= out ? 'dim' : 'bad'); } break;
      case 'pool': if (staffTab !== 'pay') lastPoolKey = ''; break;
      case 'built': if (!mine) toast(`${nameOf(e.p)} built a ${rname(e.kind)}`, 'dim'); break;
      case 'desk': if (mine) toast('Reception desk installed. Now hire a receptionist under Staff.', 'good'); break;
      case 'open': if (!mine) toast(`${nameOf(e.p)} has opened the doors`, 'dim'); else toast('The doors are open!', 'good'); break;
      case 'profile': hudKey = ''; statusKey = ''; setStatus(); break;
      case 'hired': if (mine) toast(`Hired ${e.nm}`, 'dim'); else toast(`${nameOf(e.p)} hired ${e.nm}`, 'dim'); break;
      case 'fired': if (mine) toast(`${e.nm} has been let go`, 'dim'); break;
      case 'resigned': if (mine) toast(`${e.nm} resigned and walked out`, 'bad'); break;
      case 'raise': if (mine) toast(`${e.nm} got a raise: ${money(e.sal)}/month`, 'dim'); break;
      case 'bonus': if (mine) toast(`${e.nm} is delighted with the bonus`, 'dim'); break;
      case 'razed': if (mine) toast(`Demolished the ${rname(e.kind)} · 40% refunded`, 'dim'); break;
      case 'emStart': if (mine) toast(`Emergency! ${e.n} patients with ${dname(e.dis)} are on their way`, 'bad'); break;
      case 'emEnd': if (mine) toast(e.pay ? `Emergency over: ${e.saved}/${e.n} saved · bonus ${money(e.pay)}` : `Emergency over: only ${e.saved}/${e.n} saved, no bonus`, e.pay ? 'good' : 'bad'); break;
      case 'vipIn': if (mine) toast(`${cap(e.who)} has arrived for a tour`, 'dim'); break;
      case 'vipSurprise': if (mine) toast('You refused too many VIPs: this one turned up unannounced!', 'bad'); break;
      case 'vipOut': if (mine) toast(`${cap(e.who)} thought your hospital was ${e.grade}` + (e.cash ? ` · +${money(e.cash)}` : '') + ` · reputation ${e.rep > 0 ? '+' : ''}${e.rep}`, e.rep > 0 ? 'good' : 'bad'); break;
      case 'epi': if (mine) toast(`Epidemic of ${dname(e.dis)}! ${e.n} patients are infected`, 'bad'); break;
      case 'epiCover': if (mine) toast('Cover-up: tap infected patients to have a nurse vaccinate them, and cure them before the inspector arrives', 'dim'); break;
      case 'epiDeclare': if (mine) toast('Epidemic declared: everyone vaccinated · fined $3,000 and reputation −20', 'bad'); break;
      case 'inspector': if (mine) toast('The health inspector is here!', 'bad'); break;
      case 'epiEnd': if (mine) toast(e.left ? `The inspector found ${e.left} infected patient${e.left > 1 ? 's' : ''}: fined ${money(1000 * e.left)}` : 'The inspector found nothing: +$2,000 and reputation +15', e.left ? 'bad' : 'good'); break;
      case 'rat': if (mine) toast('A rat! Tap it to shoot it', 'dim'); break;
      case 'shot': burst(e.p, e.x, e.y, '#c88a8a', 6, 2); break;
      case 'autopsy': if (mine) toast(`${e.nm} went to the Auto-Autopsy: research boosted, reputation −8`, 'dim'); break;
      case 'boiler': if (mine) toast('The boiler has broken down! The heating swings hot and cold. Hire more handymen.', 'bad'); break;
      case 'tremor': toast('A small tremor… a big earthquake is on its way. Replace worn machines!', 'bad'); shake = 0.6; break;
      case 'quake': toast(e.big ? 'A big earthquake! Every machine took a beating' : 'An earthquake! Every machine took a beating', 'bad'); shake = 2.5; break;
      case 'awards': setTimeout(() => openStatus(true), 600); break;
      case 'start': floaters.length = ghosts.length = sparks.length = 0; $('over').hidden = true; $('legend').hidden = true; closeSheets(); break;
      case 'over': setTimeout(showOver, 800); break;
    }
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function flashBtn(id) { const b = $(id); b.classList.add('flash'); }
  function curPosOf(key) {
    if (!host) return curPos.get(key);
    const id = +key.slice(1);
    for (const h of state.h) { const e = key[0] === 'p' ? RH.patById(h, id) : RH.staffById(h, id); if (e) return [e.x, e.y]; }
    return null;
  }

  // ============================ HUD, advisor, phases ============================
  let hudKey = '';
  function renderHud() {
    if (!view) return;
    const h = view.h[ME], r = view.h[FRIEND];
    const key = [view.ph, view.month, h.cash, h.rep, h.cured, r.cash, r.rep, tab, nameOf(ME), nameOf(FRIEND), h.open].join('|');
    if (key === hudKey) return; hudKey = key;
    const ym = RH.yearMonth(Math.min(view.month, RH.MONTHS - 1));
    $('hudDate').innerHTML = (view.ph === 'ready' ? '<small>Opening</small>soon' : `<small>Year ${ym.year}</small>${RH.MONTH_NAMES[ym.month]}`) + '<i class="mp"><b id="monthBar"></b></i>';
    $('hudCash').textContent = money(h.cash); $('hudCash').classList.toggle('neg', h.cash < 0);
    $('hudRep').textContent = h.rep; $('hudRepBar').style.width = h.rep / 10 + '%';
    $('hudCured').textContent = h.cured + (h.seen ? ` · ${RH.curePct(h)}%` : '');
    $('tabMine').replaceChildren(document.createTextNode(`${nameOf(ME)}'s`), Object.assign(el('span', 'alt'), { textContent: ' hospital' }));
    $('tabRival').replaceChildren(document.createTextNode(`${nameOf(FRIEND)}'s `), Object.assign(el('small'), { textContent: `· ${money(r.cash)} · ${r.rep}` }));
    $('openBtn').hidden = !(view.ph === 'play' && !h.open && view.t < RH.GRACE && tab === ME);
  }
  let lastMonthPct = -1;
  function monthBar(now) {
    const e = document.getElementById('monthBar'); if (!e || !view) return;
    const t = view.ph === 'play' ? view.t + (host ? 0 : Math.min(1, (now - curAt) / 1000)) : 0;
    const pct = Math.round(((t % RH.MONTH) / RH.MONTH) * 100);
    if (pct !== lastMonthPct) { lastMonthPct = pct; e.style.width = pct + '%'; }
    if (!$('openBtn').hidden) $('openBtn').textContent = `Open the doors · ${Math.max(0, Math.ceil(RH.GRACE - view.t))}s`;
  }
  let statusKey = '', barH = 0, hoverTxt = '', advisorOff = false;
  function placeStatus() { const hgt = document.querySelector('.bar').offsetHeight; if (hgt !== barH) { barH = hgt; document.documentElement.style.setProperty('--barh', hgt + 'px'); } }
  const needWord = k => ({ doc: 'doctor', psy: 'psychiatrist', surg: 'surgeon', res: 'researcher', con: 'consultant to teach', nurse: 'nurse' })[RH.ROOMS[k].staff];
  function advice() {
    if (mismatch) return [mismatchText(), 'warn'];
    if (!room.connected) return ['Waiting for your friend to join…' + (view && view.ph === 'play' ? ' (paused)' : '')];
    if (!view) return ['Syncing…'];
    if (view.ph === 'ready') return [host ? 'Press “Start the match” when you\'re both ready.' : 'Waiting for the host to start the match…'];
    if (view.ph === 'over') return ['Game over. ' + (host ? 'Press Play again for a rematch.' : 'Ask the host for a rematch.')];
    if (tab !== ME) return [`Peeking at ${nameOf(FRIEND)}'s hospital. Tap a room to see what they have.`];
    if (hoverTxt) return [hoverTxt, 'info'];
    const h = view.h[ME], rooms = Object.entries(h.rooms).filter(([, r]) => !r.wreck), live = h.staff.filter(s => !s.gone);
    if (!h.desk) return ['Tap the dashed outline by the entrance to buy a reception desk ($150). Without one, no patients come.', 'warn'];
    if (!live.some(s => s.k === 'r')) return ['Hire a receptionist under Staff. Without one, no patients come.', 'warn'];
    if (!rooms.some(([, r]) => r.k === 'gp')) return ['Build a GP\'s Office: every patient starts there. Tap an empty lot.', 'warn'];
    if (h.epi && h.epi.phase === 'cover') return [`Cover-up! Tap patients with the bug icon to vaccinate them, then cure them. Inspector arrives in ${Math.max(0, Math.round(h.epi.t - view.t))}s`, 'warn'];
    if (h.em) return [`Emergency: ${h.em.saved}/${h.em.n} with ${dname(h.em.dis)} cured · ${Math.max(0, Math.round(h.em.end - view.t))}s left`, 'warn'];
    const smoking = rooms.find(([, r]) => RH.ROOMS[r.k].mach && r.used > r.str);
    if (smoking) return [`The ${rname(smoking[1].k)} machine is smoking! Get a handyman to repair it or replace it before it explodes.`, 'warn'];
    const unst = rooms.find(([, r]) => r.bt <= 0 && RH.capacity(r) && r.sts.length < (RH.ROOMS[r.k].need || 1));
    if (unst) return [`Your ${rname(unst[1].k)} needs a ${needWord(unst[1].k)}. Hire one under Staff.`, 'warn'];
    if (!h.open && view.t < RH.GRACE) return [`Patients start arriving in ${Math.ceil(RH.GRACE - view.t)}s. Build and hire now, or open the doors early.`];
    if (h.mess.length >= 4 && !live.some(x => x.k === 'h')) return [`${h.mess.length} messes on the floor and nobody to clean them. Hire a handyman.`, 'warn'];
    if (h.warm < 0.6) return ['Brrr! The hospital is cold. Add radiators in the corridors or turn up the heating in Policy.', 'warn'];
    if (h.warm > 1.6) return ['It\'s sweltering in here. Turn the heating down in Policy.', 'warn'];
    if (!rooms.some(([, r]) => r.k === 'staff') && live.some(s => s.tired > 0.6)) return ['Your staff are worn out. Build a Staff Room so they can rest.', 'warn'];
    if (!rooms.some(([, r]) => r.k === 'toilet') && view.month >= 1) return ['Patients need Toilets, or they\'ll have accidents in the corridor.'];
    if (live.some(s => s.hap < 0.3)) return ['Some staff are unhappy. Pay at least the fair wage, give bonuses, or let them rest.', 'warn'];
    if (h.fax.length) return ['You have faxes waiting at the bottom left.'];
    if (!rooms.some(([, r]) => r.k !== 'gp' && RH.ROOMS[r.k].cat !== 'fac')) return ['Build a Pharmacy and a General Diagnosis room next.'];
    if (!rooms.some(([, r]) => r.k === 'research')) return ['A Research Dept. (with a Researcher doctor) unlocks new rooms and better drugs.'];
    return ['Tap a lot to build · tap the corridor to place objects · tap people for details · F1–F8 for screens'];
  }
  function setStatus() {
    placeStatus();
    const [s, cls] = advice();
    const key = s + (cls || '') + advisorOff;
    if (key !== statusKey) { statusKey = key; $('status').textContent = s; $('status').classList.toggle('warn', cls === 'warn'); $('status').classList.toggle('info', cls === 'info'); }
    $('status').hidden = advisorOff;
    if (host) { $('startBtn').disabled = !room.connected; $('startBtn').hidden = !(view && view.ph === 'ready'); }
  }
  function onPhase() {
    if (!view) return;
    setStatus();
    if (view.ph !== lastPhase) {
      if (view.ph === 'ready' && lastPhase === null && profile) $('legend').hidden = false;
      if (view.ph === 'over' && lastPhase === null) showOver();
      if (view.ph === 'play' && lastPhase === 'ready') $('legend').hidden = true;
      lastPhase = view.ph;
    }
  }

  // ============================ faxes ============================
  const FAX_ICON = { diag: '?', nocure: '✚', raise: '$', emerg: '!', vip: '★', epi: '☣' };
  const FAX_LEN = { raise: RH.MONTH, diag: 25, nocure: 25 };
  let faxKey = '', openFax = null;
  function faxTitle(f) {
    switch (f.k) {
      case 'diag': return [`${f.nm}: diagnosis ${f.dg}%`, 'Guess at a cure?'];
      case 'nocure': return [`${f.nm}: no cure room`, dname(f.dis)];
      case 'raise': return [`${f.nm} wants a raise`, `${money(f.ask)}/month`];
      case 'emerg': return ['Emergency!', `${f.n} × ${dname(f.dis)}`];
      case 'vip': return ['VIP visit request', cap(f.who)];
      case 'epi': return ['Epidemic!', `${f.n} × ${dname(f.dis)}`];
    }
    return ['Fax', ''];
  }
  function renderFaxes() {
    if (!view) return;
    const h = view.h[ME], list = view.ph === 'play' ? h.fax || [] : [];
    const key = list.map(f => f.id).join(',') + '|' + Math.floor(view.t);
    if (key === faxKey) return; faxKey = key;
    const wrap = $('faxes'); wrap.replaceChildren();
    for (const f of list) {
      const [a, b] = faxTitle(f), left = Math.max(0, f.t - view.t), len = FAX_LEN[f.k] || 30;
      const bt = el('button', 'faxbtn' + (left < 8 ? ' urgent' : ''));
      const ico = el('span', 'ico', FAX_ICON[f.k] || '✉'); bt.append(ico, el('span', null, a), el('small', null, b + ` · ${Math.ceil(left)}s`));
      const tm = el('span', 'tm'), ti = el('i'); ti.style.width = clamp(left / len, 0, 1) * 100 + '%'; tm.append(ti); bt.append(tm);
      bt.addEventListener('click', () => showFax(f.id));
      wrap.append(bt);
    }
    if (openFax != null && !list.some(f => f.id === openFax)) { $('faxSheet').hidden = true; openFax = null; }
  }
  function showFax(id) {
    const h = view.h[ME], f = (h.fax || []).find(x => x.id === id); if (!f) return;
    openFax = id;
    const body = $('faxBody'); body.replaceChildren();
    const P = t => el('p', null, t), opts = el('div', 'opts');
    const opt = (label, c, primary) => opts.append(btn(label, 'pt-btn' + (primary ? '' : ' pt-btn-ghost'), () => { act('fax', { id, c }); $('faxSheet').hidden = true; openFax = null; }));
    const pol = h.pol || { guess: 85, home: 40 };
    switch (f.k) {
      case 'diag': {
        const d = RH.DISEASES[f.dis];
        body.append(el('h3', null, `Patient: ${f.nm}`), P(`Your doctors are only ${f.dg}% sure what's wrong, and there are no more diagnosis rooms to try. (Policy: send home below ${pol.home}%, cure above ${pol.guess}%.)`), P(`Best guess: ${d.name}. The odds of a cure are roughly ${f.dg}%; a failed cure for a serious disease is fatal.`));
        opt(`Guess at the cure (${f.dg}% odds)`, 'guess', true); opt('Wait while you build more diagnosis rooms', 'wait'); opt('Send them home', 'home');
        if (view.h[ME].rooms && Object.values(view.h[ME].rooms).some(r => r.k === 'research' && !r.wreck)) opt('Auto-Autopsy (research boost, reputation −8)', 'autopsy');
        break;
      }
      case 'nocure': {
        const d = RH.DISEASES[f.dis], rk = d.room;
        const locked = !RH.unlocked(view.h[ME], rk);
        body.append(el('h3', null, `Patient: ${f.nm}`), P(`Diagnosed with ${d.name}. It's cured in a ${rname(rk)}${rk === 'op' ? ' (after a stay in a Ward)' : ''}, which you don't have.` + (locked ? ' You need to research it first (Cure Equipment).' : '')));
        opt('Wait while you build one', 'wait', !locked); opt('Send them home', 'home', locked);
        if (Object.values(view.h[ME].rooms).some(r => r.k === 'research' && !r.wreck)) opt('Auto-Autopsy (research boost, reputation −8)', 'autopsy');
        break;
      }
      case 'raise': {
        const st = view.h[ME].staff.find(s => s.id === f.sid);
        body.append(el('h3', null, `${f.nm} is fed up`), P(`They want ${money(f.ask)} a month` + (st ? ` (now ${money(st.sal)}, fair wage ${money(RH.fairWage(st))})` : '') + '. Refuse or ignore this and they walk out at the end of next month.'));
        opt(`Pay the raise (${money(f.ask)}/month)`, 'pay', true); opt('Refuse', 'ignore'); opt('Sack them now', 'sack');
        break;
      }
      case 'emerg': {
        const d = RH.DISEASES[f.dis];
        body.append(el('h3', null, 'EMERGENCY'), P(`After ${f.what}, ${f.n} patients with ${d.name} need urgent treatment in a ${rname(d.room)}${d.room === 'op' ? ' (after a Ward)' : ''}. Time limit: ${f.limit} seconds.`), P(`Bonus if you save at least half: up to ${money(f.bonus)}. They skip diagnosis. Anyone not cured in time dies, and counts against you.`), P(f.has ? 'You have the facilities.' : 'You do NOT have the facilities right now.'));
        opt('Accept', 'accept', f.has); opt('Decline', 'decline', !f.has);
        break;
      }
      case 'vip':
        body.append(el('h3', null, 'VIP visit'), P(`${cap(f.who)} would like to tour your hospital. VIPs check cleanliness, warmth, drinks, fire extinguishers, toilets, staff morale and skill, and any deaths or explosions.`), P('A good visit pays $800–4,000 and lifts your reputation; a bad one costs reputation. Refuse too often and one turns up unannounced.'));
        opt('Accept', 'accept', true); opt('Decline', 'decline');
        break;
      case 'epi':
        body.append(el('h3', null, 'EPIDEMIC'), P(`${f.n} patients have contagious ${dname(f.dis)}.`), P('Declare it: everyone is vaccinated, but you are fined $3,000 and lose reputation. Cover it up: tap infected patients (bug icon) so a nurse vaccinates them, and cure them before the health inspector arrives in 75 seconds. Each infected patient he finds costs $1,000; none at all earns $2,000 and reputation.'));
        opt('Cover it up', 'cover', true); opt('Declare it', 'declare');
        break;
    }
    body.append(opts);
    closeSheets(); $('faxSheet').hidden = false;
  }
  $('faxClose').addEventListener('click', () => { $('faxSheet').hidden = true; openFax = null; });

  // ============================ sheets ============================
  const sheets = ['legend', 'buildSheet', 'roomSheet', 'staffSheet', 'over', 'profile', 'decorSheet', 'caseSheet', 'polSheet', 'resSheet', 'bankSheet', 'statSheet', 'faxSheet'];
  const panelOpen = () => sheets.some(id => !$(id).hidden);
  function closeSheets() { for (const id of sheets) if (id !== 'legend' && id !== 'over') $(id).hidden = true; openSlot = null; openFax = null; }
  let openSlot = null, razeArmed = false;
  let fireArmed = null;        // { id, at }: a Fire button waiting for its confirming second tap
  const FIRE_ARM_MS = 2500;
  const errFor = id => { $(id).textContent = lastErr && performance.now() - lastErr.at < 4000 ? lastErr.m : ''; };
  const staffKind = s => (s.k === 'd' && RH.hasQ(s, 's') ? 's' : s.k);
  function spriteCanvas(sheet, px) { const c = document.createElement('canvas'); c.width = Math.round(16 * px / 24); c.height = px; c.style.width = c.width + 'px'; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(sheet.down[0], 0, 0, c.width, c.height); return c; }
  const staffSprite = s => spriteCanvas(HA.staffSheet(s.look, staffKind(s)), 33);
  const patVis = i => RH.DISEASES[i].vis || '';
  function quals(s) {
    const f = document.createDocumentFragment();
    if (s.k !== 'd') return f;
    const rk = RH.rank(s); f.append(el('span', 'q c', rk));
    for (const q of ['r', 'p', 's']) if (RH.hasQ(s, q)) f.append(el('span', 'q ' + q, RH.QUAL_NAME[q]));
    else if (s.q && s.q[q] > 0) f.append(el('span', 'q ' + q, `${RH.QUAL_NAME[q]} ${Math.round(100 * s.q[q] / RH.QUAL_PTS[q])}%`));
    return f;
  }
  const skillTxt = s => (s.k === 'd' ? `skill ${Math.round(s.sk * 1000)}` : `ability ${Math.round(s.sk * 100)}%`);

  // ---- build ----
  let buildCat = 'diag';
  function openBuild(k) { openSlot = k; razeArmed = false; lastErr = null; $('buildSheet').hidden = false; $('buildList').dataset.key = ''; refreshBuild(); }
  function refreshBuild() {
    if ($('buildSheet').hidden || !view) return;
    const h = view.h[ME];
    if (h.rooms[openSlot] || view.ph !== 'play') { $('buildSheet').hidden = true; return; }
    $('buildSub').textContent = `Lot ${openSlot + 1} · you have ${money(h.cash)}`;
    const cats = $('buildCats');
    if (!cats.children.length) for (const [c, nm] of RH.CATS) cats.append(btn(nm, '', () => { buildCat = c; $('buildList').dataset.key = ''; [...cats.children].forEach(b => b.classList.toggle('on', b.dataset.c === buildCat)); refreshBuild(); }));
    [...cats.children].forEach((b, i) => { b.dataset.c = RH.CATS[i][0]; b.classList.toggle('on', b.dataset.c === buildCat); });
    // Rebuilt only when what it shows changes: replacing a button mid-press swallows the click.
    const list = $('buildList');
    const kinds = RH.ROOM_ORDER.filter(k => (RH.ROOMS[k].cat === 'treat' && buildCat === 'treat') || RH.ROOMS[k].cat === buildCat);
    const key = [openSlot, buildCat].concat(kinds.map(k => (RH.unlocked(h, k) ? 1 : 0) + (h.cash < RH.roomCost(h, k) ? 0 : 2))).join('|');
    if (list.dataset.key !== key) {
      list.dataset.key = key; list.replaceChildren();
      for (const kind of kinds) {
        const R = RH.ROOMS[kind], open = RH.unlocked(h, kind), cost = RH.roomCost(h, kind);
        const cures = RH.DISEASES.filter(d => d.room === kind).map(d => d.name);
        const b = el('button', 'item room' + (open ? '' : ' locked')); b.disabled = !open || h.cash < cost;
        const body = el('div');
        let what = '';
        if (kind === 'gp') what = 'First diagnosis for every patient. Consultants diagnose most cases in one visit.';
        else if (R.cat === 'diag') what = `Adds to the diagnosis % (finds ${R.det.split(' ').map(g => ({ pharm: 'drug', psych: 'mental', clinic: 'clinic', op: 'surgical' })[g]).join(', ')} illnesses). Fee ${money(R.fee)}.`;
        else if (kind === 'ward') what = 'Diagnoses, and prepares patients for surgery. More beds, faster stays.';
        else if (kind === 'psych') what = 'Diagnoses and cures mental illness: ' + cures.join(', ') + '.';
        else if (kind === 'staff') what = 'Tired staff rest here: one sofa each.';
        else if (kind === 'toilet') what = 'One patient per cubicle. Drinks and some illnesses send people often.';
        else if (kind === 'research') what = 'Researchers unlock rooms, improve drugs and machines. One desk per researcher.';
        else if (kind === 'training') what = 'A consultant teaches students skill and their qualifications.';
        else what = 'Cures ' + (cures.join(', ') || '—') + '.';
        const need = R.staff ? ` Needs ${R.need ? 'two surgeons' : 'a ' + needWord(kind)}.` : '';
        const mach = R.mach ? ` Machine strength ${RH.machStr(h, kind)}.` : '';
        body.append(el('b', null, R.name), el('small', null, open ? what + need + mach : `Not researched yet (${RH.RESEARCH.cure.list.includes(kind) ? 'Cure' : 'Diagnosis'} Equipment). ` + what));
        b.append(body, el('span', 'price', money(cost)));
        b.addEventListener('click', () => { act('build', { slot: openSlot, kind }); $('buildSheet').hidden = true; });
        list.append(b);
      }
    }
    errFor('buildErr');
  }

  // ---- a room ----
  function openRoom(k) { openSlot = k; razeArmed = false; lastErr = null; $('roomSheet').hidden = false; $('roomSheet').dataset.key = ''; refreshRoom(); }
  function refreshRoom() {
    if ($('roomSheet').hidden || !view) return;
    const h = view.h[tab], r = h.rooms[openSlot];
    if (!r) { $('roomSheet').hidden = true; return; }
    const R = RH.ROOMS[r.k], mine = tab === ME && view.ph === 'play';
    const sts = r.sts.map(id => h.staff.find(s => s.id === id)).filter(Boolean);
    const pt = r.p != null && h.pats ? h.pats.find(x => x.id === r.p) : null;
    const cands = mine && R.staff ? h.staff.filter(s => !s.gone && !r.sts.includes(s.id) && RH.eligible(s, r.k)).sort((a, b) => b.sk - a.sk).slice(0, 6) : [];
    const key = [tab, openSlot, r.k, r.bt > 0 ? 1 : 0, r.wreck, r.n, qn(r), un(r), r.str, r.used, JSON.stringify(r.ex), sts.map(s => `${s.id}:${Math.round(s.tired * 10)}:${Math.round(s.hap * 10)}`).join(','),
      pt ? `${pt.id}:${Math.round(r.prog * 20)}` : '', mine, razeArmed, Math.floor(h.cash / 500), cands.map(c => c.id).join(',')].join('|');
    if ($('roomSheet').dataset.key === key) { errFor('roomErr'); return; }
    $('roomSheet').dataset.key = key;
    $('roomTitle').textContent = R.name + (tab !== ME ? ' (rival)' : '');
    $('roomSub').textContent = r.wreck ? 'Wrecked by an exploding machine. It can never be used, edited or demolished.' : r.bt > 0 ? 'Under construction…' : `Lot ${openSlot + 1} · ${r.n} patient${r.n === 1 ? '' : 's'} seen · ${qn(r)} waiting`;
    const info = $('roomInfo'); info.replaceChildren();
    const row = (icon, title, sub, right) => { const it = el('div', 'item'); it.append(icon || el('span', null, ''), (() => { const b = el('div'); b.append(el('b', null, title)); if (sub) b.append(sub instanceof Node ? sub : el('small', null, sub)); return b; })(), right || el('span')); info.append(it); return it; };
    if (!r.wreck) {
      for (const s of sts) {
        const sub = el('small'); sub.append(skillTxt(s) + ' · tired', meter(s.tired, s.tired > 0.7 ? 'bad' : s.tired > 0.4 ? 'warn' : ''), 'happy', meter(s.hap, s.hap < 0.3 ? 'bad' : s.hap < 0.5 ? 'warn' : ''));
        const t = el('div'); t.append(el('b', null, s.nm), quals(s)); const it = el('div', 'item'); it.append(staffSprite(s), (() => { const b = el('div'); b.append(t, sub); return b; })(), el('span')); info.append(it);
      }
      if (R.staff && sts.length < RH.capacity(r)) row(el('span', null, '—'), r.k === 'research' ? `${sts.length}/${RH.capacity(r)} researchers` : 'Nobody working here' + (R.need && sts.length ? ' (needs two)' : ''), `Needs a ${needWord(r.k)}${r.k === 'research' ? ' per desk' : ''}. Hire one under Staff${cands.length ? ' or move one in below' : ''}.`);
      if (r.k === 'staff') row(el('span', null, '☕'), `${un(r)}/${r.ex.seat || 0} sofas in use`, `Staff rest here when tiredness reaches ${view.h[ME].pol ? view.h[ME].pol.rest : 60}% (Policy).`);
      if (r.k === 'toilet') row(el('span', null, '🚻'), `${un(r)}/${r.ex.cub || 0} cubicles in use`, 'Patients nip in while they queue and keep their place.');
      if (r.k === 'training') row(el('span', null, '🎓'), `${un(r)}/${r.ex.chair || 0} students`, 'Tick “Train” on a doctor in the Staff screen to send them. Students can\'t pass the teacher\'s skill.');
      if (pt) row(spriteCanvas(HA.patientSheet(pt.look, patVis(pt.dis)), 33), pt.nm, (pt.dx ? (R.cat === 'diag' || r.k === 'ward' && !pt.dx ? 'Diagnosing ' : 'Treating ') + dname(pt.dis) : `Diagnosing · ${Math.round(pt.dg * 100)}% so far`) + ` · ${Math.round(r.prog * 100)}%`);
      if (R.mach) {
        const left = r.str - r.used, sub = el('small');
        sub.append(`Strength ${r.str} · used ${r.used} times · `, left > 0 ? `${left} uses left` : el('b', 'bad', 'SMOKING'), meter(left / Math.max(1, r.str), left <= 2 ? 'bad' : left <= 4 ? 'warn' : ''));
        const cost = Math.round(R.cost * 0.5);
        row(el('span', null, '⚙'), 'Machine', sub, mine ? btn(`Replace ${money(cost)}`, 'pt-btn pt-btn-small pt-btn-ghost', () => act('replace', { slot: openSlot }), h.cash < cost) : null);
      }
      const cures = RH.DISEASES.filter(d => d.room === r.k);
      if (cures.length) row(el('span', null, '✚'), 'Cures', cures.map(d => d.name).join(', '));
      else if (R.fee) row(el('span', null, '?'), 'Diagnosis', `Fee ${money(RH.diagFee(h.price ? h : view.h[ME], r.k))} per visit.`);
    }
    // extras (the till)
    const exWrap = $('roomExtras'); exWrap.replaceChildren();
    const exKinds = r.wreck || r.bt > 0 ? [] : RH.extrasFor(r.k);
    $('roomExtrasWrap').hidden = !exKinds.length || !mine;
    for (const e of exKinds) {
      const E = RH.EXTRAS[e], have = (r.ex && r.ex[e]) || 0;
      const b = el('button', 'item room'); b.disabled = !mine || have >= E.max || h.cash < E.cost;
      const body = el('div'); body.append(el('b', null, `${E.name} ${have}/${E.max}`), el('small', null, E.desc));
      b.append(body, el('span', 'price', have >= E.max ? 'full' : money(E.cost)));
      b.addEventListener('click', () => act('extra', { slot: openSlot, e }));
      exWrap.append(b);
    }
    const asg = $('roomAssign'); asg.replaceChildren();
    $('roomAssignWrap').hidden = !cands.length || r.wreck || r.bt > 0;
    for (const s of cands) {
      const it = el('div', 'item'), t = el('div'); t.append(el('b', null, s.nm), quals(s));
      const where = s.desk ? 'reception' : s.slot != null && h.rooms[s.slot] ? rname(h.rooms[s.slot].k) : s.mode === 'rest' ? 'resting' : s.mode === 'train' ? 'training' : 'idle';
      const b2 = el('div'); b2.append(t, el('small', null, `${skillTxt(s)} · ${where}`));
      it.append(staffSprite(s), b2, btn('Move here', 'pt-btn pt-btn-small', () => act('place', { id: s.id, slot: openSlot })));
      asg.append(it);
    }
    $('roomRaze').hidden = !mine || r.wreck;
    $('roomRaze').textContent = razeArmed ? `Really demolish? +${money(R.cost * 0.4)}` : 'Demolish';
    $('roomNote').textContent = mine && !r.wreck ? 'Demolishing refunds 40% of the cost.' : '';
    errFor('roomErr');
  }
  $('roomRaze').addEventListener('click', () => { if (!razeArmed) { razeArmed = true; $('roomSheet').dataset.key = ''; refreshRoom(); return; } act('raze', { slot: openSlot }); $('roomSheet').hidden = true; });

  // ---- corridor objects & the reception desk ----
  let decorSpotSel = null;
  function openDecor(c, r) {
    decorSpotSel = [c, r]; lastErr = null; $('decorErr').textContent = '';
    const h = view.h[ME];
    $('decorTitle').textContent = 'Corridor objects';
    $('decorSub').textContent = `Comfort ${h.comfort}/${RH.MAX_COMFORT} · warmth ${warmWord(h.warm)} · you have ${money(h.cash)}`;
    const list = $('decorList'); list.replaceChildren();
    for (const kind of RH.DECOR_ORDER) {
      const D = RH.DECOR[kind];
      const b = el('button', 'item room'); b.disabled = h.cash < D.cost;
      const body = el('div'); body.append(el('b', null, D.name), el('small', null, D.desc + (D.comfort ? ` Comfort +${D.comfort}.` : '')));
      b.append(body, el('span', 'price', money(D.cost)));
      b.addEventListener('click', () => { act('decor', { c, r, kind }); $('decorSheet').hidden = true; });
      list.append(b);
    }
    $('decorRemove').hidden = true;
    closeSheets(); $('decorSheet').hidden = false;
  }
  function openDecorInfo(c, r) {
    decorSpotSel = [c, r];
    const h = view.h[ME], kind = h.decor[RH.decorKey(c, r)]; if (!kind) return;
    $('decorTitle').textContent = RH.DECOR[kind].name;
    $('decorSub').textContent = RH.DECOR[kind].desc + (kind === 'plant' && h.dry && h.dry.includes(RH.decorKey(c, r)) ? ' This one has died: a handyman needs to water it.' : '');
    $('decorList').replaceChildren();
    $('decorRemove').hidden = view.ph !== 'play'; $('decorRemove').textContent = `Remove · +${money(RH.DECOR[kind].cost / 2)}`;
    $('decorErr').textContent = '';
    closeSheets(); $('decorSheet').hidden = false;
  }
  function openDesk() {
    const h = view.h[ME];
    decorSpotSel = null;
    $('decorTitle').textContent = 'Reception desk';
    const rc = h.staff.find(s => s.desk && !s.gone);
    $('decorSub').textContent = h.desk ? (rc ? `${rc.nm} is on the desk (ability ${Math.round(rc.sk * 100)}%). Receptionists never tire.` : 'No receptionist! Hire one under Staff.') : 'Every hospital needs a reception desk and a receptionist, or no patients come.';
    const list = $('decorList'); list.replaceChildren();
    if (!h.desk) {
      const b = el('button', 'item room'); b.disabled = h.cash < RH.DESK_COST || view.ph !== 'play';
      const body = el('div'); body.append(el('b', null, 'Buy the reception desk'), el('small', null, 'One receptionist works it.'));
      b.append(body, el('span', 'price', money(RH.DESK_COST)));
      b.addEventListener('click', () => { act('desk'); $('decorSheet').hidden = true; });
      list.append(b);
    }
    $('decorRemove').hidden = true;
    closeSheets(); $('decorSheet').hidden = false;
  }
  const warmWord = w => (w < 0.6 ? 'cold' : w > 1.6 ? 'too hot' : w > 1.2 ? 'warm' : 'comfortable');
  $('decorRemove').addEventListener('click', () => { if (decorSpotSel) act('undecor', { c: decorSpotSel[0], r: decorSpotSel[1] }); $('decorSheet').hidden = true; });
  $('decorClose').addEventListener('click', () => { $('decorSheet').hidden = true; });
  $('decorBtn').addEventListener('click', () => { if (tab !== ME) setTab(ME); decorHint = 6; toast('Tap one of the glowing corridor spots to place something', 'dim'); });

  // ---- staff ----
  let staffTab = 'd', lastPoolKey = '';
  const STAFF_TABS = [['d', 'Doctors'], ['n', 'Nurses'], ['h', 'Handymen'], ['r', 'Receptionists'], ['pay', 'On the payroll']];
  function openStaff(t) { if (t) staffTab = t; $('staffSheet').hidden = false; lastErr = null; fireArmed = null; lastPoolKey = ''; $('staffList').dataset.key = ''; refreshStaff(); }
  function refreshStaff() {
    if ($('staffSheet').hidden || !view) return;
    const h = view.h[ME], pool = view.pool || [];
    const tabs = $('staffTabs');
    if (!tabs.children.length) for (const [k, nm] of STAFF_TABS) { const b = btn(nm, '', () => { staffTab = k; lastPoolKey = ''; $('staffList').dataset.key = ''; refreshStaff(); }); b.dataset.k = k; tabs.append(b); }
    const live = h.staff.filter(s => !s.gone);
    [...tabs.children].forEach(b => { b.classList.toggle('on', b.dataset.k === staffTab); if (b.dataset.k === 'pay') b.textContent = `On the payroll (${live.length})`; });
    const hl = $('hireList'), sl = $('staffList');
    hl.hidden = staffTab === 'pay'; sl.hidden = staffTab !== 'pay';
    let bill = 0; for (const s of live) bill += s.sal;
    $('payroll').textContent = live.length ? `Wage bill ${money(bill)} a month` : '';
    if (staffTab !== 'pay') {
      const cands = pool.filter(c => c.k === staffTab);
      const key = [view.ph, staffTab].concat(cands.map(c => `${c.id}:${h.cash < c.sal ? 0 : 1}`)).join('|');
      if (key !== lastPoolKey) {
        lastPoolKey = key; hl.replaceChildren();
        for (const c of cands) {
          const b = el('button', 'item'); b.disabled = view.ph !== 'play' || h.cash < c.sal;
          b.append(spriteCanvas(HA.staffSheet(c.id % 8, staffKind(c)), 33));
          const t = el('div'); t.append(el('b', null, c.nm), quals(c));
          const what = c.k === 'h' ? 'Cleans, waters plants, repairs machines' : c.k === 'r' ? 'Works the reception desk' : c.k === 'n' ? 'Pharmacy, Ward, Fracture Clinic' : 'Any doctor\'s room';
          const body = el('div'); body.append(t, el('small', null, `${what} · `), el('span', 'skill', skillTxt(c)));
          b.append(body, el('span', 'price', money(c.sal) + '/mo'));
          b.addEventListener('click', () => act('hire', { id: c.id }));
          hl.append(b);
        }
        if (!cands.length) hl.append(el('small', null, 'Nobody of that kind is looking for work. New candidates arrive on the 1st of the month.'));
      }
    } else {
      if (fireArmed && performance.now() - fireArmed.at > FIRE_ARM_MS) fireArmed = null;
      const key = [view.ph, fireArmed ? fireArmed.id : '', Math.floor(h.cash / 200)].concat(live.map(s => `${s.id}:${s.slot}:${s.sal}:${s.mode}:${s.train}:${s.pri}:${Math.round(s.hap * 10)}:${Math.round(s.tired * 10)}:${Math.round(s.sk * 1000)}:${s.desk}`)).join('|');
      if (sl.dataset.key !== key) {
        sl.dataset.key = key; sl.replaceChildren();
        const order = { d: 0, n: 1, h: 2, r: 3 };
        for (const s of live.slice().sort((a, b) => order[a.k] - order[b.k] || b.sk - a.sk)) {
          const it = el('div', 'item'); it.append(staffSprite(s));
          const fair = RH.fairWage(s), under = s.sal < fair;
          const where = s.desk ? 'Reception desk' : s.slot != null && h.rooms[s.slot] ? rname(h.rooms[s.slot].k) : s.mode === 'rest' ? 'Resting in the staff room' : s.mode === 'train' ? 'In training' : s.k === 'h' ? 'Roaming the corridors' : s.train ? 'Waiting for a training place' : 'No room yet';
          const t = el('div'); t.append(el('b', null, s.nm), quals(s));
          const sub = el('small'); sub.append(`${where} · ${skillTxt(s)} · `, el('span', under ? 'bad' : '', `${money(s.sal)}/mo`), ` (fair ${money(fair)})`);
          const sub2 = el('small'); if (s.k !== 'r') sub2.append('tired', meter(s.tired, s.tired > 0.7 ? 'bad' : s.tired > 0.4 ? 'warn' : '')); sub2.append('happy', meter(s.hap, s.hap < 0.3 ? 'bad' : s.hap < 0.5 ? 'warn' : ''));
          if (s.quit) sub2.append(el('span', 'bad', ' · leaving at month end'));
          const body = el('div'); body.append(t, sub, sub2);
          const acts = el('div', 'acts'), dis = view.ph !== 'play';
          acts.append(btn(`Bonus ${money(Math.max(10, Math.round(s.sal * 1.2)))}`, 'pt-btn pt-btn-small pt-btn-ghost', () => act('pay', { id: s.id, kind: 'bonus' }), dis || h.cash < s.sal * 1.2));
          acts.append(btn('Raise 10%', 'pt-btn pt-btn-small pt-btn-ghost', () => act('pay', { id: s.id, kind: 'raise' }), dis));
          if (s.k === 'd' && !RH.isCon(s)) acts.append(btn(s.train ? 'Stop training' : 'Train', 'pt-btn pt-btn-small' + (s.train ? '' : ' pt-btn-ghost'), () => act('train', { id: s.id, on: !s.train }), dis));
          if (s.k === 'h') { const P = ['all', 'clean', 'repair', 'water'], L = { all: 'Does everything', clean: 'Mostly cleaning', repair: 'Mostly repairs', water: 'Mostly watering' }; acts.append(btn(L[s.pri || 'all'], 'pt-btn pt-btn-small pt-btn-ghost', () => act('pri', { id: s.id, pri: P[(P.indexOf(s.pri || 'all') + 1) % 4] }), dis)); }
          const armed = !!fireArmed && fireArmed.id === s.id;
          acts.append(btn(armed ? 'Sure?' : 'Fire', 'pt-btn pt-btn-small' + (armed ? '' : ' pt-btn-ghost'), () => {
            if (fireArmed && fireArmed.id === s.id) { fireArmed = null; act('fire', { id: s.id }); }
            else { fireArmed = { id: s.id, at: performance.now() }; setTimeout(() => { if (fireArmed && fireArmed.id === s.id) { fireArmed = null; refreshStaff(); } }, FIRE_ARM_MS + 50); }
            refreshStaff();
          }, dis));
          it.append(body, acts); sl.append(it);
        }
        if (!sl.children.length) sl.append(el('small', null, 'No staff yet.'));
      }
    }
    errFor('staffErr');
  }

  // ---- casebook ----
  function openCase() { $('caseSheet').hidden = false; $('caseBody').dataset.key = ''; $('caseBtn').classList.remove('flash'); lastErr = null; refreshCase(); }
  function refreshCase() {
    if ($('caseSheet').hidden || !view) return;
    const h = view.h[ME]; if (!h.price) return;
    const known = RH.DISEASES.map((d, i) => i).filter(i => h.known[i]);
    const key = [h.dprice, h.rep, h.res.spec].concat(known.map(i => `${i}:${h.price[i]}:${h.res.eff[i]}:${h.cb[i].join(',')}`)).join('|') + Object.keys(h.rooms).map(k => h.rooms[k].k).join();
    if ($('caseBody').dataset.key === key) { errFor('caseErr'); return; }
    $('caseBody').dataset.key = key;
    const body = $('caseBody'); body.replaceChildren();
    const stepper = (val, onDelta) => { const s = el('span', 'step'); s.append(btn('−', '', () => onDelta(-5)), el('b', null, val + '%'), btn('+', '', () => onDelta(5))); return s; };
    const dp = el('div', 'item'); dp.append(el('span', null, '?'), (() => { const b = el('div'); b.append(el('b', null, 'Diagnosis charges'), el('small', null, `GP ${money(RH.diagFee(h, 'gp'))} · General Diagnosis ${money(RH.diagFee(h, 'gendiag'))} · Scanner ${money(RH.diagFee(h, 'scanner'))}`)); return b; })(), stepper(h.dprice, d => act('price', { which: 'diag', pct: h.dprice + d })));
    body.append(dp);
    if (!known.length) { body.append(el('p', 'sub', 'No diseases discovered yet. They appear here once your doctors diagnose them.')); return; }
    const tb = el('table', 't'), hd = el('tr');
    for (const c of ['', 'Disease', 'Cure', 'Effect.', 'Charge', 'Fee', 'Cured / died', 'Earned', 'Improve']) hd.append(el('th', null, c));
    tb.append(hd);
    for (const i of known) {
      const d = RH.DISEASES[i], tr = el('tr', h.res.spec === i ? 'sel' : '');
      const td = (x, cls) => { const c = el('td', cls); if (x instanceof Node) c.append(x); else c.textContent = x; tr.append(c); return c; };
      td(spriteCanvas(HA.patientSheet(i % 8, d.vis), 24));
      const nm = el('div'); nm.append(el('b', null, d.name), el('br'), el('small', null, d.cause)); td(nm);
      const built = Object.values(h.rooms).some(r => r.k === d.room && !r.wreck), open = RH.unlocked(h, d.room);
      td(el('span', built ? 'ok' : open ? '' : 'bad', `${RH.ROOMS[d.room].short}${built ? ' ✓' : open ? '' : ' (research)'}`));
      td(d.grp === 'pharm' ? Math.round(h.res.eff[i] * 100) + '%' : RH.cureType(d), 'n');
      td(stepper(h.price[i], dd => act('price', { which: i, pct: h.price[i] + dd })), 'n');
      td(money(RH.cureFee(h, i)), 'n');
      td(`${h.cb[i][0]} / ${h.cb[i][1]}`, 'n');
      td(money(h.cb[i][2]), 'n');
      const canSpec = d.grp === 'pharm' ? h.res.eff[i] < 1 : !!RH.ROOMS[d.room].mach;
      td(canSpec ? btn(h.res.spec === i ? '★ on' : 'Improve', 'pt-btn pt-btn-small' + (h.res.spec === i ? '' : ' pt-btn-ghost'), () => act('research', { spec: h.res.spec === i ? -1 : i })) : '—');
      tb.append(tr);
    }
    body.append(tb);
    $('caseNote').textContent = 'Overcharging (above 120%) makes some cured patients refuse to pay and drives patients to your rival. Undercharging lifts reputation a little. “Improve” points the Specialisation research at that cure.';
    errFor('caseErr');
  }

  // ---- policy ----
  function slider(label, sub, min, max, stepv, val, fmt, onChange) {
    const w = el('div', 'slider'), lb = el('label', null, label), out = el('output', null, fmt(val)), inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = stepv; inp.value = val;
    inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); });
    inp.addEventListener('change', () => onChange(+inp.value, inp, out));
    w.append(lb, out, inp); if (sub) w.append(el('small', null, sub));
    return w;
  }
  function openPolicy() {
    const h = view.h[ME]; if (!h.pol) return;
    const P = h.pol, body = $('polBody'); body.replaceChildren();
    const pc = v => v + '%';
    body.append(el('h4', null, 'Diagnosis'));
    body.append(slider('Send home below', 'Patients whose diagnosis can\'t get past this are sent home automatically.', 0, 100, 5, P.home, pc, v => act('policy', { pol: { home: v } })));
    body.append(slider('Guess at a cure above', 'Patients diagnosed past this go straight for a cure. Between the two, you get a fax. Fans say never gamble below 95%.', 0, 100, 5, P.guess, pc, v => act('policy', { pol: { guess: v } })));
    body.append(slider('Diagnosis termination', 'Above 100%, doctors keep running tests patients pay for, even when they\'re sure. Extra cash, longer queues.', 50, 200, 10, P.term, pc, v => act('policy', { pol: { term: v } })));
    body.append(el('h4', null, 'Staff'));
    body.append(slider('Send staff to rest at', 'Tiredness at which staff head for the staff room. 30–40% avoids most fatigue problems.', 10, 100, 5, P.rest, pc, v => act('policy', { pol: { rest: v } })));
    const lv = el('div', 'item room'), lb = el('div'); lb.append(el('b', null, 'Staff leave rooms'), el('small', null, 'Yes: doctors and nurses in quiet rooms go where they\'re needed. No: each stays in its room.'));
    const tg = btn(P.leave ? 'Yes' : 'No', 'pt-btn pt-btn-small', () => { const v = tg.textContent !== 'Yes'; tg.textContent = v ? 'Yes' : 'No'; act('policy', { pol: { leave: v } }); });
    lv.append(lb, tg); body.append(lv);
    body.append(el('h4', null, 'Heating'));
    body.append(slider('Heating level', `${h.rads} radiators · warmth now ${warmWord(h.warm)} · bill about ${money(h.rads * P.heat * 6)} a month. Heat makes people thirsty.`, 1, 5, 1, P.heat, v => ['', 'Low', 'Mild', 'Medium', 'High', 'Max'][v], v => act('policy', { pol: { heat: v } })));
    closeSheets(); $('polSheet').hidden = false;
  }

  // ---- research ----
  let resKey = '';
  function openResearch() { $('resBtn').classList.remove('flash'); resKey = ''; closeSheets(); $('resSheet').hidden = false; lastErr = null; refreshResearch(true); }
  function refreshResearch(force) {
    if ($('resSheet').hidden || !view) return;
    const h = view.h[ME]; if (!h.res || !h.res.alloc) return;
    const R = h.res, rooms = Object.entries(h.rooms).filter(([, r]) => r.k === 'research' && !r.wreck && r.bt <= 0);
    const researchers = rooms.reduce((a, [, r]) => a + r.sts.length, 0);
    $('resSub').textContent = !rooms.length ? 'Build a Research Dept. and staff it with a doctor who has the Researcher qualification.' : !researchers ? 'Your research room has no researcher: hire a doctor with the Researcher qualification.' : `${researchers} researcher${researchers > 1 ? 's' : ''} at work` + (RH.hasUpgrade(h, 'computer') ? ' · computers' : '') + (RH.hasUpgrade(h, 'atom') ? ' · atom analyser' : '');
    const key = JSON.stringify(R.alloc) + R.spec + JSON.stringify(R.done) + R.disc;
    const body = $('resBody');
    if (force || key !== resKey) {
      resKey = key; body.replaceChildren();
      const nextOf = f => {
        if (f === 'cure' || f === 'diag') { const it = RH.RESEARCH[f].list[R.done[f]]; return it ? (RH.ROOMS[it] ? rname(it) : it === 'computer' ? 'Research computers' : 'Atom analyser') : 'All done'; }
        if (f === 'drug') return 'Raises the weakest drugs (75% first, then 100%)';
        if (f === 'imp') return R.done.imp < RH.RESEARCH.imp.max ? `Machine strength +${R.done.imp + 1}` : R.disc < 0.25 ? `Rooms ${Math.round((R.disc + 0.05) * 100)}% cheaper` : 'All done';
        if (f === 'spec') return R.spec >= 0 ? `Improving the cure for ${dname(R.spec)}` : 'Pick a cure with “Improve” in the Casebook';
        return '';
      };
      for (const f of RH.FIELDS) {
        const others = RH.FIELDS.reduce((a, g) => a + (g === f ? 0 : R.alloc[g]), 0);
        const w = slider(RH.RESEARCH[f].name, nextOf(f), 0, 100, 5, R.alloc[f], v => v + '%', (v, inp, out) => {
          const vv = Math.min(v, 100 - others); inp.value = vv; out.textContent = vv + '%';
          act('research', { alloc: Object.assign({}, R.alloc, { [f]: vv }) });
        });
        const bar = el('span', 'meter'); bar.style.width = '100%'; bar.style.height = '4px'; bar.dataset.f = f; bar.append(el('i'));
        w.append(bar);
        body.append(w);
      }
      const tot = RH.FIELDS.reduce((a, g) => a + R.alloc[g], 0);
      body.append(el('p', 'sub', `Allocated ${tot}% of 100%. Nothing happens without researchers, whatever the sliders say.`));
    }
    for (const bar of body.querySelectorAll('.meter[data-f]')) { const f = bar.dataset.f, need = RH.researchCost(h, f); bar.firstChild.style.width = need ? clamp(R.pts[f] / need, 0, 1) * 100 + '%' : f === 'spec' ? '0%' : '100%'; }
    errFor('resErr');
  }

  // ---- bank ----
  let bankTab = 'mgr';
  function openBank(t) { if (t) bankTab = t; closeSheets(); $('bankSheet').hidden = false; $('bankBody').dataset.key = ''; lastErr = null; refreshBank(); }
  function refreshBank() {
    if ($('bankSheet').hidden || !view) return;
    const h = view.h[ME]; if (!h.fin) return;
    const tabs = $('bankTabs');
    if (!tabs.children.length) for (const [k, nm] of [['mgr', 'Bank Manager'], ['stmt', 'Statement']]) { const b = btn(nm, '', () => { bankTab = k; $('bankBody').dataset.key = ''; refreshBank(); }); b.dataset.k = k; tabs.append(b); }
    [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.k === bankTab));
    const key = bankTab + '|' + Math.round(h.cash) + '|' + h.loan + '|' + JSON.stringify(h.fin.cur).length + '|' + h.owed;
    if ($('bankBody').dataset.key === key) { errFor('bankErr'); return; }
    $('bankBody').dataset.key = key;
    const body = $('bankBody'); body.replaceChildren();
    const line = (k, v, cls) => { const it = el('div', 'item room'); it.append(el('b', null, k), el('span', 'price ' + (cls || ''), v)); body.append(it); };
    if (bankTab === 'mgr') {
      body.append(el('div', 'big', money(h.cash)), el('p', 'sub', 'Bank balance. The loan isn\'t counted against it, and the game is lost if it falls below ' + money(RH.LOSE.cash) + '.'));
      const lim = Math.max(20000, Math.round(RH.value(h) * 0.6 / RH.LOAN_STEP) * RH.LOAN_STEP);
      line('Loan', money(h.loan)); line('Loan limit (tied to hospital value)', money(lim)); line('Interest', `${RH.LOAN_RATE * 100}% a month · ${money(h.loan * RH.LOAN_RATE)}`);
      line('Insurance owed to you (paid at month end)', money(h.owed)); line('Hospital value', money(RH.value(h)));
      const r = el('div', 'row'); r.append(btn(`Borrow ${money(RH.LOAN_STEP)}`, 'pt-btn', () => act('loan', { dir: 1 }), h.loan + RH.LOAN_STEP > lim || view.ph !== 'play'), btn(`Repay ${money(RH.LOAN_STEP)}`, 'pt-btn pt-btn-ghost', () => act('loan', { dir: -1 }), !h.loan || h.cash < RH.LOAN_STEP || view.ph !== 'play'));
      body.append(r);
    } else {
      const cats = [...new Set(Object.keys(h.fin.cur).concat(Object.keys(h.fin.last)))].sort();
      const tb = el('table', 't'), hd = el('tr'); for (const c of ['', 'This month', 'Last month']) hd.append(el('th', null, c)); tb.append(hd);
      let a = 0, b = 0;
      for (const c of cats) { const x = h.fin.cur[c] || 0, y = h.fin.last[c] || 0; a += x; b += y; const tr = el('tr'); tr.append(el('td', null, c), el('td', 'n ' + (x < 0 ? 'bad' : ''), money(x)), el('td', 'n ' + (y < 0 ? 'bad' : ''), money(y))); tb.append(tr); }
      const tr = el('tr'); tr.append(el('td', null, 'Net'), el('td', 'n ' + (a < 0 ? 'bad' : 'ok'), money(a)), el('td', 'n ' + (b < 0 ? 'bad' : 'ok'), money(b))); tb.append(tr);
      body.append(cats.length ? tb : el('p', 'sub', 'Nothing yet this month.'));
    }
    errFor('bankErr');
  }

  // ---- status ----
  function openStatus(awards) { closeSheets(); $('statSheet').hidden = false; $('statBody').dataset.key = ''; statAwards = !!awards; refreshStatus(); }
  let statAwards = false;
  function refreshStatus() {
    if ($('statSheet').hidden || !view) return;
    const h = view.h[ME], r = view.h[FRIEND];
    const key = [view.month, h.cash, h.rep, h.cured, h.seen, r.cured, r.rep, h.awards.length, r.awards.length].join('|');
    if ($('statBody').dataset.key === key) return;
    $('statBody').dataset.key = key;
    const nextQ = (Math.floor(view.month / 3) + 1) * 3;
    $('statSub').textContent = `Meet every target at a quarter-end check (next: end of ${RH.MONTH_NAMES[(nextQ - 1) % 12]}, year ${Math.floor((nextQ - 1) / 12) + 1}) to win. After ${RH.MONTHS} months, the hospital closest to its targets wins.`;
    const body = $('statBody'); body.replaceChildren();
    const bars = el('div', 'bars');
    const tb = (label, v, t, txt, lose) => { const w = el('div', 'tbar' + (lose ? ' lose' : '')), tr = el('span', 'track'), i = el('i'); i.style.width = clamp(v / t, 0, 1) * 100 + '%'; tr.append(i); w.append(el('span', null, label), tr, el('b', clamp(v / t, 0, 1) >= 1 && !lose ? 'ok' : lose && v / t > 0.6 ? 'bad' : '', txt)); bars.append(w); };
    const tg = RH.TARGETS;
    body.append(el('h4', null, 'Targets'));
    tb('Reputation', h.rep, tg.rep, `${h.rep} / ${tg.rep}`);
    tb('Bank balance', Math.max(0, h.cash), tg.cash, `${money(h.cash)} / ${money(tg.cash)}`);
    tb('Cure rate', RH.curePct(h), tg.pct, `${RH.curePct(h)}% / ${tg.pct}%`);
    tb('Patients cured', h.cured, tg.cured, `${h.cured} / ${tg.cured}`);
    tb('Hospital value', RH.value(h), tg.value, `${money(RH.value(h))} / ${money(tg.value)}`);
    tb('Bank balance below ' + money(RH.LOSE.cash), Math.max(0, -h.cash), -RH.LOSE.cash, h.cash < 0 ? money(h.cash) : 'safe', true);
    tb('Reputation below ' + RH.LOSE.rep, Math.max(0, 500 - h.rep), 500 - RH.LOSE.rep, h.rep < 500 ? String(h.rep) : 'safe', true);
    body.append(bars);
    body.append(el('h4', null, 'Your patients'));
    const ps = (host ? patStat(h.pats) : h.pstat) || { n: 0 }, pb = el('div', 'bars');
    const pbar = (label, v, txt, bad) => { const w = el('div', 'tbar' + (bad ? ' lose' : '')), tr = el('span', 'track'), i = el('i'); i.style.width = clamp(v, 0, 1) * 100 + '%'; tr.append(i); w.append(el('span', null, label), tr, el('b', null, txt)); pb.append(w); };
    pbar('Happiness', ps.pat || 0, Math.round((ps.pat || 0) * 100) + '%');
    pbar('Thirst', ps.th || 0, Math.round((ps.th || 0) * 100) + '%', true);
    pbar('Warmth', clamp(h.warm / 1.6, 0, 1), warmWord(h.warm));
    pbar('Health', ps.hp || 0, Math.round((ps.hp || 0) * 100) + '%');
    body.append(pb);
    // market share and the league table against the rival
    body.append(el('h4', null, 'League table'));
    const share = (h.visits + r.visits) ? h.visits / (h.visits + r.visits) : 0.5;
    const pie = el('div', 'pie'), c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.fillStyle = getComputedStyle(document.body).getPropertyValue('--accent-2') || '#1f8f87'; x.beginPath(); x.moveTo(32, 32); x.arc(32, 32, 30, 0, Math.PI * 2); x.fill();
    x.fillStyle = getComputedStyle(document.body).getPropertyValue('--accent') || '#e8533f'; x.beginPath(); x.moveTo(32, 32); x.arc(32, 32, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share); x.fill();
    pie.append(c, el('span', null, `Market share: ${nameOf(ME)} ${Math.round(share * 100)}% · ${nameOf(FRIEND)} ${100 - Math.round(share * 100)}%`));
    body.append(pie);
    const cmp = el('div', 'cmp'); cmp.append(el('span', 'a hd', nameOf(ME)), el('span', 'k', ''), el('span', 'b hd', nameOf(FRIEND)));
    for (const [k, a, b] of [['Cured', h.cured, r.cured], ['Deaths', h.died, r.died], ['Balance', money(h.cash), money(r.cash)], ['Visitors', h.visits, r.visits], ['Value', money(RH.value(h)), money(RH.value(r))], ['Reputation', h.rep, r.rep], ['Rating', RH.score(h), RH.score(r)]]) cmp.append(el('span', 'a', String(a)), el('span', 'k', k), el('span', 'b', String(b)));
    body.append(cmp);
    if (h.awards.length || r.awards.length || statAwards) {
      body.append(el('h4', null, 'Awards and citations'));
      const aw = el('div', 'cmp'); aw.append(el('span', 'a hd', nameOf(ME)), el('span', 'k', ''), el('span', 'b hd', nameOf(FRIEND)));
      aw.append(el('span', 'a', h.awards.join(' · ') || '—'), el('span', 'k', 'Year-end'), el('span', 'b', r.awards.join(' · ') || '—'));
      body.append(aw);
    }
  }

  function refreshSheets() { refreshBuild(); refreshRoom(); refreshStaff(); refreshCase(); refreshResearch(); refreshBank(); refreshStatus(); renderFaxes(); }
  function showOver() {
    if (!view || view.ph !== 'over') return;
    const a = view.h[ME], b = view.h[FRIEND], w = view.winner;
    $('ovTitle').textContent = view.why === 'targets' ? 'Targets met!' : view.why && view.why.startsWith('lost') ? 'Scandal!' : `Year ${RH.MONTHS / 12} is over`;
    $('ovVerdict').textContent = w === ME ? `${nameOf(ME)}'s hospital wins!` : w === FRIEND ? `${nameOf(FRIEND)}'s hospital wins` : 'Dead heat!';
    const loser = w === ME ? FRIEND : ME;
    $('ovWhy').textContent = view.why === 'targets' ? 'Every target was met at a quarter-end check.' : view.why === 'lost:cash' ? `${nameOf(loser)}'s balance fell below ${money(RH.LOSE.cash)}: the Health Ministry stepped in.` : view.why === 'lost:rep' ? `${nameOf(loser)}'s reputation sank below ${RH.LOSE.rep}: the Health Ministry stepped in.` : `${RH.MONTHS} months are up: the hospital closest to its targets wins.`;
    const rows = [['Rating', RH.score(a), RH.score(b)], ['Balance', money(a.cash), money(b.cash)], ['Reputation', a.rep, b.rep], ['Cured', `${a.cured} (${RH.curePct(a)}%)`, `${b.cured} (${RH.curePct(b)}%)`], ['Deaths', a.died, b.died], ['Walked out', a.angry, b.angry], ['Sent home', a.home, b.home], ['Value', money(RH.value(a)), money(RH.value(b))]];
    const c = $('ovCmp'); c.replaceChildren(el('span', 'a hd', nameOf(ME)), el('span', 'k', ''), el('span', 'b hd', nameOf(FRIEND)));
    for (const [k, x, y] of rows) c.append(el('span', 'a', String(x)), el('span', 'k', k), el('span', 'b', String(y)));
    closeSheets(); $('legend').hidden = true; $('over').hidden = false;
  }
  // legend
  (function buildLegend() {
    const tg = RH.TARGETS;
    $('legendWin').textContent = `Be the first to meet every target at a quarter-end check: reputation ${tg.rep}, a bank balance of ${money(tg.cash)}, a ${tg.pct}% cure rate, ${tg.cured} patients cured and a hospital value of ${money(tg.value)}. Lose if your balance falls below ${money(RH.LOSE.cash)} or your reputation below ${RH.LOSE.rep}. If nobody gets there in ${RH.MONTHS} months (a month lasts ${RH.MONTH} seconds), the hospital closest to its targets wins. Year-end awards bring cash and reputation.`;
    const tb = $('disTable'); tb.replaceChildren();
    const hd = el('tr'); for (const c of ['', 'Disease', 'Cure', 'Type']) hd.append(el('th', null, c)); tb.append(hd);
    RH.DISEASES.forEach((d, i) => {
      const tr = el('tr'), c0 = el('td'), c1 = el('td'), c2 = el('td'), c3 = el('td');
      c0.append(spriteCanvas(HA.patientSheet(i % 8, d.vis), 26));
      c1.append(el('b', null, d.name), el('br'), el('small', null, d.cause + (d.fatal ? ' A failed cure is fatal.' : '')));
      c2.textContent = RH.ROOMS[d.room].name + (d.room === 'op' ? ' (Ward first)' : '');
      c3.textContent = RH.cureType(d);
      tr.append(c0, c1, c2, c3); tb.append(tr);
    });
    $('legendNote').textContent = host ? 'Close this, then press “Start the match”.' : 'The host starts the match.';
  })();
  function toggleLegend() { if ($('legend').hidden) { closeSheets(); $('over').hidden = true; $('legend').hidden = false; } else if (view && view.ph !== 'ready') $('legend').hidden = true; }
  $('helpBtn').addEventListener('click', toggleLegend);
  $('legendClose').addEventListener('click', () => { $('legend').hidden = true; });
  $('startBtn').addEventListener('click', requestStart);
  $('openBtn').addEventListener('click', () => act('open'));
  $('buildClose').addEventListener('click', () => { $('buildSheet').hidden = true; });
  $('roomClose').addEventListener('click', () => { $('roomSheet').hidden = true; });
  $('staffClose').addEventListener('click', () => { $('staffSheet').hidden = true; });
  $('caseClose').addEventListener('click', () => { $('caseSheet').hidden = true; });
  $('polClose').addEventListener('click', () => { $('polSheet').hidden = true; });
  $('resClose').addEventListener('click', () => { $('resSheet').hidden = true; });
  $('bankClose').addEventListener('click', () => { $('bankSheet').hidden = true; });
  $('statClose').addEventListener('click', () => { $('statSheet').hidden = true; });
  const mine = () => { if (tab !== ME) setTab(ME); return !!view; };
  $('staffBtn').addEventListener('click', () => { if (mine()) { closeSheets(); openStaff(); } });
  $('caseBtn').addEventListener('click', () => { if (mine()) { closeSheets(); openCase(); } });
  $('resBtn').addEventListener('click', () => { if (mine()) openResearch(); });
  $('polBtn').addEventListener('click', () => { if (mine()) openPolicy(); });
  $('bankBtn').addEventListener('click', () => { if (mine()) openBank(); });
  $('statBtn').addEventListener('click', () => { if (mine()) openStatus(); });
  $('profBtn').addEventListener('click', openProfile);
  $('profSave').addEventListener('click', saveProfile);
  $('profInput').addEventListener('keydown', e => { if (e.key === 'Enter') saveProfile(); });
  if (host) applyProfile(); else renderProfBtn();
  if (!profile) openProfile();
  $('ovClose').addEventListener('click', () => { $('over').hidden = true; });
  $('ovAgain').addEventListener('click', () => { if (host) { RH.start(state); drainEvents(); onPhase(); room.save(state); } else { requestStart(); $('ovAgain').textContent = 'Asked the host…'; setTimeout(() => ($('ovAgain').textContent = 'Play again'), 2000); } });
  function setTab(p) { tab = p; $('tabMine').classList.toggle('on', p === ME); $('tabRival').classList.toggle('on', p !== ME); selected = null; closeSheets(); hudKey = ''; statusKey = ''; setStatus(); if (!host && room.connected) room.send({ t: 'tab', p }); }
  $('tabMine').addEventListener('click', () => setTab(ME));
  $('tabRival').addEventListener('click', () => setTab(FRIEND));
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || !$('profile').hidden) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (!$('legend').hidden && view && view.ph !== 'ready') $('legend').hidden = true; closeSheets(); return; }
    const F = { f1: () => openBank('stmt'), f2: () => { closeSheets(); openCase(); }, f3: openPolicy, f4: openResearch, f5: () => openStatus(), f6: () => { closeSheets(); openStaff(); }, f7: () => openBank('mgr'), f8: () => openStatus() };
    if (F[k]) { e.preventDefault(); if (view && mine()) F[k](); return; }
    if (k === 'a' && e.shiftKey) { advisorOff = !advisorOff; setStatus(); return; }
    if (k === 'h' || k === '?') { if (!e.repeat) toggleLegend(); return; }
    if (k === 'tab') { e.preventDefault(); setTab(tab === ME ? FRIEND : ME); return; }
  });

  // ============================ canvas, camera, input ============================
  const HI = window.HI;
  const cv = $('view'), ctx = cv.getContext('2d');
  const BW = HI.BW, BH = HI.BH;
  const [buf, bctx] = HA.canvas(BW, BH);
  const groundC = HI.ground(), ghostSpr = HA.ghost(), mopSpr = HA.furniture('mop');
  let cw = 1, ch = 1, DPR = 1;
  const cam = { x: BW / 2, y: BH / 2 - 10, z: 2 };          // centre of the view in buffer px, zoom
  let fitZ = 1;
  function resize() {
    DPR = devicePixelRatio || 1; cw = innerWidth; ch = innerHeight;
    cv.width = Math.round(cw * DPR); cv.height = Math.round(ch * DPR);
    const ex = HI.extent(); fitZ = Math.min(cw / ex.w, (ch - 110) / ex.h) * 0.96;
    clampCam();
  }
  const minZ = () => Math.max(0.6, Math.min(fitZ, 1.5)), maxZ = () => 4;
  function clampCam() {
    // the view centre may sit anywhere over the map, at any zoom, so panning always works
    cam.z = clamp(cam.z, minZ(), maxZ());
    const ex = HI.extent();
    cam.x = clamp(cam.x, ex.x, ex.x + ex.w);
    cam.y = clamp(cam.y, ex.y, ex.y + ex.h);
  }
  function fitView() {
    const ex = HI.extent(); fitZ = Math.min(cw / ex.w, (ch - 110) / ex.h) * 0.96;
    cam.z = Math.max(fitZ, 0.6); cam.x = ex.x + ex.w / 2; cam.y = ex.y + ex.h / 2 - 10;
    if (cw < 700) { cam.z = Math.max(cam.z, 1.4); const [ex, ey] = HI.px(120, 100); cam.x = ex; cam.y = ey; }   // phones: start zoomed in on the entrance
    clampCam();
  }
  function zoomAt(f, px, py) {   // zoom by factor f keeping the screen point (px, py) fixed
    const z0 = cam.z, z1 = clamp(z0 * f, minZ(), maxZ());
    const bx = cam.x + (px - cw / 2) / z0, by = cam.y + (py - ch / 2) / z0;
    cam.z = z1; cam.x = bx - (px - cw / 2) / z1; cam.y = by - (py - ch / 2) / z1; clampCam();
  }
  function rotate(dir) { HI.setRot(HI.getRot() + dir); hudKey = ''; }
  function setFlat(f) { HI.setFlat(f); $('camFlat').textContent = f ? '3D' : '2D'; $('camFlat').title = f ? 'Back to the isometric view (V)' : 'Aerial view (V)'; try { localStorage.setItem('rh3d_flat', f ? '1' : '0'); } catch (e) {} fitView(); }
  try { if (localStorage.getItem('rh3d_flat') === '1') setFlat(true); } catch (e) {}
  addEventListener('resize', resize); resize(); fitView(); setTimeout(() => { resize(); fitView(); }, 300);
  const toBuf = (px, py) => [cam.x + (px - cw / 2) / cam.z, cam.y + (py - ch / 2) / cam.z];
  const toScr = (bx, by) => [(bx - cam.x) * cam.z + cw / 2, (by - cam.y) * cam.z + ch / 2];
  // pointers: one drags, two pinch; a short still press is a tap
  const ptrs = new Map();
  let gesture = null;
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture && (() => { try { cv.setPointerCapture(e.pointerId); } catch (err) {} })();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) gesture = { kind: 'tap', x0: e.clientX, y0: e.clientY, t0: performance.now(), lx: e.clientX, ly: e.clientY };
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
  });
  cv.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.kind === 'pinch' && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const target = clamp(gesture.z0 * d / Math.max(10, gesture.d0), minZ(), maxZ());
      zoomAt(target / cam.z, mx, my);
      cam.x -= (mx - gesture.mx) / cam.z; cam.y -= (my - gesture.my) / cam.z; gesture.mx = mx; gesture.my = my; clampCam();
      return;
    }
    if (gesture.kind === 'tap' && Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) > 6) { gesture.kind = 'drag'; cv.classList.add('drag'); }
    if (gesture.kind === 'drag') { cam.x -= (e.clientX - gesture.lx) / cam.z; cam.y -= (e.clientY - gesture.ly) / cam.z; clampCam(); }
    gesture.lx = e.clientX; gesture.ly = e.clientY;
  });
  const endPtr = e => {
    const wasTap = gesture && gesture.kind === 'tap' && performance.now() - gesture.t0 < 600;
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) { cv.classList.remove('drag'); if (wasTap) { const [bx, by] = toBuf(e.clientX, e.clientY); const [wx, wy] = HI.unproj(bx, by); onTap(wx, wy); } gesture = null; }
    else if (ptrs.size === 1) { const [a] = [...ptrs.values()]; gesture = { kind: 'drag', lx: a.x, ly: a.y }; }
  };
  cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('wheel', e => { e.preventDefault(); if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY); else { cam.x += e.deltaX / cam.z; cam.y += e.deltaY / cam.z; clampCam(); } }, { passive: false });
  $('camRotL').addEventListener('click', () => rotate(-1)); $('camRotR').addEventListener('click', () => rotate(1));
  $('camFlat').addEventListener('click', () => setFlat(!HI.getFlat()));
  $('camIn').addEventListener('click', () => zoomAt(1.3, cw / 2, ch / 2)); $('camOut').addEventListener('click', () => zoomAt(1 / 1.3, cw / 2, ch / 2)); $('camFit').addEventListener('click', fitView);
  const keysDown = new Set();
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || !$('profile').hidden || panelOpen()) return;
    const k = e.key.toLowerCase();
    if (k === 'q') rotate(-1); else if (k === 'e') rotate(1); else if (k === 'f') fitView(); else if (k === 'v') setFlat(!HI.getFlat());
    else if (k === '+' || k === '=') zoomAt(1.25, cw / 2, ch / 2); else if (k === '-' || k === '_') zoomAt(0.8, cw / 2, ch / 2);
    else if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 'd'].includes(k) || (k === 's' && !e.repeat && false)) { keysDown.add(k); e.preventDefault(); }
  });
  addEventListener('keyup', e => keysDown.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keysDown.clear());
  function panKeys(dt) {
    if (!keysDown.size) return;
    const v = 320 * dt / cam.z;
    if (keysDown.has('arrowleft') || keysDown.has('a')) cam.x -= v; if (keysDown.has('arrowright') || keysDown.has('d')) cam.x += v;
    if (keysDown.has('arrowup') || keysDown.has('w')) cam.y -= v; if (keysDown.has('arrowdown')) cam.y += v;
    clampCam();
  }
  function onTap(bx, by) {
    if (!view || panelOpen()) return;
    const h = view.h[tab];
    const [tx, ty] = HI.px(bx, by);
    // rats first: tap to shoot
    if (tab === ME && view.ph === 'play') for (const rt of h.rats || []) {
      const [x, y] = posOf('r', rt), [sx, sy] = HI.px(x, y);
      if (Math.abs(tx - sx) <= 9 && Math.abs(ty - (sy - 4)) <= 8) { act('shoot', { id: rt.id }); burst(tab, x, y, '#ffd23f', 5, 4); return; }
    }
    // people: hit test against the projected sprite box
    let best = null, bd = 1e9;
    for (const pt of h.pats || []) { const [x, y] = posOf('p', pt); const [sx, sy] = HI.px(x, y); if (Math.abs(tx - sx) <= 8 && ty <= sy + 2 && ty >= sy - 24) { const d = Math.abs(tx - sx) + Math.abs(ty - (sy - 12)); if (d < bd) { bd = d; best = pt; } } }
    if (best) {
      selected = { id: best.id, until: performance.now() + 4000 };
      if (tab === ME && h.epi && h.epi.phase === 'cover' && best.inf && !best.mk) act('vax', { id: best.id });
      return;
    }
    selected = null;
    if (tab === ME && bx >= 30 && bx <= 66 && by >= 86 && by <= 112) { openDesk(); return; }
    const k = RH.slotAtWorld(bx, by);
    if (k != null) { if (h.rooms[k]) { closeSheets(); openRoom(k); } else if (tab === ME && view.ph === 'play') { closeSheets(); openBuild(k); } return; }
    const c = Math.floor(bx / T), r = Math.floor(by / T);
    if (RH.decorSpot(c, r) && tab === ME) { if (h.decor[RH.decorKey(c, r)]) openDecorInfo(c, r); else if (view.ph === 'play') openDecor(c, r); }
  }
  let selected = null;
  // the info bar: what's under the mouse
  cv.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || e.buttons || !view) { if (hoverTxt) { hoverTxt = ''; setStatus(); } return; }
    const [bx, by] = toBuf(e.clientX, e.clientY), [wx, wy] = HI.unproj(bx, by), h = view.h[tab];
    let txt = '';
    const k = RH.slotAtWorld(wx, wy);
    if (k != null && h.rooms[k]) {
      const r = h.rooms[k], R = RH.ROOMS[r.k];
      txt = r.wreck ? `${R.name}: wrecked` : r.bt > 0 ? `${R.name}: being built` : `${R.name} · ${qn(r)} queuing` + (R.mach ? ` · machine strength ${r.str}, used ${r.used}` : '') + (r.sts.length < (R.need || (R.staff ? 1 : 0)) ? ` · needs a ${needWord(r.k)}` : '');
    } else if (k != null && tab === ME) txt = `Empty lot ${k + 1}: tap to build`;
    else if (wx >= 30 && wx <= 66 && wy >= 86 && wy <= 112) txt = h.desk ? 'Reception desk' : 'Reception desk: tap to buy ($150)';
    else { const c = Math.floor(wx / T), r = Math.floor(wy / T), d = h.decor[RH.decorKey(c, r)]; if (d) txt = RH.DECOR[d].name + (d === 'plant' && h.dry && h.dry.includes(RH.decorKey(c, r)) ? ' (dead: needs watering)' : ''); }
    if (txt !== hoverTxt) { hoverTxt = txt; setStatus(); }
  });
  cv.addEventListener('pointerleave', () => { if (hoverTxt) { hoverTxt = ''; setStatus(); } });

  // ============================ rendering ============================
  const P = (x, y, w, h, col) => { bctx.fillStyle = col; bctx.fillRect(x, y, w, h); };
  function posOf(kind, e) {
    if (host) return [e.x, e.y];
    const prev = prevPos.get(kind + e.id); if (!prev) return [e.x, e.y];
    const span = Math.max(50, curAt - prevAt), k = clamp((performance.now() - curAt) / span, 0, 1);
    return [prev[0] + (e.x - prev[0]) * k, prev[1] + (e.y - prev[1]) * k];
  }
  const animT = new Map();
  // draws an upright sprite at its projected feet; returns the screen (buffer) position of the feet
  function drawPerson(sheet, e, kind, t, dt, wx, wy) {
    const key = kind + e.id;
    const a = (animT.get(key) || 0) + (e.mv ? dt : 0); animT.set(key, e.mv ? a : 0);
    const frame = e.mv ? [1, 0, 2, 0][Math.floor(a * 8) % 4] : 0;
    const dir = sheet[DIRS[HI.facing(e.f)]] || sheet.down, sh = dir[frame] || dir[0];
    const [sx, sy] = HI.px(wx, wy);
    bctx.fillStyle = 'rgba(0,0,0,.28)'; bctx.beginPath(); bctx.ellipse(sx, sy, 6, 3, 0, 0, Math.PI * 2); bctx.fill();
    bctx.drawImage(sh, Math.round(sx) - 8, Math.round(sy) - 23);
    return [Math.round(sx), Math.round(sy)];
  }
  const labels = [];  // text drawn after the blit (positions in buffer px)
  function icon(kind, x, y, t) {
    if (kind === 'skull') { P(x - 2, y - 3, 5, 4, '#f4f0e6'); P(x - 1, y + 1, 3, 1, '#f4f0e6'); P(x - 1, y - 2, 1, 1, '#1b1720'); P(x + 1, y - 2, 1, 1, '#1b1720'); }
    else if (kind === 'bug') { P(x - 2, y - 2, 4, 3, '#4fbf4a'); P(x - 3, y - 1, 1, 1, '#2f6b3a'); P(x + 2, y - 1, 1, 1, '#2f6b3a'); P(x - 1, y - 3, 2, 1, '#2f6b3a'); }
    else if (kind === 'vax') { P(x - 3, y - 1, 5, 2, '#9fd8ff'); P(x + 2, y, 2, 1, '#f4f0e6'); P(x - 4, y - 1, 1, 2, '#3c7bd6'); }
    else if (kind === 'siren') { const on = Math.floor(t * 6) % 2; P(x - 2, y - 2, 4, 3, on ? '#3c7bd6' : '#9fd8ff'); P(x - 3, y + 1, 6, 1, '#6b7280'); if (on) { bctx.globalAlpha = 0.35; P(x - 5, y - 4, 10, 7, '#6fd3ff'); bctx.globalAlpha = 1; } }
    else if (kind === 'q') { P(x - 1, y - 3, 3, 1, '#ffe36b'); P(x + 1, y - 2, 1, 2, '#ffe36b'); P(x, y, 1, 1, '#ffe36b'); P(x, y + 2, 1, 1, '#ffe36b'); }
    else if (kind === 'angry') { P(x - 1, y - 3, 2, 4, '#ff6b57'); P(x - 1, y + 2, 2, 1, '#ff6b57'); }
  }
  function render(t, dt) {
    labels.length = 0;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, BW, BH);
    const h = view ? view.h[tab] : null;
    const mine = tab === ME;
    // floors
    HI.floorAt(bctx, groundC, 0, 0);
    if (h) for (const key in h.rooms) { const k = +key, r = h.rooms[k]; HI.floorAt(bctx, HI.roomFloor(r.k), RH.slotX0(k) * T, RH.slotY0(k) * T); }
    const objs = HI.outside().concat(HI.buildingWalls());
    // walls, furniture, lots
    for (let k = 0; k < RH.SLOTS; k++) {
      const X = RH.slotX0(k) * T, Y = RH.slotY0(k) * T, top = RH.slotTop(k), r = h && h.rooms[k];
      if (!r) {
        objs.push(...HI.lotWalls(X, Y, top));
        if (h && mine && view.ph === 'play') objs.push({ d: HI.depth(X + 32, Y + 32), draw: c => { const [sx, sy] = HI.px(X + 32, Y + 32); const a = 0.5 + Math.sin(t * 3) * 0.2; c.globalAlpha = a; P(sx - 1, sy - 9, 2, 10, '#5a5246'); P(sx - 5, sy - 5, 10, 2, '#5a5246'); c.globalAlpha = 1; } });
        continue;
      }
      objs.push(...HI.roomWalls(k, r.k, X, Y, top));
      if (r.bt > 0) { objs.push(...HI.scaffoldItems(X, Y, 1 - r.bt / 4)); continue; }
      const items = r.wreck ? HI.wreckItems(X, Y) : HI.roomItems(r.k, top, r.ex, r.water);
      for (const it of items) objs.push({ d: HI.depth(X + it.x + it.w, Y + it.y + it.d), draw: c => it.draw(c, X, Y) });
      // a machine past its strength smokes
      if (!r.wreck && RH.ROOMS[r.k].mach && r.used > r.str && Math.random() < dt * 8) smokes.push({ p: tab, x: X + 20 + Math.random() * 24, y: Y + 14 + Math.random() * 16, z: 20, life: 1.6, r: 2 + Math.random() * 2 });
    }
    if (h) {
      objs.push(HI.deskItem(h.desk, t));
      for (const key in h.decor) { const [c, r] = key.split(',').map(Number), kind = h.decor[key], [fw, fd] = HI.DECOR_FOOT[kind] || [8, 8], x = c * T + 8, y = r * T + 8, dry = kind === 'plant' && h.dry && h.dry.includes(key); objs.push({ d: HI.depth(x + fw / 2, y + fd / 2), draw: cx => HI.DECOR_DRAW[kind] && HI.DECOR_DRAW[kind](cx, x, y, dry) }); }
      for (const m of h.mess) objs.push(HI.messItem(m));
      for (const rt of h.rats || []) { const [x, y] = posOf('r', rt); objs.push(HI.ratItem({ x, y, f: rt.f }, t)); }
      if (mine && view.ph === 'play' && decorHint > 0) for (let c = 2; c < RH.W; c++) for (let r = 4; r <= 17; r++) if (RH.decorSpot(c, r) && !h.decor[RH.decorKey(c, r)]) objs.push({ d: HI.depth(c * T + 8, r * T + 8), draw: cx => { const [sx, sy] = HI.px(c * T + 8, r * T + 8); cx.globalAlpha = 0.35 + Math.sin(t * 4) * 0.15; P(sx - 1, sy - 1, 3, 3, '#1f8f87'); cx.globalAlpha = 1; } });
      for (const st of h.staff) objs.push({ d: HI.depth(st.x, st.y), draw: () => {
        const [x, y] = posOf('s', st);
        const [sx, sy] = drawPerson(HA.staffSheet(st.look, staffKind(st)), st, 's', t, dt, x, y);
        if (st.k === 'h' && (st.cl || st.work > 0)) { const j = st.job; if (j === 'm' || (j && j[0] === 'm')) bctx.drawImage(mopSpr, sx + 5 + (Math.floor(t * 6) % 2 ? 2 : 0), sy - 20); else if (Math.floor(t * 8) % 2) { P(sx + 6, sy - 14, 3, 2, '#9aa3b8'); P(sx + 8, sy - 16, 1, 3, '#9aa3b8'); } }
        if (st.mode === 'rest' && Math.floor(t * 1.5) % 2) labels.push({ x: sx + 6, y: sy - 27, txt: 'z', col: '#9fd8ff', size: 4.5 });
        else if (st.tired > 0.85 && Math.floor(t * 2) % 2) labels.push({ x: sx + 6, y: sy - 27, txt: 'zz', col: '#ff9a7a', size: 3.6 });
        if (st.hap < 0.3 && !st.gone && Math.floor(t * 2) % 2) icon('angry', sx - 7, sy - 27, t);
      } });
      for (const pt of h.pats || []) objs.push({ d: HI.depth(pt.x, pt.y), draw: () => {
        const dis = RH.DISEASES[pt.dis], shown = pt.why === 'cured' ? '' : dis.vis;
        const [x, y] = posOf('p', pt);
        // serious radiation glows
        if (shown === 'rad') { const [gx, gy] = HI.px(x, y); const g = bctx.createRadialGradient(gx, gy - 12, 0, gx, gy - 12, 14); g.addColorStop(0, 'rgba(180,240,106,.45)'); g.addColorStop(1, 'rgba(180,240,106,0)'); bctx.fillStyle = g; bctx.fillRect(gx - 14, gy - 26, 28, 28); }
        const wob = shown === 'jelly' ? Math.round(Math.sin(t * 9 + pt.id) * 1) : 0;
        const [sx, sy] = drawPerson(HA.patientSheet(pt.look, shown), pt, 'p', t, dt, x + wob * 0.5, y);
        let ix = sx, iy = sy - 29;
        if (pt.em) { icon('siren', ix, iy, t); iy -= 6; }
        if (pt.inf && !pt.vax) { icon('bug', ix + (pt.em ? 6 : 0), iy + (pt.em ? 6 : 0), t); }
        else if (pt.vax && pt.inf) icon('vax', ix, iy, t);
        if (pt.hp < 0.25 && pt.why !== 'cured' && Math.floor(t * 3) % 2) icon('skull', sx - 7, sy - 26, t);
        if (pt.st === 'wait' && Math.floor(t * 2) % 2) icon('q', sx + 7, sy - 26, t);
        if (pt.st === 'queue' && pt.pat < 20 && Math.floor(t * 4) % 2) icon('angry', sx + 7, sy - 26, t);
        if (dis.id === 'sleep' && shown && Math.floor(t * 2) % 2) labels.push({ x: sx + 7, y: sy - 28, txt: 'z', col: '#9fd8ff', size: 5 });
        if (pt.mk && !pt.vax) { bctx.strokeStyle = '#6fd3ff'; bctx.lineWidth = 1; bctx.beginPath(); bctx.ellipse(sx, sy, 8, 4, 0, 0, Math.PI * 2); bctx.stroke(); }
        if (pt.why === 'cured' && Math.floor(t * 3) % 2) { P(sx + 7, sy - 27, 1, 3, '#ffe36b'); P(sx + 6, sy - 26, 3, 1, '#ffe36b'); }
        if (selected && selected.id === pt.id && performance.now() < selected.until) {
          const what = pt.dx ? dis.name : `diagnosis ${Math.round(pt.dg * 100)}%`;
          const doing = pt.st === 'queue' ? ` · patience ${Math.max(0, Math.round(pt.pat))}s` : pt.st === 'in' ? ' · in treatment' : pt.st === 'wait' ? ' · waiting for you' : pt.st === 'wc' ? ' · in the loo' : pt.st === 'trip' ? ' · buying a drink' : pt.why === 'cured' ? ' · cured!' : '';
          labels.push({ x: sx, y: sy - 34, txt: `${pt.nm} · ${what} · health ${Math.round(pt.hp * 100)}%${doing}${pt.em ? ' · EMERGENCY' : ''}${pt.inf && !pt.vax ? ' · infected' : ''}`, col: '#fff6e0', bubble: true, size: 4.6 });
        }
      } });
      for (const v of h.vis || []) objs.push({ d: HI.depth(v.x, v.y), draw: () => {
        const [x, y] = posOf('v', v);
        const [sx, sy] = drawPerson(v.k === 'vip' ? HA.vipSheet() : HA.inspSheet(), v, 'v', t, dt, x, y);
        labels.push({ x: sx, y: sy - 32, txt: v.k === 'vip' ? 'VIP' : 'Inspector', col: '#fff6e0', size: 3.8, plate: true });
      } });
      // the administrator pacing corridor A with a clipboard (cosmetic, driven by local time)
      {
        const ph = (t % 48) / 48, x0 = 100, x1 = 330;
        let mx, mf, mv;
        if (ph < 0.4) { mx = x0 + (ph / 0.4) * (x1 - x0); mf = 3; mv = 1; } else if (ph < 0.5) { mx = x1; mf = 0; mv = 0; } else if (ph < 0.9) { mx = x1 - ((ph - 0.5) / 0.4) * (x1 - x0); mf = 2; mv = 1; } else { mx = x0; mf = 0; mv = 0; }
        const mgr = { id: 'm' + tab, f: mf, mv }, my = RH.LANE - 3;
        objs.push({ d: HI.depth(mx, my), draw: () => { const [sx, sy] = drawPerson(HA.managerSheet(avOf(tab)), mgr, 'g', t, dt, mx, my); labels.push({ x: sx, y: sy - 30, txt: nameOf(tab), col: '#fff6e0', size: 3.8, plate: true }); } });
      }
    }
    objs.sort((a, b) => a.d - b.d).forEach(o => o.draw(bctx));
    if (h) {
      for (const key in h.rooms) {
        const k = +key, r = h.rooms[k], X = RH.slotX0(k) * T, Y = RH.slotY0(k) * T, cx = RH.slotCx(k), top = RH.slotTop(k), R = RH.ROOMS[r.k];
        const [dx, dy] = HI.px(cx, top ? Y + 66 : Y - 2);
        labels.push({ x: dx - 12, y: dy - 14, txt: R.short, col: '#fff6e0', size: 4.2, plate: true });
        if (r.wreck) continue;
        const need = R.need || (R.staff ? 1 : 0);
        if (need && r.sts.length < need && r.bt <= 0) { const [wx, wy] = HI.px(X + 32, Y + 32); labels.push({ x: wx, y: wy - 6, txt: 'no ' + needWord(r.k).split(' ')[0], col: '#ff6b57', size: 4.2 }); }
        if (r.p != null && r.prog > 0) { const sp = RH.spots(k), [bx, by] = HI.px(sp.in[0], sp.in[1]); P(bx - 8, by - 29, 16, 4, '#1b1720'); P(bx - 7, by - 28, Math.round(14 * clamp(r.prog, 0, 1)), 2, R.cat === 'diag' ? '#6fd3ff' : '#7ee081'); }
        if (R.mach && r.bt <= 0) { const left = r.str - r.used, [mx, my] = HI.px(cx + 22, top ? Y + 8 : Y + 56); P(mx - 6, my - 20, 12, 3, '#1b1720'); P(mx - 5, my - 19, Math.round(10 * clamp(left / Math.max(1, r.str), 0, 1)), 1, left <= 2 ? '#ff6b57' : left <= 4 ? '#e5a62a' : '#7ee081'); }
        const q = qn(r); if (q > 0) labels.push({ x: dx + 14, y: dy - 14, txt: q + ' waiting', col: q > 5 ? '#ff6b57' : '#fff6e0', size: 3.6, dim: true });
      }
    }
    for (let i = smokes.length - 1; i >= 0; i--) {
      const q = smokes[i]; q.life -= dt; if (q.life <= 0) { smokes.splice(i, 1); continue; }
      if (q.p !== tab) continue; q.z += dt * 14; q.r += dt * 3;
      const [sx, sy] = HI.px(q.x, q.y); bctx.globalAlpha = clamp(q.life / 1.6, 0, 1) * 0.55; bctx.fillStyle = '#6a6a70'; bctx.beginPath(); bctx.arc(sx, sy - q.z, q.r, 0, Math.PI * 2); bctx.fill(); bctx.globalAlpha = 1;
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const q = sparks[i]; q.life -= dt; if (q.life <= 0) { sparks.splice(i, 1); continue; }
      if (q.p !== tab) continue; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 40 * dt;
      const [sx, sy] = HI.px(q.x, q.y); bctx.globalAlpha = clamp(q.life * 2, 0, 1); P(Math.round(sx), Math.round(sy - q.z), 1, 1, q.col); bctx.globalAlpha = 1;
    }
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const g = ghosts[i]; g.life -= dt; if (g.life <= 0) { ghosts.splice(i, 1); continue; }
      if (g.p !== tab) continue;
      const [sx, sy] = HI.px(g.x, g.y);
      bctx.globalAlpha = clamp(g.life / 1.2, 0, 1) * 0.9;
      bctx.drawImage(ghostSpr, Math.round(sx - 7 + Math.sin(g.life * 6) * 2), Math.round(sy - 20 - (2.2 - g.life) * 14));
      bctx.globalAlpha = 1;
    }

    // ---- blit through the camera (with an earthquake or explosion shake) ----
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#f6f1e9'; ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = cam.z < 1;
    let shx = 0, shy = 0;
    if (shake > 0) { shake -= dt; const a = Math.min(1, shake) * 4; shx = (Math.random() - 0.5) * a; shy = (Math.random() - 0.5) * a; }
    const sx0 = cam.x - cw / cam.z / 2 + shx, sy0 = cam.y - ch / cam.z / 2 + shy;
    ctx.setTransform(DPR * cam.z, 0, 0, DPR * cam.z, -sx0 * DPR * cam.z, -sy0 * DPR * cam.z);
    ctx.drawImage(buf, 0, 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (flash) { flash.life -= dt; ctx.fillStyle = `rgba(255,236,180,${clamp(flash.life * 1.5, 0, 0.6)})`; ctx.fillRect(0, 0, cw, ch); if (flash.life <= 0) flash = null; }
    if (h && h.warm < 0.6 && mine && view.ph === 'play') { ctx.fillStyle = 'rgba(120,170,230,.07)'; ctx.fillRect(0, 0, cw, ch); }
    if (!room.connected || !view) { ctx.fillStyle = 'rgba(5,8,16,.5)'; ctx.fillRect(0, 0, cw, ch); }
    // ---- crisp overlays in screen space ----
    const S = clamp(cam.z, 1.2, 3.2);
    const font = (px, w) => `${w || 700} ${Math.max(10, Math.round(px * S * 0.95))}px 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const l of labels) {
      const [x, y] = toScr(l.x, l.y);
      if (x < -80 || y < -40 || x > cw + 80 || y > ch + 40) continue;
      ctx.font = font(l.size || 5, l.dim ? 600 : 700);
      if (l.plate) {
        const w = ctx.measureText(l.txt).width + 6 * S;
        ctx.fillStyle = '#2b2e3a'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 3.2 * S, w, 6.4 * S, 1.5 * S); ctx.fill();
        ctx.fillStyle = '#5a5f6e'; ctx.fillRect(x - w / 2 + S, y - 3.2 * S + S, w - 2 * S, 0.8 * S);
        ctx.fillStyle = '#fff6e0'; ctx.fillText(l.txt, x, y + S * 0.3);
        continue;
      }
      if (l.bubble) {
        const w = ctx.measureText(l.txt).width + 8 * S, bx = clamp(x, w / 2 + 2, cw - w / 2 - 2);
        ctx.fillStyle = '#1b1720'; ctx.beginPath(); ctx.roundRect(bx - w / 2 - S, y - 4 * S, w + 2 * S, 8 * S, 2 * S); ctx.fill();
        ctx.fillStyle = '#fff6e0'; ctx.beginPath(); ctx.roundRect(bx - w / 2, y - 3 * S, w, 6 * S, 1.5 * S); ctx.fill();
        ctx.fillStyle = '#1b1720'; ctx.fillText(l.txt, bx, y + S * 0.2);
        continue;
      }
      ctx.lineWidth = Math.max(2, S * 0.7); ctx.strokeStyle = '#1b1720'; ctx.globalAlpha = l.dim ? 0.85 : 1;
      ctx.strokeText(l.txt, x, y); ctx.fillStyle = l.col; ctx.fillText(l.txt, x, y); ctx.globalAlpha = 1;
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]; f.life -= dt; if (f.life <= 0) { floaters.splice(i, 1); continue; }
      if (f.p !== tab) continue;
      const [bx, by] = HI.px(f.x, f.y), rise = (1.6 - Math.min(f.life, 1.6)) * 10, [x, y] = toScr(bx, by - 26 - rise);
      ctx.globalAlpha = clamp(f.life * 2, 0, 1); ctx.font = font(f.big ? 7 : 5);
      ctx.lineWidth = Math.max(2, S * 0.8); ctx.strokeStyle = '#1b1720'; ctx.strokeText(f.txt, x, y); ctx.fillStyle = f.col; ctx.fillText(f.txt, x, y);
      ctx.globalAlpha = 1;
    }
    if (view && view.ph === 'ready') {
      ctx.font = font(9); ctx.lineWidth = S; ctx.strokeStyle = '#1b1720'; ctx.strokeText('Opening soon', cw / 2, ch / 2); ctx.fillStyle = '#ffe36b'; ctx.fillText('Opening soon', cw / 2, ch / 2);
    }
    if (decorHint > 0) decorHint -= dt;
  }
  let decorHint = 0;

  // ============================ main loop ============================
  let last = performance.now(), slow = 0;
  function frame(now) {
    // rAF timestamps can precede a performance.now() taken earlier, so never let dt go negative
    const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
    panKeys(dt);
    try {
      render(now / 1000, dt); renderHud(); placeStatus(); monthBar(now);
      if ((slow += dt) > 0.5) { slow = 0; setStatus(); renderFaxes(); if (host) refreshSheets(); }
    } catch (err) { console.error(err); }
    requestAnimationFrame(frame);
  }
  if (host) onPhase();
  setStatus();
  requestAnimationFrame(frame);

  // test hook (read-only)
  window.__rh = { get view() { return view; }, role: room.role, _state: host ? () => state : undefined, act, setTab, cam, fitView };
})();
