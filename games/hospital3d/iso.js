// Rival Hospital: isometric scene. The simulation keeps plain 2D coordinates (rules.js); this file
// projects them 2:1 and draws floors, walls, furniture as shaded iso boxes, and corridor decoration.
// Everything here is drawn in code; people and plants are upright "billboard" sprites from art.js.
(function () {
  'use strict';
  const A = window.HA;
  const T = 16, W = 22, H = 11, OUT = '#1b1720';
  const K = 0.75, KX = K, KY = K / 2;           // world px → screen px along the two floor axes
  const OX = H * T * K, OY = 46;
  const BW = Math.ceil((W * T + H * T) * KX), BH = Math.ceil((W * T + H * T) * KY) + OY + 8;
  const WALL_H = 34, LOW_H = 9;
  const px = (x, y) => [OX + (x - y) * KX, OY + (x + y) * KY];
  const unproj = (sx, sy) => { const u = (sx - OX) / KX, v = (sy - OY) / KY; return [(u + v) / 2, (v - u) / 2]; };
  const reset = ctx => ctx.setTransform(1, 0, 0, 1, 0, 0);
  const R = (ctx, x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  const shade = A.shade;

  // ---------- projected image helpers ----------
  function floorAt(ctx, img, x, y) { ctx.setTransform(KX, KY, -KX, KY, OX + (x - y) * KX, OY + (x + y) * KY); ctx.drawImage(img, 0, 0); reset(ctx); }
  function wallN(ctx, img, x, y, h) { ctx.setTransform(KX, KY, 0, 1, OX + (x - y) * KX, OY + (x + y) * KY - h); ctx.drawImage(img, 0, 0); reset(ctx); }
  function wallW(ctx, img, x, y, h) { ctx.setTransform(-KX, KY, 0, 1, OX + (x - y) * KX, OY + (x + y) * KY - h); ctx.drawImage(img, 0, 0); reset(ctx); }
  function bill(ctx, img, x, y, lift) { const [sx, sy] = px(x, y); ctx.drawImage(img, Math.round(sx - img.width / 2), Math.round(sy - img.height + (lift || 0))); }
  function shadow(ctx, x, y, rx) { const [sx, sy] = px(x, y); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(sx, sy, rx, rx / 2, 0, 0, Math.PI * 2); ctx.fill(); }
  // a floor decal drawn in world units (e.g. a puddle)
  function decal(ctx, x, y, fn) { ctx.setTransform(KX, KY, -KX, KY, OX + (x - y) * KX, OY + (x + y) * KY); fn(ctx); reset(ctx); }

  // ---------- iso box: footprint (x, y, w, d) in world units, height h in screen px ----------
  function box(ctx, x, y, w, d, h, col, faces) {
    const p00 = px(x, y), p10 = px(x + w, y), p11 = px(x + w, y + d), p01 = px(x, y + d);
    const poly = (pts, fill) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = 'rgba(27,23,32,.75)'; ctx.lineWidth = 1; ctx.stroke(); };
    const up = p => [p[0], p[1] - h];
    poly([up(p01), up(p11), p11, p01], col);                      // south face
    poly([up(p10), up(p11), p11, p10], shade(col, -0.32));        // east face
    poly([up(p00), up(p10), up(p11), up(p01)], shade(col, 0.18)); // top
    if (!faces) return;
    ctx.save();
    if (faces.top) { ctx.setTransform(KX, KY, -KX, KY, p00[0], p00[1] - h); ctx.beginPath(); ctx.rect(0, 0, w, d); ctx.clip(); faces.top(ctx, w, d); reset(ctx); }
    if (faces.south) { ctx.setTransform(KX, KY, 0, 1, p01[0], p01[1] - h); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip(); faces.south(ctx, w, h); reset(ctx); }
    if (faces.east) { ctx.setTransform(-KX, KY, 0, 1, p10[0], p10[1] - h); ctx.beginPath(); ctx.rect(0, 0, d, h); ctx.clip(); faces.east(ctx, d, h); reset(ctx); }
    ctx.restore();
  }
  // small decal painters (local units)
  const screen = (ctx, u, v, w, h) => { R(ctx, u, v, w, h, '#1d2a3a'); R(ctx, u + 1, v + 1, Math.max(1, w / 2), 1, '#6fd3ff'); R(ctx, u + 1, v + 3, Math.max(1, w - 3), 1, '#2f5a7a'); R(ctx, u + w - 3, v + h - 2, 2, 1, '#e8533f'); };
  const buttons = (ctx, u, v) => { R(ctx, u, v, 2, 2, '#e8533f'); R(ctx, u + 3, v, 2, 2, '#39a85a'); R(ctx, u + 6, v, 2, 2, '#ffd23f'); };
  const drawers = (ctx, w, h) => { for (let v = 3; v < h - 3; v += 6) { R(ctx, 2, v, w - 4, 4, 'rgba(0,0,0,.18)'); R(ctx, w / 2 - 1, v + 2, 2, 1, OUT); } };
  const bottles = (ctx, w, h) => { for (let i = 2; i < w - 2; i += 4) { const col = ['#e8533f', '#3c7bd6', '#39a85a', '#ffd23f', '#d64f8e', '#f4f0e6'][Math.floor(i / 4) % 6], bh = 5 + (i % 3); R(ctx, i, h - 3 - bh, 3, bh, col); R(ctx, i, h - 3 - bh, 1, bh, shade(col, 0.4)); } R(ctx, 0, h - 3, w, 1, '#5a3620'); };
  const sheet = (ctx, w, d) => { R(ctx, 1, 1, w - 2, d - 2, '#f4f4f8'); R(ctx, 2, 2, w - 4, 6, '#dfe4f2'); R(ctx, 3, 3, w - 6, 3, '#fff'); R(ctx, 1, 10, w - 2, d - 11, '#7fb7e6'); R(ctx, 1, 10, w - 2, 1, '#fff'); };

  // ---------- room furniture: footprint for depth sorting + draw(ctx, X, Y) ----------
  const F = {
    desk: (x, y) => ({ x, y, w: 28, d: 12, draw: (c, X, Y) => { box(c, X + x, Y + y, 28, 12, 11, '#8a5a34', { top: ctx => { R(ctx, 3, 3, 8, 4, '#f2ecdc'); R(ctx, 4, 4, 6, 1, '#c9c0ac'); R(ctx, 14, 2, 4, 3, '#e8533f'); }, south: drawers }); box(c, X + x + 19, Y + y + 2, 7, 5, 7, '#2b2e3a', { south: (ctx, w, h) => screen(ctx, 1, 1, w - 2, h - 2) }); } }),
    chair: (x, y, col) => ({ x, y, w: 8, d: 8, draw: (c, X, Y) => { box(c, X + x, Y + y, 8, 8, 5, col || '#3a3f5c'); box(c, X + x, Y + y, 8, 2, 11, shade(col || '#3a3f5c', -0.15)); } }),
    cabinet: (x, y) => ({ x, y, w: 10, d: 10, draw: (c, X, Y) => box(c, X + x, Y + y, 10, 10, 22, '#6c6f78', { south: drawers }) }),
    shelves: (x, y, w) => ({ x, y, w, d: 6, draw: (c, X, Y) => box(c, X + x, Y + y, w, 6, 20, '#8b5a2b', { south: bottles }) }),
    counter: (x, y, w) => ({ x, y, w, d: 10, draw: (c, X, Y) => box(c, X + x, Y + y, w, 10, 11, '#e8e0d0', { top: ctx => { R(ctx, 2, 2, 4, 3, '#3c7bd6'); R(ctx, 8, 3, 5, 2, '#f4f0e6'); R(ctx, w - 7, 2, 4, 3, '#39a85a'); }, south: (ctx, w2, h) => { R(ctx, 0, 3, w2, 1, '#bbb3a4'); R(ctx, 3, 5, w2 / 2 - 4, h - 7, '#d6cdbc'); R(ctx, w2 / 2 + 1, 5, w2 / 2 - 4, h - 7, '#d6cdbc'); } }) }),
    sink: (x, y) => ({ x, y, w: 10, d: 10, draw: (c, X, Y) => { box(c, X + x, Y + y, 10, 10, 11, '#c0c4cc', { top: ctx => { R(ctx, 2, 2, 6, 6, '#9fd8ff'); R(ctx, 4, 1, 2, 1, '#6a7078'); } }); } }),
    bed: (x, y) => ({ x, y, w: 14, d: 26, draw: (c, X, Y) => { box(c, X + x, Y + y, 14, 2, 14, '#5a3a22'); box(c, X + x, Y + y + 2, 14, 24, 8, '#f4f4f8', { top: sheet }); } }),
    bedside: (x, y) => ({ x, y, w: 8, d: 8, draw: (c, X, Y) => box(c, X + x, Y + y, 8, 8, 10, '#8b5a2b', { top: ctx => { R(ctx, 2, 2, 4, 4, '#ff6b9a'); R(ctx, 3, 1, 2, 1, '#39a85a'); } }) }),
    curtain: (x, y) => ({ x, y, w: 2, d: 22, draw: (c, X, Y) => box(c, X + x, Y + y, 2, 22, 22, '#bfe3df', { east: (ctx, d, h) => { for (let v = 2; v < h; v += 4) R(ctx, 0, v, d, 1, '#aed7d2'); } }) }),
    couch: (x, y) => ({ x, y, w: 32, d: 12, draw: (c, X, Y) => { box(c, X + x, Y + y, 32, 3, 13, '#6b2d3a'); box(c, X + x, Y + y + 3, 32, 9, 7, '#8a3a4a', { top: ctx => { R(ctx, 2, 1, 28, 6, '#a04a5a'); R(ctx, 4, 2, 6, 4, '#f2d9a4'); } }); } }),
    bookshelf: (x, y) => ({ x, y, w: 22, d: 6, draw: (c, X, Y) => box(c, X + x, Y + y, 22, 6, 24, '#5a3a22', { south: (ctx, w, h) => { for (let v = 3; v < h - 2; v += 7) { R(ctx, 1, v, w - 2, 6, '#2b1b10'); for (let u = 2; u < w - 2; u += 3) R(ctx, u, v + 1 + ((u * 7 + v) % 3), 2, 5 - ((u * 7 + v) % 3), ['#8b2a2a', '#2f5e3a', '#2a4a7a', '#8a6a2a', '#5a2a6a'][(u + v) % 5]); } } }) }),
    inflator: (x, y) => ({ x, y, w: 18, d: 14, draw: (c, X, Y) => { box(c, X + x, Y + y, 18, 14, 26, '#8aa0b8', { south: (ctx, w, h) => { screen(ctx, 2, 3, 14, 8); buttons(ctx, 3, 14); R(ctx, 2, h - 6, 14, 3, '#5c6f85'); } }); box(c, X + x + 20, Y + y + 2, 8, 8, 16, '#ffd23f', { south: (ctx, w, h) => R(ctx, 1, 2, w - 2, 4, '#e8b800') }); box(c, X + x + 18, Y + y + 5, 2, 2, 12, '#5c6f85'); } }),
    monitor: (x, y) => ({ x, y, w: 10, d: 8, draw: (c, X, Y) => { box(c, X + x, Y + y, 10, 8, 4, '#6b7280'); box(c, X + x + 1, Y + y + 1, 8, 6, 15, '#8aa0b8', { south: (ctx, w, h) => { screen(ctx, 1, 2, w - 2, 7); R(ctx, 2, 11, 2, 2, '#39a85a'); } }); } }),
    slicer: (x, y) => ({ x, y, w: 22, d: 14, draw: (c, X, Y) => { box(c, X + x, Y + y, 22, 14, 22, '#9aa3b8', { south: (ctx, w, h) => { screen(ctx, 2, 2, 18, 6); R(ctx, 8, 10, 6, 10, '#e8e8ee'); R(ctx, 10, 11, 2, 8, '#8a8f99'); } }); box(c, X + x - 6, Y + y + 4, 5, 6, 4, '#ff6b9a'); } }),
    hairchair: (x, y) => ({ x, y, w: 14, d: 12, draw: (c, X, Y) => { box(c, X + x, Y + y, 14, 12, 8, '#e8533f', { top: ctx => R(ctx, 2, 2, 10, 8, '#ff7a66') }); box(c, X + x + 6, Y + y - 2, 2, 2, 24, '#6b7280'); box(c, X + x + 1, Y + y - 3, 12, 6, 10, '#d9d9de', { south: (ctx, w, h) => R(ctx, 2, 4, w - 4, 2, '#6fd3ff') }); } }),
    coil: (x, y) => ({ x, y, w: 12, d: 12, draw: (c, X, Y) => { box(c, X + x, Y + y, 12, 12, 6, '#5c6f85', { south: (ctx, w, h) => R(ctx, 2, 2, w - 4, 2, '#e8533f') }); box(c, X + x + 4, Y + y + 4, 4, 4, 22, '#8aa0b8', { south: (ctx, w, h) => { for (let v = 2; v < h; v += 3) R(ctx, 0, v, w, 1, '#c8ced8'); } }); const [sx, sy] = px(X + x + 6, Y + y + 6); c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(sx, sy - 30, 6, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff6c0'; c.beginPath(); c.arc(sx - 2, sy - 32, 2, 0, Math.PI * 2); c.fill(); } }),
    zapchair: (x, y) => ({ x, y, w: 14, d: 12, draw: (c, X, Y) => { box(c, X + x, Y + y, 14, 12, 8, '#9aa3b8', { top: ctx => R(ctx, 2, 2, 10, 8, '#b8c0cc') }); box(c, X + x, Y + y, 14, 2, 14, '#6b7280'); } }),
    optable: (x, y) => ({ x, y, w: 30, d: 12, draw: (c, X, Y) => { box(c, X + x + 4, Y + y + 4, 22, 4, 4, '#6b7280'); box(c, X + x, Y + y, 30, 12, 10, '#c8ced8', { top: ctx => { R(ctx, 2, 2, 26, 8, '#e8e8ee'); R(ctx, 3, 3, 8, 3, '#dfe4f2'); } }); } }),
    oplamp: (x, y) => ({ x, y, w: 2, d: 2, draw: (c, X, Y) => { box(c, X + x, Y + y, 2, 2, 30, '#9aa3b8'); const [sx, sy] = px(X + x + 1, Y + y + 1); R(c, sx - 12, sy - 36, 24, 5, '#9aa3b8'); R(c, sx - 10, sy - 31, 20, 3, '#ffd23f'); R(c, sx - 8, sy - 29, 16, 1, '#fff6c0'); } }),
    lamp: (x, y) => ({ x, y, w: 4, d: 4, draw: (c, X, Y) => bill(c, A.furniture('lamp'), X + x + 2, Y + y + 4) }),
    plant: (x, y) => ({ x, y, w: 8, d: 8, draw: (c, X, Y) => { shadow(c, X + x + 4, Y + y + 6, 5); bill(c, A.furniture('plant'), X + x + 4, Y + y + 7); } }),
    bin: (x, y) => ({ x, y, w: 6, d: 6, draw: (c, X, Y) => box(c, X + x, Y + y, 6, 6, 8, '#6b7280', { top: ctx => R(ctx, 1, 1, 4, 4, '#3a3f48') }) }),
  };
  const ROOM_ITEMS = {
    gp:     [F.desk(4, 10), F.chair(10, 24), F.cabinet(50, 4), F.plant(54, 30)],
    pharm:  [F.shelves(2, 2, 60), F.counter(6, 18, 26), F.sink(50, 16), F.bin(56, 30)],
    ward:   [F.bed(4, 6), F.bedside(22, 8), F.bed(44, 6), F.curtain(32, 6)],
    psych:  [F.bookshelf(2, 2), F.couch(26, 14), F.lamp(6, 28), F.plant(54, 30)],
    infl:   [F.inflator(4, 4), F.monitor(50, 6), F.bin(56, 30)],
    tongue: [F.slicer(36, 4), F.cabinet(4, 4), F.sink(4, 22)],
    hair:   [F.hairchair(8, 14), F.cabinet(50, 6), F.plant(54, 30)],
    elec:   [F.coil(44, 4), F.zapchair(6, 12), F.monitor(50, 24)],
    op:     [F.optable(16, 12), F.oplamp(30, 6), F.monitor(2, 6), F.cabinet(50, 4)],
  };
  // corridor decoration (centred on a 16px tile)
  const DECOR_DRAW = {
    plant: (c, x, y) => { shadow(c, x, y + 4, 5); bill(c, A.furniture('plant'), x, y + 5); },
    bench: (c, x, y) => { box(c, x - 7, y - 2, 14, 6, 4, '#26a69e'); box(c, x - 7, y - 3, 14, 1, 9, '#1f8f87'); },
    bin: (c, x, y) => box(c, x - 3, y - 3, 6, 6, 8, '#6b7280', { top: ctx => R(ctx, 1, 1, 4, 4, '#3a3f48') }),
    radiator: (c, x, y) => box(c, x - 7, y - 2, 14, 3, 8, '#f4f4f0', { south: (ctx, w, h) => { for (let u = 1; u < w; u += 2) R(ctx, u, 1, 1, h - 2, '#d2d2cf'); } }),
    drinks: (c, x, y) => box(c, x - 5, y - 4, 10, 8, 22, '#c43c2c', { south: (ctx, w, h) => { R(ctx, 1, 2, w - 2, 11, '#1d2a3a'); for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) R(ctx, 2 + i * 3, 4 + j * 5, 2, 3, ['#ffd23f', '#39a85a', '#3c7bd6'][(i + j) % 3]); R(ctx, 2, h - 6, w - 4, 3, '#1d2a3a'); R(ctx, w - 3, 14, 2, 1, '#ffd23f'); } }),
  };
  const DECOR_FOOT = { plant: [8, 8], bench: [14, 6], bin: [6, 6], radiator: [14, 3], drinks: [10, 8] };

  // ---------- floors and walls ----------
  const C = A.C;
  let groundC = null;
  function ground() {
    if (groundC) return groundC;
    const [c, x] = A.canvas(W * T, H * T);
    R(x, 0, 0, 32, H * T, C.grass);
    for (let i = 0; i < 90; i++) R(x, Math.floor(A.hash(i, 7) * 31), Math.floor(A.hash(i, 11) * (H * T - 1)), 1, 1, C.grassD);
    for (let i = 0; i < 12; i++) { const X = Math.floor(A.hash(i, 21) * 29) + 1, Y = Math.floor(A.hash(i, 33) * (H * T - 2)); if (Y > 56 && Y < 120) continue; R(x, X, Y, 2, 2, ['#ffd23f', '#ff6b9a', '#f4f4f0'][i % 3]); }
    for (let r = 4; r <= 6; r++) for (let col = 0; col < 2; col++) { R(x, col * T, r * T, 16, 16, (col + r) % 2 ? C.pave : C.paveD); }
    for (let r = 4; r <= 6; r++) for (let col = 2; col < W; col++) { R(x, col * T, r * T, 16, 16, (col + r) % 2 ? C.hall : C.hallD); R(x, col * T, r * T, 16, 1, shade(C.hall, 0.1)); R(x, col * T, r * T, 1, 16, shade(C.hall, -0.08)); }
    R(x, 32, 87, W * T - 32, 2, '#2fa39a'); R(x, 32, 87, W * T - 32, 1, '#5fc4bb');
    R(x, 14, 70, 18, 14, '#b0503a'); R(x, 16, 72, 14, 10, '#c86048');
    for (let k = 0; k < 10; k++) {
      const X = (2 + 4 * (k % 5)) * T, Y = k < 5 ? 0 : 112;
      R(x, X, Y, 64, 64, C.lot);
      for (let j = 0; j < 64; j += 4) for (let i = 0; i < 64; i += 4) if (A.hash(i + X, j + Y) < 0.12) R(x, X + i, Y + j, 2, 1, C.lotD);
      x.setLineDash([3, 3]); x.strokeStyle = shade(C.lot, -0.25); x.lineWidth = 1; x.strokeRect(X + 2.5, Y + 2.5, 59, 59); x.setLineDash([]);
    }
    return (groundC = c);
  }
  const floorCache = {};
  function roomFloor(kind) {
    if (floorCache[kind]) return floorCache[kind];
    const [c, x] = A.canvas(64, 64);
    const st = A.ROOM_STYLE[kind];
    A.floor(x, 0, 0, 64, 64, st.floor[0], st.floor[1], st.floor[2]);
    R(x, 0, 0, 64, 3, 'rgba(0,0,0,.14)'); R(x, 0, 0, 3, 64, 'rgba(0,0,0,.14)');
    return (floorCache[kind] = c);
  }
  const wallCache = {};
  // wallpaper strip w x h with cornice, baseboard and optional decal; `gap` = [u0, u1] door opening
  function wallImg(key, w, h, col, style, decal, gap) {
    if (wallCache[key]) return wallCache[key];
    const [c, x] = A.canvas(w, h);
    R(x, 0, 0, w, h, col);
    const d = shade(col, -0.1), l = shade(col, 0.12);
    if (style === 'stripe') for (let i = 0; i < w; i += 6) R(x, i, 0, 2, h, d);
    else if (style === 'dots') for (let j = 3; j < h - 4; j += 5) for (let i = (j % 10 ? 1 : 4); i < w; i += 6) R(x, i, j, 1, 1, l);
    else if (style === 'tiles') { for (let j = 0; j < h; j += 5) R(x, 0, j, w, 1, d); for (let i = 0; i < w; i += 9) R(x, i, 0, 1, h, d); }
    else if (style === 'brick') { for (let j = 0; j < h; j += 4) { R(x, 0, j, w, 1, shade(col, -0.2)); for (let i = (j / 4) % 2 ? 4 : 0; i < w; i += 8) R(x, i, j, 1, 4, shade(col, -0.2)); } }
    R(x, 0, 0, w, 1, l);
    if (h > 12) { R(x, 0, h - 3, w, 3, shade(col, -0.35)); R(x, 0, h - 3, w, 1, shade(col, -0.15)); }
    else { R(x, 0, h - 2, w, 2, shade(col, -0.35)); R(x, 0, 1, w, 1, shade(col, 0.2)); }
    if (decal) decal(x, w, h);
    if (gap) { x.clearRect(gap[0], 0, gap[1] - gap[0], h); R(x, gap[0] - 2, 0, 2, h, '#5a4634'); R(x, gap[1], 0, 2, h, '#5a4634'); R(x, gap[0] - 2, 0, gap[1] - gap[0] + 4, 2, '#5a4634'); }
    return (wallCache[key] = c);
  }
  const WALL_DECAL = {
    gp: (x, w, h) => { R(x, 6, 6, 10, 12, '#f4f0e6'); R(x, 10, 8, 2, 2, OUT); R(x, 8, 11, 2, 1, OUT); R(x, 12, 11, 2, 1, OUT); for (let i = 8; i < 14; i += 2) R(x, i, 14, 1, 1, OUT); x.fillStyle = '#f4f0e6'; x.beginPath(); x.arc(46, 10, 4, 0, Math.PI * 2); x.fill(); R(x, 46, 7, 1, 3, OUT); R(x, 46, 10, 2, 1, OUT); },
    pharm: (x, w, h) => { R(x, 44, 5, 10, 9, '#fff'); R(x, 48, 6, 2, 7, '#e8533f'); R(x, 46, 8, 6, 3, '#e8533f'); },
    ward: (x, w, h) => { R(x, 26, 5, 12, 10, '#fff'); R(x, 27, 6, 10, 8, '#3c7bd6'); R(x, 28, 7, 8, 1, '#fff'); R(x, 29, 10, 6, 1, '#fff'); },
    psych: (x, w, h) => { R(x, 36, 5, 16, 12, '#d9a93a'); R(x, 37, 6, 14, 10, '#3c7bd6'); R(x, 37, 12, 14, 4, '#39a85a'); R(x, 46, 7, 3, 3, '#ffd23f'); },
    infl: (x, w, h) => { R(x, 34, 5, 12, 10, '#fff'); R(x, 35, 6, 10, 8, '#e8533f'); R(x, 37, 8, 6, 4, '#fff'); },
    tongue: (x, w, h) => { R(x, 8, 5, 12, 10, '#fff'); R(x, 9, 6, 10, 8, '#ff6b9a'); R(x, 11, 9, 6, 2, '#e04a7a'); },
    hair: (x, w, h) => { R(x, 40, 5, 16, 12, '#8b5a2b'); R(x, 41, 6, 14, 10, '#9fd8ff'); R(x, 42, 7, 6, 4, '#dff3ff'); },
    elec: (x, w, h) => { R(x, 8, 5, 12, 10, '#ffd23f'); R(x, 13, 7, 2, 4, OUT); R(x, 13, 12, 2, 1, OUT); },
    op: (x, w, h) => { R(x, 6, 5, 14, 12, '#2b2e3a'); R(x, 7, 6, 12, 10, '#9fd8ff'); R(x, 10, 8, 2, 7, '#dff3ff'); R(x, 13, 8, 2, 7, '#dff3ff'); R(x, 9, 10, 8, 1, '#dff3ff'); },
  };
  const EXT = '#b9b2a6';
  function roomWalls(k, kind, X, Y, top) {
    const st = A.ROOM_STYLE[kind], col = st.wall[0], style = st.wall[1];
    const items = [];
    if (top) {
      const n = wallImg('N' + kind, 64, WALL_H, col, style, WALL_DECAL[kind]);
      items.push({ d: X + Y - 100, draw: c => wallN(c, n, X, Y, WALL_H) });
      const wimg = wallImg('W' + kind, 64, WALL_H, col, style);
      items.push({ d: X + Y - 60, draw: c => wallW(c, wimg, X, Y, WALL_H) });
      const sLow = wallImg('S' + kind, 64, LOW_H, col, style, null, [25, 39]);
      for (let i = 0; i < 4; i++) items.push({ d: X + i * 16 + 8 + Y + 64, draw: i === 0 ? c => wallN(c, sLow, X, Y + 64, LOW_H) : () => {} });
    } else {
      const n = wallImg('n' + kind, 64, LOW_H, col, style, null, [25, 39]);
      items.push({ d: X + 8 + Y, draw: c => wallN(c, n, X, Y, LOW_H) });
      const wimg = wallImg('w' + kind, 64, LOW_H, col, style);
      items.push({ d: X + Y + 8, draw: c => wallW(c, wimg, X, Y, LOW_H) });
    }
    return items;
  }
  function lotWalls(X, Y, top) {
    const items = [];
    if (top) { const n = wallImg('Nlot', 64, WALL_H, EXT, 'brick'); items.push({ d: X + Y - 100, draw: c => wallN(c, n, X, Y, WALL_H) }); const l = wallImg('Slot', 64, LOW_H, EXT, 'brick'); items.push({ d: X + 8 + Y + 64, draw: c => wallN(c, l, X, Y + 64, LOW_H) }); }
    else { const l = wallImg('nlot', 64, LOW_H, EXT, 'brick'); items.push({ d: X + 8 + Y, draw: c => wallN(c, l, X, Y, LOW_H) }); }
    return items;
  }
  function scaffoldItems(X, Y, prog) {
    return [{ d: X + Y + 70, draw: c => { for (let i = 0; i < 3; i++) box(c, X + 6 + i * 22, Y + 10, 2, 2, 28, '#c8a05a'); box(c, X + 8, Y + 30, 14, 12, 10, '#a0703a'); box(c, X + 36, Y + 32, 16, 10, 8, '#a0703a'); const [sx, sy] = px(X + 32, Y + 32); R(c, sx - 16, sy - 30, 32, 5, OUT); R(c, sx - 15, sy - 29, Math.round(30 * prog), 3, '#ffd23f'); } }];
  }
  // outside: ambulance, trees, sign, entrance posts, reception desk
  function outside() {
    const items = [];
    items.push({ d: 2 + 26 + 28 + 12, draw: c => { box(c, 2, 28, 26, 12, 13, '#f4f4f0', { south: (ctx, w, h) => { R(ctx, 0, 6, w, 3, '#e8533f'); R(ctx, 2, 1, 6, 4, '#9fd8ff'); R(ctx, 10, 1, 6, 4, '#9fd8ff'); R(ctx, 19, 1, 6, 4, '#9fd8ff'); R(ctx, 12, 2, 2, 1, '#e8533f'); R(ctx, 11, 3, 4, 1, '#e8533f'); }, east: (ctx, d, h) => { R(ctx, 0, 6, d, 3, '#e8533f'); R(ctx, 2, 1, 8, 4, '#9fd8ff'); }, top: ctx => { R(ctx, 4, 2, 4, 3, '#3c7bd6'); R(ctx, 14, 2, 4, 3, '#e8533f'); } }); } });
    items.push({ d: 16 + 150, draw: c => { shadow(c, 16, 150, 8); bill(c, A.furniture('tree'), 16, 150); } });
    items.push({ d: 10 + 12, draw: c => bill(c, A.furniture('bush'), 10, 12) });
    items.push({ d: 20 + 168, draw: c => bill(c, A.furniture('bush'), 20, 168) });
    items.push({ d: 14 + 56, draw: c => bill(c, A.furniture('sign'), 14, 56) });
    items.push({ d: 32 + 64, draw: c => box(c, 30, 62, 3, 3, 24, '#8a8f99') });
    items.push({ d: 32 + 112, draw: c => box(c, 30, 110, 3, 3, 24, '#8a8f99') });
    items.push({ d: 30 + 106, draw: c => { box(c, 0, 96, 30, 10, 11, '#7a4b2c', { top: ctx => { R(ctx, 3, 2, 6, 4, '#f2ecdc'); R(ctx, 22, 2, 4, 3, '#e8533f'); }, south: (ctx, w, h) => { R(ctx, 2, 3, 10, 6, '#5a3620'); R(ctx, 17, 3, 10, 6, '#5a3620'); } }); box(c, 12, 97, 7, 5, 7, '#2b2e3a', { south: (ctx, w, h) => screen(ctx, 1, 1, w - 2, h - 2) }); } });
    // exterior wall segments west of the top and bottom rows
    const ew = wallImg('EXTW', 64, WALL_H, EXT, 'brick', (x, w, h) => { R(x, 20, 8, 12, 10, '#9fd8ff'); R(x, 21, 9, 4, 4, '#dff3ff'); R(x, 19, 7, 14, 1, '#f4f4f0'); R(x, 19, 18, 14, 1, '#f4f4f0'); });
    items.push({ d: 32 - 60, draw: c => wallW(c, ew, 32, 0, WALL_H) });
    const el = wallImg('EXTL', 64, LOW_H, EXT, 'brick');
    items.push({ d: 32 + 112 + 8, draw: c => wallW(c, el, 32, 112, LOW_H) });
    return items;
  }
  // mess: puddle decal or a dropped can
  function messItem(m) {
    if (m.k === 'vomit') return { d: m.x + m.y - 1, draw: c => decal(c, m.x, m.y, ctx => { ctx.fillStyle = '#8fbf4a'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 4, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#b5d86a'; ctx.beginPath(); ctx.ellipse(-1, -1, 3, 2, 0, 0, Math.PI * 2); ctx.fill(); R(ctx, 5, 2, 2, 1, '#8fbf4a'); R(ctx, -7, 1, 2, 1, '#8fbf4a'); }) };
    return { d: m.x + m.y, draw: c => { const [sx, sy] = px(m.x, m.y); R(c, sx - 2, sy - 4, 4, 4, '#e8533f'); R(c, sx - 2, sy - 5, 4, 1, '#c8ccd4'); R(c, sx - 1, sy - 3, 1, 2, '#ffd23f'); } };
  }

  window.HI = { K, KX, KY, OX, OY, BW, BH, WALL_H, LOW_H, px, unproj, floorAt, wallN, wallW, bill, shadow, decal, box, ground, roomFloor, roomWalls, lotWalls, scaffoldItems, outside, messItem, ROOM_ITEMS, DECOR_DRAW, DECOR_FOOT };
})();
