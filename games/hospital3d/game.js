// Rival Hospital: networking, rendering, input and UI.
// The host runs the simulation (rules.js) for both hospitals at 60 Hz and broadcasts 10 Hz snapshots.
// The guest sends intents (build / hire / fire / demolish / start) and renders interpolated snapshots.
(async () => {
  'use strict';
  const RH = window.RH, HA = window.HA;
  const { T } = HA;
  const DIRS = ['down', 'up', 'left', 'right'];
  const TICK = 1 / 60, SNAP_HZ = 10;
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const money = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
  const stars = sk => '★'.repeat(Math.round(sk * 5)) + '☆'.repeat(5 - Math.round(sk * 5));
  const qn = r => (Array.isArray(r.q) ? r.q.length : r.q);

  const room = await PT.room({ game: 'hospital3d', title: 'Rival Hospital 3D' });
  const host = room.role === 'host';
  const ME = host ? 0 : 1, FRIEND = 1 - ME;

  // ============================ state ============================
  let state = null;   // host only
  let view = null;    // what we render from: host → state, guest → normalised latest snapshot
  let tab = ME;       // which hospital is on screen
  let lastPhase = null;
  if (host) { state = room.saved || RH.newState(); state.ev = []; if (!state.prof) state.prof = [{ nm: '', av: 0 }, { nm: '', av: 1 }]; view = state; }

  // ============================ profile (name + character) ============================
  const PROFILE_KEY = 'rh_profile';
  let profile = null;
  try { const j = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); if (j && typeof j.nm === 'string') profile = { nm: j.nm.slice(0, 12), av: j.av === 1 ? 1 : 0 }; } catch (e) {}
  let pickAv = profile ? profile.av : ME;
  const nameOf = p => (view && view.prof && view.prof[p] && view.prof[p].nm) || HA.AVATARS[avOf(p)].name;
  const avOf = p => (view && view.prof && view.prof[p] ? view.prof[p].av : p);
  function applyProfile() {
    if (!profile) return;
    if (host) { RH.setProfile(state, 0, profile.nm, profile.av); drainEvents(); hudKey = ''; }
    else if (room.connected) room.send({ t: 'profile', nm: profile.nm, av: profile.av });
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
  function hs(h, p) {
    const rm = {};
    for (const k in h.rooms) { const r = h.rooms[k]; rm[k] = { k: r.k, bt: r1(r.bt), st: r.st, p: r.p, prog: r2(r.prog), n: r.n, q: r.q.length, dis: r.dis }; }
    return { c: h.cash, r: h.rep, cu: h.cured, d: h.died, a: h.angry, ho: h.home, tr: h.treated, inc: h.income, rm, dec: h.decor, ms: h.mess, cf: h.comfort,
      st: h.staff.map(s => ({ id: s.id, k: s.k, nm: s.nm, sk: s.sk, sal: s.sal, slot: s.slot, x: r1(s.x), y: r1(s.y), f: s.f, mv: s.mv, gone: s.gone ? 1 : 0, look: s.look, cl: s.clean > 0 ? 1 : 0 })),
      pt: h.pats.map(q => ({ id: q.id, nm: q.nm, dis: q.dis, dx: q.dx, x: r1(q.x), y: r1(q.y), f: q.f, mv: q.mv, st: q.st, slot: q.slot, pat: Math.round(q.pat), look: q.look, why: q.why })),
      pool: p === 1 ? h.pool : undefined };
  }
  const snapshot = () => ({ t: 's', ph: state.ph, tm: r1(state.t), m: state.month, w: state.winner, why: state.why, pr: state.prof, h: state.h.map(hs), ev: pendingEv.splice(0) });
  const normHosp = x => ({ cash: x.c, rep: x.r, cured: x.cu, died: x.d, angry: x.a, home: x.ho, treated: x.tr, income: x.inc, rooms: x.rm, staff: x.st, pats: x.pt, pool: x.pool, decor: x.dec || {}, mess: x.ms || [], comfort: x.cf || 0 });
  // guest interpolation: previous snapshot positions by entity id
  let prevPos = new Map(), curPos = new Map(), prevAt = 0, curAt = 0;
  function applySnap(m) {
    prevPos = curPos; prevAt = curAt; curPos = new Map(); curAt = performance.now();
    view = { ph: m.ph, t: m.tm, month: m.m, winner: m.w, why: m.why, prof: m.pr, h: m.h.map(normHosp) };
    for (const h of view.h) { for (const e of h.staff) curPos.set('s' + e.id, [e.x, e.y]); for (const e of h.pats) curPos.set('p' + e.id, [e.x, e.y]); }
    for (const e of m.ev || []) onEvent(e);
    onPhase(); refreshSheets();
  }
  function drainEvents() {
    if (!state.ev.length) return;
    const evs = state.ev.splice(0);
    for (const e of evs) onEvent(e);
    pendingEv.push(...evs);
    if (evs.some(e => ['month', 'over', 'built', 'hired', 'fired', 'razed', 'start', 'profile', 'decor', 'undecor'].includes(e.k))) room.save(state);
  }
  function fail(msg) { lastErr = { m: msg, at: performance.now() }; refreshSheets(); toast(msg, 'bad'); }
  let lastErr = null;
  function act(kind, payload) {
    if (!view || view.ph !== 'play') return;
    if (host) {
      const err = kind === 'build' ? RH.build(state, 0, payload.slot, payload.kind) : kind === 'hire' ? RH.hire(state, 0, payload.type, payload.id)
        : kind === 'fire' ? RH.fire(state, 0, payload.id) : kind === 'raze' ? RH.demolish(state, 0, payload.slot)
        : kind === 'decor' ? RH.placeDecor(state, 0, payload.c, payload.r, payload.kind) : kind === 'undecor' ? RH.removeDecor(state, 0, payload.c, payload.r) : 'Unknown';
      if (err) fail(err); else { drainEvents(); refreshSheets(); }
    } else if (room.connected) room.send(Object.assign({ t: kind }, payload));
  }
  room.on('connected', () => { if (host) { pendingEv = []; room.send(snapshot()); } else applyProfile(); setStatus(); });
  room.on('disconnected', () => { setStatus(); });
  room.on('message', m => {
    if (host) {
      let err = null;
      if (m.t === 'build') err = RH.build(state, 1, m.slot | 0, String(m.kind));
      else if (m.t === 'hire') err = RH.hire(state, 1, m.type === 'n' ? 'n' : m.type === 'h' ? 'h' : 'd', m.id | 0);
      else if (m.t === 'fire') err = RH.fire(state, 1, m.id | 0);
      else if (m.t === 'raze') err = RH.demolish(state, 1, m.slot | 0);
      else if (m.t === 'decor') err = RH.placeDecor(state, 1, m.c | 0, m.r | 0, String(m.kind));
      else if (m.t === 'undecor') err = RH.removeDecor(state, 1, m.c | 0, m.r | 0);
      else if (m.t === 'start') { hostStart(); return; }
      else if (m.t === 'profile') { RH.setProfile(state, 1, m.nm, m.av); drainEvents(); hudKey = ''; room.save(state); return; }
      else return;
      if (err) room.send({ t: 'err', m: err });
      drainEvents(); refreshSheets();
    } else if (m.t === 's') applySnap(m);
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
    if (room.connected && now - lastSnap >= 1000 / SNAP_HZ) { lastSnap = now; room.send(snapshot()); }
    if (now - lastSave > 2000) { lastSave = now; room.save(state); }
  }, 1000 / 120);

  // ============================ events, toasts ============================
  const floaters = [], ghosts = [], sparks = [];
  const toastsEl = $('toasts');
  function toast(text, cls) {
    const t = document.createElement('div'); t.className = 'toast ' + (cls || ''); t.textContent = text;
    toastsEl.appendChild(t); setTimeout(() => t.classList.add('out'), 2600); setTimeout(() => t.remove(), 3100);
    while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
  }
  const dname = i => RH.DISEASES[i].name;
  function onEvent(e) {
    const mine = e.p === ME;
    switch (e.k) {
      case 'cured':
        if (mine) { toast(`${e.nm} cured of ${dname(e.dis)} · +${money(e.fee)}`, 'good'); }
        floaters.push({ p: e.p, x: e.x, y: e.y, txt: '+' + money(e.fee), col: '#ffe36b', life: 1.6, big: true });
        for (let i = 0; i < 8; i++) sparks.push({ p: e.p, x: e.x + (Math.random() - .5) * 12, y: e.y + (Math.random() - .5) * 12, z: 10 + Math.random() * 14, vx: (Math.random() - .5) * 30, vy: (Math.random() - .5) * 30, life: .5 + Math.random() * .4, col: '#ffe36b' });
        break;
      case 'died':
        if (mine) toast(`${e.nm} died of ${dname(e.dis)} · reputation −15`, 'bad');
        ghosts.push({ p: e.p, x: e.x, y: e.y, life: 2.2 });
        break;
      case 'uncured': if (mine) toast(`${e.nm} left uncured · reputation −3`, 'dim'); break;
      case 'angry':
        if (mine) toast(`${e.nm} stormed out after waiting too long · reputation −3`, 'bad');
        floaters.push({ p: e.p, x: e.x, y: e.y, txt: '!!', col: '#ff6b57', life: 1.2 });
        break;
      case 'home': if (mine) toast(`${e.nm} sent home: no ${RH.ROOMS[RH.DISEASES[e.dis].room].name} for ${dname(e.dis)}`, 'dim'); break;
      case 'nogp': if (mine) toast(`${e.nm} left: there's no GP's Office!`, 'bad'); break;
      case 'crowd': if (mine) toast(`${e.nm} left: reception is too crowded`, 'dim'); break;
      case 'diag': { const pos = curPosOf('p' + e.id); if (pos) floaters.push({ p: e.p, x: pos[0], y: pos[1], txt: dname(e.dis), col: '#fff6e0', life: 1.4 }); break; }
      case 'vomit': if (mine) toast(`${e.nm} was sick in the corridor · reputation −1`, 'bad'); floaters.push({ p: e.p, x: e.x, y: e.y, txt: 'bleurgh', col: '#b5d86a', life: 1.4 }); break;
      case 'cleaned': for (let i = 0; i < 6; i++) sparks.push({ p: e.p, x: e.x + (Math.random() - .5) * 10, y: e.y + (Math.random() - .5) * 10, z: 2 + Math.random() * 8, vx: (Math.random() - .5) * 20, vy: (Math.random() - .5) * 20, life: .4 + Math.random() * .3, col: '#9fd8ff' }); break;
      case 'dirty': if (mine) toast(`The inspector counted ${e.n} messes on your floors · reputation −${Math.floor(e.n / 2)}`, 'bad'); break;
      case 'decor': if (mine) decorHint = 0; else toast(`${nameOf(e.p)} added a ${RH.DECOR[e.kind].name.toLowerCase()}`, 'dim'); break;
      case 'undecor': break;
      case 'month':
        if (mine) toast(`${RH.MONTH_NAMES[(e.m - 1) % 12]} · fees +${money(e.income)} · salaries −${money(e.sal)}`, e.income >= e.sal ? 'dim' : 'bad');
        break;
      case 'built': if (!mine) toast(`${nameOf(e.p)} built a ${RH.ROOMS[e.kind].name}`, 'dim'); break;
      case 'profile': hudKey = ''; statusKey = ''; setStatus(); break;
      case 'hired': if (mine) toast(`Hired ${e.nm}`, 'dim'); break;
      case 'fired': if (mine) toast(`${e.nm} has been let go`, 'dim'); break;
      case 'razed': if (mine) toast(`Demolished the ${RH.ROOMS[e.kind].name} · half refunded`, 'dim'); break;
      case 'start': floaters.length = ghosts.length = sparks.length = 0; $('over').hidden = true; $('legend').hidden = true; closeSheets(); break;
      case 'over': setTimeout(showOver, 800); break;
    }
  }
  function curPosOf(key) {
    if (!host) return curPos.get(key);
    const id = +key.slice(1);
    for (const h of state.h) { const e = key[0] === 'p' ? RH.patById(h, id) : RH.staffById(h, id); if (e) return [e.x, e.y]; }
    return null;
  }

  // ============================ HUD, status, phases ============================
  let hudKey = '';
  function renderHud() {
    if (!view) return;
    const h = view.h[ME], r = view.h[FRIEND];
    const key = [view.ph, view.month, h.cash, h.rep, h.cured, r.cash, r.rep, r.cured, tab, nameOf(ME), nameOf(FRIEND), avOf(FRIEND)].join('|');
    if (key === hudKey) return; hudKey = key;
    const ym = RH.yearMonth(Math.min(view.month, RH.MONTHS - 1));
    $('hudDate').innerHTML = view.ph === 'ready' ? 'Not open yet' : `Year <b>${ym.year}</b> · <b>${RH.MONTH_NAMES[ym.month]}</b>`;
    $('hudCash').textContent = money(h.cash); $('hudCash').classList.toggle('neg', h.cash < 0);
    $('hudRep').textContent = h.rep; $('hudCured').textContent = h.cured; $('hudScore').textContent = RH.score(h).toLocaleString('en-US');
    $('stCash').classList.toggle('met', h.cash >= RH.TARGETS.cash); $('stRep').classList.toggle('met', h.rep >= RH.TARGETS.rep); $('stCured').classList.toggle('met', h.cured >= RH.TARGETS.cured);
    $('tabMine').replaceChildren(document.createTextNode(`${nameOf(ME)}'s`), Object.assign(el('span', 'alt'), { textContent: ' hospital' }));
    $('tabRival').replaceChildren(document.createTextNode(`${nameOf(FRIEND)}'s `), Object.assign(el('small'), { textContent: `· ${money(r.cash)} · ${r.rep} rep` }));
    const tg = RH.TARGETS, ok = (v, t) => (v >= t ? 'ok' : '');
    $('foot').innerHTML = `<span>Targets:</span><span class="${ok(h.cured, tg.cured)}"><b>${h.cured}</b>/${tg.cured} cured</span><span class="${ok(h.rep, tg.rep)}"><b>${h.rep}</b>/${tg.rep} rep</span><span class="${ok(h.cash, tg.cash)}"><b>${money(h.cash)}</b>/${money(tg.cash)}</span><span class="alt">· or best value after 3 years</span>`;
  }
  let statusKey = '';
  function setStatus() {
    let s, warn = false;
    if (!room.connected) s = 'Waiting for your friend to join…' + (view && view.ph === 'play' ? ' (paused)' : '');
    else if (!view) s = 'Syncing…';
    else if (view.ph === 'ready') s = host ? 'Press “Open the hospital” when you\'re both ready.' : 'Waiting for the host to open the hospitals…';
    else if (view.ph === 'over') s = 'Game over. ' + (host ? 'Press Play again for a rematch.' : 'Ask the host for a rematch.');
    else {
      const h = view.h[ME], rooms = Object.values(h.rooms);
      const unst = rooms.find(r => r.st == null);
      if (tab !== ME) s = `Peeking at ${nameOf(FRIEND)}'s hospital. Tap a room to see what they have.`;
      else if (!rooms.some(r => r.k === 'gp')) { s = 'You have no GP\'s Office! Tap an empty lot to build one.'; warn = true; }
      else if (unst) { s = `Your ${RH.ROOMS[unst.k].name} has no ${RH.ROOMS[unst.k].staff === 'd' ? 'doctor' : 'nurse'}. Hire one under Staff.`; warn = true; }
      else if (h.mess.length >= 3 && !h.staff.some(x => x.k === 'h' && !x.gone)) { s = `${h.mess.length} messes on the floor and nobody to clean them. Hire a handyman under Staff.`; warn = true; }
      else if (!rooms.some(r => r.k !== 'gp')) s = 'Build a Pharmacy next: colds and gut rot are the most common complaints.';
      else s = 'Tap a lot to build · tap a corridor tile to decorate · tap a room or patient for details' + (scroller.scrollWidth > scroller.clientWidth + 4 ? ' · swipe to see it all' : '');
    }
    if (s !== statusKey) { statusKey = s; $('status').textContent = s; $('status').classList.toggle('warn', warn); }
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

  // ============================ sheets ============================
  const sheets = ['legend', 'buildSheet', 'roomSheet', 'staffSheet', 'over', 'profile', 'decorSheet'];
  const panelOpen = () => sheets.some(id => !$(id).hidden);
  function closeSheets() { for (const id of sheets) if (id !== 'legend' && id !== 'over') $(id).hidden = true; openSlot = null; }
  let openSlot = null, razeArmed = false;
  function spriteCanvas(sheet, px) { const c = document.createElement('canvas'); c.width = Math.round(16 * px / 24); c.height = px; c.style.width = c.width + 'px'; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(sheet.down[0], 0, 0, c.width, c.height); return c; }
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  function openBuild(k) {
    openSlot = k; razeArmed = false; $('buildErr').textContent = '';
    $('buildSheet').hidden = false; refreshBuild();
  }
  function refreshBuild() {
    if ($('buildSheet').hidden || !view) return;
    const h = view.h[ME];
    if (h.rooms[openSlot] || view.ph !== 'play') { $('buildSheet').hidden = true; return; }
    $('buildSub').textContent = `Lot ${openSlot + 1} · you have ${money(h.cash)}`;
    const list = $('buildList'); list.replaceChildren();
    for (const kind of RH.ROOM_ORDER) {
      const R = RH.ROOMS[kind], cures = RH.DISEASES.filter(d => d.room === kind).map(d => d.name);
      const b = el('button', 'item room'); b.disabled = h.cash < R.cost;
      const body = el('div'); body.append(el('b', null, R.name), el('small', null, (kind === 'gp' ? 'Diagnoses every patient. ' : 'Cures ' + cures.join(', ') + '. ') + 'Needs a ' + (R.staff === 'd' ? 'doctor' : 'nurse') + '.'));
      b.append(body, el('span', 'price', money(R.cost)));
      b.addEventListener('click', () => { act('build', { slot: openSlot, kind }); $('buildSheet').hidden = true; });
      list.append(b);
    }
    $('buildErr').textContent = lastErr && performance.now() - lastErr.at < 4000 ? lastErr.m : '';
  }
  function openRoom(k) { openSlot = k; razeArmed = false; $('roomSheet').hidden = false; refreshRoom(); }
  function refreshRoom() {
    if ($('roomSheet').hidden || !view) return;
    const h = view.h[tab], r = h.rooms[openSlot];
    if (!r) { $('roomSheet').hidden = true; return; }
    const R = RH.ROOMS[r.k];
    $('roomTitle').textContent = R.name + (tab !== ME ? ' (rival)' : '');
    $('roomSub').textContent = r.bt > 0 ? 'Under construction…' : `Lot ${openSlot + 1} · ${r.n} patient${r.n === 1 ? '' : 's'} seen · ${qn(r)} waiting`;
    const info = $('roomInfo'); info.replaceChildren();
    const st = r.st != null ? h.staff.find(s => s.id === r.st) : null;
    const si = el('div', 'item'); si.append(st ? spriteCanvas(HA.staffSheet(st.look, st.k), 33) : el('span', null, '—'));
    const sb = el('div'); sb.append(el('b', null, st ? st.nm : 'Nobody working here'), el('small', null, st ? `skill ${stars(st.sk)} · ${money(st.sal)}/month` : `Hire a ${R.staff === 'd' ? 'doctor' : 'nurse'} under Staff`));
    si.append(sb, el('span')); info.append(si);
    const pt = r.p != null ? h.pats.find(x => x.id === r.p) : null;
    if (pt) {
      const pi = el('div', 'item'); pi.append(spriteCanvas(HA.patientSheet(pt.look, RH.DISEASES[pt.dis].id), 33));
      const pb = el('div'); pb.append(el('b', null, pt.nm), el('small', null, (r.k === 'gp' ? 'Being diagnosed' : 'Being treated for ' + dname(pt.dis)) + ` · ${Math.round(r.prog * 100)}%`));
      pi.append(pb, el('span')); info.append(pi);
    }
    if (r.k !== 'gp') { const c = el('div', 'item'); c.append(el('span', null, '✚'), el('small', null, 'Cures ' + RH.DISEASES.filter(d => d.room === r.k).map(d => `${d.name} (${money(d.fee)})`).join(', ')), el('span')); info.append(c); }
    const canRaze = tab === ME && view.ph === 'play';
    $('roomRaze').hidden = !canRaze;
    $('roomRaze').textContent = razeArmed ? `Really demolish? +${money(R.cost / 2)}` : 'Demolish';
    $('roomNote').textContent = canRaze ? 'Demolishing refunds half the cost.' : '';
  }
  $('roomRaze').addEventListener('click', () => { if (!razeArmed) { razeArmed = true; refreshRoom(); return; } act('raze', { slot: openSlot }); $('roomSheet').hidden = true; });
  let decorSpotSel = null;
  function openDecor(c, r) {
    decorSpotSel = [c, r]; $('decorErr').textContent = '';
    const h = view.h[ME];
    $('decorSub').textContent = `Corridor tile ${c - 1} · comfort ${h.comfort}/${RH.MAX_COMFORT} · you have ${money(h.cash)}`;
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
    $('decorSheet').hidden = false;
  }
  function openDecorInfo(c, r) {
    decorSpotSel = [c, r];
    const h = view.h[ME], kind = h.decor[RH.decorKey(c, r)]; if (!kind) return;
    $('decorSub').textContent = `${RH.DECOR[kind].name} · ${RH.DECOR[kind].desc}`;
    const list = $('decorList'); list.replaceChildren();
    $('decorRemove').hidden = view.ph !== 'play'; $('decorRemove').textContent = `Remove · +${money(RH.DECOR[kind].cost / 2)}`;
    $('decorErr').textContent = '';
    $('decorSheet').hidden = false;
  }
  $('decorRemove').addEventListener('click', () => { if (decorSpotSel) act('undecor', { c: decorSpotSel[0], r: decorSpotSel[1] }); $('decorSheet').hidden = true; });
  $('decorClose').addEventListener('click', () => { $('decorSheet').hidden = true; });
  $('decorBtn').addEventListener('click', () => { if (tab !== ME) setTab(ME); decorHint = 6; toast('Tap one of the glowing corridor spots to place something', 'dim'); });
  function openStaff() { $('staffSheet').hidden = false; $('staffErr').textContent = ''; refreshStaff(); }
  function refreshStaff() {
    if ($('staffSheet').hidden || !view) return;
    const h = view.h[ME], pool = h.pool || { d: [], n: [] };
    const hl = $('hireList'); hl.replaceChildren();
    for (const c of pool.d.concat(pool.n, pool.h || [])) {
      const b = el('button', 'item'); b.disabled = view.ph !== 'play' || h.cash < c.sal;
      b.append(spriteCanvas(HA.staffSheet(c.id % 8, c.k), 33));
      const body = el('div'); body.append(el('b', null, c.nm), el('small', null, `${c.k === 'd' ? 'Doctor' : c.k === 'n' ? 'Nurse' : 'Handyman: mops up sick and litter'} · skill `), el('span', 'skill', stars(c.sk)));
      b.append(body, el('span', 'price', money(c.sal) + '/mo'));
      b.addEventListener('click', () => act('hire', { type: c.k, id: c.id }));
      hl.append(b);
    }
    if (!hl.children.length) hl.append(el('small', null, 'Nobody is looking for work right now. New candidates arrive next month.'));
    const sl = $('staffList'); sl.replaceChildren();
    let bill = 0;
    for (const s of h.staff) {
      if (s.gone) continue; bill += s.sal;
      const it = el('div', 'item'); it.append(spriteCanvas(HA.staffSheet(s.look, s.k), 33));
      const body = el('div'); body.append(el('b', null, s.nm), el('small', null, (s.k === 'h' ? 'Handyman, roaming the corridor' : s.slot != null && h.rooms[s.slot] ? RH.ROOMS[h.rooms[s.slot].k].name : 'No room yet: hanging about the entrance') + ' · ' + money(s.sal) + '/mo '), el('span', 'skill', stars(s.sk)));
      const fb = el('button', 'pt-btn pt-btn-small pt-btn-ghost', 'Fire'); fb.disabled = view.ph !== 'play';
      fb.addEventListener('click', () => { if (fb.dataset.armed) act('fire', { id: s.id }); else { fb.dataset.armed = '1'; fb.textContent = 'Sure?'; setTimeout(() => { fb.textContent = 'Fire'; delete fb.dataset.armed; }, 2000); } });
      it.append(body, fb); sl.append(it);
    }
    if (!sl.children.length) sl.append(el('small', null, 'No staff yet.'));
    $('payroll').textContent = bill ? `· ${money(bill)} a month` : '';
    $('staffErr').textContent = lastErr && performance.now() - lastErr.at < 4000 ? lastErr.m : '';
  }
  function refreshSheets() { refreshBuild(); refreshRoom(); refreshStaff(); }
  function showOver() {
    if (!view || view.ph !== 'over') return;
    const a = view.h[ME], b = view.h[FRIEND], w = view.winner;
    $('ovTitle').textContent = 'Year 3 is over';
    $('ovVerdict').textContent = w === ME ? `${nameOf(ME)}'s hospital wins!` : w === FRIEND ? `${nameOf(FRIEND)}'s hospital wins` : 'Dead heat!';
    $('ovWhy').textContent = view.why === 'targets' ? 'All three targets were met first.' : 'Three years are up: the higher hospital value wins.';
    const rows = [['Value', RH.score(a).toLocaleString('en-US'), RH.score(b).toLocaleString('en-US')], ['Cash', money(a.cash), money(b.cash)], ['Reputation', a.rep, b.rep], ['Cured', a.cured, b.cured], ['Deaths', a.died, b.died], ['Walked out', a.angry, b.angry], ['Sent home', a.home, b.home], ['Rooms', Object.keys(a.rooms).length, Object.keys(b.rooms).length]];
    const c = $('ovCmp'); c.replaceChildren(el('span', 'a hd', nameOf(ME)), el('span', 'k', ''), el('span', 'b hd', nameOf(FRIEND)));
    for (const [k, x, y] of rows) c.append(el('span', 'a', String(x)), el('span', 'k', k), el('span', 'b', String(y)));
    closeSheets(); $('legend').hidden = true; $('over').hidden = false;
  }
  // legend
  (function buildLegend() {
    const tg = RH.TARGETS;
    $('legendWin').textContent = `Be the first to reach all three targets: ${tg.cured} patients cured, ${tg.rep} reputation and ${money(tg.cash)} in the bank. If nobody gets there in three years (${RH.MONTHS} months of ${RH.MONTH} seconds), the higher hospital value wins: cash + $250 per cure + a reputation bonus.`;
    const tb = $('disTable'); tb.replaceChildren();
    for (const d of RH.DISEASES) {
      const tr = el('tr'), c0 = el('td'), c1 = el('td'), c2 = el('td');
      c0.append(spriteCanvas(HA.patientSheet(RH.DISEASES.indexOf(d) + 2, d.id), 30));
      c1.append(el('b', null, d.name), el('small', null, ' · ' + RH.ROOMS[d.room].name)); c1.append(el('br'), el('small', null, d.desc));
      c2.textContent = money(d.fee);
      tr.append(c0, c1, c2); tb.append(tr);
    }
    $('legendNote').textContent = host ? 'Close this, then press “Open the hospital”.' : 'The host opens the hospitals.';
  })();
  function toggleLegend() { if ($('legend').hidden) { closeSheets(); $('over').hidden = true; $('legend').hidden = false; } else if (view && view.ph !== 'ready') $('legend').hidden = true; }
  $('helpBtn').addEventListener('click', toggleLegend);
  $('legendClose').addEventListener('click', () => { $('legend').hidden = true; });
  $('startBtn').addEventListener('click', requestStart);
  $('buildClose').addEventListener('click', () => { $('buildSheet').hidden = true; });
  $('roomClose').addEventListener('click', () => { $('roomSheet').hidden = true; });
  $('staffClose').addEventListener('click', () => { $('staffSheet').hidden = true; });
  $('staffBtn').addEventListener('click', openStaff);
  $('profBtn').addEventListener('click', openProfile);
  $('profSave').addEventListener('click', saveProfile);
  $('profInput').addEventListener('keydown', e => { if (e.key === 'Enter') saveProfile(); });
  if (host) applyProfile(); else renderProfBtn();
  if (!profile) openProfile();
  $('ovClose').addEventListener('click', () => { $('over').hidden = true; });
  $('ovAgain').addEventListener('click', () => { if (host) { RH.start(state); drainEvents(); onPhase(); room.save(state); } else { requestStart(); $('ovAgain').textContent = 'Asked the host…'; setTimeout(() => ($('ovAgain').textContent = 'Play again'), 2000); } });
  function setTab(p) { tab = p; $('tabMine').classList.toggle('on', p === ME); $('tabRival').classList.toggle('on', p !== ME); selected = null; closeSheets(); hudKey = ''; statusKey = ''; setStatus(); }
  $('tabMine').addEventListener('click', () => setTab(ME));
  $('tabRival').addEventListener('click', () => setTab(FRIEND));
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || !$('profile').hidden) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (!$('legend').hidden && view && view.ph !== 'ready') $('legend').hidden = true; closeSheets(); return; }
    if (k === 'h' || k === '?') { if (!e.repeat) toggleLegend(); return; }
    if (k === 'tab') { e.preventDefault(); setTab(tab === ME ? FRIEND : ME); return; }
    if (k === 's' && !panelOpen()) openStaff();
  });

  // ============================ canvas, input ============================
  const HI = window.HI;
  const cv = $('view'), ctx = cv.getContext('2d'), scroller = $('scroller');
  const BW = HI.BW, BH = HI.BH;
  const [buf, bctx] = HA.canvas(BW, BH);
  const groundC = HI.ground(), ghostSpr = HA.ghost(), mopSpr = HA.furniture('mop');
  const outsideItems = HI.outside();
  let S = 2, DPR = 1;
  function resize() {
    const r = scroller.getBoundingClientRect(); DPR = devicePixelRatio || 1;
    S = Math.floor(Math.min(r.width / BW, (r.height - 4) / BH) * 2) / 2;
    if (S < 2) S = 2;
    cv.style.width = BW * S + 'px'; cv.style.height = BH * S + 'px';
    cv.width = Math.round(BW * S * DPR); cv.height = Math.round(BH * S * DPR);
  }
  addEventListener('resize', resize); resize(); setTimeout(resize, 300);
  let selected = null, down = null;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || performance.now() - down.t > 600) { down = null; return; }
    down = null;
    const r = cv.getBoundingClientRect();
    const [wx, wy] = HI.unproj((e.clientX - r.left) / S, (e.clientY - r.top) / S);
    onTap(wx, wy);
  });
  cv.addEventListener('pointercancel', () => { down = null; });
  function slotAt(bx, by) {
    if (bx < 32 || bx >= RH.W * T) return null;
    const col = Math.floor((bx - 32) / 64);
    if (by >= 0 && by < 64) return col; if (by >= 112 && by < RH.H * T) return 5 + col; return null;
  }
  function onTap(bx, by) {
    if (!view || panelOpen()) return;
    const h = view.h[tab];
    // people first: hit test against the projected sprite box
    const [tx, ty] = HI.px(bx, by);
    let best = null, bd = 1e9;
    for (const pt of h.pats) { const [x, y] = posOf('p', pt); const [sx, sy] = HI.px(x, y); if (Math.abs(tx - sx) <= 8 && ty <= sy + 2 && ty >= sy - 24) { const d = Math.abs(tx - sx) + Math.abs(ty - (sy - 12)); if (d < bd) { bd = d; best = pt; } } }
    if (best) { selected = { id: best.id, until: performance.now() + 3500 }; return; }
    selected = null;
    const k = slotAt(bx, by);
    if (k != null) { if (h.rooms[k]) openRoom(k); else if (tab === ME && view.ph === 'play') openBuild(k); return; }
    const c = Math.floor(bx / T), r = Math.floor(by / T);
    if (RH.decorSpot(c, r) && tab === ME) { if (h.decor[RH.decorKey(c, r)]) openDecorInfo(c, r); else if (view.ph === 'play') openDecor(c, r); }
  }

  // ============================ rendering ============================
  const P = (x, y, w, h, col) => { bctx.fillStyle = col; bctx.fillRect(x, y, w, h); };
  function posOf(kind, e) {
    if (host) return [e.x, e.y];
    const prev = prevPos.get(kind + e.id); if (!prev) return [e.x, e.y];
    const span = Math.max(50, curAt - prevAt), k = clamp((performance.now() - curAt) / span, 0, 1);
    return [prev[0] + (e.x - prev[0]) * k, prev[1] + (e.y - prev[1]) * k];
  }
  const animT = new Map();
  // draws an upright sprite at its projected feet; returns the screen position of the feet
  function drawPerson(sheet, e, kind, t, dt, wx, wy) {
    const key = kind + e.id;
    const a = (animT.get(key) || 0) + (e.mv ? dt : 0); animT.set(key, e.mv ? a : 0);
    const frame = e.mv ? [1, 0, 2, 0][Math.floor(a * 8) % 4] : 0;
    const dir = sheet[DIRS[e.f]] || sheet.down, sh = dir[frame] || dir[0];
    const [sx, sy] = HI.px(wx, wy);
    bctx.fillStyle = 'rgba(0,0,0,.28)'; bctx.beginPath(); bctx.ellipse(sx, sy, 6, 3, 0, 0, Math.PI * 2); bctx.fill();
    bctx.drawImage(sh, Math.round(sx) - 8, Math.round(sy) - 23);
    return [Math.round(sx), Math.round(sy)];
  }
  const labels = [];  // device-space text drawn after the blit (positions in buffer px)
  function render(t, dt) {
    labels.length = 0;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#111'; bctx.fillRect(0, 0, BW, BH);
    const h = view ? view.h[tab] : null;
    const mine = tab === ME;
    // floors
    HI.floorAt(bctx, groundC, 0, 0);
    if (h) for (const key in h.rooms) { const k = +key, r = h.rooms[k]; HI.floorAt(bctx, HI.roomFloor(r.k), RH.slotX0(k) * T, RH.slotY0(k) * T); }
    const objs = outsideItems.slice();
    // walls, furniture, lots
    for (let k = 0; k < RH.SLOTS; k++) {
      const X = RH.slotX0(k) * T, Y = RH.slotY0(k) * T, top = RH.slotTop(k), r = h && h.rooms[k];
      if (!r) {
        objs.push(...HI.lotWalls(X, Y, top));
        if (h && mine && view.ph === 'play') objs.push({ d: X + Y + 64, draw: c => { const [sx, sy] = HI.px(X + 32, Y + 32); const a = 0.5 + Math.sin(t * 3) * 0.2; c.globalAlpha = a; P(sx - 1, sy - 9, 2, 10, '#5a5246'); P(sx - 5, sy - 5, 10, 2, '#5a5246'); c.globalAlpha = 1; } });
        continue;
      }
      objs.push(...HI.roomWalls(k, r.k, X, Y, top));
      if (r.bt > 0) { objs.push(...HI.scaffoldItems(X, Y, 1 - r.bt / 4)); continue; }
      for (const it of HI.ROOM_ITEMS[r.k]) objs.push({ d: X + it.x + it.w + Y + it.y + it.d, draw: c => it.draw(c, X, Y) });
    }
    if (h) {
      // corridor decoration + mess + free-spot markers
      for (const key in h.decor) { const [c, r] = key.split(',').map(Number), kind = h.decor[key], [fw, fd] = HI.DECOR_FOOT[kind], x = c * T + 8, y = r * T + 8; objs.push({ d: x + fw / 2 + y + fd / 2, draw: cx => HI.DECOR_DRAW[kind](cx, x, y) }); }
      for (const m of h.mess) objs.push(HI.messItem(m));
      if (mine && view.ph === 'play' && decorHint > 0) for (let c = 2; c < RH.W; c++) for (const r of [4, 6]) if (RH.decorSpot(c, r) && !h.decor[RH.decorKey(c, r)]) objs.push({ d: c * T + 8 + r * T + 8, draw: cx => { const [sx, sy] = HI.px(c * T + 8, r * T + 8); cx.globalAlpha = 0.35 + Math.sin(t * 4) * 0.15; P(sx - 1, sy - 1, 3, 3, '#1f8f87'); cx.globalAlpha = 1; } });
      // people
      for (const st of h.staff) objs.push({ d: st.x + st.y, draw: () => {
        const [x, y] = posOf('s', st);
        const [sx, sy] = drawPerson(HA.staffSheet(st.look, st.k), st, 's', t, dt, x, y);
        if (st.k === 'h' && (st.cl || st.clean > 0)) { bctx.drawImage(mopSpr, sx + 5 + (Math.floor(t * 6) % 2 ? 2 : 0), sy - 20); }
      } });
      for (const pt of h.pats) objs.push({ d: pt.x + pt.y, draw: () => {
        const dis = RH.DISEASES[pt.dis], shown = pt.why === 'cured' ? null : dis.id;
        const [x, y] = posOf('p', pt);
        const [sx, sy] = drawPerson(HA.patientSheet(pt.look, shown), pt, 'p', t, dt, x, y);
        if (pt.st === 'queue' && pt.pat < 15 && Math.floor(t * 4) % 2) { P(sx - 1, sy - 30, 2, 4, '#ff6b57'); P(sx - 1, sy - 25, 2, 1, '#ff6b57'); }
        if (dis.id === 'sleep' && shown && Math.floor(t * 2) % 2) labels.push({ x: sx + 7, y: sy - 28, txt: 'z', col: '#9fd8ff', size: 5 });
        if (pt.why === 'cured' && Math.floor(t * 3) % 2) { P(sx + 7, sy - 27, 1, 3, '#ffe36b'); P(sx + 6, sy - 26, 3, 1, '#ffe36b'); }
        if (selected && selected.id === pt.id && performance.now() < selected.until) {
          labels.push({ x: sx, y: sy - 32, txt: pt.nm + ' · ' + (pt.dx ? dis.name : 'undiagnosed') + (pt.st === 'queue' ? ' · patience ' + Math.max(0, Math.round(pt.pat)) + 's' : pt.st === 'in' ? ' · in treatment' : pt.why === 'cured' ? ' · cured!' : ''), col: '#fff6e0', bubble: true, size: 4.6 });
        }
      } });
      // the manager pacing the corridor with a clipboard (cosmetic, driven by local time)
      {
        const ph = (t % 48) / 48, x0 = 46, x1 = 298;
        let mx, mf, mv;
        if (ph < 0.4) { mx = x0 + (ph / 0.4) * (x1 - x0); mf = 3; mv = 1; } else if (ph < 0.5) { mx = x1; mf = 0; mv = 0; } else if (ph < 0.9) { mx = x1 - ((ph - 0.5) / 0.4) * (x1 - x0); mf = 2; mv = 1; } else { mx = x0; mf = 0; mv = 0; }
        const mgr = { id: 'm' + tab, f: mf, mv }, my = RH.LANE - 3;
        objs.push({ d: mx + my, draw: () => { const [sx, sy] = drawPerson(HA.managerSheet(avOf(tab)), mgr, 'g', t, dt, mx, my); labels.push({ x: sx, y: sy - 30, txt: nameOf(tab), col: '#fff6e0', size: 3.8, plate: true }); } });
      }
      // receptionist behind the desk
      objs.push({ d: 12 + 94, draw: () => { const [sx, sy] = HI.px(12, 94); bctx.drawImage(HA.staffSheet(3, 'r').down[0], Math.round(sx) - 8, Math.round(sy) - 23); } });
    }
    objs.sort((a, b) => a.d - b.d).forEach(o => o.draw(bctx));
    if (h) {
      // room signs, warnings, treatment bars, queue counts
      for (const key in h.rooms) {
        const k = +key, r = h.rooms[k], X = RH.slotX0(k) * T, Y = RH.slotY0(k) * T, cx = RH.slotCx(k), top = RH.slotTop(k);
        const [dx, dy] = HI.px(cx, top ? 66 : 110);
        labels.push({ x: dx - 12, y: dy - (top ? 16 : 14), txt: RH.ROOMS[r.k].short, col: '#fff6e0', size: 4.2, plate: true });
        if (r.st == null && r.bt <= 0) { const [wx, wy] = HI.px(X + 32, Y + 40); labels.push({ x: wx, y: wy - 6, txt: 'no ' + (RH.ROOMS[r.k].staff === 'd' ? 'doctor' : 'nurse'), col: '#ff6b57', size: 4.2 }); }
        if (r.p != null && r.prog > 0) { const sp = RH.spots(k), [bx, by] = HI.px(sp.in[0], sp.in[1]); P(bx - 8, by - 29, 16, 4, '#1b1720'); P(bx - 7, by - 28, Math.round(14 * clamp(r.prog, 0, 1)), 2, r.k === 'gp' ? '#6fd3ff' : '#7ee081'); }
        const q = qn(r); if (q > 0) labels.push({ x: dx + 14, y: dy - (top ? 16 : 14), txt: q + ' waiting', col: q > 5 ? '#ff6b57' : '#fff6e0', size: 3.6, dim: true });
      }
    }
    // effects (world coordinates, projected)
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
    const vg = bctx.createRadialGradient(BW / 2, BH / 2, BW * 0.3, BW / 2, BH / 2, BW * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(20,10,30,.22)'); bctx.fillStyle = vg; bctx.fillRect(0, 0, BW, BH);
    if (!room.connected || !view) { bctx.fillStyle = 'rgba(20,16,24,.45)'; bctx.fillRect(0, 0, BW, BH); }

    // ---- blit ----
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 0, 0, BW * S, BH * S);
    // ---- crisp overlays ----
    const font = (px, w) => `${w || 700} ${Math.max(10, Math.round(px * S * 0.95))}px 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const l of labels) {
      ctx.font = font(l.size || 5, l.dim ? 600 : 700);
      const x = l.x * S, y = l.y * S;
      if (l.plate) {
        const w = ctx.measureText(l.txt).width + 6 * S;
        ctx.fillStyle = '#2b2e3a'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 3.2 * S, w, 6.4 * S, 1.5 * S); ctx.fill();
        ctx.fillStyle = '#5a5f6e'; ctx.fillRect(x - w / 2 + S, y - 3.2 * S + S, w - 2 * S, 0.8 * S);
        ctx.fillStyle = '#fff6e0'; ctx.fillText(l.txt, x, y + S * 0.3);
        continue;
      }
      if (l.bubble) {
        const w = ctx.measureText(l.txt).width + 8 * S, bx = clamp(x, w / 2 + 2, BW * S - w / 2 - 2);
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
      const [sx, sy] = HI.px(f.x, f.y);
      const rise = (1.6 - Math.min(f.life, 1.6)) * 10;
      ctx.globalAlpha = clamp(f.life * 2, 0, 1); ctx.font = font(f.big ? 7 : 5);
      ctx.lineWidth = Math.max(2, S * 0.8); ctx.strokeStyle = '#1b1720'; ctx.strokeText(f.txt, sx * S, (sy - 26 - rise) * S); ctx.fillStyle = f.col; ctx.fillText(f.txt, sx * S, (sy - 26 - rise) * S);
      ctx.globalAlpha = 1;
    }
    if (view && view.ph === 'ready') {
      ctx.font = font(9); ctx.lineWidth = S; ctx.strokeStyle = '#1b1720'; ctx.strokeText('Opening soon', BW * S / 2, BH * S / 2); ctx.fillStyle = '#ffe36b'; ctx.fillText('Opening soon', BW * S / 2, BH * S / 2);
    }
    if (decorHint > 0) decorHint -= dt;
  }
  let decorHint = 0;

  // ============================ main loop ============================
  let last = performance.now();
  function frame(now) {
    // rAF timestamps can precede a performance.now() taken earlier, so never let dt go negative
    const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
    try { render(now / 1000, dt); renderHud(); } catch (err) { console.error(err); }
    requestAnimationFrame(frame);
  }
  if (host) onPhase();
  setStatus();
  requestAnimationFrame(frame);

  // test hook (read-only)
  window.__rh = { get view() { return view; }, role: room.role, _state: host ? () => state : undefined, act, setTab };
})();
