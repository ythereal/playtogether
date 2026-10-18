// Rival Hospital 3D: isometric scene. The simulation keeps plain 2D coordinates (rules.js); this file rotates
// them (four 90° views), projects them 2:1 and draws floors, walls, furniture as shaded iso boxes and corridor
// decoration. Everything is drawn in code; people and plants are upright "billboard" sprites from art.js.
(function () {
  'use strict';
  const A = window.HA, RH = window.RH;
  const T = 16, W = RH.W, H = RH.H, OUT = '#1b1720';
  const K = 0.75, KX = K, KY = K / 2;             // world px → screen px along the two floor axes
  const L = Math.max(W, H) * T, CXW = W * T / 2, CYW = H * T / 2;   // rotation centre and bounding square
  const OX = Math.ceil(L * KX) + 8, OY = 54;
  const OXF = 8, OYF = 60;                          // flat (aerial) view origin
  const BW = Math.max(OX * 2, L + 16), BH = Math.max(Math.ceil(L * K) + OY + 30, L + OYF + 40);
  const WALL_H = 34, LOW_H = 3;      // walls facing the viewer are cut down to a baseboard so nothing is sliced
  let rot = 0;                                      // 0..3, quarter turns clockwise
  let flat = false;                                 // aerial view: plain top-down instead of isometric
  const setRot = r => { rot = ((r % 4) + 4) % 4; };
  const getRot = () => rot;
  const setFlat = f => { flat = !!f; };
  const getFlat = () => flat;
  // the area of the buffer the current view occupies (for fitting the camera)
  const extent = () => (flat ? { x: 0, y: OYF - 36, w: L + 16, h: L + 40 } : { x: 0, y: 0, w: OX * 2, h: Math.ceil(L * K) + OY + 30 });
  // world → rotated world (about the map centre)
  function rw(x, y) {
    const dx = x - CXW, dy = y - CYW;
    switch (rot) { case 1: return [CXW - dy, CYW + dx]; case 2: return [CXW - dx, CYW - dy]; case 3: return [CXW + dy, CYW - dx]; default: return [x, y]; }
  }
  function unrw(x, y) {
    const dx = x - CXW, dy = y - CYW;
    switch (rot) { case 1: return [CXW + dy, CYW - dx]; case 2: return [CXW - dx, CYW - dy]; case 3: return [CXW - dy, CYW + dx]; default: return [x, y]; }
  }
  const pxr = (x, y) => (flat ? [OXF + x, OYF + y] : [OX + (x - y) * KX, OY + (x + y) * KY]);   // rotated world → screen
  const px = (x, y) => { const [a, b] = rw(x, y); return pxr(a, b); };          // world → screen
  const dsum = (a, b) => (flat ? b + a * 0.001 : a + b);          // draw order: y-major when aerial, x+y when isometric
  const depth = (x, y) => { const [a, b] = rw(x, y); return dsum(a, b); };
  function unproj(sx, sy) { if (flat) return unrw(sx - OXF, sy - OYF); const u = (sx - OX) / KX, v = (sy - OY) / KY; return unrw((u + v) / 2, (v - u) / 2); }
  // sprite facing (0 down, 1 up, 2 left, 3 right) seen from the rotated view
  const ROTF = [[0, 1, 2, 3], [2, 3, 1, 0], [1, 0, 3, 2], [3, 2, 0, 1]];
  const facing = f => ROTF[rot][f] == null ? 0 : ROTF[rot][f];
  const reset = ctx => ctx.setTransform(1, 0, 0, 1, 0, 0);
  const R = (ctx, x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  const shade = A.shade;

  // ---------- projected image helpers ----------
  // a top-down image whose top-left is at world (x, y)
  function floorAt(ctx, img, x, y) {
    const [a, b] = rw(x, y);
    // world +x and +y map to these screen vectors for each quarter turn
    const m = (flat ? [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]] : [[KX, KY, -KX, KY], [-KX, KY, -KX, -KY], [-KX, -KY, KX, -KY], [KX, -KY, KX, KY]])[rot];
    // the image's u axis is world +x and v axis is world +y; both rotate with the view
    const [ox, oy] = pxr(a, b);
    ctx.setTransform(m[0], m[1], m[2], m[3], ox, oy);
    ctx.drawImage(img, 0, 0); reset(ctx);
  }
  // a vertical wall image standing on the floor from world A to world B (left edge of the image at A)
  function wallSeg(ctx, img, ax, ay, bx, by, h) {
    const [a1, a2] = px(ax, ay), [b1, b2] = px(bx, by), len = Math.hypot(bx - ax, by - ay);
    ctx.setTransform((b1 - a1) / len, (b2 - a2) / len, 0, 1, a1, a2 - h);
    ctx.drawImage(img, 0, 0, len, h); reset(ctx);
  }
  function bill(ctx, img, x, y, lift) { const [sx, sy] = px(x, y); ctx.drawImage(img, Math.round(sx - img.width / 2), Math.round(sy - img.height + (lift || 0))); }
  function shadow(ctx, x, y, rx) { const [sx, sy] = px(x, y); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(sx, sy, rx, rx / 2, 0, 0, Math.PI * 2); ctx.fill(); }
  const topM = () => (flat ? [1, 0, 0, 1] : [KX, KY, -KX, KY]);
  function decal(ctx, x, y, fn) { const [a, b] = rw(x, y), [ox, oy] = pxr(a, b), m = topM(); ctx.setTransform(m[0], m[1], m[2], m[3], ox, oy); fn(ctx); reset(ctx); }

  // ---------- iso box: footprint (x, y, w, d) in world units, height h in screen px ----------
  function box(ctx, x, y, w, d, h, col, faces) {
    h = h | 0;
    // rotate the footprint into view space (axis-aligned again, w/d may swap)
    const c = [rw(x, y), rw(x + w, y), rw(x + w, y + d), rw(x, y + d)];
    const x0 = Math.min(...c.map(p => p[0])), y0 = Math.min(...c.map(p => p[1])), x1 = Math.max(...c.map(p => p[0])), y1 = Math.max(...c.map(p => p[1]));
    const vw = x1 - x0, vd = y1 - y0;
    const p00 = pxr(x0, y0), p10 = pxr(x1, y0), p11 = pxr(x1, y1), p01 = pxr(x0, y1);
    const poly = (pts, fill) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = 'rgba(27,23,32,.75)'; ctx.lineWidth = 1; ctx.stroke(); };
    if (flat) h = 0;
    const up = p => [p[0], p[1] - h];
    if (!flat) {
      poly([up(p01), up(p11), p11, p01], col);                      // south face (view space)
      poly([up(p10), up(p11), p11, p10], shade(col, -0.32));        // east face
    }
    poly([up(p00), up(p10), up(p11), up(p01)], shade(col, flat ? 0.08 : 0.18)); // top
    if (!faces) return;
    ctx.save();
    if (faces.top) { const m = topM(); ctx.setTransform(m[0], m[1], m[2], m[3], p00[0], p00[1] - h); ctx.beginPath(); ctx.rect(0, 0, vw, vd); ctx.clip(); faces.top(ctx, vw, vd); reset(ctx); }
    if (faces.south && !flat) { ctx.setTransform(KX, KY, 0, 1, p01[0], p01[1] - h); ctx.beginPath(); ctx.rect(0, 0, vw, h); ctx.clip(); faces.south(ctx, vw, h); reset(ctx); }
    if (faces.east && !flat) { ctx.setTransform(-KX, KY, 0, 1, p10[0], p10[1] - h); ctx.beginPath(); ctx.rect(0, 0, vd, h); ctx.clip(); faces.east(ctx, vd, h); reset(ctx); }
    ctx.restore();
  }
  // small decal painters (local units)
  const screen = (ctx, u, v, w, h) => { R(ctx, u, v, w, h, '#1d2a3a'); R(ctx, u + 1, v + 1, Math.max(1, w / 2), 1, '#6fd3ff'); R(ctx, u + 1, v + 3, Math.max(1, w - 3), 1, '#2f5a7a'); R(ctx, u + w - 3, v + h - 2, 2, 1, '#e8533f'); };
  const buttons = (ctx, u, v) => { R(ctx, u, v, 2, 2, '#e8533f'); R(ctx, u + 3, v, 2, 2, '#39a85a'); R(ctx, u + 6, v, 2, 2, '#ffd23f'); };
  const drawers = (ctx, w, h) => { for (let v = 3; v < h - 3; v += 6) { R(ctx, 2, v, w - 4, 4, 'rgba(0,0,0,.18)'); R(ctx, w / 2 - 1, v + 2, 2, 1, OUT); } };
  const bottles = (ctx, w, h) => { for (let i = 2; i < w - 2; i += 4) { const col = ['#e8533f', '#3c7bd6', '#39a85a', '#ffd23f', '#d64f8e', '#f4f0e6'][Math.floor(i / 4) % 6], bh = 5 + (i % 3); R(ctx, i, h - 3 - bh, 3, bh, col); R(ctx, i, h - 3 - bh, 1, bh, shade(col, 0.4)); } R(ctx, 0, h - 3, w, 1, '#5a3620'); };
  const sheet = (ctx, w, d) => { R(ctx, 1, 1, w - 2, d - 2, '#f4f4f8'); R(ctx, 2, 2, w - 4, 6, '#dfe4f2'); R(ctx, 3, 3, w - 6, 3, '#fff'); R(ctx, 1, 10, w - 2, d - 11, '#7fb7e6'); R(ctx, 1, 10, w - 2, 1, '#fff'); };

  // ---------- room furniture: footprint for depth sorting + draw(ctx, X, Y) ----------
  const hazard = (ctx, w, h) => { for (let u = -h; u < w; u += 6) { ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(u, h); ctx.lineTo(u + 3, h); ctx.lineTo(u + 3 + h, 0); ctx.lineTo(u + h, 0); ctx.fill(); } };
  const glow = (c, sx, sy, r, col) => { const g = c.createRadialGradient(sx, sy, 0, sx, sy, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(sx - r, sy - r, r * 2, r * 2); };
  const F = {
    desk: (x, y) => ({ x, y, w: 28, d: 12, draw: (c, X, Y) => { box(c, X + x, Y + y, 28, 12, 11, '#8a5a34', { top: ctx => { R(ctx, 3, 3, 8, 4, '#f2ecdc'); R(ctx, 4, 4, 6, 1, '#c9c0ac'); R(ctx, 14, 2, 4, 3, '#e8533f'); }, south: drawers }); box(c, X + x + 19, Y + y + 2, 7, 5, 7, '#2b2e3a', { south: (ctx, w, h) => screen(ctx, 1, 1, w - 2, h - 2) }); } }),
    rdesk: (x, y) => ({ x, y, w: 18, d: 10, draw: (c, X, Y) => { box(c, X + x, Y + y, 18, 10, 11, '#6c6f78', { top: ctx => { R(ctx, 2, 2, 5, 4, '#f2ecdc'); R(ctx, 3, 7, 7, 1, '#2b2e3a'); }, south: drawers }); box(c, X + x + 8, Y + y + 1, 8, 5, 9, '#d9d4c7', { south: (ctx, w, h) => { R(ctx, 1, 1, w - 2, h - 3, '#1d2a3a'); R(ctx, 2, 2, 3, 1, '#7ee081'); R(ctx, 2, 4, 4, 1, '#7ee081'); } }); } }),
    chair: (x, y, col) => ({ x, y, w: 8, d: 8, draw: (c, X, Y) => { box(c, X + x, Y + y, 8, 8, 5, col || '#3a3f5c'); box(c, X + x, Y + y, 8, 2, 11, shade(col || '#3a3f5c', -0.15)); } }),
    cabinet: (x, y) => ({ x, y, w: 10, d: 10, draw: (c, X, Y) => box(c, X + x, Y + y, 10, 10, 22, '#6c6f78', { south: drawers }) }),
    shelves: (x, y, w) => ({ x, y, w, d: 6, draw: (c, X, Y) => box(c, X + x, Y + y, w, 6, 20, '#8b5a2b', { south: bottles }) }),
    counter: (x, y, w) => ({ x, y, w, d: 10, draw: (c, X, Y) => box(c, X + x, Y + y, w, 10, 11, '#e8e0d0', { top: ctx => { R(ctx, 2, 2, 4, 3, '#3c7bd6'); R(ctx, 8, 3, 5, 2, '#f4f0e6'); R(ctx, w - 7, 2, 4, 3, '#39a85a'); }, south: (ctx, w2, h) => { R(ctx, 0, 3, w2, 1, '#bbb3a4'); R(ctx, 3, 5, w2 / 2 - 4, h - 7, '#d6cdbc'); R(ctx, w2 / 2 + 1, 5, w2 / 2 - 4, h - 7, '#d6cdbc'); } }) }),
    sink: (x, y) => ({ x, y, w: 10, d: 10, draw: (c, X, Y) => { box(c, X + x, Y + y, 10, 10, 11, '#c0c4cc', { top: ctx => { R(ctx, 2, 2, 6, 6, '#9fd8ff'); R(ctx, 4, 1, 2, 1, '#6a7078'); } }); box(c, X + x + 2, Y + y, 6, 1, 20, '#dfe4f2', { south: (ctx, w, h) => R(ctx, 1, 1, w - 2, h - 2, '#9fd8ff') }); } }),
    bed: (x, y) => ({ x, y, w: 14, d: 26, draw: (c, X, Y) => { box(c, X + x, Y + y, 14, 2, 14, '#5a3a22'); box(c, X + x, Y + y + 2, 14, 24, 8, '#f4f4f8', { top: sheet }); } }),
    bedside: (x, y) => ({ x, y, w: 8, d: 8, draw: (c, X, Y) => box(c, X + x, Y + y, 8, 8, 10, '#8b5a2b', { top: ctx => { R(ctx, 2, 2, 4, 4, '#ff6b9a'); R(ctx, 3, 1, 2, 1, '#39a85a'); } }) }),
    curtain: (x, y, col) => ({ x, y, w: 2, d: 14, draw: (c, X, Y) => box(c, X + x, Y + y, 2, 14, 18, col || '#bfe3df', { east: (ctx, d, h) => { for (let v = 2; v < h; v += 4) R(ctx, 0, v, d, 1, shade(col || '#bfe3df', -0.08)); R(ctx, 0, 0, d, 1, '#9aa3b8'); } }) }),
    screenP: (x, y) => ({ x, y, w: 16, d: 2, draw: (c, X, Y) => box(c, X + x, Y + y, 16, 2, 20, '#f2e8d4', { south: (ctx, w, h) => { R(ctx, 0, 0, w, 2, '#9aa3b8'); for (let u = 5; u < w; u += 5) R(ctx, u, 0, 1, h, '#c9bfa8'); R(ctx, 0, h - 3, w, 3, '#9aa3b8'); } }) }),
    couch: (x, y, w) => ({ x, y, w: w || 32, d: 12, draw: (c, X, Y) => { const ww = w || 32; box(c, X + x, Y + y, ww, 3, 13, '#6b2d3a'); box(c, X + x, Y + y + 3, ww, 9, 7, '#8a3a4a', { top: ctx => { R(ctx, 2, 1, ww - 4, 6, '#a04a5a'); R(ctx, 4, 2, 6, 4, '#f2d9a4'); } }); box(c, X + x, Y + y + 3, 2, 9, 10, '#6b2d3a'); box(c, X + x + ww - 2, Y + y + 3, 2, 9, 10, '#6b2d3a'); } }),
    sofa: (x, y) => ({ x, y, w: 18, d: 10, draw: (c, X, Y) => { box(c, X + x, Y + y, 18, 3, 13, '#2f6b74'); box(c, X + x, Y + y + 3, 18, 7, 6, '#3f8a94', { top: ctx => { R(ctx, 1, 1, 7, 4, '#5aa8b2'); R(ctx, 10, 1, 7, 4, '#5aa8b2'); } }); box(c, X + x, Y + y + 3, 2, 7, 9, '#2f6b74'); box(c, X + x + 16, Y + y + 3, 2, 7, 9, '#2f6b74'); } }),
    examtable: (x, y) => ({ x, y, w: 26, d: 10, draw: (c, X, Y) => { box(c, X + x + 2, Y + y + 3, 3, 4, 6, '#9aa3b8'); box(c, X + x + 21, Y + y + 3, 3, 4, 6, '#9aa3b8'); box(c, X + x, Y + y, 26, 10, 10, '#4a8fb8', { top: ctx => { R(ctx, 1, 1, 24, 8, '#5fa7d0'); R(ctx, 1, 1, 6, 8, '#f4f4f8'); R(ctx, 8, 2, 16, 6, '#f4f4f8'); } }); } }),
    scale: (x, y) => ({ x, y, w: 8, d: 8, draw: (c, X, Y) => { box(c, X + x, Y + y, 8, 8, 2, '#c8ced8'); box(c, X + x + 3, Y + y, 2, 2, 22, '#9aa3b8'); const [sx, sy] = px(X + x + 4, Y + y + 1); R(c, sx - 4, sy - 26, 8, 6, '#f4f4f0'); R(c, sx - 3, sy - 25, 6, 4, '#2b2e3a'); R(c, sx - 1, sy - 24, 3, 1, '#e8533f'); } }),
    bookshelf: (x, y) => ({ x, y, w: 22, d: 6, draw: (c, X, Y) => box(c, X + x, Y + y, 22, 6, 24, '#5a3a22', { south: (ctx, w, h) => { for (let v = 3; v < h - 2; v += 7) { R(ctx, 1, v, w - 2, 6, '#2b1b10'); for (let u = 2; u < w - 2; u += 3) R(ctx, u, v + 1 + ((u * 7 + v) % 3), 2, 5 - ((u * 7 + v) % 3), ['#8b2a2a', '#2f5e3a', '#2a4a7a', '#8a6a2a', '#5a2a6a'][(u + v) % 5]); } } }) }),
    skeleton: (x, y) => ({ x, y, w: 6, d: 6, draw: (c, X, Y) => { box(c, X + x + 1, Y + y + 1, 4, 4, 2, '#6b7280'); box(c, X + x + 2, Y + y + 2, 2, 2, 8, '#9aa3b8'); const [sx, sy] = px(X + x + 3, Y + y + 3); const b = '#f4f0e6'; R(c, sx - 2, sy - 28, 5, 5, b); R(c, sx - 1, sy - 26, 1, 1, OUT); R(c, sx + 1, sy - 26, 1, 1, OUT); R(c, sx, sy - 23, 1, 12, b); for (let i = 0; i < 4; i++) R(c, sx - 3, sy - 21 + i * 2, 7, 1, b); R(c, sx - 4, sy - 21, 1, 7, b); R(c, sx + 4, sy - 21, 1, 7, b); R(c, sx - 2, sy - 11, 1, 6, b); R(c, sx + 2, sy - 11, 1, 6, b); } }),
    inflator: (x, y) => ({ x, y, w: 18, d: 14, draw: (c, X, Y) => { box(c, X + x, Y + y, 18, 14, 26, '#8aa0b8', { south: (ctx, w, h) => { screen(ctx, 2, 3, 14, 8); buttons(ctx, 3, 14); R(ctx, 2, h - 6, 14, 3, '#5c6f85'); } }); box(c, X + x + 20, Y + y + 2, 8, 8, 16, '#ffd23f', { south: (ctx, w, h) => R(ctx, 1, 2, w - 2, 4, '#e8b800') }); box(c, X + x + 18, Y + y + 5, 2, 2, 12, '#5c6f85'); } }),
    monitor: (x, y) => ({ x, y, w: 10, d: 8, draw: (c, X, Y) => { box(c, X + x, Y + y, 10, 8, 4, '#6b7280'); box(c, X + x + 1, Y + y + 1, 8, 6, 15, '#8aa0b8', { south: (ctx, w, h) => { screen(ctx, 1, 2, w - 2, 7); R(ctx, 2, 11, 2, 2, '#39a85a'); } }); } }),
    console: (x, y) => ({ x, y, w: 16, d: 8, draw: (c, X, Y) => { box(c, X + x, Y + y, 16, 8, 10, '#5c6f85', { top: ctx => { buttons(ctx, 2, 2); R(ctx, 10, 2, 4, 3, '#1d2a3a'); R(ctx, 11, 3, 2, 1, '#7ee081'); } }); box(c, X + x + 2, Y + y, 12, 2, 18, '#8aa0b8', { south: (ctx, w, h) => screen(ctx, 1, 1, w - 2, h - 9) }); } }),
    slicer: (x, y) => ({ x, y, w: 22, d: 14, draw: (c, X, Y) => { box(c, X + x, Y + y, 22, 14, 22, '#9aa3b8', { south: (ctx, w, h) => { screen(ctx, 2, 2, 18, 6); R(ctx, 8, 10, 6, 10, '#e8e8ee'); R(ctx, 10, 11, 2, 8, '#8a8f99'); } }); box(c, X + x - 6, Y + y + 4, 5, 6, 4, '#ff6b9a'); } }),
    hairchair: (x, y) => ({ x, y, w: 14, d: 12, draw: (c, X, Y) => { box(c, X + x, Y + y, 14, 12, 8, '#e8533f', { top: ctx => R(ctx, 2, 2, 10, 8, '#ff7a66') }); box(c, X + x + 6, Y + y - 2, 2, 2, 24, '#6b7280'); box(c, X + x + 1, Y + y - 3, 12, 6, 10, '#d9d9de', { south: (ctx, w, h) => R(ctx, 2, 4, w - 4, 2, '#6fd3ff') }); } }),
    coil: (x, y) => ({ x, y, w: 12, d: 12, draw: (c, X, Y) => { box(c, X + x, Y + y, 12, 12, 6, '#5c6f85', { south: (ctx, w, h) => R(ctx, 2, 2, w - 4, 2, '#e8533f') }); box(c, X + x + 4, Y + y + 4, 4, 4, 22, '#8aa0b8', { south: (ctx, w, h) => { for (let v = 2; v < h; v += 3) R(ctx, 0, v, w, 1, '#c8ced8'); } }); const [sx, sy] = px(X + x + 6, Y + y + 6); c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(sx, sy - 30, 6, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff6c0'; c.beginPath(); c.arc(sx - 2, sy - 32, 2, 0, Math.PI * 2); c.fill(); } }),
    zapchair: (x, y) => ({ x, y, w: 14, d: 12, draw: (c, X, Y) => { box(c, X + x, Y + y, 14, 12, 8, '#9aa3b8', { top: ctx => R(ctx, 2, 2, 10, 8, '#b8c0cc') }); box(c, X + x, Y + y, 14, 2, 14, '#6b7280'); } }),
    optable: (x, y) => ({ x, y, w: 30, d: 12, draw: (c, X, Y) => { box(c, X + x + 4, Y + y + 4, 22, 4, 4, '#6b7280'); box(c, X + x, Y + y, 30, 12, 10, '#c8ced8', { top: ctx => { R(ctx, 2, 2, 26, 8, '#e8e8ee'); R(ctx, 3, 3, 8, 3, '#dfe4f2'); } }); } }),
    oplamp: (x, y) => ({ x, y, w: 2, d: 2, draw: (c, X, Y) => { box(c, X + x, Y + y, 2, 2, 30, '#9aa3b8'); const [sx, sy] = px(X + x + 1, Y + y + 1); R(c, sx - 12, sy - 36, 24, 5, '#9aa3b8'); R(c, sx - 10, sy - 31, 20, 3, '#ffd23f'); R(c, sx - 8, sy - 29, 16, 1, '#fff6c0'); } }),
    lamp: (x, y) => ({ x, y, w: 4, d: 4, draw: (c, X, Y) => bill(c, A.furniture('lamp'), X + x + 2, Y + y + 4) }),
    plant: (x, y, dry) => ({ x, y, w: 8, d: 8, draw: (c, X, Y) => { shadow(c, X + x + 4, Y + y + 6, 5); bill(c, A.furniture(dry ? 'deadplant' : 'plant'), X + x + 4, Y + y + 7); } }),
    bin: (x, y) => ({ x, y, w: 6, d: 6, draw: (c, X, Y) => box(c, X + x, Y + y, 6, 6, 8, '#6b7280', { top: ctx => R(ctx, 1, 1, 4, 4, '#3a3f48') }) }),
    ext: (x, y) => ({ x, y, w: 4, d: 4, draw: (c, X, Y) => { box(c, X + x, Y + y, 4, 4, 13, '#d0352a', { south: (ctx, w, h) => { R(ctx, 0, 3, w, 3, '#f4f0e6'); R(ctx, 1, 4, 2, 1, '#d0352a'); } }); const [sx, sy] = px(X + x + 2, Y + y + 2); R(c, sx - 1, sy - 16, 3, 2, OUT); R(c, sx + 2, sy - 15, 2, 1, OUT); } }),
    rad: (x, y) => ({ x, y, w: 14, d: 3, draw: (c, X, Y) => box(c, X + x, Y + y, 14, 3, 9, '#f4f4f0', { south: (ctx, w, h) => { for (let u = 1; u < w; u += 2) R(ctx, u, 1, 1, h - 2, '#d2d2cf'); } }) }),
    // ---- diagnosis machines ----
    treadmill: (x, y) => ({ x, y, w: 26, d: 12, draw: (c, X, Y) => { box(c, X + x, Y + y, 26, 12, 4, '#3a3f48', { top: ctx => { R(ctx, 2, 2, 22, 8, '#1d2029'); for (let u = 3; u < 24; u += 3) R(ctx, u, 2, 1, 8, '#2b2e3a'); } }); box(c, X + x + 2, Y + y, 2, 2, 18, '#9aa3b8'); box(c, X + x + 2, Y + y + 10, 2, 2, 18, '#9aa3b8'); box(c, X + x + 1, Y + y, 4, 12, 3, '#9aa3b8'); const [sx, sy] = px(X + x + 3, Y + y + 6); R(c, sx - 5, sy - 28, 10, 7, '#2b2e3a'); R(c, sx - 4, sy - 27, 8, 5, '#1d2a3a'); c.strokeStyle = '#7ee081'; c.lineWidth = 1; c.beginPath(); c.moveTo(sx - 4, sy - 24); c.lineTo(sx - 2, sy - 24); c.lineTo(sx - 1, sy - 27); c.lineTo(sx, sy - 22); c.lineTo(sx + 1, sy - 24); c.lineTo(sx + 4, sy - 24); c.stroke(); } }),
    xray: (x, y) => ({ x, y, w: 22, d: 12, draw: (c, X, Y) => { box(c, X + x, Y + y, 22, 12, 4, '#c8ced8'); box(c, X + x + 2, Y + y + 1, 4, 4, 34, '#8aa0b8', { south: (ctx, w, h) => { for (let v = 4; v < h; v += 6) R(ctx, 0, v, w, 1, '#6b7a8c'); } }); box(c, X + x + 6, Y + y + 1, 14, 6, 6, '#5c6f85'); const [sx, sy] = px(X + x + 14, Y + y + 4); R(c, sx - 7, sy - 32, 14, 6, '#8aa0b8'); R(c, sx - 6, sy - 27, 12, 2, '#ffd23f'); box(c, X + x + 6, Y + y + 8, 14, 3, 22, '#e8eef4', { south: (ctx, w, h) => { R(ctx, 1, 2, w - 2, h - 6, '#24344a'); R(ctx, 4, 4, 2, 10, '#dfe8f4'); R(ctx, 3, 6, 4, 1, '#dfe8f4'); R(ctx, 3, 9, 4, 1, '#dfe8f4'); R(ctx, 8, 5, 3, 3, '#dfe8f4'); } }); } }),
    leadscreen: (x, y) => ({ x, y, w: 12, d: 3, draw: (c, X, Y) => box(c, X + x, Y + y, 12, 3, 22, '#6b7a8c', { south: (ctx, w, h) => { R(ctx, 2, 3, w - 4, 6, '#9fd8ff'); R(ctx, 3, 4, 3, 2, '#dff3ff'); hazard(ctx, w, 3); } }) }),
    scanner: (x, y) => ({ x, y, w: 30, d: 16, draw: (c, X, Y) => { box(c, X + x + 18, Y + y + 5, 12, 6, 7, '#e8eef4', { top: ctx => R(ctx, 1, 1, 10, 4, '#f4f4f8') }); box(c, X + x, Y + y, 18, 16, 28, '#e8eef4', { south: (ctx, w, h) => { ctx.fillStyle = '#5c6f85'; ctx.beginPath(); ctx.ellipse(w / 2, h / 2 + 2, 6, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#1d2029'; ctx.beginPath(); ctx.ellipse(w / 2, h / 2 + 2, 4, 5, 0, 0, Math.PI * 2); ctx.fill(); R(ctx, 2, 3, 4, 2, '#6fd3ff'); R(ctx, w - 5, 3, 3, 2, '#7ee081'); }, east: (ctx, d, h) => { R(ctx, 2, 4, d - 4, 2, '#3c7bd6'); } }); } }),
    bloodm: (x, y) => ({ x, y, w: 14, d: 10, draw: (c, X, Y) => { box(c, X + x, Y + y, 14, 10, 24, '#d8dde6', { south: (ctx, w, h) => { screen(ctx, 2, 2, 10, 6); for (let i = 0; i < 4; i++) { R(ctx, 2 + i * 3, 11, 2, 7, '#f4f4f8'); R(ctx, 2 + i * 3, 13 + (i % 2), 2, 5 - (i % 2), '#c4202a'); } } }); box(c, X + x + 15, Y + y + 3, 2, 2, 20, '#9aa3b8'); const [sx, sy] = px(X + x + 16, Y + y + 4); R(c, sx - 3, sy - 26, 6, 7, '#c4202a'); R(c, sx - 2, sy - 25, 2, 3, '#e8533f'); c.strokeStyle = '#c4202a'; c.beginPath(); c.moveTo(sx, sy - 19); c.quadraticCurveTo(sx + 6, sy - 10, sx + 10, sy - 12); c.stroke(); } }),
    ultra: (x, y) => ({ x, y, w: 24, d: 14, draw: (c, X, Y) => { box(c, X + x, Y + y, 24, 14, 8, '#c9d2e0', { top: ctx => R(ctx, 2, 2, 20, 10, '#e8eef4') }); const [sx, sy] = px(X + x + 12, Y + y + 7); c.fillStyle = 'rgba(160,220,255,.55)'; c.beginPath(); c.ellipse(sx, sy - 14, 15, 9, 0, Math.PI, 0); c.fill(); c.strokeStyle = '#5c6f85'; c.lineWidth = 1; c.beginPath(); c.ellipse(sx, sy - 14, 15, 9, 0, Math.PI, 0); c.stroke(); R(c, sx - 10, sy - 19, 3, 1, '#fff'); glow(c, sx, sy - 18, 14, 'rgba(111,211,255,.25)'); } }),
    // ---- clinics ----
    castm: (x, y) => ({ x, y, w: 16, d: 12, draw: (c, X, Y) => { box(c, X + x, Y + y, 16, 12, 18, '#b8c0cc', { south: (ctx, w, h) => { R(ctx, 2, 3, w - 4, 5, '#f4f0e6'); for (let u = 3; u < w - 3; u += 3) R(ctx, u, 4, 1, 3, '#d9d1c0'); buttons(ctx, 3, 11); } }); box(c, X + x + 2, Y + y + 2, 12, 4, 4, '#f4f0e6'); } }),
    vat: (x, y) => ({ x, y, w: 22, d: 18, draw: (c, X, Y) => { box(c, X + x, Y + y, 22, 18, 16, '#7a8ca0', { south: (ctx, w, h) => { R(ctx, 0, 3, w, 2, '#5c6f85'); R(ctx, 0, h - 4, w, 2, '#5c6f85'); for (let u = 3; u < w; u += 6) R(ctx, u, 3, 1, h - 5, '#9aaabb'); } }); const [sx, sy] = px(X + x + 11, Y + y + 9); c.fillStyle = '#4fbf4a'; c.beginPath(); c.ellipse(sx, sy - 16, 12, 6, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = '#8ae07a'; c.beginPath(); c.ellipse(sx - 3, sy - 18, 5, 2, 0, 0, Math.PI * 2); c.fill(); box(c, X + x + 23, Y + y + 6, 3, 6, 18, '#c8a05a', { south: (ctx, w, h) => { for (let v = 3; v < h; v += 4) R(ctx, 0, v, w, 1, '#8a6a2a'); } }); } }),
    shower: (x, y) => ({ x, y, w: 18, d: 16, draw: (c, X, Y) => { box(c, X + x, Y + y, 18, 16, 3, '#d0d6de', { top: ctx => { for (let u = 1; u < 17; u += 4) R(ctx, u, 1, 2, 14, '#b8c0cc'); } }); box(c, X + x, Y + y, 2, 16, 30, '#ffd23f', { east: hazard }); box(c, X + x + 16, Y + y, 2, 16, 30, '#ffd23f'); box(c, X + x, Y + y, 18, 2, 30, '#d8dde6', { south: (ctx, w, h) => { R(ctx, 2, 2, w - 4, h - 8, 'rgba(159,216,255,.6)'); hazard(ctx, w, 3); } }); const [sx, sy] = px(X + x + 9, Y + y + 8); R(c, sx - 3, sy - 32, 6, 2, '#6b7280'); c.fillStyle = 'rgba(126,224,129,.45)'; for (let i = 0; i < 6; i++) c.fillRect(sx - 4 + i * 1.6, sy - 29, 1, 22); } }),
    dna: (x, y) => ({ x, y, w: 20, d: 14, draw: (c, X, Y) => { box(c, X + x, Y + y, 20, 14, 30, '#3a3f5c', { south: (ctx, w, h) => { R(ctx, 3, 3, w - 6, h - 10, '#1d2029'); for (let v = 0; v < h - 12; v++) { const a = Math.sin(v / 2.2) * 4; R(ctx, w / 2 + a - 0.5, 4 + v, 1, 1, '#ff6b9a'); R(ctx, w / 2 - a - 0.5, 4 + v, 1, 1, '#6fd3ff'); if (v % 3 === 0) R(ctx, w / 2 - Math.abs(a), 4 + v, Math.abs(a) * 2, 1, '#4a5070'); } R(ctx, 3, h - 5, w - 6, 2, '#7ee081'); } }); const [sx, sy] = px(X + x + 10, Y + y + 7); glow(c, sx, sy - 34, 10, 'rgba(255,107,154,.35)'); } }),
    // ---- facilities ----
    arcade: (x, y) => ({ x, y, w: 10, d: 9, draw: (c, X, Y) => box(c, X + x, Y + y, 10, 9, 26, '#3a2a6a', { south: (ctx, w, h) => { R(ctx, 1, 2, w - 2, 3, '#ffd23f'); R(ctx, 1, 6, w - 2, 7, '#1d2a3a'); R(ctx, 2, 7, 3, 2, '#ff6b9a'); R(ctx, 6, 10, 2, 2, '#7ee081'); R(ctx, 2, 15, 2, 2, '#e8533f'); R(ctx, 6, 15, 2, 2, '#3c7bd6'); } }) }),
    pool: (x, y) => ({ x, y, w: 26, d: 14, draw: (c, X, Y) => { box(c, X + x + 2, Y + y + 2, 3, 3, 6, '#5a3a22'); box(c, X + x + 21, Y + y + 9, 3, 3, 6, '#5a3a22'); box(c, X + x, Y + y, 26, 14, 9, '#6b4320', { top: ctx => { R(ctx, 2, 2, 22, 10, '#2f8a4a'); R(ctx, 2, 2, 1, 1, OUT); R(ctx, 23, 2, 1, 1, OUT); R(ctx, 2, 11, 1, 1, OUT); R(ctx, 23, 11, 1, 1, OUT); R(ctx, 8, 6, 2, 2, '#f4f0e6'); R(ctx, 16, 5, 2, 2, '#e8533f'); R(ctx, 17, 8, 2, 2, '#ffd23f'); } }); } }),
    cubicle: (x, y) => ({ x, y, w: 16, d: 14, draw: (c, X, Y) => { box(c, X + x + 5, Y + y + 2, 6, 6, 7, '#f4f4f8', { top: ctx => R(ctx, 1, 1, 4, 4, '#9fd8ff') }); box(c, X + x, Y + y, 1, 14, 22, '#7aa0c8'); box(c, X + x + 15, Y + y, 1, 14, 22, '#7aa0c8'); box(c, X + x, Y + y, 16, 1, 24, '#5f88b4', { south: (ctx, w, h) => { R(ctx, 0, 0, w, 2, '#4a6f98'); } }); } }),
    blackboard: (x, y) => ({ x, y, w: 26, d: 2, draw: (c, X, Y) => box(c, X + x, Y + y, 26, 2, 26, '#5a3a22', { south: (ctx, w, h) => { R(ctx, 1, 4, w - 2, h - 10, '#2f4a3a'); R(ctx, 3, 6, 9, 1, '#f4f0e6'); R(ctx, 3, 9, 14, 1, '#f4f0e6'); R(ctx, 3, 12, 6, 1, '#f4f0e6'); R(ctx, 15, 6, 6, 5, 'rgba(244,240,230,.7)'); R(ctx, 1, h - 6, w - 2, 1, '#8a6a44'); } }) }),
    lectern: (x, y) => ({ x, y, w: 8, d: 6, draw: (c, X, Y) => box(c, X + x, Y + y, 8, 6, 14, '#8a5a34', { top: ctx => R(ctx, 1, 1, 6, 3, '#f2ecdc'), south: (ctx, w, h) => R(ctx, 2, 3, w - 4, 1, '#5a3620') }) }),
    lchair: (x, y) => ({ x, y, w: 8, d: 7, draw: (c, X, Y) => { box(c, X + x, Y + y, 8, 7, 5, '#c9a06a'); box(c, X + x, Y + y + 5, 8, 2, 11, '#a88050'); box(c, X + x + 5, Y + y, 3, 4, 7, '#8a6a44', { top: ctx => R(ctx, 0, 0, 3, 4, '#f2ecdc') }); } }),
    autopsy: (x, y) => ({ x, y, w: 14, d: 10, draw: (c, X, Y) => { box(c, X + x, Y + y, 14, 10, 20, '#6b7a8c', { south: (ctx, w, h) => { R(ctx, 2, 2, w - 4, 8, '#1d2a3a'); R(ctx, 3, 3, 4, 2, '#e8533f'); R(ctx, 2, h - 6, w - 4, 3, '#5c6f85'); hazard(ctx, w, 2); } }); } }),
    flask: (x, y) => ({ x, y, w: 14, d: 8, draw: (c, X, Y) => { box(c, X + x, Y + y, 14, 8, 11, '#e8e0d0'); const [sx, sy] = px(X + x + 7, Y + y + 4); const fl = (dx, col) => { R(c, sx + dx, sy - 20, 2, 4, '#dfe8f4'); c.fillStyle = col; c.beginPath(); c.moveTo(sx + dx - 2, sy - 12); c.lineTo(sx + dx + 4, sy - 12); c.lineTo(sx + dx + 2, sy - 16); c.lineTo(sx + dx, sy - 16); c.fill(); }; fl(-5, '#7ee081'); fl(0, '#ff6b9a'); fl(4, '#6fd3ff'); } }),
  };
  // furniture sits in the half of the room away from the door (north half for rooms whose door is south);
  // rooms whose door is on the north wall get the layout mirrored so nobody walks through a desk.
  // Rooms with a variable number of beds, desks, sofas, chairs or cubicles take the room's extras.
  const n = (ex, k, d) => (ex && ex[k] != null ? ex[k] : d);
  const ROOM_ITEMS = {
    gp:       () => [F.desk(4, 10), F.chair(10, 24), F.cabinet(50, 4), F.skeleton(40, 4)],
    gendiag:  () => [F.examtable(4, 6), F.screenP(34, 4), F.scale(52, 10), F.cabinet(52, 26)],
    cardio:   () => [F.treadmill(4, 6), F.curtain(36, 4, '#e6d2d7'), F.monitor(50, 6)],
    xray:     () => [F.xray(4, 4), F.leadscreen(44, 6), F.console(42, 24)],
    scanner:  () => [F.scanner(4, 4), F.console(44, 24)],
    blood:    () => [F.bloodm(6, 4), F.chair(28, 10, '#e8533f'), F.cabinet(50, 4)],
    ultra:    () => [F.ultra(4, 6), F.console(42, 4)],
    ward:     ex => { const b = n(ex, 'bed', 2); if (b <= 2) return [F.bed(4, 6), F.bedside(22, 8), F.curtain(32, 6), F.bed(44, 6)]; return [F.bed(2, 6), F.bed(18, 6), F.bed(34, 6), b > 3 ? F.bed(50, 6) : F.bedside(52, 8)]; },
    psych:    () => [F.bookshelf(2, 2), F.couch(26, 14), F.lamp(6, 28)],
    pharm:    () => [F.shelves(2, 2, 60), F.counter(6, 18, 26), F.sink(50, 16)],
    op:       () => [F.optable(16, 12), F.oplamp(30, 6), F.monitor(2, 6), F.cabinet(52, 4), F.sink(2, 34)],
    infl:     () => [F.inflator(4, 4), F.monitor(50, 6)],
    tongue:   () => [F.slicer(36, 4), F.cabinet(4, 4), F.sink(4, 22)],
    fracture: () => [F.castm(4, 4), F.examtable(26, 8), F.cabinet(52, 26)],
    hair:     () => [F.hairchair(8, 14), F.cabinet(50, 6), F.sink(36, 4)],
    elec:     () => [F.coil(44, 4), F.zapchair(6, 12), F.monitor(50, 24)],
    jelly:    () => [F.vat(6, 4), F.cabinet(52, 4)],
    decon:    () => [F.shower(6, 2), F.console(40, 6)],
    dna:      () => [F.dna(6, 2), F.console(38, 6), F.monitor(52, 24)],
    staff:    ex => { const s = n(ex, 'seat', 2), out = [], pos = [[3, 10], [23, 10], [43, 10], [3, 30], [23, 30], [43, 30]]; for (let i = 0; i < s; i++) out.push(F.sofa(pos[i][0], pos[i][1])); if (s <= 3) out.push(F.arcade(4, 30), F.pool(30, 32)); else if (s <= 5) out.push(F.arcade(50, 34)); return out; },
    toilet:   ex => { const s = n(ex, 'cub', 2), out = [], pos = [[4, 4], [24, 4], [44, 4], [4, 26]]; for (let i = 0; i < s; i++) out.push(F.cubicle(pos[i][0], pos[i][1])); out.push(F.sink(50, 30)); if (s < 4) out.push(F.sink(4, 30)); return out; },
    research: ex => { const s = n(ex, 'desk', 1), out = []; for (let i = 0; i < s; i++) out.push(F.rdesk(3 + 20 * i, 14)); out.push(F.autopsy(48, 34 - 32), F.flask(2, 2)); return out; },
    training: ex => { const s = n(ex, 'chair', 2), out = [F.blackboard(4, 1), F.lectern(10, 12)]; const pos = [[26, 18], [40, 18], [26, 30], [40, 30]]; for (let i = 0; i < s; i++) out.push(F.lchair(pos[i][0], pos[i][1])); return out; },
  };
  // extras every room can take: a fire extinguisher, a radiator, a plant, a bin, bookcases
  function extraItems(kind, ex, water) {
    const out = [];
    if (!ex) return out;
    if (ex.ext) out.push(F.ext(58, 2));
    if (ex.rad) out.push(F.rad(46, 0));
    if (ex.plant) out.push(F.plant(55, 28, water <= 0));
    if (ex.bin) out.push(F.bin(2, 42));
    if (ex.book) { out.push(F.bookshelf(kind === 'psych' ? 26 : 34, 0)); if (ex.book > 1) out.push(F.skeleton(2, 2)); }
    return out;
  }
  // the mirrored variant: footprint y → 64 - y - d, drawn with Y shifted accordingly
  const itemCache = {};
  function roomItems(kind, top, ex, water) {
    const key = kind + (top ? '' : '~') + JSON.stringify(ex || {}) + (water <= 0 ? 'd' : '');
    if (itemCache[key]) return itemCache[key];
    const base = (ROOM_ITEMS[kind] ? ROOM_ITEMS[kind](ex) : []).concat(extraItems(kind, ex, water));
    const items = top ? base : base.map(it => ({ x: it.x, y: 64 - it.y - it.d, w: it.w, d: it.d, draw: (c, X, Y) => it.draw(c, X, Y + 64 - 2 * it.y - it.d) }));
    return (itemCache[key] = items);
  }
  // a room wrecked by an exploding machine: scorch marks and rubble
  function wreckItems(X, Y) {
    const items = [];
    for (let i = 0; i < 7; i++) { const x = 6 + Math.floor(A.hash(X + i, Y) * 46), y = 6 + Math.floor(A.hash(Y + i, X) * 46), w = 4 + Math.floor(A.hash(i, X + Y) * 8); items.push({ x, y, w, d: w, draw: (c, XX, YY) => box(c, XX + x, YY + y, w, w, 3 + (i % 3) * 3, ['#5a5246', '#3a3530', '#6b6058'][i % 3]) }); }
    items.push({ x: 20, y: 20, w: 24, d: 24, draw: (c, XX, YY) => decal(c, XX + 32, YY + 32, ctx => { ctx.fillStyle = 'rgba(20,16,14,.55)'; ctx.beginPath(); ctx.ellipse(0, 0, 24, 20, 0.4, 0, Math.PI * 2); ctx.fill(); }) });
    return items;
  }
  // corridor decoration (centred on a 16px tile)
  const DECOR_DRAW = {
    plant: (c, x, y, dry) => { shadow(c, x, y + 4, 5); bill(c, A.furniture(dry ? 'deadplant' : 'plant'), x, y + 5); },
    bench: (c, x, y) => { box(c, x - 7, y - 2, 14, 6, 4, '#26a69e'); box(c, x - 7, y - 3, 14, 1, 9, '#1f8f87'); box(c, x - 6, y + 2, 1, 1, 3, '#2b2e3a'); box(c, x + 5, y + 2, 1, 1, 3, '#2b2e3a'); },
    radiator: (c, x, y) => box(c, x - 7, y - 2, 14, 3, 8, '#f4f4f0', { south: (ctx, w, h) => { for (let u = 1; u < w; u += 2) R(ctx, u, 1, 1, h - 2, '#d2d2cf'); } }),
    ext: (c, x, y) => { box(c, x - 2, y - 2, 4, 4, 13, '#d0352a', { south: (ctx, w, h) => { R(ctx, 0, 3, w, 3, '#f4f0e6'); } }); const [sx, sy] = px(x, y); R(c, sx - 1, sy - 16, 3, 2, OUT); },
    drinks: (c, x, y) => box(c, x - 5, y - 4, 10, 8, 22, '#c43c2c', { south: (ctx, w, h) => { R(ctx, 1, 2, w - 2, 11, '#1d2a3a'); for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) R(ctx, 2 + i * 3, 4 + j * 5, 2, 3, ['#ffd23f', '#39a85a', '#3c7bd6'][(i + j) % 3]); R(ctx, 2, h - 6, w - 4, 3, '#1d2a3a'); R(ctx, w - 3, 14, 2, 1, '#ffd23f'); } }),
  };
  const DECOR_FOOT = { plant: [8, 8], bench: [14, 6], radiator: [14, 3], ext: [4, 4], drinks: [10, 8] };

  // ---------- floors ----------
  const C = A.C;
  let groundC = null;
  function ground() {
    if (groundC) return groundC;
    const [c, x] = A.canvas(W * T, H * T);
    // grass all round, paths at the entrance
    R(x, 0, 0, W * T, H * T, C.grass);
    for (let i = 0; i < 400; i++) R(x, Math.floor(A.hash(i, 7) * (W * T - 1)), Math.floor(A.hash(i, 11) * (H * T - 1)), 1, 1, C.grassD);
    for (let i = 0; i < 40; i++) { const X = Math.floor(A.hash(i, 21) * 29) + 1, Y = Math.floor(A.hash(i, 33) * (H * T - 2)); if (Y > 56 && Y < 120) continue; R(x, X, Y, 2, 2, ['#ffd23f', '#ff6b9a', '#f4f0e6'][i % 3]); }
    for (let r = 4; r <= 6; r++) for (let col = 0; col < 2; col++) R(x, col * T, r * T, 16, 16, (col + r) % 2 ? C.pave : C.paveD);
    // building floor: concrete under everything, lino corridors
    R(x, 32, 0, W * T - 32, H * T, C.lot);
    const lino = (c0, r0, c1, r1) => { for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) { R(x, col * T, r * T, 16, 16, (col + r) % 2 ? C.hall : C.hallD); R(x, col * T, r * T, 16, 1, shade(C.hall, 0.1)); R(x, col * T, r * T, 1, 16, shade(C.hall, -0.08)); } };
    lino(2, 4, W - 1, 6); lino(2, 15, W - 1, 17); lino(2, 7, 4, 14);
    for (const Ly of RH.LANES) { R(x, 48, Ly - 1, W * T - 48, 2, '#2fa39a'); R(x, 48, Ly - 1, W * T - 48, 1, '#5fc4bb'); }
    R(x, RH.CX - 1, RH.LANES[0], 2, RH.LANES[1] - RH.LANES[0], '#2fa39a');
    R(x, 14, 70, 18, 14, '#b0503a'); R(x, 16, 72, 14, 10, '#c86048');
    for (let k = 0; k < RH.SLOTS; k++) {
      const X = RH.slotX0(k) * T, Y = RH.slotY0(k) * T;
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
    return (floorCache[kind] = c);
  }

  // ---------- walls ----------
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
    R(x, 0, 0, w, 2, '#3fae5a'); R(x, 0, 0, w, 1, '#7ad88f');
    if (h > 12) { R(x, 0, h - 3, w, 3, shade(col, -0.35)); R(x, 0, h - 3, w, 1, shade(col, -0.15)); }
    else { R(x, 0, h - 1, w, 1, shade(col, -0.35)); }
    if (decal && h > 12) decal(x, w, h);
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
    gendiag: (x, w, h) => { R(x, 40, 5, 12, 13, '#f4f0e6'); for (let i = 0; i < 5; i++) R(x, 42 + (i % 2), 7 + i * 2, 8 - i * 1.5, 1, OUT); },
    cardio: (x, w, h) => { R(x, 8, 5, 18, 10, '#1d2a3a'); x.strokeStyle = '#7ee081'; x.beginPath(); x.moveTo(9, 10); x.lineTo(13, 10); x.lineTo(15, 6); x.lineTo(17, 14); x.lineTo(19, 10); x.lineTo(25, 10); x.stroke(); },
    xray: (x, w, h) => { R(x, 40, 4, 16, 14, '#24344a'); R(x, 46, 6, 3, 11, '#dfe8f4'); for (let i = 0; i < 4; i++) R(x, 43, 8 + i * 2, 9, 1, '#dfe8f4'); },
    scanner: (x, w, h) => { R(x, 36, 5, 14, 12, '#fff'); R(x, 38, 7, 10, 8, '#3c7bd6'); R(x, 41, 9, 4, 4, '#9fd8ff'); },
    blood: (x, w, h) => { R(x, 40, 5, 10, 12, '#fff'); x.fillStyle = '#c4202a'; x.beginPath(); x.moveTo(45, 7); x.lineTo(48, 12); x.arc(45, 12, 3, 0, Math.PI); x.lineTo(45, 7); x.fill(); },
    ultra: (x, w, h) => { R(x, 30, 5, 18, 10, '#1d2a3a'); x.fillStyle = '#6fd3ff'; x.beginPath(); x.arc(39, 15, 7, Math.PI, 0); x.fill(); },
    fracture: (x, w, h) => { R(x, 40, 4, 14, 14, '#24344a'); R(x, 46, 6, 2, 11, '#dfe8f4'); R(x, 45, 11, 4, 1, '#e8533f'); },
    jelly: (x, w, h) => { R(x, 36, 5, 14, 12, '#fff'); R(x, 38, 9, 10, 7, '#4fbf4a'); R(x, 39, 8, 8, 2, '#8ae07a'); },
    decon: (x, w, h) => { R(x, 36, 4, 14, 14, '#ffd23f'); x.fillStyle = OUT; x.beginPath(); x.arc(43, 11, 2, 0, Math.PI * 2); x.fill(); for (let a = 0; a < 3; a++) { x.beginPath(); x.moveTo(43, 11); x.arc(43, 11, 6, a * 2.09 - 0.5, a * 2.09 + 0.5); x.fill(); } },
    dna: (x, w, h) => { R(x, 36, 4, 12, 14, '#1d2029'); for (let v = 0; v < 12; v++) { const a = Math.sin(v / 1.8) * 3; R(x, 42 + a, 5 + v, 1, 1, '#ff6b9a'); R(x, 42 - a, 5 + v, 1, 1, '#6fd3ff'); } },
    staff: (x, w, h) => { R(x, 6, 5, 18, 12, '#d9a93a'); R(x, 7, 6, 16, 10, '#e8533f'); R(x, 7, 12, 16, 4, '#ffd23f'); R(x, 14, 7, 4, 4, '#fff6c0'); },
    toilet: (x, w, h) => { R(x, 40, 5, 14, 10, '#fff'); R(x, 43, 6, 2, 2, '#3c7bd6'); R(x, 42, 8, 4, 5, '#3c7bd6'); R(x, 49, 6, 2, 2, '#e8533f'); R(x, 48, 8, 4, 5, '#e8533f'); },
    research: (x, w, h) => { R(x, 40, 4, 14, 14, '#fff'); x.fillStyle = '#ffd23f'; x.beginPath(); x.arc(47, 9, 4, 0, Math.PI * 2); x.fill(); R(x, 46, 13, 3, 3, '#6b7280'); },
    training: (x, w, h) => { R(x, 40, 5, 14, 11, '#2b2e3a'); R(x, 42, 7, 10, 1, '#f4f0e6'); R(x, 42, 10, 7, 1, '#f4f0e6'); R(x, 42, 13, 9, 1, '#f4f0e6'); },
    op: (x, w, h) => { R(x, 6, 5, 14, 12, '#2b2e3a'); R(x, 7, 6, 12, 10, '#9fd8ff'); R(x, 10, 8, 2, 7, '#dff3ff'); R(x, 13, 8, 2, 7, '#dff3ff'); R(x, 9, 10, 8, 1, '#dff3ff'); },
  };
  const EXT = '#b9b2a6';
  // A wall segment from (ax, ay) to (bx, by) with the interior on the side of normal (nx, ny). In the current view
  // it is tall when it faces away from the viewer (a back wall) and cut down low when it would hide the interior.
  function wallItems(ax, ay, bx, by, nx, ny, key, col, style, decal, gap) {
    const [a1, a2] = rw(ax, ay), [b1, b2] = rw(bx, by), [n1, n2] = (() => { const o = rw(0, 0), n = rw(nx, ny); return [n[0] - o[0], n[1] - o[1]]; })();
    const alongX = Math.abs(a2 - b2) < 0.5;
    const far = alongX ? n2 > 0 : n1 > 0;
    const h = flat ? 4 : far ? WALL_H : LOW_H;
    const img = wallImg(key + (flat ? 'F' : far ? 'T' : 'L'), Math.round(Math.hypot(bx - ax, by - ay)), h, col, style, decal, gap);
    // orient the image so its left edge sits at the end that is drawn first in view space
    const flip = alongX ? a1 > b1 : a2 > b2;
    const [sx, sy, ex, ey] = flip ? [bx, by, ax, ay] : [ax, ay, bx, by];
    // every wall is split into 16px pieces so the depth sort puts people and trees on the right side of each part
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 16)), items = [];
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const p0 = [sx + (ex - sx) * t0, sy + (ey - sy) * t0], p1 = [sx + (ex - sx) * t1, sy + (ey - sy) * t1];
      const q0 = rw(p0[0], p0[1]), q1 = rw(p1[0], p1[1]);
      items.push({ d: Math.max(dsum(q0[0], q0[1]), dsum(q1[0], q1[1])) + 0.5, draw: c => { const [u1, u2] = px(p0[0], p0[1]), [v1, v2] = px(p1[0], p1[1]), len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); c.setTransform((v1 - u1) / len, (v2 - u2) / len, 0, 1, u1, u2 - h); c.drawImage(img, img.width * t0, 0, img.width * (t1 - t0), h, 0, 0, len, h); reset(c); } });
    }
    return items;
  }
  function roomWalls(k, kind, X, Y, top) {
    const st = A.ROOM_STYLE[kind], col = st.wall[0], style = st.wall[1], dk = kind;
    const gapN = top ? null : [25, 39], gapS = top ? [25, 39] : null;
    return [].concat(
      wallItems(X, Y, X + 64, Y, 0, 1, 'N' + dk + (gapN ? 'g' : ''), col, style, WALL_DECAL[kind], gapN),
      wallItems(X, Y + 64, X + 64, Y + 64, 0, -1, 'S' + dk + (gapS ? 'g' : ''), col, style, WALL_DECAL[kind], gapS),
      wallItems(X, Y, X, Y + 64, 1, 0, 'W' + dk, col, style, null, null),
      wallItems(X + 64, Y, X + 64, Y + 64, -1, 0, 'E' + dk, col, style, null, null));
  }
  function lotWalls(X, Y, top) {
    // bare lot: the building's outer wall, only where the lot really is on the outside (top of band 0, bottom of band 3)
    if (top && Y === 0) return wallItems(X, Y, X + 64, Y, 0, 1, 'Nlot', EXT, 'brick');
    if (!top && Y + 64 === H * T) return wallItems(X, Y + 64, X + 64, Y + 64, 0, -1, 'Slot', EXT, 'brick');
    return [];
  }
  function buildingWalls() {
    // west exterior wall, with the entrance gap, and the east end wall
    const items = [];
    items.push(...wallItems(32, 0, 32, 64, 1, 0, 'EXTW1', EXT, 'brick', (x, w, h) => { R(x, 20, 8, 12, 10, '#9fd8ff'); R(x, 21, 9, 4, 4, '#dff3ff'); }));
    items.push(...wallItems(32, 112, 32, H * T, 1, 0, 'EXTW2', EXT, 'brick', (x, w, h) => { for (let u = 24; u < w - 20; u += 60) { R(x, u, 8, 12, 10, '#9fd8ff'); R(x, u + 1, 9, 4, 4, '#dff3ff'); } }));
    items.push(...wallItems(W * T, 0, W * T, H * T, -1, 0, 'EXTE', EXT, 'brick'));
    return items;
  }
  function scaffoldItems(X, Y, prog) {
    return [{ d: depth(X + 32, Y + 40), draw: c => { for (let i = 0; i < 3; i++) box(c, X + 6 + i * 22, Y + 10, 2, 2, 28, '#c8a05a'); box(c, X + 8, Y + 30, 14, 12, 10, '#a0703a'); box(c, X + 36, Y + 32, 16, 10, 8, '#a0703a'); const [sx, sy] = px(X + 32, Y + 32); R(c, sx - 16, sy - 30, 32, 5, OUT); R(c, sx - 15, sy - 29, Math.round(30 * prog), 3, '#ffd23f'); } }];
  }
  // outside: ambulance, trees, sign, entrance posts, reception desk
  function outside() {
    const items = [];
    const bx = (x, y, w, d, h, col, faces) => ({ d: depth(x + w, y + d), draw: c => box(c, x, y, w, d, h, col, faces) });
    items.push(bx(2, 28, 26, 12, 13, '#f4f4f0', { south: (ctx, w, h) => { R(ctx, 0, 6, w, 3, '#e8533f'); R(ctx, 2, 1, 6, 4, '#9fd8ff'); R(ctx, 10, 1, 6, 4, '#9fd8ff'); R(ctx, 19, 1, 6, 4, '#9fd8ff'); R(ctx, 12, 2, 2, 1, '#e8533f'); R(ctx, 11, 3, 4, 1, '#e8533f'); }, east: (ctx, d, h) => { R(ctx, 0, 6, d, 3, '#e8533f'); R(ctx, 2, 1, 8, 4, '#9fd8ff'); }, top: ctx => { R(ctx, 4, 2, 4, 3, '#3c7bd6'); R(ctx, 14, 2, 4, 3, '#e8533f'); } }));
    for (const [tx, ty] of [[13, 150], [13, 230], [13, 320]]) items.push({ d: depth(tx, ty), draw: c => { shadow(c, tx, ty, 8); bill(c, A.furniture('tree'), tx, ty); } });
    for (const [bxp, byp] of [[10, 12], [20, 180], [8, 280]]) items.push({ d: depth(bxp, byp), draw: c => bill(c, A.furniture('bush'), bxp, byp) });
    items.push({ d: depth(14, 56), draw: c => bill(c, A.furniture('sign'), 14, 56) });
    items.push(bx(30, 62, 3, 3, 24, '#8a8f99'));
    items.push(bx(30, 110, 3, 3, 24, '#8a8f99'));
    return items;
  }
  // the reception desk once it has been bought, or a dashed outline where it goes
  function deskItem(bought, t) {
    if (!bought) return { d: depth(62, 106) - 40, draw: c => decal(c, 34, 96, ctx => { ctx.globalAlpha = 0.5 + Math.sin(t * 3) * 0.2; ctx.setLineDash([3, 2]); ctx.strokeStyle = '#7a4b2c'; ctx.lineWidth = 1.5; ctx.strokeRect(0.5, 0.5, 27, 9); ctx.setLineDash([]); ctx.globalAlpha = 1; }) };
    return { d: depth(62, 106), draw: c => { box(c, 34, 96, 28, 10, 11, '#7a4b2c', { top: ctx => { R(ctx, 3, 2, 6, 4, '#f2ecdc'); R(ctx, 20, 2, 4, 3, '#e8533f'); }, south: (ctx, w, h) => { R(ctx, 2, 3, 10, 6, '#5a3620'); R(ctx, 16, 3, 10, 6, '#5a3620'); } }); box(c, 44, 97, 7, 5, 7, '#2b2e3a', { south: (ctx, w, h) => screen(ctx, 1, 1, w - 2, h - 2) }); box(c, 36, 92, 2, 2, 18, '#9aa3b8'); const [sx, sy] = px(37, 93); R(c, sx - 8, sy - 26, 16, 7, '#3c7bd6'); R(c, sx - 7, sy - 25, 14, 5, '#5a95e6'); R(c, sx - 1, sy - 25, 2, 5, '#fff'); R(c, sx - 3, sy - 23, 6, 1, '#fff'); } };
  }
  // mess: puddle decal or a dropped can
  function messItem(m) {
    if (m.k === 'puddle') return { d: depth(m.x, m.y) - 1, draw: c => decal(c, m.x, m.y, ctx => { ctx.fillStyle = 'rgba(236,206,72,.75)'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 4, -0.2, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,240,160,.8)'; ctx.beginPath(); ctx.ellipse(-2, -1, 2.5, 1.2, 0, 0, Math.PI * 2); ctx.fill(); }) };
    if (m.k === 'rat') return { d: depth(m.x, m.y), draw: c => { const [sx, sy] = px(m.x, m.y); R(c, sx - 4, sy - 3, 7, 3, '#6a6a70'); R(c, sx - 4, sy - 3, 7, 1, '#8a8a90'); R(c, sx + 3, sy - 2, 4, 1, '#c88a8a'); R(c, sx - 3, sy, 1, 1, '#c88a8a'); R(c, sx + 1, sy, 1, 1, '#c88a8a'); R(c, sx - 4, sy - 2, 1, 1, OUT); } };
    if (m.k === 'vomit') return { d: depth(m.x, m.y) - 1, draw: c => decal(c, m.x, m.y, ctx => { ctx.fillStyle = '#8fbf4a'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 4, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#b5d86a'; ctx.beginPath(); ctx.ellipse(-1, -1, 3, 2, 0, 0, Math.PI * 2); ctx.fill(); R(ctx, 5, 2, 2, 1, '#8fbf4a'); R(ctx, -7, 1, 2, 1, '#8fbf4a'); }) };
    return { d: depth(m.x, m.y), draw: c => { const [sx, sy] = px(m.x, m.y); R(c, sx - 2, sy - 4, 4, 4, '#e8533f'); R(c, sx - 2, sy - 5, 4, 1, '#c8ccd4'); R(c, sx - 1, sy - 3, 1, 2, '#ffd23f'); } };
  }

  // a rat scurrying along the skirting board (feet at its world position)
  function ratItem(rt, t) {
    return { d: depth(rt.x, rt.y), draw: c => {
      const [sx, sy] = px(rt.x, rt.y), [ax] = px(rt.x + 1, rt.y), left = ax < sx === (rt.f === 3), dir = left ? -1 : 1, hop = Math.floor(t * 12) % 2;
      c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(sx, sy, 5, 2, 0, 0, Math.PI * 2); c.fill();
      R(c, sx - 4, sy - 5 - hop, 8, 4, '#6a6a70'); R(c, sx - 3, sy - 6 - hop, 6, 1, '#8a8a90'); R(c, sx + dir * 4 - (dir < 0 ? 2 : 0), sy - 5 - hop, 3, 3, '#6a6a70');
      R(c, sx + dir * 6 - (dir < 0 ? 0 : 0), sy - 4 - hop, 1, 1, '#ff9aa8'); R(c, sx + dir * 5, sy - 5 - hop, 1, 1, OUT); R(c, sx + dir * 3, sy - 7 - hop, 2, 2, '#c88a8a');
      c.strokeStyle = '#c88a8a'; c.lineWidth = 1; c.beginPath(); c.moveTo(sx - dir * 4, sy - 3); c.quadraticCurveTo(sx - dir * 8, sy - 1 - hop * 2, sx - dir * 10, sy - 4); c.stroke();
      R(c, sx - 3, sy - 1, 1, 1, '#4a4a50'); R(c, sx + 2, sy - 1, 1, 1, '#4a4a50');
    } };
  }
  window.HI = { K, KX, KY, OX, OY, BW, BH, WALL_H, LOW_H, setRot, getRot, setFlat, getFlat, extent, rw, px, depth, unproj, facing, floorAt, wallSeg, bill, shadow, decal, box, ground, roomFloor, roomWalls, lotWalls, buildingWalls, scaffoldItems, outside, deskItem, messItem, ratItem, roomItems, wreckItems, DECOR_DRAW, DECOR_FOOT };
})();
