// Manor Mystery: game loop, rendering, input, UI and networking.
// Host is authoritative for the case (killer/weapon/room), clue reveals, NPCs and accusations.
// Each player moves their own detective locally and sends positions (it's a friendly race).
(async () => {
  'use strict';
  const Wd = window.MM_WORLD, A = window.MM_ART;
  const { T, W, H, ROOMS, HALL, F, SUSPECTS, WEAPONS, BODY, INSPECTOR, SPAWN } = Wd;
  const DIRS = ['down', 'up', 'left', 'right'];
  const LOOK_OF = ['colonel', 'doctor', 'vane', 'reverend', 'finch', 'butler', 'professor', 'countess'];
  const SPEED = 72, NPC_SPEED = 26;

  // ============================ networking & state ============================
  const room = await PT.room({ game: 'mystery', title: 'Manor Mystery' });
  const host = room.role === 'host';
  const ME = host ? 'A' : 'B', FRIEND = host ? 'B' : 'A';

  // ---- host-only ----
  let state = null, kase = null;
  function newState(prev) {
    return { caseNo: prev ? prev.caseNo + 1 : 1, seed: (Math.random() * 2 ** 31) | 0, phase: 'play', out: { A: false, B: false },
             winner: null, score: prev ? prev.score : { A: 0, B: 0 }, found: { A: [], B: [] } };
  }
  function pubOf(s) {
    return { caseNo: s.caseNo, phase: s.phase, out: s.out, winner: s.winner, score: s.score,
             solution: s.phase === 'over' ? { k: kase.killer, w: kase.weapon, r: kase.room } : null };
  }
  const notebookFor = p => state.found[p].map(id => Wd.reveal(kase, id)).filter(Boolean);

  // ---- shared view state (both sides) ----
  let pub = null;                 // public game info
  let notebook = [];              // my revealed entries
  const me = { look: host ? 'detA' : 'detB', x: SPAWN[ME].px, y: SPAWN[ME].py, dir: 0, moving: false, anim: 0 };
  const friend = { look: host ? 'detB' : 'detA', x: SPAWN[FRIEND].px, y: SPAWN[FRIEND].py, tx: SPAWN[FRIEND].px, ty: SPAWN[FRIEND].py, dir: 0, moving: false, anim: 0, seen: false };
  let npcs = [];                  // [{look, x, y, dir, moving, anim, ...}]
  const inspector = { look: 'inspector', x: INSPECTOR.px, y: INSPECTOR.py, dir: 0, moving: false, anim: 0 };

  function startCase() {
    kase = Wd.genCase(state.seed);
    npcs = SUSPECTS.map((s, i) => {
      const st = Wd.npcStart(kase, i);
      return { look: LOOK_OF[i], x: st.px, y: st.py, tx: st.px, ty: st.py, dir: 0, moving: false, anim: 0, room: st.room, wait: 1 + Math.random() * 3, talk: 0 };
    });
  }
  function resetMe() {
    me.x = SPAWN[ME].px; me.y = SPAWN[ME].py; me.dir = 1; me.moving = false;
    friend.x = friend.tx = SPAWN[FRIEND].px; friend.y = friend.ty = SPAWN[FRIEND].py;
    closeAllPanels();
  }

  if (host) {
    state = room.saved || newState();
    startCase();
    pub = pubOf(state);
    notebook = notebookFor('A');
  }

  function hostSync() {
    room.save(state);
    pub = pubOf(state);
    room.send({ t: 'pub', pub });
    onPub();
  }

  function hostExamine(p, id) {
    if (state.phase !== 'play' && id !== 'insp') return null;
    if (id === 'insp') return { id, kind: 'inspector' };
    const e = Wd.reveal(kase, id);
    if (!e) return null;
    if (!state.found[p].includes(id)) {
      state.found[p].push(id);
      room.save(state);
      if (e.kind === 'clue') toFriendOf(p, { t: 'evt', kind: 'found' });
      if (e.kind === 'statement') toFriendOf(p, { t: 'evt', kind: 'talk', who: +id.slice(1) });
    }
    if (id[0] === 'n') { const n = npcs[+id.slice(1)]; n.talk = 4; n.talkTo = p === 'A' ? me : friend; }
    return e;
  }
  function toFriendOf(p, msg) { if (p === 'A') room.send(msg); else onEvent(msg); }

  function hostAccuse(p, k, w, r) {
    if (state.phase !== 'play' || state.out[p]) return;
    if (k === kase.killer && w === kase.weapon && r === kase.room) { state.phase = 'over'; state.winner = p; state.score[p]++; }
    else {
      state.out[p] = true;
      const evt = { t: 'evt', kind: 'wrong', who: p };
      room.send(evt); onEvent(evt);
      if (state.out.A && state.out.B) { state.phase = 'over'; state.winner = null; }
    }
    hostSync();
  }
  function hostAgain() {
    if (state.phase !== 'over') return;
    state = newState(state);
    startCase();
    notebook = [];
    hostSync();
    room.send({ t: 'nb', entries: [] });
  }

  // ---- messages ----
  room.on('connected', () => {
    if (host) { room.send({ t: 'pub', pub }); room.send({ t: 'nb', entries: notebookFor('B') }); }
    setStatus();
  });
  room.on('disconnected', () => { friend.seen = false; setStatus(); });
  room.on('message', m => {
    if (host) {
      if (m.t === 'pos') { friend.tx = m.x; friend.ty = m.y; friend.dir = m.d; friend.moving = !!m.m; if (!friend.seen) { friend.x = m.x; friend.y = m.y; friend.seen = true; } }
      else if (m.t === 'ex') {
        if (Math.hypot(friend.tx - m.x, friend.ty - m.y) > 40) return; // stale/far: ignore
        const e = hostExamine('B', m.id);
        if (e) room.send({ t: 'rev', entry: e });
      }
      else if (m.t === 'acc') hostAccuse('B', m.k, m.w, m.r);
      else if (m.t === 'again') hostAgain();
    } else {
      if (m.t === 'pub') { const newCase = !pub || pub.caseNo !== m.pub.caseNo; pub = m.pub; if (newCase) resetMe(); onPub(); }
      else if (m.t === 'nb') { notebook = m.entries; renderNotebook(); }
      else if (m.t === 'rev') { addEntry(m.entry); showEntry(m.entry); }
      else if (m.t === 'evt') onEvent(m);
      else if (m.t === 's') {
        const [x, y, d, mv] = m.a; friend.tx = x; friend.ty = y; friend.dir = d; friend.moving = !!mv;
        if (!friend.seen) { friend.x = x; friend.y = y; friend.seen = true; }
        m.n.forEach((v, i) => {
          if (!npcs[i]) npcs[i] = { look: LOOK_OF[i], x: v[0], y: v[1], tx: v[0], ty: v[1], dir: v[2], moving: false, anim: 0 };
          const n = npcs[i]; n.tx = v[0]; n.ty = v[1]; n.dir = v[2]; n.moving = !!v[3];
        });
        inspector.dir = m.i;
      }
    }
  });

  function addEntry(e) { if (!notebook.some(n => n.id === e.id)) { notebook.push(e); renderNotebook(); } }

  // examine something (both roles)
  function examine(id) {
    if (!pub) return;
    if (id === 'insp') return inspectorTalk();
    if (pub.phase !== 'play') return;
    if (host) { const e = hostExamine('A', id); if (e) { addEntry(e); showEntry(e); } }
    else room.send({ t: 'ex', id, x: Math.round(me.x), y: Math.round(me.y) });
  }
  function accuse(k, w, r) { if (host) hostAccuse('A', k, w, r); else room.send({ t: 'acc', k, w, r }); }
  function again() { if (host) hostAgain(); else room.send({ t: 'again' }); }

  // ============================ map pre-render ============================
  const [mapC, mx] = A.canvas(W * T, H * T);
  function hash(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  const P = (x, y, w, h, c) => { mx.fillStyle = c; mx.fillRect(x, y, w, h); };
  const styleOf = id => (id === Wd.NR ? HALL : ROOMS[id]);

  function floorTile(tx, ty, style) {
    const X = tx * T, Y = ty * T, hv = hash(tx, ty);
    const planks = (a, b, seam) => {
      for (let r = 0; r < 4; r++) {
        const yy = Y + r * 4, row = ty * 4 + r, off = Math.floor(hash(row, 3) * 16);
        P(X, yy, 16, 4, hash(row, tx >> 1) < 0.5 ? a : b);
        P(X, yy + 3, 16, 1, seam);
        const jx = ((off + tx * 16) % 32 + 32) % 32; if (jx < 16) P(X + jx, yy, 1, 3, seam);
        if (hash(row * 7, tx) < 0.06) P(X + 4 + Math.floor(hash(tx, row) * 8), yy + 1, 2, 1, seam);
      }
    };
    switch (style) {
      case 'wood_dark': planks('#5b3a26', '#553622', '#3e2618'); break;
      case 'wood_light': planks('#a87a4f', '#a07247', '#7e5634'); break;
      case 'hall': planks('#6b4a32', '#65452e', '#4a3221'); break;
      case 'parquet':
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
          const X0 = X + i * 8, Y0 = Y + j * 8, vert = (i + j) % 2;
          P(X0, Y0, 8, 8, '#7a5236');
          for (let k = 0; k < 4; k++) vert ? P(X0 + k * 2, Y0, 1, 8, '#6a4630') : P(X0, Y0 + k * 2, 8, 1, '#6a4630');
        }
        break;
      case 'stone':
        P(X, Y, 16, 16, '#4a4650');
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
          const v = hash(tx * 2 + i, ty * 2 + j);
          P(X + i * 8 + 1, Y + j * 8 + 1, 7, 7, v < 0.33 ? '#5a5560' : v < 0.66 ? '#55505b' : '#605a66');
          P(X + i * 8 + 1, Y + j * 8 + 1, 7, 1, '#6a6470');
        }
        if (hv < 0.12) P(X + 3, Y + 11, 3, 1, '#3a5a3a');
        break;
      case 'carpet':
        P(X, Y, 16, 16, '#6a1e2a'); P(X + 7, Y + 6, 2, 4, '#8a3a2a'); P(X + 6, Y + 7, 4, 2, '#8a3a2a'); P(X + 7, Y + 7, 2, 2, '#c9a24a');
        P(X, Y, 1, 1, '#5a1824'); P(X + 15, Y + 15, 1, 1, '#5a1824'); break;
      case 'tile_green':
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { P(X + i * 8, Y + j * 8, 8, 8, hash(tx * 2 + i, ty * 2 + j) < 0.5 ? '#6e8a68' : '#64805e'); P(X + i * 8, Y + j * 8, 8, 1, '#4c6648'); P(X + i * 8, Y + j * 8, 1, 8, '#4c6648'); }
        if (hv < 0.2) P(X + 10, Y + 3, 2, 1, '#4f7a3a'); break;
      case 'checker':
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) P(X + i * 8, Y + j * 8, 8, 8, (tx * 2 + i + ty * 2 + j) % 2 ? '#2d2a33' : '#e6dfd0');
        break;
      case 'marble':
        P(X, Y, 16, 16, '#e6e1d8'); P(X, Y, 16, 1, '#cfc8bb'); P(X, Y, 1, 16, '#cfc8bb');
        if (hv < 0.5) { mx.strokeStyle = '#d4cdc0'; mx.beginPath(); mx.moveTo(X + 2, Y + 3 + hv * 8); mx.lineTo(X + 14, Y + 12 - hv * 6); mx.stroke(); }
        break;
    }
  }
  const WALLS = {
    green:  { paper: '#3d5a45', alt: '#35503c', wains: '#5a3a22' },
    red:    { paper: '#7a2e36', alt: '#6a2630', wains: '#4a2a1c', dots: '#b08a3a' },
    cream:  { paper: '#e6dcc6', alt: '#c9bea6', wains: '#8a6a44', tiles: true },
    blue:   { paper: '#2f4c72', alt: '#3a5a84', wains: '#5a3424' },
    gold:   { paper: '#7a5f2a', alt: '#9a7a3a', wains: '#e2dccd', dots: '#c9a24a' },
    panel:  { paper: '#5e3f28', alt: '#4f3421', wains: '#4a3020', panel: true },
    teal:   { paper: '#24514f', alt: '#1e4543', wains: '#4a2e1e', dots: '#c9a24a' },
    brick:  { paper: '#6a3a2e', alt: '#4a2a22', wains: '#3a3238', brick: true },
  };
  function wallFace(tx, ty, style) {
    const X = tx * T, Y = ty * T;
    if (style === 'glass') {
      P(X, Y, 16, 16, '#d8dcd6');
      const g = mx.createLinearGradient(0, Y + 1, 0, Y + 14); g.addColorStop(0, '#36597e'); g.addColorStop(1, '#1a2c44');
      mx.fillStyle = g; mx.fillRect(X + 1, Y + 1, 14, 12);
      P(X + 8, Y + 1, 1, 12, '#d8dcd6'); P(X + 1, Y + 7, 14, 1, '#d8dcd6');
      P(X + 2, Y + 2, 1, 3, 'rgba(255,255,255,.35)'); P(X + 3, Y + 2, 1, 1, 'rgba(255,255,255,.35)');
      if (hash(tx, ty) < 0.4) P(X + 4 + Math.floor(hash(ty, tx) * 8), Y + 3, 1, 1, '#f4f0d0');
      P(X, Y + 13, 16, 3, '#8a8a80'); P(X, Y + 13, 16, 1, '#a8a89c');
      return;
    }
    const s = WALLS[style];
    P(X, Y, 16, 16, s.paper);
    if (s.brick) { for (let r = 0; r < 4; r++) { P(X, Y + r * 4 + 3, 16, 1, s.alt); for (let k = (r % 2) * 4; k < 16; k += 8) P(X + k, Y + r * 4, 1, 3, s.alt); } }
    else if (s.tiles) { for (let r = 0; r < 4; r++) { P(X, Y + r * 3 + 2, 16, 1, s.alt); P(X + ((r % 2) ? 4 : 12), Y + r * 3 + 2, 1, 3, s.alt); } }
    else if (s.panel) { P(X + 2, Y + 3, 12, 8, s.alt); P(X + 2, Y + 3, 12, 1, shade(s.paper, 0.15)); P(X + 2, Y + 10, 12, 1, shade(s.paper, -0.3)); }
    else { for (let i = 0; i < 16; i += 4) P(X + i, Y + 2, 1, 9, s.alt); if (s.dots) { P(X + 2, Y + 5, 1, 1, s.dots); P(X + 10, Y + 8, 1, 1, s.dots); } }
    P(X, Y, 16, 2, shade(s.paper, 0.18)); P(X, Y + 2, 16, 1, shade(s.paper, -0.25));             // cornice
    P(X, Y + 11, 16, 4, s.wains); P(X, Y + 11, 16, 1, shade(s.wains, 0.25));                     // wainscot
    P(X, Y + 15, 16, 1, '#1a1218');                                                               // baseboard shadow
  }
  const shade = A.shade;
  function painting(tx, ty, col) {
    const X = tx * T + 3, Y = ty * T + 3;
    P(X - 1, Y - 1, 12, 9, '#c9a24a'); P(X, Y, 10, 7, col); P(X + 3, Y + 1, 4, 4, shade(col, 0.3)); P(X + 4, Y + 2, 2, 2, '#e9cfa8');
  }
  function rug(x0, y0, w, h, col, border) {
    const X = x0 * T + 4, Y = y0 * T + 4, PW = w * T - 8, PH = h * T - 8;
    P(X, Y, PW, PH, border); P(X + 2, Y + 2, PW - 4, PH - 4, col);
    P(X + 4, Y + 4, PW - 8, 1, border); P(X + 4, Y + PH - 5, PW - 8, 1, border);
    for (let i = X + 8; i < X + PW - 8; i += 8) P(i, Y + PH / 2 - 1, 2, 2, border);
  }
  function drawMap() {
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      if (!Wd.isWall(tx, ty)) { floorTile(tx, ty, styleOf(Wd.roomOf(tx, ty)).floor); continue; }
      const below = ty + 1 < H && !Wd.isWall(tx, ty + 1);
      if (below) wallFace(tx, ty, styleOf(Wd.roomOf(tx, ty + 1)).wall);
      else {
        P(tx * T, ty * T, 16, 16, '#211a28');
        P(tx * T + 2, ty * T + 2, 12, 12, '#2a2233');
        const edge = '#3d3348';
        if (!Wd.isWall(tx - 1, ty)) P(tx * T, ty * T, 2, 16, edge);
        if (!Wd.isWall(tx + 1, ty)) P(tx * T + 14, ty * T, 2, 16, edge);
        if (ty > 0 && !Wd.isWall(tx, ty - 1)) P(tx * T, ty * T, 16, 2, edge);
      }
    }
    // door thresholds
    for (const dx of Wd.DOOR_X) for (const row of [9, 16]) P(dx * T, row * T + 13, 32, 3, '#3a2a1c');
    rug(3, 3, 6, 4, '#7a2a2a', '#c9a24a');
    rug(16, 5, 5, 3, '#25356a', '#b8a06a');
    rug(15, 19, 7, 4, '#3a4a2a', '#c9a24a');
    // ballroom inlay star
    const cx = 30.5 * T, cy = 20.5 * T;
    mx.fillStyle = '#c9a24a'; mx.beginPath();
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, r = i % 2 ? 10 : 26; mx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.75); }
    mx.fill(); mx.fillStyle = '#e6e1d8'; mx.beginPath(); mx.ellipse(cx, cy, 6, 4.5, 0, 0, Math.PI * 2); mx.fill();
    // hall runner
    P(2 * T, 11 * T + 2, 45 * T, 3 * T + 12, '#c9a24a'); P(2 * T + 2, 11 * T + 4, 45 * T - 4, 3 * T + 8, '#7a1f2a');
    for (let x = 2 * T + 6; x < 47 * T - 6; x += 10) P(x, 11 * T + 7, 4, 1, '#a8443a'), P(x + 3, 14 * T + 9, 4, 1, '#a8443a');
    // paintings & windows
    painting(3, 9, '#2f4a3a'); painting(10, 9, '#5a2a3a'); painting(15, 9, '#3a3a5a'); painting(22, 9, '#5a4a2a');
    painting(27, 9, '#2a3a5a'); painting(34, 9, '#4a3a2a'); painting(39, 9, '#3a2a2a'); painting(45, 9, '#2a4a3a');
    painting(9, 0, '#3a2a4a'); painting(19, 0, '#5a3a2a'); painting(42, 0, '#2a3a2a'); painting(28, 16, '#2a4a4a'); painting(3, 16, '#6a5a3a');
    rug(39, 3, 5, 4, '#2a3a2a', '#8a6a3a');
    wallFace(6, 0, 'glass');
  }
  drawMap();

  // furniture sprites, positioned
  const furn = F.map(f => {
    const spr = A.furniture(f.type);
    return { f, spr, x: f.x * T + Math.round((f.w * T - spr.width) / 2), y: (f.y + f.h) * T - spr.height, foot: (f.y + f.h) * T - 1 };
  });
  const bodySpr = A.bodySprite();
  const bodyRect = { x: BODY.x * T, y: BODY.y * T + 2, w: 32, h: 14 };

  const LIGHTS = [
    { x: 6 * T, y: 5 * T, r: 62, warm: 1 },          // library lamp
    { x: 6.5 * T, y: 1.2 * T, r: 40, warm: 0 },      // library window
    { x: 15 * T, y: 1.6 * T, r: 84, warm: 1, fl: 1 },// study fireplace
    { x: 28 * T, y: 1.5 * T, r: 64, warm: 0 }, { x: 33 * T, y: 1.5 * T, r: 64, warm: 0 }, { x: 30 * T, y: 6 * T, r: 50, warm: 0 },
    { x: 2 * T, y: 17.5 * T, r: 64, warm: 1, fl: 1 }, // stove
    { x: 18.5 * T, y: 20.3 * T, r: 76, warm: 1, fl: 1 }, // candelabra
    { x: 30.5 * T, y: 20 * T, r: 96, warm: 1 },      // chandelier
    { x: 6.5 * T, y: 21.5 * T, r: 52, warm: 1 },
    { x: 5 * T, y: 10.4 * T, r: 70, warm: 1, fl: 1 }, { x: 13 * T, y: 10.4 * T, r: 70, warm: 1, fl: 1 },
    { x: 21 * T, y: 10.4 * T, r: 70, warm: 1, fl: 1 }, { x: 29 * T, y: 10.4 * T, r: 70, warm: 1, fl: 1 },
    { x: 37 * T, y: 10.4 * T, r: 70, warm: 1, fl: 1 }, { x: 45 * T, y: 10.4 * T, r: 70, warm: 1, fl: 1 },
    { x: 24.5 * T, y: 12.5 * T, r: 44, warm: 0 },     // inspector's lamp on the body
    { x: 41.5 * T, y: 4.2 * T, r: 84, warm: 1 },      // billiard lamp
    { x: 42 * T, y: 18 * T, r: 66, warm: 1, fl: 1 }, { x: 46 * T, y: 24 * T, r: 46, warm: 1, fl: 1 }, // cellar lanterns
  ];

  // ============================ movement & collision ============================
  function canStandHere(px, py) {
    if (!Wd.canStand(px, py)) return false;
    const fx0 = px - Wd.FOOT_W / 2, fx1 = px + Wd.FOOT_W / 2, fy0 = py - Wd.FOOT_H, fy1 = py;
    const hit = r => fx1 > r.x && fx0 < r.x + r.w && fy1 > r.y && fy0 < r.y + r.h;
    if (hit(bodyRect)) return false;
    if (hit({ x: inspector.x - 5, y: inspector.y - 5, w: 10, h: 5 })) return false;
    return true;
  }
  function moveChar(c, dx, dy) {
    if (dx && canStandHere(c.x + dx, c.y)) c.x += dx;
    if (dy && canStandHere(c.x, c.y + dy)) c.y += dy;
  }

  // ---- host NPC simulation ----
  function npcThink(n, dt) {
    if (n.talk > 0) { n.talk -= dt; n.moving = false; const who = n.talkTo || me, dx = who.x - n.x, dy = who.y - n.y; n.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0); return; }
    if (n.goal) {
      const dx = n.goal.x - n.x, dy = n.goal.y - n.y, d = Math.hypot(dx, dy);
      if (d < 1.5) { n.goal = null; n.moving = false; n.wait = 2 + Math.random() * 5; return; }
      const sx = dx / d * NPC_SPEED * dt, sy = dy / d * NPC_SPEED * dt;
      const ox = n.x, oy = n.y;
      moveChar(n, sx, sy);
      if (Math.abs(n.x - ox) + Math.abs(n.y - oy) < 0.01) { n.goal = null; n.moving = false; n.wait = 1 + Math.random() * 2; return; }
      n.moving = true; n.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0);
    } else {
      n.wait -= dt;
      if (n.wait <= 0) {
        const r = n.room;
        for (let k = 0; k < 12; k++) {
          const gx = (r.x + 1 + Math.random() * (r.w - 2)) * T, gy = (r.y + 1 + Math.random() * (r.h - 2)) * T + 8;
          if (canStandHere(gx, gy) && Math.hypot(gx - n.x, gy - n.y) < 80) { n.goal = { x: gx, y: gy }; break; }
        }
        if (!n.goal) n.wait = 1;
        else if (Math.random() < 0.3) { n.dir = (Math.random() * 4) | 0; }
      }
    }
  }

  // ============================ input ============================
  const keys = new Set();
  const joy = { x: 0, y: 0 };
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (k === 'escape') return closeAllPanels();
    if (k === 'n' || k === 'tab') { e.preventDefault(); return toggleNotebook(); }
    if (k === 'e' || k === ' ' || k === 'enter') { if (!e.repeat) interact(); return; }
    keys.add(k);
  });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());

  // touch joystick
  const joyEl = document.getElementById('joy'), knob = document.getElementById('knob');
  let joyId = null, joyC = null;
  joyEl.addEventListener('pointerdown', e => { joyId = e.pointerId; joyEl.setPointerCapture(e.pointerId); const r = joyEl.getBoundingClientRect(); joyC = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; joyMove(e); });
  joyEl.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
  const joyEnd = e => { if (e.pointerId === joyId) { joyId = null; joy.x = joy.y = 0; knob.style.transform = ''; } };
  joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);
  function joyMove(e) {
    let dx = e.clientX - joyC.x, dy = e.clientY - joyC.y; const d = Math.hypot(dx, dy), m = joyC.r * 0.8;
    if (d > m) { dx = dx / d * m; dy = dy / d * m; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    joy.x = Math.abs(dx) > 6 ? dx / m : 0; joy.y = Math.abs(dy) > 6 ? dy / m : 0;
  }
  document.getElementById('act').addEventListener('click', () => interact());

  // ============================ interaction ============================
  function probe() {
    const v = [[0, 1], [0, -1], [-1, 0], [1, 0]][me.dir];
    return { x: me.x + v[0] * 10, y: me.y - 4 + v[1] * 10 };
  }
  const rectDist = (p, r) => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
  function nearestTarget() {
    if (!pub) return null;
    const p = probe(); let best = null, bd = 1e9;
    const consider = (id, d, pos, kind) => { if (d < bd) { bd = d; best = { id, pos, kind }; } };
    for (const fu of furn) if (fu.f.search) {
      const r = { x: fu.f.x * T, y: fu.f.y * T, w: fu.f.w * T, h: fu.f.h * T }, d = rectDist(p, r);
      if (d <= 9) consider('f' + fu.f.id, d, { x: fu.x + fu.spr.width / 2, y: fu.y }, 'search');
    }
    npcs.forEach((n, i) => { const d = Math.hypot(p.x - n.x, p.y - (n.y - 6)); if (d <= 15) consider('n' + i, d - 2, { x: n.x, y: n.y - 26 }, 'talk'); });
    { const d = Math.hypot(p.x - inspector.x, p.y - (inspector.y - 6)); if (d <= 16) consider('insp', d - 2, { x: inspector.x, y: inspector.y - 26 }, 'talk'); }
    { const d = rectDist(p, bodyRect); if (d <= 8) consider('body', d, { x: bodyRect.x + 16, y: bodyRect.y - 6 }, 'search'); }
    return best;
  }
  let target = null;
  function interact() {
    if (dialog.open) return advanceDialog();
    if (anyPanelOpen()) return;
    if (pub && pub.phase === 'over') return showOver();
    if (target) examine(target.id);
  }

  // ============================ UI: dialog ============================
  const $ = id => document.getElementById(id);
  const dialog = { open: false, full: '', shown: 0, then: null };
  function setPic(el, iconName) {
    const ctx = el.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, el.width, el.height);
    if (iconName.startsWith('portrait:')) ctx.drawImage(A.portrait(LOOK_OF[+iconName.split(':')[1]] || iconName.split(':')[1], 48), 0, 0, el.width, el.height);
    else if (iconName.startsWith('look:')) ctx.drawImage(A.portrait(iconName.slice(5), 48), 0, 0, el.width, el.height);
    else if (iconName.startsWith('room:')) {
      const r = ROOMS[+iconName.slice(5)], fx = r.x * T, fy = (r.y + 2) * T;
      ctx.drawImage(mapC, fx, fy, 48, 48, 0, 0, el.width, el.height);
    }
    else { ctx.fillStyle = '#2a2233'; ctx.fillRect(0, 0, el.width, el.height); ctx.drawImage(A.icon(iconName), el.width * 0.15, el.height * 0.15, el.width * 0.7, el.height * 0.7); }
  }
  function say(icon, title, text, then) {
    dialog.open = true; dialog.full = text; dialog.shown = 0; dialog.then = then || null;
    setPic($('dlgPic'), icon); $('dlgTitle').textContent = title; $('dlgText').textContent = '';
    $('dialog').hidden = false; $('dialog').classList.remove('done');
  }
  function advanceDialog() {
    if (dialog.shown < dialog.full.length) { dialog.shown = dialog.full.length; $('dlgText').textContent = dialog.full; $('dialog').classList.add('done'); return; }
    dialog.open = false; $('dialog').hidden = true;
    const t = dialog.then; dialog.then = null; if (t) t();
  }
  $('dialog').addEventListener('click', advanceDialog);
  function showEntry(e) {
    const tag = e.kind === 'clue' ? 'New clue! ' : '';
    say(e.icon, e.title, e.text, null);
    if (e.kind === 'clue') { $('dialog').classList.add('clue'); $('dlgTag').textContent = 'Added to your notebook'; }
    else if (e.kind === 'statement') { $('dialog').classList.remove('clue'); $('dlgTag').textContent = 'Statement noted'; }
    else { $('dialog').classList.remove('clue'); $('dlgTag').textContent = ''; }
    void tag;
  }
  function inspectorTalk() {
    $('dialog').classList.remove('clue'); $('dlgTag').textContent = '';
    if (pub.phase === 'over') return showOver();
    if (pub.out[ME]) return say('look:inspector', 'Inspector Grey', 'You\'ve had your chance, detective. Leave it to your colleague now.');
    say('look:inspector', 'Inspector Grey', 'Made up your mind, detective? Name the killer, the weapon and the room. Be certain: a wrong accusation and you\'re off the case.', openAccuse);
  }

  // ============================ UI: notebook ============================
  const crossKey = () => 'mm-cross-' + (pub ? pub.caseNo : 0) + '-' + room.code;
  let cross = null;
  function loadCross() { try { cross = JSON.parse(sessionStorage.getItem(crossKey())); } catch (e) { cross = null; } if (!cross) cross = { s: [], w: [], r: [] }; }
  function saveCross() { try { sessionStorage.setItem(crossKey(), JSON.stringify(cross)); } catch (e) {} }

  function chip(kind, i, label, pic, onClick, selected) {
    const b = document.createElement('button');
    b.className = 'chip' + (selected ? ' sel' : '') + (cross && cross[kind][i] ? ' x' : '');
    const c = document.createElement('canvas'); c.width = c.height = 32; setPic(c, pic);
    const s = document.createElement('span'); s.textContent = label;
    b.append(c, s); b.addEventListener('click', onClick);
    return b;
  }
  function renderNotebook() {
    if (!pub) return;
    if (!cross) loadCross();
    const board = (kind, el, items) => {
      el.replaceChildren(...items.map((it, i) => chip(kind, i, it.label, it.pic, () => { cross[kind][i] = !cross[kind][i]; saveCross(); renderNotebook(); })));
    };
    board('s', $('nbSus'), SUSPECTS.map((s, i) => ({ label: s.short, pic: 'portrait:' + i })));
    board('w', $('nbWea'), WEAPONS.map(w => ({ label: w.name, pic: w.icon })));
    board('r', $('nbRoom'), ROOMS.map((r, i) => ({ label: r.name, pic: 'room:' + i })));
    const list = (el, items, empty) => {
      if (!items.length) { el.innerHTML = '<p class="empty">' + empty + '</p>'; return; }
      el.replaceChildren(...items.map(e => {
        const d = document.createElement('div'); d.className = 'entry';
        const c = document.createElement('canvas'); c.width = c.height = 32; setPic(c, e.icon);
        const t = document.createElement('div'); t.innerHTML = '<b></b><p></p>'; t.querySelector('b').textContent = e.title; t.querySelector('p').textContent = e.text;
        d.append(c, t); return d;
      }));
    };
    list($('nbClues'), notebook.filter(e => e.kind === 'clue'), 'Search furniture (sparkles) to find evidence.');
    list($('nbStmts'), notebook.filter(e => e.kind === 'statement'), 'Talk to the suspects to hear their alibis.');
    $('nbCount').textContent = notebook.filter(e => e.kind === 'clue').length + ' clues · ' + notebook.filter(e => e.kind === 'statement').length + ' statements';
  }
  function toggleNotebook() { if ($('notebook').hidden) { closeAllPanels(); renderNotebook(); $('notebook').hidden = false; } else $('notebook').hidden = true; }
  $('nbBtn').addEventListener('click', toggleNotebook);
  $('nbClose').addEventListener('click', () => ($('notebook').hidden = true));

  // ============================ UI: accusation ============================
  const pick = { s: -1, w: -1, r: -1 };
  function openAccuse() {
    if (!pub || pub.phase !== 'play' || pub.out[ME]) return;
    closeAllPanels(); if (!cross) loadCross();
    renderAccuse(); $('accuse').hidden = false;
  }
  function renderAccuse() {
    const row = (kind, el, items) => el.replaceChildren(...items.map((it, i) => chip(kind, i, it.label, it.pic, () => { pick[kind] = i; renderAccuse(); }, pick[kind] === i)));
    row('s', $('acSus'), SUSPECTS.map((s, i) => ({ label: s.short, pic: 'portrait:' + i })));
    row('w', $('acWea'), WEAPONS.map(w => ({ label: w.name, pic: w.icon })));
    row('r', $('acRoom'), ROOMS.map((r, i) => ({ label: r.name, pic: 'room:' + i })));
    const ok = pick.s >= 0 && pick.w >= 0 && pick.r >= 0;
    $('acGo').disabled = !ok;
    $('acSum').textContent = ok ? `${SUSPECTS[pick.s].name}, with the ${WEAPONS[pick.w].name}, in the ${ROOMS[pick.r].name}.` : 'Choose a suspect, a weapon and a room.';
  }
  $('acGo').addEventListener('click', () => { if (pick.s < 0 || pick.w < 0 || pick.r < 0) return; accuse(pick.s, pick.w, pick.r); $('accuse').hidden = true; pick.s = pick.w = pick.r = -1; });
  $('acCancel').addEventListener('click', () => ($('accuse').hidden = true));

  // ============================ UI: events, status, game over ============================
  function toast(text) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    $('toasts').appendChild(t); setTimeout(() => t.classList.add('out'), 2600); setTimeout(() => t.remove(), 3200);
  }
  function onEvent(m) {
    if (m.kind === 'found') toast('🔍 Your friend found a clue…');
    else if (m.kind === 'talk') toast('🗣 Your friend is questioning ' + SUSPECTS[m.who].short);
    else if (m.kind === 'wrong') toast(m.who === ME ? '✖ Wrong! You\'re off the case.' : '✖ Your friend accused the wrong person. They\'re out!');
  }
  let lastPhase = null;
  function onPub() {
    if (!pub) return;
    if (cross === null || crossKey() !== cross._k) { loadCross(); cross._k = crossKey(); }
    setStatus(); renderNotebook();
    if (pub.phase === 'over' && lastPhase !== 'over') setTimeout(showOver, 400);
    if (pub.phase === 'play' && lastPhase === 'over') { $('over').hidden = true; resetMe(); }
    lastPhase = pub.phase;
  }
  function setStatus() {
    if (!pub) { $('hudCase').textContent = 'Connecting…'; return; }
    $('hudCase').textContent = 'Case #' + pub.caseNo;
    $('hudScore').innerHTML = 'You <b>' + pub.score[ME] + '</b> · <b>' + pub.score[FRIEND] + '</b> Friend';
    let s;
    if (!room.connected) s = 'Waiting for your friend…';
    else if (pub.phase === 'over') s = 'Case closed';
    else if (pub.out[ME]) s = 'You\'re off the case. Watch your friend…';
    else if (pub.out[FRIEND]) s = 'Your friend is out. Take your time.';
    else s = 'Find the killer, the weapon and the room. Report to the Inspector.';
    $('hudStatus').textContent = s;
  }
  function showOver() {
    if (!pub || pub.phase !== 'over' || !pub.solution) return;
    closeAllPanels();
    const sol = pub.solution;
    $('ovTitle').textContent = pub.winner === ME ? 'You solved it! 🎉' : pub.winner === FRIEND ? 'Your friend cracked the case' : 'The killer got away';
    setPic($('ovPic'), 'portrait:' + sol.k); setPic($('ovWea'), WEAPONS[sol.w].icon);
    $('ovText').textContent = `It was ${SUSPECTS[sol.k].name}, with the ${WEAPONS[sol.w].name}, in the ${ROOMS[sol.r].name}.`;
    $('ovScore').innerHTML = 'You <b>' + pub.score[ME] + '</b> · <b>' + pub.score[FRIEND] + '</b> Friend';
    $('over').hidden = false;
  }
  $('ovAgain').addEventListener('click', () => { again(); $('ovAgain').textContent = 'Starting…'; setTimeout(() => ($('ovAgain').textContent = 'New case'), 1500); });
  $('ovClose').addEventListener('click', () => ($('over').hidden = true));

  function anyPanelOpen() { return !$('notebook').hidden || !$('accuse').hidden || !$('over').hidden; }
  function closeAllPanels() { for (const id of ['notebook', 'accuse', 'over']) $(id).hidden = true; if (dialog.open) { dialog.open = false; $('dialog').hidden = true; } }

  // ============================ rendering ============================
  const cv = $('view'), ctx = cv.getContext('2d');
  let buf, bctx, light, lctx, S = 3;
  function resize() {
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    S = Math.max(2, Math.floor(Math.min(cv.width / (T * 15), cv.height / (T * 9))));
    [buf, bctx] = A.canvas(Math.ceil(cv.width / S), Math.ceil(cv.height / S));
    [light, lctx] = A.canvas(buf.width, buf.height);
    ctx.imageSmoothingEnabled = false;
  }
  addEventListener('resize', resize); resize();

  const dust = Array.from({ length: 70 }, () => ({ x: Math.random() * W * T, y: Math.random() * H * T, v: 2 + Math.random() * 4, p: Math.random() * 6 }));

  function drawChar(c, t, phase) {
    const sh = A.sheet(c.look)[DIRS[c.dir] || 'down'];
    const frame = c.moving ? [1, 0, 2, 0][Math.floor(c.anim * 8) % 4] : 0;
    const bob = !c.moving && Math.floor(t * 1.2 + phase) % 2 === 0 ? 0 : 0;
    bctx.fillStyle = 'rgba(0,0,0,.35)'; bctx.beginPath(); bctx.ellipse(Math.round(c.x), Math.round(c.y) - 1, 5, 2, 0, 0, Math.PI * 2); bctx.fill();
    bctx.drawImage(sh[frame], Math.round(c.x) - 8, Math.round(c.y) - 24 + bob);
  }

  function render(t) {
    const bw = buf.width, bh = buf.height;
    let camX = Math.round(me.x - bw / 2), camY = Math.round(me.y - 12 - bh / 2);
    camX = W * T <= bw ? Math.round((W * T - bw) / 2) : Math.max(0, Math.min(W * T - bw, camX));
    camY = H * T <= bh ? Math.round((H * T - bh) / 2) : Math.max(0, Math.min(H * T - bh, camY));

    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.fillStyle = '#0d0a12'; bctx.fillRect(0, 0, bw, bh);
    bctx.drawImage(mapC, -camX, -camY);
    bctx.setTransform(1, 0, 0, 1, -camX, -camY);

    bctx.drawImage(bodySpr, bodyRect.x, bodyRect.y - 4);

    // y-sorted objects
    const objs = [];
    for (const fu of furn) objs.push({ y: fu.foot, draw: () => {
      bctx.drawImage(fu.spr, fu.x, fu.y);
      if (fu.f.type === 'fireplace') bctx.drawImage(A.fireFrames[Math.floor(t * 9) % 3], fu.x + 9, fu.y + 19);
    } });
    npcs.forEach((n, i) => objs.push({ y: n.y, draw: () => drawChar(n, t, i) }));
    objs.push({ y: inspector.y, draw: () => drawChar(inspector, t, 9) });
    if (room.connected && friend.seen) objs.push({ y: friend.y, draw: () => drawChar(friend, t, 7) });
    objs.push({ y: me.y + 0.1, draw: () => drawChar(me, t, 3) });
    objs.sort((a, b) => a.y - b.y).forEach(o => o.draw());

    // sparkles on spots I haven't searched
    const seen = new Set(notebook.map(e => e.id));
    for (const fu of furn) if (fu.f.search && !seen.has('f' + fu.f.id)) {
      const ph = (t * 0.8 + fu.f.id * 0.37) % 2;
      if (ph < 0.6) {
        const k = ph < 0.2 ? 1 : ph < 0.4 ? 2 : 1, sx = Math.round(fu.x + fu.spr.width / 2 + Math.sin(fu.f.id) * 6), sy = Math.round(fu.y + 3);
        bctx.fillStyle = '#fff6c8'; bctx.fillRect(sx - k, sy, k * 2 + 1, 1); bctx.fillRect(sx, sy - k, 1, k * 2 + 1);
      }
    }
    // dust in the air
    bctx.fillStyle = 'rgba(255,240,210,.28)';
    for (const d of dust) { const yy = (d.y + t * d.v) % (H * T), xx = d.x + Math.sin(t * 0.6 + d.p) * 4; if (xx > camX && xx < camX + bw && yy > camY && yy < camY + bh) bctx.fillRect(Math.round(xx), Math.round(yy), 1, 1); }

    // ---- lighting ----
    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = 'rgba(8,5,18,0.42)'; lctx.fillRect(0, 0, bw, bh);
    lctx.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r) => {
      const X = x - camX, Y = y - camY; if (X < -r || Y < -r || X > bw + r || Y > bh + r) return;
      const g = lctx.createRadialGradient(X, Y, 0, X, Y, r); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = g; lctx.fillRect(X - r, Y - r, r * 2, r * 2);
    };
    const flick = (L, i) => (L.fl ? 1 + Math.sin(t * 9 + i * 3) * 0.04 + Math.sin(t * 23 + i) * 0.03 : 1);
    LIGHTS.forEach((L, i) => hole(L.x, L.y, L.r * flick(L, i)));
    hole(me.x, me.y - 10, 76);
    if (room.connected && friend.seen) hole(friend.x, friend.y - 10, 40);
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.drawImage(light, 0, 0);
    bctx.globalCompositeOperation = 'lighter';
    LIGHTS.forEach((L, i) => {
      const X = L.x - camX, Y = L.y - camY, r = L.r * 0.7 * flick(L, i); if (X < -r || Y < -r || X > bw + r || Y > bh + r) return;
      const g = bctx.createRadialGradient(X, Y, 0, X, Y, r);
      g.addColorStop(0, L.warm ? 'rgba(255,150,60,.22)' : 'rgba(90,140,230,.16)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      bctx.fillStyle = g; bctx.fillRect(X - r, Y - r, r * 2, r * 2);
    });
    bctx.globalCompositeOperation = 'source-over';

    // ---- overlays above lighting ----
    bctx.setTransform(1, 0, 0, 1, -camX, -camY);
    if (room.connected && friend.seen) {
      const fx = Math.round(friend.x), fy = Math.round(friend.y) - 30 + (Math.floor(t * 3) % 2);
      bctx.fillStyle = OUTLINE; bctx.fillRect(fx - 3, fy - 1, 7, 4);
      bctx.fillStyle = host ? '#2bb5a8' : '#c43c2c'; bctx.fillRect(fx - 2, fy, 5, 1); bctx.fillRect(fx - 1, fy + 1, 3, 1); bctx.fillRect(fx, fy + 2, 1, 1);
    }
    if (target && !dialog.open && !anyPanelOpen() && pub && pub.phase === 'play') {
      const bx = Math.round(target.pos.x) - 5, by = Math.round(target.pos.y) - 12 + (Math.floor(t * 3) % 2);
      bctx.fillStyle = OUTLINE; bctx.fillRect(bx - 1, by - 1, 12, 11);
      bctx.fillStyle = '#fff6e0'; bctx.fillRect(bx, by, 10, 9); bctx.fillRect(bx + 3, by + 9, 3, 2);
      bctx.fillStyle = '#2a1e30';
      if (target.kind === 'talk') { bctx.fillRect(bx + 2, by + 4, 1, 1); bctx.fillRect(bx + 4, by + 4, 2, 1); bctx.fillRect(bx + 7, by + 4, 1, 1); }
      else { bctx.fillRect(bx + 4, by + 1, 2, 5); bctx.fillRect(bx + 4, by + 7, 2, 1); }
    }
    // vignette
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    const vg = bctx.createRadialGradient(bw / 2, bh / 2, Math.min(bw, bh) * 0.35, bw / 2, bh / 2, Math.max(bw, bh) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
    bctx.fillStyle = vg; bctx.fillRect(0, 0, bw, bh);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 0, 0, buf.width * S, buf.height * S);
  }
  const OUTLINE = '#17121f';

  // ============================ main loop ============================
  let last = performance.now(), lastSnap = 0, lastPos = 0, lastSent = '';
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    const t = now / 1000;
    // my movement
    let ix = 0, iy = 0;
    const frozen = dialog.open || anyPanelOpen();
    if (!frozen) {
      if (keys.has('arrowleft') || keys.has('a')) ix -= 1;
      if (keys.has('arrowright') || keys.has('d')) ix += 1;
      if (keys.has('arrowup') || keys.has('w')) iy -= 1;
      if (keys.has('arrowdown') || keys.has('s')) iy += 1;
      ix += joy.x; iy += joy.y;
    }
    const mag = Math.hypot(ix, iy);
    if (mag > 0.15) {
      const k = Math.min(1, mag) / mag;
      moveChar(me, ix * k * SPEED * dt, iy * k * SPEED * dt);
      me.dir = Math.abs(ix) > Math.abs(iy) ? (ix < 0 ? 2 : 3) : (iy < 0 ? 1 : 0);
      me.moving = true; me.anim += dt;
    } else { me.moving = false; me.anim = 0; }

    // others
    const ease = c => { c.x += (c.tx - c.x) * Math.min(1, dt * 12); c.y += (c.ty - c.y) * Math.min(1, dt * 12); c.anim = c.moving ? c.anim + dt : 0; };
    ease(friend);
    if (host) {
      npcs.forEach(n => { npcThink(n, dt); n.anim = n.moving ? n.anim + dt : 0; });
      // inspector faces whoever is closest
      const near = [me, friend].sort((a, b) => Math.hypot(a.x - inspector.x, a.y - inspector.y) - Math.hypot(b.x - inspector.x, b.y - inspector.y))[0];
      const dx = near.x - inspector.x, dy = near.y - inspector.y;
      inspector.dir = Math.hypot(dx, dy) < 60 ? (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0)) : 2;
      if (room.connected && now - lastSnap > 80) {
        lastSnap = now;
        room.send({ t: 's', a: [Math.round(me.x), Math.round(me.y), me.dir, me.moving ? 1 : 0], i: inspector.dir,
          n: npcs.map(n => [Math.round(n.x), Math.round(n.y), n.dir, n.moving ? 1 : 0]) });
      }
    } else {
      npcs.forEach(ease);
      if (room.connected && now - lastPos > 66) {
        const s = Math.round(me.x) + ',' + Math.round(me.y) + ',' + me.dir + ',' + (me.moving ? 1 : 0);
        if (s !== lastSent || now - lastPos > 1000) { lastPos = now; lastSent = s; room.send({ t: 'pos', x: Math.round(me.x), y: Math.round(me.y), d: me.dir, m: me.moving ? 1 : 0 }); }
      }
    }

    target = frozen ? null : nearestTarget();
    $('act').classList.toggle('ready', !!target);
    $('act').textContent = target ? (target.kind === 'talk' ? 'Talk' : 'Search') : '•';

    // typewriter
    if (dialog.open && dialog.shown < dialog.full.length) {
      dialog.shown = Math.min(dialog.full.length, dialog.shown + dt * 55);
      $('dlgText').textContent = dialog.full.slice(0, Math.floor(dialog.shown));
      if (dialog.shown >= dialog.full.length) $('dialog').classList.add('done');
    }
    render(t);
    requestAnimationFrame(frame);
  }
  if (host) onPub();
  setStatus();
  requestAnimationFrame(frame);

  // test hook (read-only)
  window.__mm = { get pub() { return pub; }, get notebook() { return notebook; }, me, friend, get npcs() { return npcs; }, get target() { return target; }, examine, accuse, role: room.role,
    _kase: host ? () => kase : undefined };
})();
