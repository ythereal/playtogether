// Rival Hospital 3D: isometric scene. The simulation keeps plain 2D coordinates (rules.js); this file rotates
// them (four 90° views), projects them 2:1 and draws floors, walls, furniture as shaded iso boxes and corridor
// decoration. Everything is drawn in code; people and plants are upright "billboard" sprites from art.js.
(function () {
  'use strict';
  const A = window.HA, RH = window.RH;
  const T = 16, W = RH.W, H = RH.H, OUT = '#1b1720';
  // world px → screen px along the two floor axes. Floors are drawn wide relative to walls and people (a person is
  // about two thirds of a tile across, a wall under two tiles tall), like Theme Hospital, so rooms can be seen into
  const K = 1.2, KX = K, KY = K / 2;
  const L = Math.max(W, H) * T, CXW = W * T / 2, CYW = H * T / 2;   // rotation centre and bounding square
  const GM = 96;                                     // the hospital grounds: lawns, paths and the road around the map
  const OX0 = Math.ceil(L * KX) + 8, OY0 = 54, OXF0 = 8, OYF0 = 60;
  const OX = OX0 + 2 * GM * KX, OY = OY0 + 2 * GM * KY;
  const OXF = OXF0 + GM, OYF = OYF0 + GM;          // flat (aerial) view origin
  const BW = Math.max(OX * 2, L + 16 + 2 * GM), BH = Math.max(Math.ceil(L * K) + OY + 30 + 2 * GM * KY, L + OYF + 40 + GM);
  const WALL_H = 34, LOW_H = WALL_H; // every wall stands full height, front walls included, as in Theme Hospital
  const EXT_LOW = 18;                // the building's outer brick wall facing the camera stands about half height, as in Theme Hospital, so the entrance hall can be seen
  // animation: game.js hands over the clock and where everyone is standing each frame (doors open for people)
  let now = 0, frameDt = 0, ppl = [];
  const frame = (t, dt, people) => { now = t; frameDt = dt; ppl = people || []; };
  const near = (x, y, rx, ry) => ppl.some(p => Math.abs(p[0] - x) < rx && Math.abs(p[1] - y) < ry);
  let rot = 3;                                      // 0..3, quarter turns clockwise; 3 looks at the front doors, like Theme Hospital
  let flat = false;                                 // aerial view: plain top-down instead of isometric
  const setRot = r => { rot = ((r % 4) + 4) % 4; };
  const getRot = () => rot;
  const setFlat = f => { flat = !!f; };
  const getFlat = () => flat;
  // the area of the buffer the current view occupies (for fitting the camera)
  const extent = () => (flat ? { x: GM, y: OYF - 36, w: L + 16, h: L + 40 } : { x: 2 * GM * KX, y: 2 * GM * KY, w: OX0 * 2, h: Math.ceil(L * K) + OY0 + 30 });
  // world → rotated world (about the map centre)
  let pre = null;                                   // object rotation applied before the view rotation (withRot)
  function rw(x, y) {
    if (pre) [x, y] = pre(x, y);
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
  // Sorting: furniture by its footprint's centre, walls by each 16px piece's midpoint. A wall then always sorts after
  // whatever stands on its far side and before whatever stands on its near side (both at least 8px from it), so
  // nothing is ever drawn half into a wall.
  const depthBox = (x, y, w, d) => depth(x + w / 2, y + d / 2);
  function unproj(sx, sy) { if (flat) return unrw(sx - OXF, sy - OYF); const u = (sx - OX) / KX, v = (sy - OY) / KY; return unrw((u + v) / 2, (v - u) / 2); }
  // sprite facing (0 down, 1 up, 2 left, 3 right) seen from the rotated view
  const ROTF = [[0, 1, 2, 3], [2, 3, 1, 0], [1, 0, 3, 2], [3, 2, 0, 1]];
  const facing = f => ROTF[rot][f] == null ? 0 : ROTF[rot][f];
  // the scene buffer is SS times the logical size: every transform here is in logical pixels, scaled up by SS
  const SS = A.SS;
  const ST = (ctx, a, b, c, d, e, f) => ctx.setTransform(a * SS, b * SS, c * SS, d * SS, e * SS, f * SS);
  const reset = ctx => ctx.setTransform(SS, 0, 0, SS, 0, 0);
  const lw = img => img.lw || img.width, lh = img => img.lh || img.height;
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
    ST(ctx, m[0], m[1], m[2], m[3], ox, oy);
    ctx.drawImage(img, 0, 0, lw(img), lh(img)); reset(ctx);
  }
  // a vertical wall image standing on the floor from world A to world B (left edge of the image at A)
  function wallSeg(ctx, img, ax, ay, bx, by, h) {
    const [a1, a2] = px(ax, ay), [b1, b2] = px(bx, by), len = Math.hypot(bx - ax, by - ay);
    ST(ctx, (b1 - a1) / len, (b2 - a2) / len, 0, 1, a1, a2 - h);
    ctx.drawImage(img, 0, 0, len, h); reset(ctx);
  }
  function bill(ctx, img, x, y, lift) { const [sx, sy] = px(x, y); ctx.drawImage(img, Math.round(sx - lw(img) / 2), Math.round(sy - lh(img) + (lift || 0)), lw(img), lh(img)); }
  function shadow(ctx, x, y, rx) { const [sx, sy] = px(x, y); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(sx, sy, rx, rx / 2, 0, 0, Math.PI * 2); ctx.fill(); }
  const topM = () => (flat ? [1, 0, 0, 1] : [KX, KY, -KX, KY]);
  // fn paints in world units (u = world +x, v = world +y) with its origin at world (x, y); turns with the view like floors
  const ROTM = { flat: [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]], iso: [[KX, KY, -KX, KY], [-KX, KY, -KX, -KY], [-KX, -KY, KX, -KY], [KX, -KY, KX, KY]] };
  function decal(ctx, x, y, fn) { const [a, b] = rw(x, y), [ox, oy] = pxr(a, b), m = ROTM[flat ? 'flat' : 'iso'][rot]; ST(ctx, m[0], m[1], m[2], m[3], ox, oy); fn(ctx); reset(ctx); }

  // ---------- iso box: footprint (x, y, w, d) in world units, height h in screen px ----------
  // faces paints detail onto real sides of the box: north / east / south / west (in the object's own frame, before
  // it's turned) and top, each in world units. A side is only painted when it faces the viewer, so a desk's drawers
  // or a monitor's screen show which way the piece is facing.
  // lift raises the whole box off the floor (a chair seat on its legs)
  function box(ctx, x, y, w, d, h, col, faces, lift) {
    h = h | 0; const L0 = flat ? 0 : lift || 0;
    // rotate the footprint into view space (axis-aligned again, w/d may swap)
    const c = [rw(x, y), rw(x + w, y), rw(x + w, y + d), rw(x, y + d)];
    const x0 = Math.min(...c.map(p => p[0])), y0 = Math.min(...c.map(p => p[1])), x1 = Math.max(...c.map(p => p[0])), y1 = Math.max(...c.map(p => p[1]));
    const lp = p => [p[0], p[1] - L0];
    const p00 = lp(pxr(x0, y0)), p10 = lp(pxr(x1, y0)), p11 = lp(pxr(x1, y1)), p01 = lp(pxr(x0, y1));
    const poly = (pts, fill) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = 'rgba(27,23,32,.7)'; ctx.lineWidth = 0.6; ctx.stroke(); };
    if (flat) h = 0;
    const up = p => [p[0], p[1] - h];
    if (!flat) {
      poly([up(p01), up(p11), p11, p01], col);                      // south face (view space)
      poly([up(p10), up(p11), p11, p10], shade(col, -0.32));        // east face
    }
    poly([up(p00), up(p10), up(p11), up(p01)], shade(col, flat ? 0.08 : 0.18)); // top
    if (!faces) return;
    const [cxs, cys] = rw(x + w / 2, y + d / 2);
    const faceing = (nx, ny) => { const [a, b] = rw(x + w / 2 + nx, y + d / 2 + ny); return a - cxs > 0.5 || b - cys > 0.5; };
    const paint = (fn, ox, oy, ux, uy, len, isTop, dep) => {
      const [o1, o2] = px(ox, oy), [a1, a2] = px(ox + ux, oy + uy);
      ctx.save();
      if (isTop) { const [b1, b2] = px(ox, oy + 1); ST(ctx, a1 - o1, a2 - o2, b1 - o1, b2 - o2, o1, o2 - h - L0); ctx.beginPath(); ctx.rect(0, 0, w, d); ctx.clip(); fn(ctx, w, d); }
      else { ST(ctx, a1 - o1, a2 - o2, 0, 1, o1, o2 - h - L0); ctx.beginPath(); ctx.rect(0, 0, len, h); ctx.clip(); fn(ctx, len, h); }
      reset(ctx); ctx.restore();
    };
    if (faces.top) paint(faces.top, x, y, 1, 0, 0, true);
    if (flat) return;
    if (faces.south && faceing(0, 1)) paint(faces.south, x, y + d, 1, 0, w);
    if (faces.east && faceing(1, 0)) paint(faces.east, x + w, y, 0, 1, d);
    if (faces.north && faceing(0, -1)) paint(faces.north, x, y, 1, 0, w);
    if (faces.west && faceing(-1, 0)) paint(faces.west, x, y, 0, 1, d);
  }
  // ---------- rounded shapes (less boxy furniture) ----------
  // rbox: a block whose footprint is a rounded rectangle (corner radius rad), shaded round its curve; top(ctx, w, d)
  // paints its top in world units. cyl: an upright cylinder centred on (x, y). tube: a thin leg or rail.
  function rbox(ctx, x, y, w, d, h, col, rad, lift, top) {
    const L0 = flat ? 0 : lift || 0; h = flat ? 0 : h; rad = Math.max(0.01, Math.min(rad || 0, w / 2, d / 2));
    const pts = [];
    for (const [cx, cy, a0] of [[x + w - rad, y + rad, -Math.PI / 2], [x + w - rad, y + d - rad, 0], [x + rad, y + d - rad, Math.PI / 2], [x + rad, y + rad, Math.PI]])
      for (let i = 0; i <= 4; i++) { const a = a0 + i * Math.PI / 8; pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); }
    const sc = pts.map(([a, b]) => px(a, b)), up = p => [p[0], p[1] - L0 - h], dn = p => [p[0], p[1] - L0];
    const [o1, o2] = rw(x + w / 2, y + d / 2);
    // the sides: every outline segment facing the camera, lit by how far it turns from the light
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length, [mx, my] = [(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2], [v1, v2] = rw(mx, my);
      const ln = Math.hypot(v1 - o1, v2 - o2) || 1, nx = (v1 - o1) / ln, ny = (v2 - o2) / ln;
      if (!flat && nx + ny <= 0) continue;                    // facing away from the camera
      ctx.fillStyle = shade(col, -0.34 * Math.min(1, Math.max(0, (nx - ny + 1) / 2)));   // south-facing full colour, east-facing in shadow
      ctx.beginPath(); const a = dn(sc[i]), b = dn(sc[j]), c2 = up(sc[j]), d2 = up(sc[i]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d2[0], d2[1]); ctx.closePath(); ctx.fill();
    }
    // the outline of the silhouette, then the top
    ctx.strokeStyle = 'rgba(27,23,32,.6)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); sc.forEach((p, i) => { const q = up(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath();
    ctx.fillStyle = shade(col, 0.16); ctx.fill(); ctx.stroke();
    if (top) {
      const [t1, t2] = px(x, y), [a1, a2] = px(x + 1, y), [b1, b2] = px(x, y + 1);
      ctx.save(); ST(ctx, a1 - t1, a2 - t2, b1 - t1, b2 - t2, t1, t2 - L0 - h); ctx.beginPath(); ctx.roundRect(0, 0, w, d, rad); ctx.clip(); top(ctx, w, d); reset(ctx); ctx.restore();
    }
  }
  function cyl(ctx, x, y, r, h, col, lift) {
    const L0 = flat ? 0 : lift || 0, [sx, sy] = px(x, y), rx = r * KX * Math.SQRT2 * (flat ? 0.7 : 1), ry = r * KY * Math.SQRT2 * (flat ? 1.4 : 1); h = flat ? 0 : h;
    const g = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0); g.addColorStop(0, shade(col, 0.22)); g.addColorStop(0.35, col); g.addColorStop(1, shade(col, -0.38));
    ctx.fillStyle = g; ctx.strokeStyle = 'rgba(27,23,32,.6)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.ellipse(sx, sy - L0, rx, ry, 0, 0, Math.PI); ctx.lineTo(sx - rx, sy - L0 - h); ctx.ellipse(sx, sy - L0 - h, rx, ry, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = shade(col, 0.2); ctx.beginPath(); ctx.ellipse(sx, sy - L0 - h, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  const tube = (ctx, x, y, h, col, lift) => cyl(ctx, x, y, 0.55, h, col || '#c8ced8', lift);
  // small decal painters (local units)
  const screen = (ctx, u, v, w, h) => { R(ctx, u, v, w, h, '#1d2a3a'); R(ctx, u + 1, v + 1, Math.max(1, w / 2), 1, '#6fd3ff'); R(ctx, u + 1, v + 3, Math.max(1, w - 3), 1, '#2f5a7a'); R(ctx, u + w - 3, v + h - 2, 2, 1, '#e8533f'); };
  const buttons = (ctx, u, v) => { R(ctx, u, v, 2, 2, '#e8533f'); R(ctx, u + 3, v, 2, 2, '#39a85a'); R(ctx, u + 6, v, 2, 2, '#ffd23f'); };
  const drawers = (ctx, w, h) => { for (let v = 3; v < h - 3; v += 6) { R(ctx, 2, v, w - 4, 4, 'rgba(0,0,0,.18)'); R(ctx, w / 2 - 1, v + 2, 2, 1, OUT); } };
  const bottles = (ctx, w, h) => { for (let i = 2; i < w - 2; i += 4) { const col = ['#e8533f', '#3c7bd6', '#39a85a', '#ffd23f', '#d64f8e', '#f4f0e6'][Math.floor(i / 4) % 6], bh = 5 + (i % 3); R(ctx, i, h - 3 - bh, 3, bh, col); R(ctx, i, h - 3 - bh, 1, bh, shade(col, 0.4)); } R(ctx, 0, h - 3, w, 1, '#5a3620'); };
  const sheet = (ctx, w, d) => { R(ctx, 1, 1, w - 2, d - 2, '#f4f4f8'); R(ctx, 2, 2, w - 4, 6, '#dfe4f2'); R(ctx, 3, 3, w - 6, 3, '#fff'); R(ctx, 1, 10, w - 2, d - 11, '#7fb7e6'); R(ctx, 1, 10, w - 2, 1, '#fff'); };

  // ---------- room furniture: footprint for depth sorting + draw(ctx, X, Y) ----------
  const hazard = (ctx, w, h) => { for (let u = -h; u < w; u += 6) { ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(u, h); ctx.lineTo(u + 3, h); ctx.lineTo(u + 3 + h, 0); ctx.lineTo(u + h, 0); ctx.fill(); } };
  const glow = (c, sx, sy, r, col) => { const g = c.createRadialGradient(sx, sy, 0, sx, sy, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(sx - r, sy - r, r * 2, r * 2); };
  // a swivel office chair in an 8x8 footprint at world (x, y); its back on the south side, so it faces north
  function officeChair(c, x, y) {
    const cx = x + 4, cy = y + 4;
    for (const [dx, dy] of [[0, -3.2], [3, -1], [1.9, 2.6], [-1.9, 2.6], [-3, -1]]) { const [a1, a2] = px(cx, cy), [b1, b2] = px(cx + dx, cy + dy); c.strokeStyle = '#2b2e3a'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(a1, a2 - 0.8); c.lineTo(b1, b2 - 0.6); c.stroke(); c.fillStyle = '#1b1720'; c.beginPath(); c.arc(b1, b2 - 0.3, 0.7, 0, Math.PI * 2); c.fill(); }
    cyl(c, cx, cy, 0.6, 3, '#8a8f99', 0.6);                                                          // gas lift
    rbox(c, x + 0.8, y + 0.8, 6.4, 6, 2, '#2f5fa8', 2.4, 3, ctx => { ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.roundRect(1, 1, 4, 3, 1.5); ctx.fill(); });
    rbox(c, x + 1.2, y + 6.2, 5.6, 1.4, 8, '#2f5fa8', 0.7, 4.5);                                      // the curved back
  }

  // a fire extinguisher: a red cylinder with a white label, a black cap and hose
  function extinguisher(c, x, y) {
    cyl(c, x, y, 1.7, 11, '#d0352a'); cyl(c, x, y, 1.75, 2.2, '#f4f0e6', 5); cyl(c, x, y, 0.9, 1.6, '#2b2e3a', 11);
    const [sx, sy] = px(x, y); c.strokeStyle = '#1b1720'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(sx, sy - 12.5); c.quadraticCurveTo(sx + 3, sy - 13, sx + 2.4, sy - 8); c.stroke();
  }
  const F = {
    // the doctor's desk: drawers and a kneehole on the doctor's side (south), a plain modesty panel facing the patient,
    // the monitor turned to the doctor, and the doctor's blue office chair tucked in on their side
    desk: (x, y) => ({ x, y, w: 28, d: 12, draw: (c, X, Y) => {
      const ox = X + x, oy = Y + y;
      box(c, ox + 1, oy + 1, 9, 10, 9, '#7a4c2a', { south: (ctx, w, h) => { for (let v = 1; v < h - 1; v += 2.8) { R(ctx, 0.8, v, w - 1.6, 2.3, '#94603a'); R(ctx, 0.8, v, w - 1.6, 0.5, '#a8744a'); R(ctx, w / 2 - 1, v + 1, 2, 0.5, '#d9b46a'); } } });   // the drawer pedestal
      tube(c, ox + 26, oy + 2, 9, '#5a3620'); tube(c, ox + 26, oy + 10, 9, '#5a3620');                     // legs
      box(c, ox + 11, oy + 1, 15, 1, 7, '#7a4c2a', null, 2);                                              // the modesty panel
      rbox(c, ox, oy, 28, 12, 2, '#9a6a40', 2.5, 9, ctx => { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(0, 0, 28, 1); R(ctx, 3, 3, 7, 5, '#f2ecdc'); R(ctx, 4, 4, 5, 0.5, '#bdb5a2'); R(ctx, 4, 5.5, 4, 0.5, '#bdb5a2'); R(ctx, 12, 8, 9, 2.5, '#d9d4c7'); for (let i = 12.5; i < 21; i += 1.5) R(ctx, i, 8.5, 1, 0.5, '#8a8f99'); });
      cyl(c, ox + 24, oy + 3, 1.3, 3, '#3c7bd6', 11); R(c, ...px(ox + 24, oy + 3).map((v, k) => v - (k ? 17 : 0.4)), 0.6, 3, '#e8533f');   // a pen pot
      cyl(c, ox + 17.5, oy + 3.5, 2, 0.8, '#3a3d44', 11); tube(c, ox + 17.5, oy + 3.5, 3, '#5c6068', 11);     // the monitor's foot and neck
      rbox(c, ox + 12, oy + 3, 11, 1.6, 9, '#d9d4c7', 0.7, 13);
      box(c, ox + 12.6, oy + 3.4, 9.8, 0.6, 7, '#1d2a3a', { south: (ctx, w, h) => { const f = Math.floor(now * 2 + X) % 4; R(ctx, 1, 1, w / 2, 1, '#6fd3ff'); R(ctx, 1, 3, w - 3 - f, 0.5, '#7ee081'); R(ctx, 1, 4.5, w - 6 + f, 0.5, '#7ee081'); } }, 14);
    } }),
    rdesk: (x, y) => ({ x, y, w: 18, d: 10, draw: (c, X, Y) => { box(c, X + x, Y + y, 18, 10, 11, '#6c6f78', { top: ctx => { R(ctx, 2, 2, 5, 4, '#f2ecdc'); R(ctx, 3, 7, 7, 1, '#2b2e3a'); }, south: drawers }); box(c, X + x + 8, Y + y + 1, 8, 5, 9, '#d9d4c7', { south: (ctx, w, h) => { R(ctx, 1, 1, w - 2, h - 3, '#1d2a3a'); R(ctx, 2, 2, 3, 1, '#7ee081'); R(ctx, 2, 4, 4, 1, '#7ee081'); } }); } }),
    // a visitor's chair: wooden legs, a padded seat, the back on its north side so it faces south
    chair: (x, y, col) => ({ x, y, w: 8, d: 8, draw: (c, X, Y) => {
      const cc = col || '#2f9a5a';   // patients' chairs are green, like the corridor benches; staff chairs are blue
      for (const [lx, ly] of [[1.2, 1.2], [6.8, 1.2], [1.2, 6.8], [6.8, 6.8]]) tube(c, X + x + lx, Y + y + ly, 3, '#c8ced8');
      rbox(c, X + x + 0.5, Y + y + 0.5, 7, 7, 1.5, cc, 2, 2.5, ctx => { ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.beginPath(); ctx.roundRect(1, 1.5, 5, 4, 1.5); ctx.fill(); });
      tube(c, X + x + 1.2, Y + y + 0.8, 8, '#c8ced8', 3); tube(c, X + x + 6.8, Y + y + 0.8, 8, '#c8ced8', 3);
      rbox(c, X + x + 0.5, Y + y + 0.2, 7, 1.4, 5, cc, 0.7, 6);
    } }),
    // a filing cabinet: four labelled drawers with handles on its front (south)
    cabinet: (x, y) => ({ x, y, w: 10, d: 10, draw: (c, X, Y) => { box(c, X + x + 0.5, Y + y + 0.5, 9, 9, 21, '#7d838e', { south: (ctx, w, h) => { for (let i = 0; i < 4; i++) { const v = 1 + i * 5; R(ctx, 0.8, v, w - 1.6, 4.4, '#8e95a0'); R(ctx, 0.8, v, w - 1.6, 0.5, '#aab1bc'); R(ctx, 0.8, v + 3.9, w - 1.6, 0.5, '#5c6270'); R(ctx, 3, v + 1, 3, 1.2, '#f4f0e6'); R(ctx, 3.5, v + 2.6, 2, 0.8, '#3a3d44'); } } }); rbox(c, X + x, Y + y, 10, 10, 1, '#9aa1ac', 1.5, 21); } }),
    shelves: (x, y, w) => ({ x, y, w, d: 6, draw: (c, X, Y) => box(c, X + x, Y + y, w, 6, 20, '#8b5a2b', { south: bottles }) }),
    counter: (x, y, w) => ({ x, y, w, d: 10, draw: (c, X, Y) => box(c, X + x, Y + y, w, 10, 11, '#e8e0d0', { top: ctx => { R(ctx, 2, 2, 4, 3, '#3c7bd6'); R(ctx, 8, 3, 5, 2, '#f4f0e6'); R(ctx, w - 7, 2, 4, 3, '#39a85a'); }, south: (ctx, w2, h) => { R(ctx, 0, 3, w2, 1, '#bbb3a4'); R(ctx, 3, 5, w2 / 2 - 4, h - 7, '#d6cdbc'); R(ctx, w2 / 2 + 1, 5, w2 / 2 - 4, h - 7, '#d6cdbc'); } }) }),
    sink: (x, y) => ({ x, y, w: 10, d: 10, draw: (c, X, Y) => { box(c, X + x, Y + y, 10, 10, 11, '#c0c4cc', { top: ctx => { R(ctx, 2, 2, 6, 6, '#9fd8ff'); R(ctx, 4, 1, 2, 1, '#6a7078'); } }); box(c, X + x + 2, Y + y, 6, 1, 20, '#dfe4f2', { south: (ctx, w, h) => R(ctx, 1, 1, w - 2, h - 2, '#9fd8ff') }); } }),
    bed: (x, y) => ({ x, y, w: 14, d: 26, draw: (c, X, Y) => { const ox = X + x, oy = Y + y; for (const [lx, ly] of [[1.5, 3], [12.5, 3], [1.5, 25], [12.5, 25]]) tube(c, ox + lx, oy + ly, 3, '#9aa3b8'); rbox(c, ox, oy, 14, 2, 14, '#c8ced8', 1, 0); rbox(c, ox + 0.5, oy + 2, 13, 23.5, 2, '#9aa3b8', 1.5, 3); rbox(c, ox + 1, oy + 2.5, 12, 22.5, 3, '#f4f4f8', 2.5, 5); rbox(c, ox + 2.5, oy + 3.5, 9, 5, 1.5, '#ffffff', 2.4, 8); rbox(c, ox + 0.8, oy + 11, 12.4, 14, 1.2, '#7fb7e6', 2.5, 8, ctx => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 12.4, 1.2); ctx.fillStyle = 'rgba(0,0,0,.08)'; for (let j = 3; j < 14; j += 3) ctx.fillRect(0, j, 12.4, 0.5); }); } }),
    bedside: (x, y) => ({ x, y, w: 8, d: 8, draw: (c, X, Y) => box(c, X + x, Y + y, 8, 8, 10, '#8b5a2b', { top: ctx => { R(ctx, 2, 2, 4, 4, '#ff6b9a'); R(ctx, 3, 1, 2, 1, '#39a85a'); } }) }),
    curtain: (x, y, col) => ({ x, y, w: 2, d: 14, draw: (c, X, Y) => box(c, X + x, Y + y, 2, 14, 18, col || '#bfe3df', { east: (ctx, d, h) => { for (let v = 2; v < h; v += 4) R(ctx, 0, v, d, 1, shade(col || '#bfe3df', -0.08)); R(ctx, 0, 0, d, 1, '#9aa3b8'); } }) }),
    screenP: (x, y) => ({ x, y, w: 16, d: 2, draw: (c, X, Y) => box(c, X + x, Y + y, 16, 2, 20, '#f2e8d4', { south: (ctx, w, h) => { R(ctx, 0, 0, w, 2, '#9aa3b8'); for (let u = 5; u < w; u += 5) R(ctx, u, 0, 1, h, '#c9bfa8'); R(ctx, 0, h - 3, w, 3, '#9aa3b8'); } }) }),
    couch: (x, y, w) => ({ x, y, w: w || 32, d: 12, draw: (c, X, Y) => { const ww = w || 32, ox = X + x, oy = Y + y; rbox(c, ox, oy, ww, 4, 13, '#6b2d3a', 2, 0); rbox(c, ox, oy + 3, ww, 9, 4, '#7a3444', 2, 0); for (let i = 0; i < 3; i++) rbox(c, ox + 2.5 + i * (ww - 5) / 3, oy + 3.5, (ww - 5) / 3 - 0.4, 8, 2.5, '#a04a5a', 2.5, 4); rbox(c, ox + 3, oy + 4, 6, 4, 2, '#f2d9a4', 2, 6.5); rbox(c, ox, oy + 2, 3, 10, 9, '#6b2d3a', 1.5, 0); rbox(c, ox + ww - 3, oy + 2, 3, 10, 9, '#6b2d3a', 1.5, 0); } }),
    sofa: (x, y) => ({ x, y, w: 18, d: 10, draw: (c, X, Y) => { const ox = X + x, oy = Y + y; rbox(c, ox, oy, 18, 3.5, 13, '#2f6b74', 1.8, 0); rbox(c, ox, oy + 3, 18, 7, 3.5, '#357a84', 1.8, 0); rbox(c, ox + 2.2, oy + 3.3, 6.6, 6.2, 2.5, '#4f98a2', 2.4, 3.5); rbox(c, ox + 9.2, oy + 3.3, 6.6, 6.2, 2.5, '#4f98a2', 2.4, 3.5); rbox(c, ox, oy + 2, 2.4, 8, 9, '#2f6b74', 1.2, 0); rbox(c, ox + 15.6, oy + 2, 2.4, 8, 9, '#2f6b74', 1.2, 0); } }),
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
    bin: (x, y) => ({ x, y, w: 6, d: 6, draw: (c, X, Y) => { cyl(c, X + x + 3, Y + y + 3, 2.6, 7, '#6b7280'); cyl(c, X + x + 3, Y + y + 3, 2.8, 1, '#8a919c', 7); } }),
    ext: (x, y) => ({ x, y, w: 4, d: 4, draw: (c, X, Y) => extinguisher(c, X + x + 2, Y + y + 2) }),
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
  // ---------- detailed room equipment (2x1 tiles, the front facing south) ----------
  const G = {
    // the psychiatrist's couch: a buttoned leather chaise longue with a raised, rolled headrest and a bolster
    chaise: (c, X, Y) => {
      for (const [lx, ly] of [[3, 4], [29, 4], [3, 13], [29, 13]]) tube(c, X + lx, Y + ly, 3, '#5a3620');
      rbox(c, X + 1.5, Y + 2.5, 29, 12, 3, '#6b2d3a', 2, 2.5);
      rbox(c, X + 2, Y + 3, 28, 11, 2.5, '#8a3a4a', 3, 5, ctx => { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(2, 1, 24, 2); ctx.fillStyle = '#5a2430'; for (let i = 8; i < 27; i += 4.5) for (let j = 3; j < 10; j += 3.5) { ctx.beginPath(); ctx.arc(i + (j % 7 ? 2 : 0), j, 0.5, 0, Math.PI * 2); ctx.fill(); } });
      rbox(c, X + 1.5, Y + 2.5, 6, 12, 7, '#7a3442', 3, 5, ctx => { ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(1, 1, 4, 10); });   // the headrest
      rbox(c, X + 7.5, Y + 4, 3, 9, 2.5, '#a04a5a', 1.5, 7.5);                                                                                 // the bolster
    },
    // an examination couch: chrome legs on castors, a padded blue top with a raised head end and a roll of paper, a step
    examcouch: (c, X, Y) => {
      for (const [lx, ly] of [[4, 4], [28, 4], [4, 12], [28, 12]]) { tube(c, X + lx, Y + ly, 7); const [a, b] = px(X + lx, Y + ly); c.fillStyle = '#1b1720'; c.beginPath(); c.arc(a, b, 0.9, 0, Math.PI * 2); c.fill(); }
      rbox(c, X + 3, Y + 7, 26, 2, 0.8, '#c8ced8', 0.8, 3);                                                                                   // the lower rail
      rbox(c, X + 2, Y + 2.5, 28, 11, 2.5, '#2f6fa8', 2, 7, ctx => { ctx.fillStyle = '#3f84c4'; ctx.fillRect(0.5, 0.5, 27, 10); ctx.fillStyle = '#f4f4f0'; ctx.fillRect(7, 2.5, 21, 6); ctx.fillStyle = 'rgba(0,0,0,.08)'; for (let i = 10; i < 28; i += 5) ctx.fillRect(i, 2.5, 0.4, 6); });
      rbox(c, X + 2, Y + 2.5, 7, 11, 2.5, '#2f6fa8', 2, 9.5, ctx => { ctx.fillStyle = '#4a92d0'; ctx.fillRect(0.5, 0.5, 6, 10); ctx.fillStyle = '#f4f4f0'; ctx.fillRect(1.5, 3, 4, 5); });   // the raised head end
      cyl(c, X + 30.5, Y + 8, 1.6, 7, '#f4f4f0', 5.5);                                                                                        // the paper roll
      rbox(c, X + 12, Y + 14, 8, 3, 2.5, '#9aa3b8', 0.8, 0, ctx => { ctx.fillStyle = '#5c6068'; for (let i = 1; i < 8; i += 1.5) ctx.fillRect(i, 0.5, 0.6, 2); });   // a step
    },
    // the pharmacy: a glass-fronted cabinet of medicines against the wall and a counter with a till, bottles and a mortar
    pharmacy: (c, X, Y) => {
      box(c, X + 1, Y + 0.5, 30, 5, 26, '#7a4c2a', { south: (ctx, w, h) => {
        R(ctx, 1, 2, w - 2, h - 4, '#5a3620');
        for (let k = 0; k < 4; k++) { const v = 3 + k * 5.5; R(ctx, 1.5, v + 4.5, w - 3, 0.8, '#8a5a34'); for (let i = 2.5; i < w - 3; i += 2.2) { const col = ['#e8533f', '#3c7bd6', '#39a85a', '#ffd23f', '#d64f8e', '#f4f0e6', '#7ad0d8'][Math.floor(i * 3 + k * 5) % 7], bh = 2.2 + ((i * 7 + k) % 3) * 0.6; R(ctx, i, v + 4.5 - bh, 1.5, bh, col); R(ctx, i, v + 4.5 - bh, 0.5, bh, shade(col, 0.4)); R(ctx, i + 0.3, v + 4.5 - bh - 0.5, 0.9, 0.5, '#f4f4f0'); } }
        ctx.fillStyle = 'rgba(200,235,255,.22)'; ctx.fillRect(1.5, 2.5, w - 3, h - 5); ctx.fillStyle = 'rgba(255,255,255,.35)'; for (let i = 3; i < w; i += 7.5) ctx.fillRect(i, 3, 1, h - 7);
        R(ctx, w / 2 - 0.4, 2, 0.8, h - 4, '#7a4c2a');
      } });
      rbox(c, X + 0.5, Y, 31, 6, 1.5, '#8a5a34', 1, 26);                                                                                       // the cornice
      box(c, X + 2, Y + 7, 28, 7, 9, '#9a6a40', { south: (ctx, w, h) => { for (let i = 1; i < w - 1; i += 6.8) { R(ctx, i, 1.5, 6, h - 3, '#8a5a34'); R(ctx, i, 1.5, 6, 0.5, '#b07a4a'); R(ctx, i + 2.5, 4, 1, 0.5, '#d9b46a'); } } });
      rbox(c, X + 1.5, Y + 6.5, 29, 8, 1.5, '#e8e4da', 1.5, 9, ctx => { ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(1, 1, 26, 1); });   // the counter top
      rbox(c, X + 20, Y + 8, 7, 5, 4, '#5c6068', 1.2, 10.5, ctx => { ctx.fillStyle = '#2b2e3a'; ctx.fillRect(1, 0.6, 5, 1.6); ctx.fillStyle = '#7ee081'; ctx.fillRect(1.4, 0.9, 2.5, 0.8); ctx.fillStyle = '#c8ced8'; for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) ctx.fillRect(1.2 + i * 1.6, 2.7 + j * 1, 1, 0.6); });   // the till
      for (const [bx, by, col] of [[6, 9, '#e8533f'], [8.5, 10.5, '#3c7bd6'], [10.5, 9, '#39a85a']]) { cyl(c, X + bx, Y + by, 0.9, 3, col, 10.5); cyl(c, X + bx, Y + by, 0.6, 0.6, '#f4f4f0', 13.5); }
      cyl(c, X + 15, Y + 10, 1.6, 2, '#d9d4c7', 10.5); tube(c, X + 15.5, Y + 10, 2.5, '#8a8f99', 12);                                          // a pestle and mortar
    },
    // the Inflation machine: a gas tank, a pressure gauge (its needle twitching), a pump with a plunger that works up
    // and down, and a hose to the inflation cap that comes down over the patient's head
    inflate: (c, X, Y) => {
      rbox(c, X + 1, Y + 1.5, 30, 13, 2, '#7a8696', 1.5, 0, ctx => { ctx.fillStyle = '#ffd23f'; for (let i = -2; i < 30; i += 4) { ctx.beginPath(); ctx.moveTo(i, 13); ctx.lineTo(i + 1.5, 13); ctx.lineTo(i + 3.5, 11.5); ctx.lineTo(i + 2, 11.5); ctx.fill(); } });
      cyl(c, X + 8, Y + 7, 5, 20, '#f2c230', 2); cyl(c, X + 8, Y + 7, 5.05, 2, '#d0352a', 12); cyl(c, X + 8, Y + 7, 1.6, 2.5, '#8a8f99', 22);   // the gas tank and its valve
      { const [sx, sy] = px(X + 8, Y + 7); c.fillStyle = '#1b1720'; c.font = 'bold 4px sans-serif'; c.textAlign = 'center'; c.fillText('AIR', sx - 1, sy - 9); c.textAlign = 'start'; }
      rbox(c, X + 18, Y + 4, 10, 8, 10, '#3c6fb0', 1.8, 2, ctx => { ctx.fillStyle = '#2b2e3a'; ctx.fillRect(1, 1, 8, 6); });                   // the pump body
      { const stroke = Math.abs(Math.sin(now * 2.4)) * 4; tube(c, X + 23, Y + 8, 5 + stroke, '#c8ced8', 12); rbox(c, X + 20, Y + 7.3, 6, 1.4, 1.2, '#2b2e3a', 0.6, 17 + stroke); }   // the plunger and its handle
      box(c, X + 18.5, Y + 11.5, 9, 0.6, 5, '#2b2e3a', { south: (ctx, w, h) => { R(ctx, 1, 1, 1.5, 1.5, '#e8533f'); R(ctx, 3.5, 1, 1.5, 1.5, '#39a85a'); R(ctx, 6, 1, 1.5, 1.5, '#ffd23f'); } }, 4);   // the buttons
      tube(c, X + 15, Y + 4, 24, '#8a8f99', 2);                                                                                                 // the gauge's stand
      { const [gx, gy] = px(X + 15, Y + 4), cy = gy - 30, a = -2.4 + 1.6 + Math.sin(now * 3.1) * 0.25 + Math.sin(now * 7) * 0.05;
        c.fillStyle = '#c8ced8'; c.beginPath(); c.arc(gx, cy, 6.2, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#1b1720'; c.lineWidth = 0.6; c.stroke();
        c.fillStyle = '#fbfaf2'; c.beginPath(); c.arc(gx, cy, 5, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#e8533f'; c.lineWidth = 1.2; c.beginPath(); c.arc(gx, cy, 4, -0.6, 0.4); c.stroke();
        c.strokeStyle = '#1b1720'; c.lineWidth = 0.4; for (let k = 0; k < 9; k++) { const t = -3.6 + k * 0.5; c.beginPath(); c.moveTo(gx + Math.cos(t) * 4.2, cy + Math.sin(t) * 4.2); c.lineTo(gx + Math.cos(t) * 4.9, cy + Math.sin(t) * 4.9); c.stroke(); }
        c.strokeStyle = '#d0352a'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(gx, cy); c.lineTo(gx + Math.cos(a) * 4, cy + Math.sin(a) * 4); c.stroke(); c.fillStyle = '#1b1720'; c.beginPath(); c.arc(gx, cy, 0.7, 0, Math.PI * 2); c.fill(); }
      // the hose, from the pump to the cap hanging over the patient's spot in front
      { const [h1, h2] = px(X + 27, Y + 8), [m1, m2] = px(X + 28, Y + 18), [e1, e2] = px(X + 16, Y + 22);
        c.strokeStyle = '#2b2e3a'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(h1, h2 - 8); c.bezierCurveTo(h1 + 6, h2 - 2, m1, m2 - 40, e1, e2 - 30); c.stroke();
        c.strokeStyle = '#5c6068'; c.lineWidth = 0.6; c.stroke();
        c.fillStyle = '#c8ced8'; c.beginPath(); c.ellipse(e1, e2 - 27.5, 4.6, 3.2, 0, Math.PI, 0); c.fill(); c.strokeStyle = '#1b1720'; c.lineWidth = 0.5; c.stroke();
        c.fillStyle = '#d0352a'; c.fillRect(e1 - 4.6, e2 - 27.8, 9.2, 1); c.fillStyle = 'rgba(255,255,255,.6)'; c.fillRect(e1 - 2.5, e2 - 30, 1.5, 1); }
    },
  };
  // ---------- room objects ----------
  // Each painter draws its object in the canonical orientation (front facing south) with its footprint's top-left at
  // world (X, Y); objItem rotates it into place about the footprint's centre.
  const custom = {
    sscreen: (x, y) => ({ x, y, w: 16, d: 2, draw: (c, X, Y) => box(c, X + x, Y + y, 16, 2, 20, '#7cc4a0', { south: (ctx, w, h) => { R(ctx, 0, 0, w, 2, '#5a9a7a'); for (let u = 5; u < w; u += 5) R(ctx, u, 0, 1, h, '#5fae8a'); R(ctx, 0, h - 3, w, 3, '#9aa3b8'); } }) }),
    xview: (x, y) => ({ x, y, w: 12, d: 3, draw: (c, X, Y) => box(c, X + x, Y + y, 12, 3, 24, '#6b7280', { south: (ctx, w, h) => { R(ctx, 1, 3, w - 2, 10, '#dff3ff'); R(ctx, 4, 4, 2, 8, '#8aa0b8'); R(ctx, 3, 6, 4, 1, '#8aa0b8'); R(ctx, 3, 9, 4, 1, '#8aa0b8'); R(ctx, 8, 5, 2, 3, '#8aa0b8'); } }) }),
    tv: (x, y) => ({ x, y, w: 12, d: 4, draw: (c, X, Y) => { box(c, X + x + 2, Y + y, 8, 4, 8, '#5a3a22'); box(c, X + x, Y + y, 12, 3, 18, '#2b2e3a', { south: (ctx, w, h) => { R(ctx, 1, 1, w - 2, 8, '#3c7bd6'); R(ctx, 2, 2, 4, 2, '#9fd8ff'); R(ctx, 7, 5, 3, 3, '#ffd23f'); } }); } }),
    computer: (x, y) => ({ x, y, w: 14, d: 10, draw: (c, X, Y) => { box(c, X + x, Y + y, 14, 10, 10, '#d9d4c7', { top: ctx => { R(ctx, 2, 6, 8, 2, '#6b7280'); } }); box(c, X + x + 2, Y + y + 1, 10, 3, 9, '#e8e4d8', { south: (ctx, w, h) => { R(ctx, 1, 1, w - 2, h - 3, '#1d2a3a'); R(ctx, 2, 2, 4, 1, '#7ee081'); R(ctx, 2, 4, 6, 1, '#7ee081'); } }); } }),
    atom: (x, y) => ({ x, y, w: 10, d: 10, draw: (c, X, Y) => { box(c, X + x, Y + y, 10, 10, 10, '#5c6f85', { south: (ctx, w, h) => buttons(ctx, 1, 3) }); const [sx, sy] = px(X + x + 5, Y + y + 5); glow(c, sx, sy - 18, 9, 'rgba(126,224,129,.45)'); c.fillStyle = '#7ee081'; c.beginPath(); c.arc(sx, sy - 18, 3.5, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#c8ffc8'; c.lineWidth = 1; c.beginPath(); c.ellipse(sx, sy - 18, 7, 2.5, 0.5, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.ellipse(sx, sy - 18, 7, 2.5, -0.5, 0, Math.PI * 2); c.stroke(); } }),
    proj: (x, y) => ({ x, y, w: 8, d: 8, draw: (c, X, Y) => { box(c, X + x + 3, Y + y + 3, 2, 2, 12, '#6b7280'); box(c, X + x, Y + y, 8, 8, 6, '#3a3f48', { south: (ctx, w, h) => R(ctx, 2, 1, 3, 3, '#fff6c0') }); const [sx, sy] = px(X + x + 4, Y + y + 8); glow(c, sx, sy - 14, 8, 'rgba(255,246,192,.35)'); } }),
  };
  const OBJ_DRAW = {
    desk: rk => (rk === 'research' ? F.rdesk(7, 3) : F.desk(2, 2)),
    cabinet: () => F.cabinet(3, 1), chair: () => F.chair(4, 4), screen: () => F.screenP(0, 3), trolley: () => ({ x: 0, y: 0, w: 32, d: 16, draw: G.examcouch }),
    cardio: () => F.treadmill(3, 2), scanner: () => F.scanner(1, 8), console: () => F.console(0, 4), ultra: () => F.ultra(4, 1),
    bloodm: () => F.bloodm(0, 3), xray: () => F.xray(5, 10), shield: () => F.leadscreen(2, 6), couch: () => ({ x: 0, y: 0, w: 32, d: 16, draw: G.chaise }),
    comfy: () => F.chair(4, 4, '#8a3a4a'), bed: () => F.bed(1, 3), pcab: () => ({ x: 0, y: 0, w: 32, d: 16, draw: G.pharmacy }),
    optable: () => [F.optable(1, 2), F.oplamp(15, 1)], sscreen: () => custom.sscreen(0, 7), sink: () => F.sink(3, 3), xview: () => custom.xview(2, 0),
    inflator: () => ({ x: 0, y: 0, w: 32, d: 16, draw: G.inflate }), slicer: () => F.slicer(8, 1), cast: () => F.castm(8, 2), hairr: () => F.hairchair(1, 3), electro: () => F.coil(2, 2),
    jellym: () => F.vat(4, 6), shower: () => F.shower(-1, 0), dnaf: () => F.dna(6, 1), sofa: () => F.sofa(7, 3), vgame: () => F.arcade(3, 3), pool: () => F.pool(3, 1),
    tv: () => custom.tv(2, 0), toilet: () => F.cubicle(0, 1), autopsy: () => F.autopsy(9, 3), computer: () => custom.computer(1, 3), atom: () => custom.atom(3, 3),
    lchair: () => F.lchair(4, 4), proj: () => custom.proj(4, 4), ext: () => F.ext(6, 0), rad: () => F.rad(1, 0), bin: () => F.bin(5, 1),
    plant: (rk, dry) => F.plant(4, 4, dry), bookcase: () => F.bookshelf(5, 0), skeleton: () => F.skeleton(5, 2),
  };
  // rotate everything drawn inside fn by `r` quarter turns about world point (cx, cy)
  function withRot(cx, cy, r, fn) {
    r &= 3;
    if (!r) return fn();
    pre = (x, y) => { let dx = x - cx, dy = y - cy; for (let i = 0; i < r; i++) [dx, dy] = [-dy, dx]; return [cx + dx, cy + dy]; };
    try { fn(); } finally { pre = null; }
  }
  // a placed (or preview) object as a depth-sorted scene item
  function objItem(o, x, y, rot, roomKind, dry, alpha) {
    const B = RH.OBJ[o], [rwd, rdp] = RH.objDims(o, rot);
    const X = x * T, Y = y * T, cx = X + rwd * 8, cy = Y + rdp * 8;
    const parts = [].concat(OBJ_DRAW[o](roomKind, dry));
    const item = { d: depthBox(X, Y, rwd * T - 1, rdp * T - 1), draw: c => {
      if (alpha != null) c.globalAlpha = alpha;
      withRot(cx, cy, rot, () => { const X0 = cx - B.fw * 8, Y0 = cy - B.fd * 8; for (const pt of parts) pt.draw(c, X0, Y0); });
      if (alpha != null) c.globalAlpha = 1;
    } };
    if (o !== 'desk') return item;
    // a desk's office chair is its own item on the tile the doctor (or researcher, nurse) sits at, facing the desk,
    // sorted just in front of the sitter when its back is towards the camera and just behind them otherwise
    const t = RH.objTiles(o, x, y, rot), ux = t.use[0] * T + 8, uy = t.use[1] * T + 8, backNear = t.fdir === 2 || t.fdir === 3;
    const chair = { d: depth(ux, uy) + (backNear ? 0.3 : -0.3), draw: c => {
      if (alpha != null) c.globalAlpha = alpha;
      withRot(ux, uy, t.bdir, () => officeChair(c, ux - 4, uy - 7));
      if (alpha != null) c.globalAlpha = 1;
    } };
    return [item, chair];
  }
  // A patient lying on a bed, couch, examination couch or operating table: their front-facing sprite laid flat on
  // the surface, head at the pillow (or raised) end, in the object's own frame so it turns with it. h: surface
  // height; head (hx, hy) to feet (fx, fy) in the object's canonical footprint; w: how wide they lie.
  const LIE = {
    bed:     { h: 8.4, hx: 8.5, hy: 6, fx: 8.5, fy: 28, w: 11, cover: '#7fb7e6' },
    couch:   { h: 7.8, hx: 5, hy: 8.5, fx: 30, fy: 8.5, w: 9.5 },
    trolley: { h: 9.8, hx: 4.5, hy: 8, fx: 29, fy: 8, w: 9.5 },
    optable: { h: 10.4, hx: 4, hy: 8, fx: 29, fy: 8, w: 10, cover: '#5fae8a' },
  };
  function lyingItem(o, x, y, rot, img) {
    const B = RH.OBJ[o], [rwd, rdp] = RH.objDims(o, rot), X = x * T, Y = y * T, cx = X + rwd * 8, cy = Y + rdp * 8, G2 = LIE[o];
    return { d: depthBox(X, Y, rwd * T - 1, rdp * T - 1) + 0.2, draw: c => withRot(cx, cy, rot, () => {
      const X0 = cx - B.fw * 8, Y0 = cy - B.fd * 8, hx = X0 + G2.hx, hy = Y0 + G2.hy, lx = X0 + G2.fx - hx, ly = Y0 + G2.fy - hy, len = Math.hypot(lx, ly);
      const wx = -ly / len * G2.w, wy = lx / len * G2.w, ox = hx - wx / 2, oy = hy - wy / 2;
      const [o1, o2] = px(ox, oy), [u1, u2] = px(ox + wx, oy + wy), [v1, v2] = px(ox + lx * 1.05, oy + ly * 1.05);
      const prop = flat ? 0 : 5;   // the head end propped up on the pillow, so the face reads from the camera
      ST(c, (u1 - o1) / 16, (u2 - o2) / 16, (v1 - o1) / 24, (v2 - o2 + prop) / 24, o1, o2 - G2.h - prop); c.drawImage(img, 0, 0, 16, 24); reset(c);
      if (G2.cover) {   // a blanket (or surgical drape) pulled up over the legs and body
        const a = 0.42, bx0 = hx + lx * a - wx * 0.55, by0 = hy + ly * a - wy * 0.55, ex = lx * (1 - a) + lx * 0.04, ey = ly * (1 - a) + ly * 0.04;
        const xs = [bx0, bx0 + ex, bx0 + wx * 1.1, bx0 + wx * 1.1 + ex], ys = [by0, by0 + ey, by0 + wy * 1.1, by0 + wy * 1.1 + ey];
        const minX = Math.min(...xs), minY = Math.min(...ys);
        rbox(c, minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY, 1.2, G2.cover, 2, G2.h, ctx => { ctx.fillStyle = 'rgba(255,255,255,.85)'; if (lx) ctx.fillRect(0, 0, 1.4, 99); else ctx.fillRect(0, 0, 99, 1.4); ctx.fillStyle = 'rgba(0,0,0,.08)'; for (let j = 3; j < 30; j += 3) lx ? ctx.fillRect(j, 0, 0.5, 99) : ctx.fillRect(0, j, 99, 0.5); });
      }
    }) };
  }
  // a room wrecked by an exploding machine: scorch marks and rubble
  function wreckItems(rc) {
    const items = [], X = rc.x * T, Y = rc.y * T, w = rc.w * T, h = rc.h * T;
    items.push({ d: depth(X, Y) + 1, draw: c => decal(c, X + w / 2, Y + h / 2, ctx => { ctx.fillStyle = 'rgba(20,16,14,.55)'; ctx.beginPath(); ctx.ellipse(0, 0, w * 0.4, h * 0.35, 0.4, 0, Math.PI * 2); ctx.fill(); }) });
    for (let i = 0; i < 9; i++) {
      const bx = X + 6 + Math.floor(A.hash(X + i, Y) * (w - 18)), by = Y + 6 + Math.floor(A.hash(Y + i, X) * (h - 18)), s = 4 + Math.floor(A.hash(i, X + Y) * 8);
      items.push({ d: depthBox(bx, by, s, s), draw: c => box(c, bx, by, s, s, 3 + (i % 3) * 3, ['#5a5246', '#3a3530', '#6b6058'][i % 3]) });
    }
    return items;
  }
  // corridor decoration (centred on a 16px tile)
  const DECOR_DRAW = {
    plant: (c, x, y, dry) => { shadow(c, x, y + 4, 5); bill(c, A.furniture(dry ? 'deadplant' : 'plant'), x, y + 5); },
    bench: (c, x, y) => {
      // Theme Hospital's waiting bench: green padded seats and backs on a chrome tube frame
      for (const lx of [-6, 6]) { tube(c, x + lx, y - 1.5, 3); tube(c, x + lx, y + 2, 3); tube(c, x + lx, y - 2.6, 8, null, 3); }
      rbox(c, x - 7, y - 2.2, 14, 4.6, 0.6, '#b8c0cc', 0.8, 2.6);
      for (let i = 0; i < 3; i++) rbox(c, x - 6.8 + i * 4.6, y - 2, 4.3, 4.4, 1.6, '#2fa04a', 1.6, 3.2, ctx => { ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.beginPath(); ctx.roundRect(0.6, 0.6, 3, 2, 1); ctx.fill(); });
      for (let i = 0; i < 3; i++) rbox(c, x - 6.8 + i * 4.6, y - 3.2, 4.3, 1.2, 5, '#2fa04a', 0.6, 5.2);
    },
    radiator: (c, x, y) => box(c, x - 7, y - 2, 14, 3, 8, '#f4f4f0', { south: (ctx, w, h) => { for (let u = 1; u < w; u += 2) R(ctx, u, 1, 1, h - 2, '#d2d2cf'); } }),
    ext: (c, x, y) => extinguisher(c, x, y),
    drinks: (c, x, y) => { box(c, x - 5, y - 4, 10, 8, 21, '#c43c2c', { south: (ctx, w, h) => { R(ctx, 1, 2, w - 2, 11, '#1d2a3a'); for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) R(ctx, 2 + i * 3, 4 + j * 5, 2, 3, ['#ffd23f', '#39a85a', '#3c7bd6'][(i + j) % 3]); R(ctx, 2, h - 6, w - 4, 3, '#1d2a3a'); R(ctx, w - 3, 14, 2, 1, '#ffd23f'); } }); rbox(c, x - 5.3, y - 4.3, 10.6, 8.6, 1.5, '#d84a3a', 2, 21); },
  };
  // a corridor object on tile (c, r): turned so its back is against a neighbouring wall (one behind it, from the
  // viewer, if there is one) and nudged up to it; sorted by the tile's centre
  const BACK_TO_WALL = { bench: 3, radiator: 5, drinks: 3, ext: 5, plant: 0 };
  function decorSide(h, c, r) {
    const x = c * T + 8, y = r * T + 8, Lr = RH.layout(h);
    const wallAt = d => { const [dx, dy] = RH.DIRS[d], nx = c + dx, ny = r + dy; return !RH.indoor(nx, ny) || (Lr.room[RH.idx(nx, ny)] || 0) > 0; };
    const sides = [0, 1, 2, 3].filter(wallAt), behind = sides.filter(d => { const [dx, dy] = RH.DIRS[d]; return depth(x + dx, y + dy) < depth(x, y); });
    return behind.length ? behind[0] : sides.length ? sides[0] : -1;
  }
  // where the nth sitter on a bench sits (world x, y) and which way they face (sprite facing)
  function benchSeat(h, c, r, n) {
    const d = decorSide(h, c, r), k = d < 0 ? 0 : d, push = d < 0 ? 0 : BACK_TO_WALL.bench;
    let ox = n ? 3.5 : -3.5, oy = 0.5; for (let i = 0; i < k; i++) [ox, oy] = [-oy, ox];
    const [dx, dy] = d < 0 ? [0, 0] : RH.DIRS[d];
    return { x: c * T + 8 + dx * push + ox, y: r * T + 8 + dy * push + oy, f: [0, 2, 1, 3][k], near: d === 2 || d === 3 };
  }
  function decorItem(h, c, r, kind, dry) {
    const x = c * T + 8, y = r * T + 8, d = decorSide(h, c, r);
    return { d: depth(x, y), draw: cx => {
      if (!DECOR_DRAW[kind]) return;
      if (d < 0) { DECOR_DRAW[kind](cx, x, y, dry); return; }
      const [dx, dy] = RH.DIRS[d], k = BACK_TO_WALL[kind] || 0, ox = x + dx * k, oy = y + dy * k;
      withRot(ox, oy, d, () => DECOR_DRAW[kind](cx, ox, oy, dry));
    } };
  }
  const DECOR_FOOT = { plant: [8, 8], bench: [14, 6], radiator: [14, 3], ext: [4, 4], drinks: [10, 8] };

  // ---------- floors ----------
  const C = A.C;
  let groundC = null;
  // the grounds (lawn, road, paths) and the open hospital floor in one image whose top-left is world (-GM, -GM)
  function ground() {
    if (groundC) return groundC;
    const GW = W * T + 2 * GM, GH = H * T + 2 * GM;
    const [c, x] = A.hcanvas(GW, GH);
    const g = (X, Y, w, h, col) => R(x, X + GM, Y + GM, w, h, col);
    const hs = (a, b) => A.hash(a, b);
    const q = 0.5;   // one real pixel at the remastered resolution
    // mown lawn: broad stripes in two greens, then thousands of blades and the odd daisy
    for (let X = -GM; X < W * T + GM; X += 24) g(X, -GM, 24, GH, ((X + GM) / 24) % 2 ? '#4aab3c' : '#3f9c33');
    for (let i = 0; i < 16000; i++) { const X = hs(i, 7) * GW - GM, Y = hs(i, 11) * GH - GM; g(Math.floor(X * 2) / 2, Math.floor(Y * 2) / 2, q, i % 4 ? 1 : 1.5, ['#358a2b', '#5cbd4c', '#2f7d27', '#66c656'][i % 4]); }
    for (let i = 0; i < 160; i++) { const X = Math.floor(hs(i, 91) * GW) - GM, Y = Math.floor(hs(i, 93) * GH) - GM; g(X, Y, q, q, '#ffffff'); g(X + q, Y, q, q, '#ffe36b'); }
    // paving slabs, each a slightly different stone with a bevelled edge
    const pave = (X, Y, w, h) => {
      g(X, Y, w, h, '#c4c1b8');
      for (let j = 0; j < h; j += 8) for (let i = -((j / 8) % 2) * 6; i < w; i += 12) {
        const x0 = Math.max(0, i), x1 = Math.min(w, i + 12), sw = x1 - x0, sh = Math.min(8, h - j); if (sw <= 0) continue;
        const v = hs(X + i, Y + j); g(X + x0, Y + j, sw, sh, v < 0.33 ? '#c9c6bd' : v < 0.66 ? '#c0bdb4' : '#c6c3b9');
        g(X + x0, Y + j, sw, q, '#d8d5cc'); g(X + x0, Y + j, q, sh, '#d2cfc6'); g(X + x0, Y + j + sh - q, sw, q, '#a7a49b'); g(X + x1 - q, Y + j, q, sh, '#aeaba2');
      }
      for (let i = 0; i < w * h / 10; i++) g(X + Math.floor(hs(i, X * 3 + Y) * w * 2) / 2, Y + Math.floor(hs(Y + i, X + 5) * h * 2) / 2, q, q, i % 2 ? '#b5b2a9' : '#d6d3ca');
    };
    // the road along the west side: speckled asphalt, white edge lines, a dashed centre line, a bevelled kerb
    g(-GM, -GM, 42, GH, '#66686d');
    for (let i = 0; i < 9000; i++) g(-GM + Math.floor(hs(i, 51) * 84) / 2, Math.floor(hs(i, 53) * GH * 2) / 2 - GM, q, q, ['#5a5c61', '#74767b', '#5f6166'][i % 3]);
    g(-GM + 2, -GM, 1, GH, '#e8e6de'); g(-GM + 39, -GM, 1, GH, '#e8e6de');
    for (let Y = -GM; Y < H * T + GM; Y += 18) { g(-GM + 20, Y, 2, 10, '#efe3a2'); g(-GM + 20, Y, q, 10, '#fff4c0'); }
    g(-GM + 42, -GM, 3, GH, '#dcd8cc'); g(-GM + 42, -GM, 3, q, '#ece9e0'); g(-GM + 42, -GM, q, GH, '#f0ede4'); g(-GM + 44.5, -GM, q, GH, '#9a978e');
    for (let Y = -GM + 40; Y < H * T + GM; Y += 90) { g(-GM + 37, Y, 4, 3, '#3e4045'); for (let k = 0; k < 4; k++) g(-GM + 37.5 + k, Y + q, q, 2, '#2a2c30'); }
    // a pavement round the building and a path from the road to the front doors
    pave(24, -8, W * T - 24 + 8, H * T + 16);
    pave(-GM + 46, 140, GM + 24 - 46 + 32, 56);
    // the car park: tarmac with white bay lines (cars nose-in towards the road) and a footpath beside it
    { const L = RH.LOT, X0 = -GM + 46, Y0 = L.y0 - 14, Y1 = L.y0 + L.n * 16 + 2;
      g(X0, Y0, L.walk - 6 - X0, Y1 - Y0, '#5f6166');
      for (let i = 0; i < 2600; i++) g(X0 + Math.floor(hs(i, 71) * (L.walk - 6 - X0) * 2) / 2, Y0 + Math.floor(hs(i, 73) * (Y1 - Y0) * 2) / 2, q, q, i % 2 ? '#55575c' : '#6a6c71');
      for (let i = 0; i <= L.n; i++) g(X0 + 2, L.y0 - 8 + i * 16, L.walk - 18 - X0, 0.8, '#ecebe4');
      g(X0, Y0, L.walk - 6 - X0, 1, '#dcd8cc'); g(L.walk - 7, Y0, 1, Y1 - Y0, '#dcd8cc');
      pave(L.walk - 6, 196, 30 - L.walk + 6, Y1 - 196); }
    // the forecourt where the building's front corner is cut away: big pale slabs with a darker border
    { const X = 24, Y = RH.NOTCH.y0 * T - 8, w = RH.NOTCH.x1 * T - 24 + 8, hh = H * T - RH.NOTCH.y0 * T + 16;
      g(X, Y, w, hh, '#cbc8c0'); for (let j = 0; j < hh; j += 16) for (let i = 0; i < w; i += 16) { const v = hs(i + X, j + Y); g(X + i, Y + j, 16, 16, v < 0.5 ? '#cfccc4' : '#c6c3bb'); g(X + i, Y + j, 16, q, '#dedbd3'); g(X + i, Y + j, q, 16, '#d8d5cd'); g(X + i, Y + j + 15.5, 16, q, '#aeaba2'); g(X + i + 15.5, Y + j, q, 16, '#b3b0a7'); } }
    // flower beds either side of the path
    for (const [X, Y] of [[-40, 114]]) {
      g(X, Y, 44, 18, '#6b4a2c'); g(X, Y, 44, 1, '#8a6440'); g(X, Y + 17, 44, 1, '#4a3220');
      for (let i = 0; i < 260; i++) g(X + Math.floor(hs(i, X + Y + 1) * 88) / 2, Y + 1 + Math.floor(hs(Y, i + 7) * 32) / 2, q, q, i % 2 ? '#5a3c22' : '#7c5634');
      for (let i = 0; i < 60; i++) {
        const fx = X + 2 + Math.floor(hs(i, X + Y) * 80) / 2, fy = Y + 3 + Math.floor(hs(Y, i + 3) * 24) / 2, col = ['#ff5a7a', '#ffd23f', '#f4f0e6', '#c86ad8', '#ff8a3a'][i % 5];
        g(fx, fy + 1, q, 1, '#2f7d27'); g(fx - q, fy, q, q, col); g(fx + q, fy, q, q, col); g(fx, fy - q, q, q, col); g(fx, fy + q, q, q, col); g(fx, fy, q, q, '#ffe36b');
      }
    }
    // the open hospital floor: Theme Hospital's grey tiles, bevelled, with a raised pale square on each
    for (let r = 0; r < H; r++) for (let col = 2; col < W; col++) {
      if (!RH.indoor(col, r)) continue;   // the forecourt
      const X = col * T, Y = r * T, lob = RH.inLobby(col, r), v = (hs(col, r) - 0.5) * 0.04;
      const base = shade(lob ? '#b2b8bd' : '#bcbbb5', v), inset = lob ? '#c9d0d6' : '#d3d2cc';
      g(X, Y, 16, 16, base);
      g(X, Y, 16, q, shade(base, 0.22)); g(X, Y, q, 16, shade(base, 0.16)); g(X, Y + 16 - q, 16, q, shade(base, -0.16)); g(X + 16 - q, Y, q, 16, shade(base, -0.12));
      g(X + 4, Y + 4, 8, 8, inset);
      g(X + 4, Y + 4, 8, q, shade(inset, 0.3)); g(X + 4, Y + 4, q, 8, shade(inset, 0.22)); g(X + 4, Y + 12 - q, 8, q, shade(inset, -0.14)); g(X + 12 - q, Y + 4, q, 8, shade(inset, -0.1));
      g(X + 5, Y + 5, 2, q, shade(inset, 0.4));
      for (let i = 0; i < 6; i++) g(X + Math.floor(hs(i + X, Y) * 30) / 2, Y + Math.floor(hs(Y + i, X) * 30) / 2, q, q, shade(base, i % 2 ? -0.08 : 0.08));
    }
    // a bristly doormat inside the front doors
    g(33, 146, 12, 44, '#5a5650'); g(33, 146, 12, q, '#77726a'); g(33, 189.5, 12, q, '#3e3b36');
    for (let j = 147; j < 189; j += 1) for (let i = 34; i < 44; i += 1) if (hs(i, j) < 0.5) g(i + (j % 2) * q, j, q, q, '#6e6a62');
    return (groundC = c);
  }
  const floorCache = {};
  function roomFloor(kind, w, h) {
    const key = kind + ':' + w + 'x' + h;
    if (floorCache[key]) return floorCache[key];
    const [c, x] = A.hcanvas(w * T, h * T);
    const st = A.ROOM_STYLE[kind];
    A.floor(x, 0, 0, w * T, h * T, st.floor[0], st.floor[1], st.floor[2]);
    R(x, 0, 0, w * T, 1, 'rgba(0,0,0,.18)'); R(x, 0, 0, 1, h * T, 'rgba(0,0,0,.18)');
    return (floorCache[key] = c);
  }

  // ---------- walls ----------
  const wallCache = {};
  // wallpaper strip w x h with cornice, baseboard and optional decal; `gap` = [u0, u1] door opening
  function wallImg(key, w, h, col, style, decal, gap) {
    if (wallCache[key]) return wallCache[key];
    const [c, x] = A.hcanvas(w, h);
    const q = 0.5;
    R(x, 0, 0, w, h, col);
    const d = shade(col, -0.1), l = shade(col, 0.12);
    if (style === 'stripe') for (let i = 0; i < w; i += 4) { R(x, i, 0, 1.5, h, d); R(x, i + 1.5, 0, q, h, shade(col, -0.16)); R(x, i + 2.5, 0, q, h, l); }
    else if (style === 'dots') for (let j = 4; j < h - 4; j += 3) for (let i = (j % 6 ? 1 : 2.5); i < w; i += 3) { R(x, i, j, 1, 1, l); R(x, i + q, j + q, q, q, d); }
    else if (style === 'tiles') {
      for (let j = 0; j < h; j += 4) for (let i = 0; i < w; i += 4) { R(x, i, j, 4, q, l); R(x, i, j, q, 4, l); R(x, i, j + 3.5, 4, q, d); R(x, i + 3.5, j, q, 4, d); }
    } else if (style === 'brick') {
      // individual bricks: each its own shade, a lit top edge, mortar between
      for (let j = 3, row = 0; j < h; j += 2, row++) for (let i = row % 2 ? -2 : 0; i < w; i += 4) {
        const b = shade(col, (A.hash(i + 31 * row, key.length + j) - 0.5) * 0.22);
        R(x, i, j, 4, 2, b); R(x, i, j, 4, q, shade(b, 0.18)); R(x, i + 3.5, j, q, 2, shade(col, -0.32)); R(x, i, j + 1.5, 4, q, shade(col, -0.32));
      }
    } else if (style === 'plaster') {
      for (let i = 0; i < w * h / 5; i++) R(x, Math.floor(A.hash(i, w) * w * 2) / 2, Math.floor(A.hash(h, i) * h * 2) / 2, q, q, i % 2 ? shade(col, -0.05) : shade(col, 0.05));
      // a dado rail and a skirting board
      R(x, 0, h - 11, w, 1, shade(col, 0.15)); R(x, 0, h - 10, w, q, shade(col, -0.2));
      R(x, 0, h - 10 + q, w, 6.5, shade(col, -0.04));
    }
    // the top of the wall seen from above: pale with a shadowed lip, like Theme Hospital's wall caps
    R(x, 0, 0, w, 2, '#ecebe6'); R(x, 0, 0, w, q, '#fbfaf6'); R(x, 0, 2, w, 1, '#a9a7a0'); R(x, 0, 3, w, q, shade(col, -0.25));
    if (h > 12) { R(x, 0, h - 3, w, 3, shade(col, -0.35)); R(x, 0, h - 3, w, q, shade(col, -0.05)); R(x, 0, h - 2.5, w, q, shade(col, -0.18)); }
    else { R(x, 0, h - 1, w, 1, shade(col, -0.35)); }
    if (decal && h > 12) decal(x, w, h);
    if (gap) {   // a doorway: open below the lintel, with a wooden frame round it
      const dh = Math.min(h, DOOR_H), top = h - dh;
      x.clearRect(gap[0], top, gap[1] - gap[0], dh);
      R(x, gap[0] - 1, top - 1, 1, dh + 1, '#5a3a22'); R(x, gap[1], top - 1, 1, dh + 1, '#5a3a22'); R(x, gap[0] - 1, top - 1, gap[1] - gap[0] + 2, 1, '#5a3a22');
      R(x, gap[0] - 1, top - 1, gap[1] - gap[0] + 2, 0.5, '#7a5232');
    }
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
  const EXT = '#c4875a';   // the building's outside: warm brick
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
      items.push({ d: (dsum(q0[0], q0[1]) + dsum(q1[0], q1[1])) / 2, draw: c => { const [u1, u2] = px(p0[0], p0[1]), [v1, v2] = px(p1[0], p1[1]), len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); ST(c, (v1 - u1) / len, (v2 - u2) / len, 0, 1, u1, u2 - h); c.drawImage(img, img.width * t0, 0, img.width * (t1 - t0), img.height, 0, 0, len, h); reset(c); } });
    }
    return items;
  }
  // wall colours by room type: white, green, yellow for imaging, blue for clinics
  const WALLCOL = { white: '#ece8de', green: '#a6cf9c', yellow: '#e9d27e', blue: '#98bfe3' };
  // an outside window seen from the corridor: white frame, the lawn beyond
  const lawnWin = (x, w, h) => {
    const q = 0.5;
    R(x, 2, 6, w - 4, 16, '#f4f4f0'); R(x, 2, 6, w - 4, q, '#ffffff'); R(x, w - 2.5, 6, q, 16, '#c9c7c0');
    R(x, 3, 7, w - 6, 14, '#3f9c33'); R(x, 3, 7, w - 6, 5, '#8fd0ee'); R(x, 3, 7, w - 6, 2, '#b8e2f4');
    R(x, 3, 11, w - 6, 1.5, '#2f7a2a'); for (let i = 3.5; i < w - 3; i += 1.5) R(x, i, 10 + (i % 3 ? q : 0), 1, 1.5, '#2a6e26');
    for (let i = 3.5; i < w - 3.5; i += 1) R(x, i, 15 + (i % 2), q, 1, i % 3 ? '#5cbd4c' : '#4aab3c');
    x.globalAlpha = 0.45; for (let k = 0; k < 6; k++) R(x, 4 + k * q, 8 + k, 1.5, q, '#ffffff'); x.globalAlpha = 1;
    R(x, w / 2 - 0.5, 7, 1, 14, '#f4f4f0'); R(x, 3, 14, w - 6, 1, '#f4f4f0'); R(x, w / 2 + 0.5, 7, q, 14, '#c9c7c0');
    R(x, 1, 22, w - 2, 2, '#e6e4dc'); R(x, 1, 22, w - 2, q, '#ffffff'); R(x, 1, 23.5, w - 2, q, '#a9a7a0');
  };
  // a window in the brick front, seen from outside: white frame, dark glass catching the sky
  const frontWin = (x, w, h) => {
    const q = 0.5, t = 4, b = h - 4;   // fits the wall's height
    R(x, 2, t, w - 4, b - t, '#f4f4f0'); R(x, 2, t, w - 4, q, '#ffffff');
    R(x, 3, t + 1, w - 6, b - t - 2, '#3e5c76'); R(x, 3, t + 1, w - 6, 2, '#86bcda'); R(x, 3, t + 3, w - 6, 0.8, '#5f88a6');
    x.globalAlpha = 0.5; for (let k = 0; k < Math.min(6, b - t - 3); k++) R(x, 4 + k * q, t + 2 + k, 1.5, q, '#ffffff'); x.globalAlpha = 1;
    R(x, w / 2 - 0.5, t + 1, 1, b - t - 2, '#f4f4f0'); R(x, 1, b, w - 2, 1.5, '#e6e4dc'); R(x, 1, b + 1.5, w - 2, q, '#8a6a52');
  };


  const winDecal = (x, w, h) => {
    const q = 0.5;
    R(x, 2, 6, w - 4, 14, '#6b5a44'); R(x, 2, 6, w - 4, q, '#8a7658'); R(x, 3, 7, w - 6, 12, '#9fd8ff'); R(x, 3, 7, w - 6, 4, '#c6eaff');
    x.globalAlpha = 0.5; for (let k = 0; k < 6; k++) R(x, 4 + k * q, 8 + k, 1.5, q, '#ffffff'); x.globalAlpha = 1;
    R(x, w / 2 - 0.5, 7, 1, 12, '#6b5a44'); R(x, 3, 12.5, w - 6, q, '#6b5a44'); R(x, 2, 20, w - 4, 2, '#f4f0e6'); R(x, 2, 21.5, w - 4, q, '#a9a090');
  };
  // a poster for each room type, cut out of its old wall decal
  const posterCache = {};
  function poster(kind) {
    if (posterCache[kind] !== undefined) return posterCache[kind];
    const fn = WALL_DECAL[kind]; if (!fn) return (posterCache[kind] = null);
    const [c, x] = A.canvas(64, 34); fn(x, 64, 34);
    const d = x.getImageData(0, 0, 64, 34).data; let x0 = 64, y0 = 34, x1 = -1, y1 = -1;
    for (let j = 0; j < 34; j++) for (let i = 0; i < 64; i++) if (d[(j * 64 + i) * 4 + 3] > 20) { x0 = Math.min(x0, i); y0 = Math.min(y0, j); x1 = Math.max(x1, i); y1 = Math.max(y1, j); }
    if (x1 < 0) return (posterCache[kind] = null);
    const w = Math.min(14, x1 - x0 + 1), h = y1 - y0 + 1, [pc, px2] = A.canvas(w, h);
    px2.drawImage(c, x0 + Math.max(0, (x1 - x0 + 1 - w) >> 1), y0, w, h, 0, 0, w, h);
    return (posterCache[kind] = pc);
  }
  // Every wall edge of the hospital, drawn from the side that faces away from the viewer (a tall back wall) when
  // that side is a room's, otherwise cut down low so it never hides a room's interior. Doors leave a frame.
  const edgeCache = new WeakMap();
  function hospitalWalls(h) {
    const key = h.lv + ':' + rot + ':' + flat;
    const hit = edgeCache.get(h); if (hit && hit.key === key) return hit.items;
    const Lr = RH.layout(h), items = [];
    const roomOf = (x, y) => (RH.indoor(x, y) ? Lr.room[RH.idx(x, y)] : x >= 0 && x < 2 && y >= 9 && y <= 11 ? 0 : -1);
    const farN = (nx, ny) => { const o = rw(0, 0), n = rw(nx, ny), n1 = n[0] - o[0], n2 = n[1] - o[1]; return Math.abs(n2) > Math.abs(n1) ? n2 > 0 : n1 > 0; };
    const posterEdges = new Set();
    for (const k in h.rooms) {
      const r = h.rooms[k]; if (!RH.walled(r)) continue;
      // a poster in the middle of whichever back wall is longest
      const rc = r.rect, cands = [[rc.x + (rc.w >> 1), rc.y, 0, 1, rc.w], [rc.x, rc.y + (rc.h >> 1), 3, 1, rc.h], [rc.x + (rc.w >> 1), rc.y + rc.h - 1, 2, 1, rc.w], [rc.x + rc.w - 1, rc.y + (rc.h >> 1), 1, 1, rc.h]];
      for (const [x, y, d] of cands) { const [dx, dy] = RH.DIRS[d]; if (farN(-dx, -dy) && !RH.isDoorEdge(r, x, y, d) && !r.wins.some(w => w[0] === x && w[1] === y && w[2] === d)) { posterEdges.add(x + ',' + y + ',' + d); break; } }
    }
    const winSet = new Set(); for (const k in h.rooms) for (const w of h.rooms[k].wins) if (RH.walled(h.rooms[k])) winSet.add(w.join(','));
    const edge = (x, y, d) => {   // the edge on side d of tile (x, y)
      const [dx, dy] = RH.DIRS[d], nx = x + dx, ny = y + dy;
      const ra = roomOf(x, y), rb = roomOf(nx, ny);
      if (ra === rb) return;
      if (ra === -1 && rb === -1) return;
      if (!RH.indoor(x, y) && !RH.indoor(nx, ny)) return;   // the path outside has no walls
      if (RH.inMap(x, y) && RH.inMap(nx, ny) && Lr.doors.has(RH.idx(x, y) < RH.idx(nx, ny) ? RH.idx(x, y) + ',' + RH.idx(nx, ny) : RH.idx(nx, ny) + ',' + RH.idx(x, y))) { doorFrame(x, y, d, ra > 0 ? h.rooms[ra] : h.rooms[rb], ra > 0 ? [-dx, -dy] : [dx, dy]); return; }
      // the two faces: one looking into (x, y), one looking into the neighbour
      const faceA = { room: ra, n: [-dx, -dy], tile: [x, y], d }, faceB = { room: rb, n: [dx, dy], tile: [nx, ny], d: (d + 2) & 3 };
      const far = farN(faceA.n[0], faceA.n[1]) ? faceA : faceB, near = far === faceA ? faceB : faceA;
      let face, tall;
      if (far.room > 0) { face = far; tall = true; }
      else if (near.room > 0) { face = near; tall = false; if (far.room === -1) face = Object.assign({}, near, { ext: true }); }
      else { face = far.room === 0 ? far : near; tall = face === far; face = Object.assign({}, face, { ext: true }); }
      const r = face.room > 0 ? h.rooms[face.room] : null;
      const ext = face.ext || !r;
      const col = ext ? (tall ? '#dcdad3' : EXT) : WALLCOL[RH.ROOMS[r.k].wall], style = ext ? (tall ? 'plaster' : 'brick') : A.ROOM_STYLE[r.k].wall[1];
      const isWin = !ext && winSet.has(face.tile.join(',') + ',' + face.d);
      const isPoster = !ext && tall && posterEdges.has(face.tile.join(',') + ',' + face.d);
      const extWin = ext && tall && ((x + y) & 1) === 0;
      const [ax, ay, bx, by] = d === 1 ? [(x + 1) * T, y * T, (x + 1) * T, (y + 1) * T] : d === 3 ? [x * T, y * T, x * T, (y + 1) * T] : d === 2 ? [x * T, (y + 1) * T, (x + 1) * T, (y + 1) * T] : [x * T, y * T, (x + 1) * T, y * T];
      const brickWin = ext && !tall && ((x + y) & 1) === 0;
      const deco = extWin ? lawnWin : brickWin ? frontWin : isWin ? winDecal : isPoster ? (c2, w, hh) => { const pc = poster(r.k); if (pc) c2.drawImage(pc, Math.round((w - pc.width) / 2), 5); } : null;
      const k2 = (ext ? 'X' : r.k) + (isWin || extWin || brickWin ? 'w' : isPoster ? 'p' : '');
      // front: the room this wall is a camera-side wall of (so it can turn see-through while that room is furnished)
      const front = near.room > 0 ? near.room : 0;
      for (const it of wallPiece(ax, ay, bx, by, face.n[0], face.n[1], k2 + (ext && !tall ? 'b' : ''), col, style, deco, tall, ext && !tall ? EXT_LOW : LOW_H)) { it.front = front; items.push(it); }
    };
    for (let y = -1; y <= H; y++) for (let x = 0; x <= W; x++) { edge(x, y, 1); edge(x, y, 2); }
    edgeCache.set(h, { key, items });
    return items;
    // a door stays a door: the room's wall with a panelled door set in it (taller than a cut-down front wall)
    function doorFrame(x, y, d, r, n) {
      const tall = farN(n[0], n[1]);
      const [ax, ay, bx, by] = d === 1 ? [(x + 1) * T, y * T, (x + 1) * T, (y + 1) * T] : d === 3 ? [x * T, y * T, x * T, (y + 1) * T] : d === 2 ? [x * T, (y + 1) * T, (x + 1) * T, (y + 1) * T] : [x * T, y * T, (x + 1) * T, y * T];
      // A wide doorway (the Ward's and Theatre's) is one opening: frame posts only at its two ends, and a pair of
      // wide leaves hinged at the outer ends that meet in the middle, like a real double door
      const span = r && r.door ? RH.doorTiles(r).map(([tx, ty]) => (d === 0 || d === 2 ? tx : ty)).sort((a, b) => a - b) : [];
      const i = span.indexOf(d === 0 || d === 2 ? x : y), last = span.length - 1, wide = span.length > 1 && i >= 0;
      const gap = wide ? [i === 0 ? 1 : 0, i === last ? 15 : 16] : [1, 15];
      const front = !tall && r ? r.id : 0, at = items.length;
      if (r) items.push(...wallPiece(ax, ay, bx, by, n[0], n[1], r.k + 'd' + gap.join('-'), WALLCOL[RH.ROOMS[r.k].wall], A.ROOM_STYLE[r.k].wall[1], null, tall, LOW_H, gap));
      if (!wide) items.push(swingDoor(ax, ay, bx, by, n, 14));
      else {
        const len = span.length * 8 - 1;   // each leaf covers half the opening
        if (i === 0) items.push(swingDoor(ax, ay, ax + (bx - ax) * span.length, ay + (by - ay) * span.length, n, len));
        if (i === last) items.push(swingDoor(bx, by, bx - (bx - ax) * span.length, by - (by - ay) * span.length, n, len));
      }
      for (let k = at; k < items.length; k++) items[k].front = front;
    }
  }
  // one 16px wall edge; `tall` back walls, low front walls
  function wallPiece(ax, ay, bx, by, nx, ny, key, col, style, deco, tall, low, gap) {
    const h = flat ? 4 : tall ? WALL_H : low;
    const img = wallImg(key + (flat ? 'F' : tall ? 'T' : 'L') + (gap ? 'g' : ''), 16, h, col, style, deco, gap && !flat ? gap : null);
    const [a1] = rw(ax, ay), [b1] = rw(bx, by), [, a2] = rw(ax, ay), [, b2] = rw(bx, by);
    const alongX = Math.abs(a2 - b2) < 0.5;
    const flip = alongX ? a1 > b1 : a2 > b2;
    const [sx, sy, ex, ey] = flip ? [bx, by, ax, ay] : [ax, ay, bx, by];
    const q0 = rw(sx, sy), q1 = rw(ex, ey);
    void nx; void ny;
    return [{ d: (dsum(q0[0], q0[1]) + dsum(q1[0], q1[1])) / 2, draw: c => { const [u1, u2] = px(sx, sy), [v1, v2] = px(ex, ey); ST(c, (v1 - u1) / 16, (v2 - u2) / 16, 0, 1, u1, u2 - h); c.drawImage(img, 0, 0, 16, h); reset(c); } }];
  }
  // ---------- building overlays (blueprints, door and window marks, placement previews) ----------
  function tileQuad(ctx, tx, ty, fill, stroke) {
    decal(ctx, tx * T, ty * T, c => { c.fillStyle = fill; c.fillRect(0, 0, T, T); if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.strokeRect(0.5, 0.5, T - 1, T - 1); } });
  }
  function rectOutline(ctx, rc, col, dash) {
    decal(ctx, rc.x * T, rc.y * T, c => { c.strokeStyle = col; c.lineWidth = 2; if (dash) c.setLineDash([4, 3]); c.strokeRect(1, 1, rc.w * T - 2, rc.h * T - 2); c.setLineDash([]); });
  }
  // Theme Hospital's blueprint walls: see-through blue panels round the room's outline with a post at every tile,
  // full height on every side so the room's size reads at a glance. skip: 'x,y,d' edges to leave open (the door).
  // returns depth-sorted scene items, so real walls and people overlap them correctly
  function ghostWalls(rc, alpha, skip) {
    const segs = [], hh = flat ? 3 : WALL_H, items = [];
    const edgeAt = (x, y, d) => (d === 0 ? [x * T, y * T, (x + 1) * T, y * T] : d === 2 ? [x * T, (y + 1) * T, (x + 1) * T, (y + 1) * T] : d === 3 ? [x * T, y * T, x * T, (y + 1) * T] : [(x + 1) * T, y * T, (x + 1) * T, (y + 1) * T]);
    for (let x = rc.x; x < rc.x + rc.w; x++) { segs.push([x, rc.y, 0]); segs.push([x, rc.y + rc.h - 1, 2]); }
    for (let y = rc.y; y < rc.y + rc.h; y++) { segs.push([rc.x, y, 3]); segs.push([rc.x + rc.w - 1, y, 1]); }
    const posts = new Map();
    for (const [x, y, d] of segs) {
      const e = edgeAt(x, y, d);
      for (const [wx, wy] of [[e[0], e[1]], [e[2], e[3]]]) posts.set(wx + ',' + wy, [wx, wy]);
      if (skip && skip.has(x + ',' + y + ',' + d)) continue;
      items.push({ d: (depth(e[0], e[1]) + depth(e[2], e[3])) / 2 + 0.1, draw: ctx => {
        const [u1, u2] = px(e[0], e[1]), [v1, v2] = px(e[2], e[3]);
        ctx.fillStyle = `rgba(110,165,255,${0.2 * alpha})`;
        ctx.beginPath(); ctx.moveTo(u1, u2); ctx.lineTo(v1, v2); ctx.lineTo(v1, v2 - hh); ctx.lineTo(u1, u2 - hh); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = `rgba(60,115,225,${0.9 * alpha})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(u1, u2 - hh); ctx.lineTo(v1, v2 - hh); ctx.stroke();
        ctx.strokeStyle = `rgba(60,115,225,${0.35 * alpha})`; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(u1, u2 - hh * 0.5); ctx.lineTo(v1, v2 - hh * 0.5); ctx.stroke();
      } });
    }
    for (const [wx, wy] of posts.values()) items.push({ d: depth(wx, wy) + 0.15, draw: ctx => {
      const [sx, sy] = px(wx, wy);
      ctx.fillStyle = `rgba(40,90,200,${0.85 * alpha})`; ctx.fillRect(sx - 1, sy - hh, 2, hh);
      ctx.fillStyle = `rgba(190,215,255,${0.95 * alpha})`; ctx.fillRect(sx - 0.5, sy - hh, 0.5, hh);
      ctx.fillStyle = `rgba(40,90,200,${0.9 * alpha})`; ctx.fillRect(sx - 1.5, sy - hh - 1, 3, 1.5);
    } });
    return items;
  }
  // door and window previews: real joinery standing on the edge on side d of tile (x, y), as depth-sorted items.
  // state: 'set' (placed), 'ok' (a good spot under the pointer, green glow), 'bad' (can't go there, red)
  const joinCache = {};
  function joinImg(kind, state) {
    const key = kind + state; if (joinCache[key]) return joinCache[key];
    const door = kind === 'door', w = 16, h = door ? 26 : 15, [c, x] = A.hcanvas(w, h), q = 0.5;
    if (door) {
      R(x, 1, 0, 14, h, '#5a3a22'); R(x, 1, 0, 14, q, '#7a5232');                       // frame
      R(x, 2.5, 1.5, 11, h - 1.5, '#b07a4a'); R(x, 2.5, 1.5, 11, q, '#c8925e'); R(x, 2.5, 1.5, q, h - 1.5, '#c38a56');
      for (const [py, ph] of [[3, 8], [13, 10]]) { R(x, 4, py, 8, ph, '#9a6438'); R(x, 4, py, 8, q, '#7e5028'); R(x, 4, py + ph - q, 8, q, '#c8925e'); R(x, 4, py, q, ph, '#7e5028'); }
      R(x, 4.5, 3.5, 7, 4, '#9fd8ff'); R(x, 4.5, 3.5, 7, 1, '#c6eaff');                    // a little glass light
      R(x, 11, 14, 1.5, 1, '#ffd23f'); R(x, 11, 14.5, 1.5, q, '#b8901c');                  // handle
      R(x, 2.5, h - 1, 11, 1, '#3a2414');
    } else {
      R(x, 0.5, 0, 15, h - 2, '#f4f4f0'); R(x, 0.5, 0, 15, q, '#ffffff'); R(x, 15, 0, q, h - 2, '#c9c7c0');
      R(x, 2, 1.5, 12, h - 5, '#8fd0ee'); R(x, 2, 1.5, 12, 3, '#c6eaff');
      x.globalAlpha = 0.55; for (let k = 0; k < 5; k++) R(x, 3 + k * q, 2.5 + k, 2, q, '#ffffff'); x.globalAlpha = 1;
      R(x, 7.5, 1.5, 1, h - 5, '#f4f4f0'); R(x, 2, 6, 12, 1, '#f4f4f0');
      R(x, 0, h - 2, 16, 2, '#e6e4dc'); R(x, 0, h - 2, 16, q, '#ffffff'); R(x, 0, h - q, 16, q, '#a9a7a0');   // sill
    }
    if (state !== 'set') { x.globalCompositeOperation = 'source-atop'; x.fillStyle = state === 'ok' ? 'rgba(80,220,110,.35)' : 'rgba(255,70,60,.5)'; x.fillRect(0, 0, w, h); x.globalCompositeOperation = 'source-over'; }
    return (joinCache[key] = c);
  }
  function joinItem(x, y, d, kind, state) {
    const img = joinImg(kind, state), h = img.lh, lift = kind === 'door' ? 0 : 9;
    const [ax, ay, bx, by] = d === 1 ? [(x + 1) * T, y * T, (x + 1) * T, (y + 1) * T] : d === 3 ? [x * T, y * T, x * T, (y + 1) * T] : d === 2 ? [x * T, (y + 1) * T, (x + 1) * T, (y + 1) * T] : [x * T, y * T, (x + 1) * T, y * T];
    const [a1, a2] = rw(ax, ay), [b1, b2] = rw(bx, by), alongX = Math.abs(a2 - b2) < 0.5, flip = alongX ? a1 > b1 : a2 > b2;
    const [sx, sy, ex, ey] = flip ? [bx, by, ax, ay] : [ax, ay, bx, by];
    return { d: (depth(ax, ay) + depth(bx, by)) / 2 + 0.2, draw: c => {
      const [u1, u2] = px(sx, sy), [v1, v2] = px(ex, ey), hh = flat ? 3 : h, up = flat ? 0 : lift;
      if (state === 'ok' && !flat) { c.save(); c.shadowColor = 'rgba(110,255,140,.9)'; c.shadowBlur = 4; }
      ST(c, (v1 - u1) / 16, (v2 - u2) / 16, 0, 1, u1, u2 - hh - up); c.drawImage(img, 0, 0, 16, hh); reset(c);
      if (state === 'ok' && !flat) c.restore();
    } };
  }
  // a room door that swings open into the room while anyone is in the doorway, and closes behind them
  const DOOR_H = 26, doorOpen = new Map();
  const leafCache = {};
  function leafImg(w) {
    if (leafCache[w]) return leafCache[w];
    const [c, x] = A.hcanvas(w, DOOR_H - 1), h = DOOR_H - 1, q = 0.5;
    R(x, 0, 0, w, h, '#b07a4a'); R(x, 0, 0, w, q, '#c8925e'); R(x, 0, 0, q, h, '#c38a56'); R(x, w - q, 0, q, h, '#7e5028');
    for (const [py, ph] of [[2, 8], [12, 10]]) { R(x, 1.5, py, w - 3, ph, '#9a6438'); R(x, 1.5, py, w - 3, q, '#7e5028'); R(x, 1.5, py + ph - q, w - 3, q, '#c8925e'); R(x, 1.5, py, q, ph, '#7e5028'); }
    R(x, 2, 2.5, w - 4, 4, '#9fd8ff'); R(x, 2, 2.5, w - 4, 1, '#c6eaff');
    if (w > 16) { R(x, w - 3, 11, 1.5, 6, '#c8ccd4'); R(x, w - 3, 11, 0.5, 6, '#ffffff'); R(x, 2, h - 3, w - 4, 1.5, '#c8ccd4'); }   // a push plate and kick plate on swing doors
    else { R(x, w - 3.5, 13, 1.5, 1, '#ffd23f'); R(x, w - 3.5, 13.5, 1.5, q, '#b8901c'); }
    return (leafCache[w] = c);
  }
  // a leaf of length L hinged near (ax, ay), lying along the edge towards (bx, by) when shut
  function swingDoor(ax, ay, bx, by, n, L) {
    const dl = Math.hypot(bx - ax, by - ay), key = ax + ',' + ay + ',' + bx + ',' + by, ex = (bx - ax) / dl, ey = (by - ay) / dl, mx = ax + ex * L / 2, my = ay + ey * L / 2;
    const hx = ax + ex, hy = ay + ey;   // the hinge, just inside the frame
    const tipAt = a => [hx + (Math.cos(a) * ex + Math.sin(a) * n[0]) * L, hy + (Math.cos(a) * ey + Math.sin(a) * n[1]) * L];
    const open = () => doorOpen.get(key) || 0;
    return { get d() { const [tx, ty] = tipAt(open() * 1.45); return depth((hx + tx) / 2, (hy + ty) / 2) + 0.4; }, draw: c => {
      const want = near(mx + n[0] * 4, my + n[1] * 4, 6 + L / 2, 6 + L / 2) ? 1 : 0;
      let o = open(); o += (want - o) * Math.min(1, frameDt * (want ? 9 : 4)); doorOpen.set(key, o);
      const [tx, ty] = tipAt(o * 1.45), hh = flat ? 3 : DOOR_H - 1;
      // a solid leaf: two faces 1.4 apart joined by its top and end edges; the face nearer the camera drawn last
      const th = 1.4 * Math.min(1, o * 4), lx = (tx - hx) / L, ly = (ty - hy) / L, kx = -ly * th, ky = lx * th;
      const P = (x, y, up) => { const [a, b] = px(x, y); return [a, b - up]; };
      const quad = (pts, col) => { c.fillStyle = col; c.beginPath(); c.moveTo(...pts[0]); for (const q of pts.slice(1)) c.lineTo(...q); c.closePath(); c.fill(); c.strokeStyle = 'rgba(27,23,32,.55)'; c.lineWidth = 0.5; c.stroke(); };
      const face = (ox, oy, img) => {
        const [u1, u2] = px(hx + ox, hy + oy), [v1, v2] = px(tx + ox, ty + oy);
        if (img) { ST(c, (v1 - u1) / L, (v2 - u2) / L, 0, 1, u1, u2 - hh); c.drawImage(leafImg(L), 0, 0, L, hh); reset(c); }
        else quad([P(hx + ox, hy + oy, 0), P(tx + ox, ty + oy, 0), P(tx + ox, ty + oy, hh), P(hx + ox, hy + oy, hh)], '#8a5a34');
      };
      // the leaf lies in the wall's plane when shut, and only shows its thickness (centred on the hinge line) as it opens
      const nearFirst = depth((hx + tx) / 2 + kx, (hy + ty) / 2 + ky) > depth((hx + tx) / 2, (hy + ty) / 2);
      const [fo, no] = nearFirst ? [[-kx / 2, -ky / 2], [kx / 2, ky / 2]] : [[kx / 2, ky / 2], [-kx / 2, -ky / 2]];
      if (th < 0.05) { face(0, 0, true); return; }
      face(fo[0], fo[1], false);
      if (!flat) {
        const [ax2, ay2] = [-kx / 2, -ky / 2], [bx2, by2] = [kx / 2, ky / 2];
        quad([P(tx + ax2, ty + ay2, 0), P(tx + bx2, ty + by2, 0), P(tx + bx2, ty + by2, hh), P(tx + ax2, ty + ay2, hh)], '#7e5028');   // the end edge
        quad([P(hx + ax2, hy + ay2, hh), P(tx + ax2, ty + ay2, hh), P(tx + bx2, ty + by2, hh), P(hx + bx2, hy + by2, hh)], '#d2a06a');   // the top edge
      }
      face(no[0], no[1], true);
    } };
  }
  // a mark on the edge on side d of tile (x, y): a coloured bar standing on the floor
  function edgeMark(ctx, x, y, d, col, hgt) {
    const [ax, ay, bx, by] = d === 1 ? [(x + 1) * T, y * T, (x + 1) * T, (y + 1) * T] : d === 3 ? [x * T, y * T, x * T, (y + 1) * T] : d === 2 ? [x * T, (y + 1) * T, (x + 1) * T, (y + 1) * T] : [x * T, y * T, (x + 1) * T, y * T];
    const [u1, u2] = px(ax, ay), [v1, v2] = px(bx, by), hh = flat ? 3 : hgt || 14;
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(u1, u2); ctx.lineTo(v1, v2); ctx.lineTo(v1, v2 - hh); ctx.lineTo(u1, u2 - hh); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(27,23,32,.6)'; ctx.lineWidth = 1; ctx.stroke();
  }
  // the front doors: a green frame with fixed side panes, and two glass leaves that slide apart when anyone comes near
  let doorsC = null, slideOpen = 0, slideDrawn = -1;
  function doorsImg() {
    const want = near(32, 168, 30, 30) ? 1 : 0;
    slideOpen += (want - slideOpen) * Math.min(1, frameDt * (want ? 7 : 3));
    if (doorsC && Math.abs(slideOpen - slideDrawn) < 0.01) return doorsC;
    if (!doorsC) doorsC = A.hcanvas(48, WALL_H)[0];
    const x = doorsC.getContext('2d'); x.clearRect(0, 0, 48, WALL_H); slideDrawn = slideOpen;
    const G = '#2f8a3e', GL = '#5cc06a', glass = 'rgba(150,215,240,.5)';
    for (const [u, w] of [[0, 13], [35, 13]]) { R(x, u, 7, w, WALL_H - 7, glass); R(x, u + 2, 9, 2, 10, 'rgba(255,255,255,.55)'); R(x, u, 7, 2, WALL_H - 7, G); R(x, u + w - 2, 7, 2, WALL_H - 7, G); R(x, u + 1, 7, 1, WALL_H - 7, GL); R(x, u, WALL_H - 3, w, 3, G); }
    const shift = 10 * (slideOpen < 0.001 ? 0 : slideOpen);
    for (const [u, dir] of [[13, -1], [24, 1]]) {   // the sliding leaves
      const L = u + dir * shift;
      R(x, L, 8, 11, WALL_H - 9, 'rgba(170,225,245,.55)'); R(x, L, 8, 1, WALL_H - 9, G); R(x, L + 10, 8, 1, WALL_H - 9, G); R(x, L, WALL_H - 2, 11, 1, G);
      R(x, L + 2, 10, 1.5, 8, 'rgba(255,255,255,.6)'); R(x, L + (dir < 0 ? 9 : 1), 18, 1, 3, '#c9a43a');
    }
    R(x, 0, 0, 48, 7, G); R(x, 0, 0, 48, 1, GL); R(x, 3, 2, 42, 3, '#f4f4f0'); R(x, 22, 2, 4, 3, '#e8533f'); R(x, 23, 1, 2, 5, '#e8533f');
    R(x, 0, 6.5, 48, 1, '#24703a');   // the track the leaves run in
    return doorsC;
  }
  function doorItems() {
    const items = [];
    for (let i = 0; i < 3; i++) {
      const y0 = 144 + i * 16, y1 = y0 + 16;
      items.push({ d: (depth(32, y0) + depth(32, y1)) / 2 + 0.2, draw: c => {
        const img = doorsImg(), h = flat ? 4 : WALL_H, [u1, u2] = px(32, y0), [v1, v2] = px(32, y1);
        ST(c, (v1 - u1) / 16, (v2 - u2) / 16, 0, 1, u1, u2 - h); const k = img.width / 48; c.drawImage(img, i * 16 * k, (flat ? WALL_H - 4 : 0) * k, 16 * k, h * k, 0, 0, 16, h); reset(c);
      } });
    }
    return items;
  }
  // outside: the road with an ambulance, trees, lamps, hedges, the sign, and the front doors
  let outsideCache = null;
  function outside() {
    if (outsideCache && outsideCache.key === rot + ':' + flat) return outsideCache.items.slice();
    const items = doorItems();
    const bx = (x, y, w, d, h, col, faces) => ({ d: depthBox(x, y, w, d), draw: c => box(c, x, y, w, d, h, col, faces) });
    const sprite = (name, x, y, sh, sway) => ({ d: depth(x, y), draw: c => {
      if (sh) shadow(c, x, y, sh);
      if (!sway || flat) { bill(c, A.furniture(name), x, y); return; }
      // trees lean gently in the breeze, rooted at their base
      const [sx, sy] = px(x, y), k = Math.sin(now * 1.1 + x * 0.07) * 0.035 + Math.sin(now * 2.3 + y * 0.05) * 0.012;
      c.save(); c.translate(sx, sy); c.transform(1, 0, -k, 1, 0, 0); c.translate(-sx, -sy); bill(c, A.furniture(name), x, y); c.restore();
    } });
    // the ambulance parked on the road
    items.push(bx(-86, 30, 13, 28, 14, '#f4f4f0', { east: (ctx, d, h) => { R(ctx, 0, 7, d, 3, '#e8533f'); R(ctx, 2, 1, 6, 4, '#9fd8ff'); R(ctx, 12, 1, 5, 4, '#9fd8ff'); R(ctx, 19, 1, 7, 4, '#9fd8ff'); R(ctx, 13, 7, 2, 3, '#f4f4f0'); R(ctx, 12, 8, 4, 1, '#f4f4f0'); R(ctx, 3, h - 2, 4, 2, '#2b2e3a'); R(ctx, 20, h - 2, 4, 2, '#2b2e3a'); }, south: (ctx, w, h) => { R(ctx, 1, 1, w - 2, 5, '#9fd8ff'); R(ctx, 1, 9, 2, 2, '#ffd23f'); R(ctx, w - 3, 9, 2, 2, '#ffd23f'); R(ctx, 0, 7, w, 1, '#e8533f'); }, top: ctx => { const on = Math.floor(now * 3) % 2; R(ctx, 3, 4, 7, 3, on ? '#7fb2ff' : '#2a5aa6'); R(ctx, 3, 20, 7, 3, on ? '#a8202a' : '#ff6a5a'); } }));
    // trees round the grounds (none on the road, the path or the pavement)
    const trees = [[-30, -40], [60, -60], [170, -50], [290, -66], [400, -48], [500, -62], [570, -20], [580, 90], [566, 200], [584, 320], [570, 440], [500, 470], [380, 480], [250, 466], [130, 482], [20, 468], [-30, 230], [-24, 330], [-34, 410], [-20, 10]];
    for (const [x, y] of trees) items.push(sprite('bigtree', x, y, 11));
    // street lamps along the road and the path
    for (const [x, y] of [[-46, 136], [-46, -20], [-46, 60], [-2, 108], [-2, 206], [-2, 290], [-2, 356], [40, 250], [136, 250], [40, 404], [136, 404]]) items.push(sprite('streetlamp', x, y, 3));
    // the forecourt: trees in round planters
    for (const [x, y] of [[88, 290], [88, 370]]) { items.push({ d: depth(x, y) - 1, draw: c => { cyl(c, x, y, 7, 4, '#9a978e'); cyl(c, x, y, 6, 0.5, '#5a3c22', 4); } }); items.push(sprite('bigtree', x, y + 1, 0)); }
    // clipped hedges beside the flower beds
    for (const [x, y] of [[-42, 110]]) items.push(bx(x, y, 48, 4, 7, '#2f7a2a', { top: ctx => { for (let i = 0; i < 48; i += 3) R(ctx, i, 1, 2, 2, '#4aab3c'); }, south: (ctx, w, h) => { for (let i = 1; i < w; i += 4) R(ctx, i, 2, 2, 2, '#3f9c33'); } }));
    for (const [x, y] of [[-10, 20], [-30, 380], [-10, 400]]) items.push(sprite('bush', x, y));
    items.push(sprite('sign', -14, 134));
    outsideCache = { key: rot + ':' + flat, items };
    return items.slice();
  }
  // soft cloud shadows drifting across the lawns and the road
  function clouds(ctx) {
    if (flat) return;
    ctx.save();
    const [a1, a2] = px(-GM, -GM), [b1, b2] = px(W * T + GM, -GM), [c1, c2] = px(W * T + GM, H * T + GM), [d1, d2] = px(-GM, H * T + GM);
    const [e1, e2] = px(24, -8), [f1, f2] = px(W * T + 8, -8), [g1, g2] = px(W * T + 8, H * T + 8), [h1, h2] = px(24, H * T + 8);
    ctx.beginPath(); ctx.moveTo(a1, a2); ctx.lineTo(b1, b2); ctx.lineTo(c1, c2); ctx.lineTo(d1, d2); ctx.closePath();
    ctx.moveTo(e1, e2); ctx.lineTo(h1, h2); ctx.lineTo(g1, g2); ctx.lineTo(f1, f2); ctx.closePath(); ctx.clip('evenodd');
    const span = W * T + 2 * GM + 240;
    for (let i = 0; i < 4; i++) {
      const cx = -GM - 120 + ((now * (6 + i * 1.5) + i * 260) % span), cy = -GM + 60 + ((i * 197) % (H * T + GM));
      decal(ctx, cx, cy, d => { d.fillStyle = 'rgba(20,40,30,.09)'; for (const [ox, oy, rx, ry] of [[0, 0, 60, 34], [40, 12, 44, 26], [-38, 10, 40, 22]]) { d.beginPath(); d.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2); d.fill(); } });
    }
    ctx.restore();
  }
  // the reception desk once it has been bought, or a dashed outline where it goes
  // The reception desk greets patients coming in: a blue counter across the lobby, its raised ledge and name board
  // facing the front doors (west), and the receptionist's side (east) with the monitor turned to them, a keyboard,
  // papers, a plant and their office chair. Returns two items: the chair goes behind the receptionist.
  // The reception desk at the far (north) end of the entrance hall: the counter runs along the hall with its raised
  // ledge and name board towards the patients (east); the receptionist sits on the wall side (west), her back to
  // the front wall and the camera, the monitor turned to her. Returns two items: her chair is behind her.
  function deskItem(bought, t) {
    const X = 46, Y = 48;   // the counter's footprint: 14 x 28
    if (!bought) return [{ d: depth(X + 7, Y + 14) - 40, draw: c => decal(c, X, Y, ctx => { ctx.globalAlpha = 0.5 + Math.sin(t * 3) * 0.2; ctx.setLineDash([3, 2]); ctx.strokeStyle = '#3a5a8a'; ctx.lineWidth = 1.5; ctx.strokeRect(0.5, 0.5, 13, 27); ctx.setLineDash([]); ctx.globalAlpha = 1; }) }];
    const BLUE = '#4a72b0', TOP = '#e6e2d6';
    const desk = { d: depthBox(X, Y, 14, 28), draw: c => {
      box(c, X, Y, 14, 28, 11, BLUE, {
        east: (ctx, w, h) => { R(ctx, 0, h - 2, w, 2, '#2b3f66'); for (let u = 9.5; u < w; u += 9.5) R(ctx, u, 1, 0.5, h - 3, '#3a5a90'); R(ctx, w / 2 - 7, 3, 14, 4, '#f4f4f0'); R(ctx, w / 2 - 0.75, 3.75, 1.5, 2.5, '#e8533f'); R(ctx, w / 2 - 1.75, 4.25, 3.5, 1.5, '#e8533f'); },
        south: (ctx, w, h) => { R(ctx, 0, h - 2, w, 2, '#2b3f66'); R(ctx, 1, 1, w - 2, 0.5, '#6f94cc'); },
        west: (ctx, w, h) => { R(ctx, 0, h - 2, w, 2, '#2b3f66'); for (let u = 4; u < w - 4; u += 8) { R(ctx, u, 2, 6, h - 5, '#3d639e'); R(ctx, u + 2.5, 4, 1, 0.5, '#d9e4f4'); } },
        top: ctx => { R(ctx, 0, 0, 10, 28, TOP); R(ctx, 0, 0, 10, 0.5, '#f8f6ee'); },
      });
      rbox(c, X + 9.5, Y, 4.5, 28, 3, TOP, 0.8, 11);                                                              // the raised ledge on the patients' side
      box(c, X + 11, Y + 18, 2, 5, 1, '#e8533f', { top: ctx => { R(ctx, 0.3, 0.3, 1.4, 4.4, '#f2ecdc'); } }, 14);   // the guest book
      cyl(c, X + 5.5, Y + 9, 1.6, 0.8, '#3a3d44', 11); tube(c, X + 5.5, Y + 9, 2.5, '#5c6068', 11);              // the monitor's foot
      rbox(c, X + 4, Y + 5, 2, 8, 8, '#d9d4c7', 0.7, 13);
      box(c, X + 3.6, Y + 5.6, 0.6, 6.8, 6.5, '#1d2a3a', { west: (ctx, w, h) => { const f = Math.floor(now * 2) % 3; R(ctx, 1, 1, w / 2, 1, '#6fd3ff'); R(ctx, 1, 3, w - 2 - f, 0.5, '#7ee081'); R(ctx, 1, 4.5, w - 3 + f, 0.5, '#7ee081'); } }, 14);
      rbox(c, X + 1, Y + 6, 2, 6, 0.6, '#d9d4c7', 0.5, 11);                                                        // the keyboard
      rbox(c, X + 2, Y + 18, 5, 6, 1.5, '#5a5f6e', 1, 11, ctx => { ctx.fillStyle = '#f4f0e6'; ctx.fillRect(0.6, 0.6, 3.8, 4.8); });   // a tray of papers
      cyl(c, X + 4, Y + 25, 1.8, 3, '#b5643c', 11);
      const [sx, sy] = px(X + 4, Y + 25); for (const [ox, oy, r2, col] of [[0, -18, 3, '#2e6b3a'], [-2, -19, 2, '#3a8a48'], [2, -20, 2, '#4aa45a']]) { c.fillStyle = col; c.beginPath(); c.ellipse(sx + ox, sy + oy, r2, r2 * 0.8, 0, 0, Math.PI * 2); c.fill(); }
    } };
    // her chair: behind her, on the wall side, so it's drawn just after her
    const [dx, dy] = RH.DESK_STAFF;
    const chair = { d: depth(dx, dy) + 0.3, draw: c => withRot(dx, dy, 1, () => officeChair(c, dx - 4, dy - 2)) };
    return [desk, chair];
  }
  // a car of the car park: driving in off the road into its bay, stopped, or pulling out and driving away
  const CAR_COLS = ['#d0352a', '#3c7bd6', '#f2c230', '#39a85a', '#e6e2d6', '#5c6068'];
  function carPos(car) {
    const L = RH.LOT, [bx, by] = RH.bayPos(car.bay), road = -75;
    if (car.ph === 'stop') return [bx, by, 0];
    if (car.ph === 'in') {   // down the road, then turn in
      const k = 1 - Math.max(0, car.t) / RH.CAR_IN;
      if (k < 0.6) { const u = k / 0.6; return [road, by - 120 * (1 - u), 1]; }
      const u = (k - 0.6) / 0.4, e = 1 - (1 - u) * (1 - u); return [road + (bx - road) * e, by, 0];
    }
    const k = 1 - Math.max(0, car.t) / RH.CAR_OUT;   // back out, then off down the road
    if (k < 0.35) { const u = k / 0.35; return [bx + (road - bx) * u * u, by, 0]; }
    const u = (k - 0.35) / 0.65; return [road, by + 140 * u * u, 1];
  }
  function carItem(car) {
    const [x, y, along] = carPos(car), col = CAR_COLS[car.col % CAR_COLS.length];
    return { d: depth(x, y), draw: c => withRot(x, y, along ? 3 : 2, () => {   // nose south on the road, nose in (east) in the bay
      for (const [wx, wy] of [[-6, -4.2], [6, -4.2], [-6, 4.2], [6, 4.2]]) cyl(c, x + wx, y + wy, 1.5, 3, '#1b1720');
      rbox(c, x - 10, y - 4.5, 20, 9, 3, col, 2.5, 1.5);                                                      // the body
      rbox(c, x - 5.5, y - 4, 10, 8, 4, '#9fc4e0', 2.2, 4.5, ctx => { ctx.fillStyle = shade(col, -0.05); ctx.fillRect(1.5, 1, 7, 6); });   // cabin and roof
      rbox(c, x - 10, y - 4.5, 4, 9, 0.6, '#f4f0c8', 1, 3.6);                                                 // headlights
    }) };
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
  window.HI = { frame, clouds, decorItem, benchSeat, carItem, lyingItem, LIE, GM, K, KX, KY, OX, OY, BW, BH, WALL_H, LOW_H, setRot, getRot, setFlat, getFlat, extent, rw, px, depth, unproj, facing, floorAt, wallSeg, bill, shadow, decal, box, ground, roomFloor, hospitalWalls, tileQuad, rectOutline, edgeMark, ghostWalls, joinItem, outside, deskItem, messItem, ratItem, objItem, wreckItems, DECOR_DRAW, DECOR_FOOT };
})();
