// Kitchen Rush: every sprite is drawn in code at startup (no image files).
// Art is authored at A=2 pixels per world unit: tiles are 32x32, chefs 32x48, food 24x24.
// Rendering draws world units under a scale(A) transform, so positions stay in rules.js units.
(function () {
  'use strict';
  const OUT = '#1b1720';
  const A = 2, T = 16, TA = T * A;          // world tile, art tile
  const OY = 24, MX = 6, MB = 6;            // back wall height, side margin, bottom margin (world units)

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return [c, x]; }
  function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(h, amt) {
    const [r, g, b] = hex2rgb(h);
    const f = v => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    return '#' + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function outline(c, col = OUT) {
    const x = c.getContext('2d'), w = c.width, h = c.height;
    const d = x.getImageData(0, 0, w, h), a = d.data, src = new Uint8ClampedArray(a);
    const [r, g, b] = hex2rgb(col);
    const op = (i, j) => i >= 0 && j >= 0 && i < w && j < h && src[(j * w + i) * 4 + 3] > 40;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      if (src[k + 3] > 40) continue;
      if (op(i - 1, j) || op(i + 1, j) || op(i, j - 1) || op(i, j + 1)) { a[k] = r; a[k + 1] = g; a[k + 2] = b; a[k + 3] = 255; }
    }
    x.putImageData(d, 0, 0);
    return c;
  }
  function flipH(c) { const [o, x] = canvas(c.width, c.height); x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(c, 0, 0); return o; }
  function hash(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  const rect = (x, X, Y, w, h, col) => { x.fillStyle = col; x.fillRect(X, Y, w, h); };
  // bevelled box: light top/left edge, dark bottom/right edge
  function bevel(x, X, Y, w, h, col, k) {
    k = k || 0.2;
    rect(x, X, Y, w, h, col); rect(x, X, Y, w, 1, shade(col, k * 1.4)); rect(x, X, Y, 1, h, shade(col, k)); rect(x, X, Y + h - 1, w, 1, shade(col, -k * 1.6)); rect(x, X + w - 1, Y, 1, h, shade(col, -k));
  }
  // shaded ellipse: rim darker on the lower right, specular highlight top left
  function blob(x, cx, cy, rx, ry, col, o) {
    o = o || {};
    const dark = o.dark || shade(col, -0.32), dark2 = o.dark2 || shade(col, -0.5), light = o.light || shade(col, 0.35), spec = o.spec || shade(col, 0.65);
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx), y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const u = (i + 0.5 - cx) / rx, v = (j + 0.5 - cy) / ry, d = u * u + v * v;
      if (d > 1) continue;
      let c = col;
      if (!o.flat) {
        if (d > 0.8 && u + v > 0.3) c = dark2;
        else if (d > 0.5 && u + v > 0.1) c = dark;
        else if (d < 0.45 && d > 0.08 && u < -0.05 && v < -0.05) c = light;
        if (o.spec !== false && d < 0.3 && d > 0.12 && u < -0.15 && v < -0.2 && u + v < -0.6) c = spec;
      }
      x.fillStyle = c; x.fillRect(i, j, 1, 1);
    }
  }
  function ring(x, cx, cy, r, w, col) {
    for (let j = Math.floor(cy - r) - 1; j <= cy + r + 1; j++) for (let i = Math.floor(cx - r) - 1; i <= cx + r + 1; i++) {
      const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy);
      if (d <= r && d > r - w) { x.fillStyle = col; x.fillRect(i, j, 1, 1); }
    }
  }
  function speckle(x, X, Y, w, h, col, n, seed) { for (let i = 0; i < n; i++) { const a = hash(seed * 31 + i, seed + i * 7), b = hash(seed + i * 13, seed * 17 + i); rect(x, X + Math.floor(a * w), Y + Math.floor(b * h), 1, 1, col); } }

  // ======================= CHEFS (32x48) =======================
  // Two characters; the apron/neckerchief colour comes from the player's role (host red, guest teal).
  const LOOKS = {
    max: { name: 'Max', skin: '#d9a97c', hair: '#4a3222', brow: '#3a2619', beard: '#4a3222', beardL: '#5c4130' },
    mia: { name: 'Mia', skin: '#e2b48e', hair: '#5a3a26', brow: '#4a2f1e', female: true, lips: '#c4505e', gold: '#e8b23a', tie: '#3a7bd5' },
  };
  const LOOK_IDS = ['max', 'mia'];
  const ROLE = [{ apron: '#e0503c', scarf: '#c43c2c' }, { apron: '#1f8f87', scarf: '#2bb5a8' }];
  function drawChef(L, RC, dir, f, hold) {
    const [c, x] = canvas(32, 48);
    const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
    const WH = '#f6f5f1', WD = '#d3d1cb', WD2 = '#b9b6ae', WL = '#ffffff';
    const AP = RC.apron, APD = shade(RC.apron, -0.3), APD2 = shade(RC.apron, -0.5), APL = shade(RC.apron, 0.2), SC = RC.scarf;
    const SK = L.skin, SKD = shade(L.skin, -0.18), SKD2 = shade(L.skin, -0.35), SKL = shade(L.skin, 0.25);
    const HR = L.hair, HRL = shade(L.hair, 0.3), HRD = shade(L.hair, -0.35);
    const PANTS = '#2e3140', PD = '#1f2130', PL = '#3d4154', SHOE = '#15161c', SHOEL = '#34363f';
    const side = dir === 'left', back = dir === 'up', fem = !!L.female;
    const lUp = f === 1 ? 2 : 0, rUp = f === 2 ? 2 : 0;

    // ---- legs & shoes ----
    if (!side) {
      R(10, 38 - lUp, 4, 8, PANTS); R(10, 38 - lUp, 1, 8, PL); R(13, 38 - lUp, 1, 8, PD);
      R(18, 38 - rUp, 4, 8, PANTS); R(18, 38 - rUp, 1, 8, PL); R(21, 38 - rUp, 1, 8, PD);
      R(9, 46 - lUp, 6, 2, SHOE); R(18, 46 - rUp, 6, 2, SHOE); R(10, 46 - lUp, 2, 1, SHOEL); R(19, 46 - rUp, 2, 1, SHOEL);
    } else if (f !== 0) {
      const fr = f === 1 ? 10 : 18, bk = f === 1 ? 18 : 10;
      R(bk, 38, 4, 8, PD); R(fr, 38, 4, 8, PANTS); R(fr, 38, 1, 8, PL);
      R(bk - 1, 46, 6, 2, SHOE); R(fr - 1, 46, 6, 2, SHOE); R(fr, 46, 2, 1, SHOEL);
    } else { R(12, 38, 8, 8, PANTS); R(12, 38, 1, 8, PL); R(16, 38, 1, 8, PD); R(19, 38, 1, 8, PD); R(10, 46, 10, 2, SHOE); R(11, 46, 3, 1, SHOEL); }

    // ---- torso (jacket) ----
    const bx = side ? 10 : 8, bw = side ? 12 : 16;
    R(bx, 22, bw, 16, WH); R(bx, 22, 2, 16, WL); R(bx + bw - 2, 22, 2, 16, WD); R(bx + bw - 1, 22, 1, 16, WD2); R(bx, 36, bw, 2, WD); R(bx, 37, bw, 1, WD2);
    if (fem && !side) { R(8, 29, 1, 3, WD); R(23, 29, 1, 3, WD); } // slightly tapered waist
    if (back) {
      R(11, 22, 2, 8, AP); R(19, 22, 2, 8, AP); R(12, 30, 8, 2, AP); R(14, 32, 4, 2, APD); R(12, 32, 2, 3, APD); R(18, 32, 2, 3, APD);
      R(9, 22, 14, 2, SC); R(10, 24, 12, 1, shade(SC, -0.3));
    } else if (!side) {
      R(10, 27, 12, 11, AP); R(10, 27, 1, 11, APL); R(21, 27, 1, 11, APD); R(10, 37, 12, 1, APD2); R(11, 28, 10, 1, APL);
      R(13, 32, 6, 4, APD); R(13, 32, 6, 1, APD2);
      R(9, 26, 14, 1, APD2);
      R(9, 25, 1, 1, '#8a8f98'); R(22, 25, 1, 1, '#8a8f98'); R(9, 24, 1, 1, '#c8ccd3'); R(22, 24, 1, 1, '#c8ccd3');
      R(11, 22, 10, 2, SC); R(13, 24, 6, 1, SC); R(15, 25, 2, 2, SC); R(15, 25, 2, 1, shade(SC, -0.3)); R(11, 22, 10, 1, shade(SC, 0.2));
    } else {
      R(10, 27, 8, 11, AP); R(10, 27, 1, 11, APL); R(17, 27, 1, 11, APD); R(10, 37, 8, 1, APD2); R(12, 32, 4, 3, APD);
      R(10, 22, 8, 2, SC); R(10, 24, 2, 2, SC);
    }

    // ---- arms ----
    const bangle = () => {};
    if (!side) {
      if (hold && !back) {
        R(6, 22, 2, 7, WH); R(24, 22, 2, 7, WH); R(6, 29, 4, 2, WH); R(22, 29, 4, 2, WH); R(6, 28, 2, 1, WD); R(24, 28, 2, 1, WD);
        R(8, 30, 3, 3, SK); R(21, 30, 3, 3, SK); R(10, 31, 2, 2, SK); R(20, 31, 2, 2, SK); R(8, 32, 3, 1, SKD); R(21, 32, 3, 1, SKD);
        bangle(8, 30); bangle(22, 30);
      } else {
        const la = f === 1 ? -2 : f === 2 ? 1 : 0, ra = f === 2 ? -2 : f === 1 ? 1 : 0;
        R(6, 22, 2, 11 + la, WH); R(24, 22, 2, 11 + ra, WH); R(7, 22, 1, 11 + la, WD); R(25, 22, 1, 11 + ra, WD);
        R(6, 31 + la, 2, 1, WD2); R(24, 31 + ra, 2, 1, WD2);
        R(6, 32 + la, 2, 3, SK); R(24, 32 + ra, 2, 3, SK); R(6, 34 + la, 2, 1, SKD); R(24, 34 + ra, 2, 1, SKD);
        bangle(6, 32 + la); bangle(24, 32 + ra);
      }
    } else if (hold) { R(13, 22, 4, 6, WH); R(16, 22, 1, 6, WD); R(6, 27, 9, 2, WH); R(6, 28, 9, 1, WD); R(4, 26, 3, 3, SK); R(5, 28, 2, 1, SKD); bangle(6, 27); }
    else { const hx = f === 1 ? 9 : f === 2 ? 17 : 13; R(13, 22, 4, 9, WH); R(16, 22, 1, 9, WD); R(hx, 30, 4, 2, WH); R(hx, 32, 3, 3, SK); R(hx, 34, 3, 1, SKD); bangle(hx, 32); }

    // ---- long hair behind the head (Mia) ----
    if (fem) {
      if (back) { R(8, 10, 16, 8, HR); R(13, 17, 6, 2, L.tie); R(12, 19, 8, 6, HR); R(13, 25, 6, 5, HR); R(14, 30, 4, 3, HRD); R(13, 20, 1, 8, HRL); R(18, 21, 1, 6, HRD); }
      else if (side) { R(17, 10, 7, 8, HR); R(21, 17, 3, 2, L.tie); R(20, 19, 5, 7, HR); R(21, 26, 3, 3, HRD); R(21, 20, 1, 5, HRL); }
      else { R(6, 10, 2, 8, HR); R(24, 10, 2, 8, HR); R(6, 17, 2, 1, HRD); R(24, 17, 2, 1, HRD); R(6, 12, 1, 4, HRL); R(25, 12, 1, 4, HRL); }
    }

    // ---- head ----
    R(8, 10, 16, 12, SK); R(22, 10, 2, 12, SKD); R(8, 10, 16, 1, SKD); R(9, 21, 14, 1, SKD); x.clearRect(8, 10, 1, 1); x.clearRect(23, 10, 1, 1); x.clearRect(8, 21, 1, 1); x.clearRect(23, 21, 1, 1);
    if (fem) { x.clearRect(8, 20, 1, 1); x.clearRect(23, 20, 1, 1); R(9, 20, 1, 1, SKD); R(22, 20, 1, 1, SKD); }
    R(9, 11, 1, 10, SKL);
    R(11, 22, 10, 1, SKD2);
    if (back) {
      R(8, 10, 16, 6, HR); R(8, 15, 16, 1, HRD); R(10, 11, 3, 2, HRL);
      if (fem) R(8, 16, 16, 2, HR);
    } else if (side) {
      R(17, 10, 7, 6, HR); R(17, 15, 7, 1, HRD); R(18, 11, 2, 1, HRL); R(13, 10, 5, 2, HR);
      if (fem) { R(8, 11, 4, 1, HR); R(8, 12, 2, 1, HR); }
      R(11, 14, 2, 2, '#241c2a'); R(11, 14, 1, 1, '#ffffff'); R(10, 13, 4, 1, L.brow); if (fem) R(10, 14, 1, 1, '#241c2a');
      R(6, 14, 2, 4, SK); R(6, 17, 2, 1, SKD); R(8, 16, 1, 1, SKD);
      if (L.beard) { R(7, 18, 5, 2, L.beard); R(8, 20, 10, 2, L.beard); R(17, 14, 3, 7, L.beard); R(7, 18, 5, 1, L.beardL); R(8, 18, 2, 1, '#b4604a'); }
      else { R(8, 18, 2, 1, L.lips || '#b4604a'); }
      R(8, 17, 1, 1, '#f0a090');
      if (fem) { R(17, 17, 1, 1, L.gold); }
    } else {
      // hair under the hat
      R(8, 10, 2, 4, HR); R(22, 10, 2, 4, HR); R(10, 10, 12, 1, HR);
      if (fem) { R(10, 11, 5, 1, HR); R(17, 11, 5, 1, HR); R(10, 12, 2, 1, HR); R(20, 12, 2, 1, HR); R(8, 13, 1, 3, HR); R(23, 13, 1, 3, HR); R(12, 10, 1, 1, HRL); R(19, 10, 1, 1, HRL); }
      else { R(10, 11, 7, 1, HR); R(10, 12, 3, 1, HR); R(19, 11, 3, 1, HR); R(8, 14, 2, 4, L.beard); R(22, 14, 2, 4, L.beard); R(13, 11, 2, 1, HRL); }
      // brows, eyes
      if (fem) { R(11, 13, 3, 1, L.brow); R(18, 13, 3, 1, L.brow); R(10, 13, 1, 1, '#241c2a'); R(21, 13, 1, 1, '#241c2a'); }
      else { R(10, 13, 4, 1, L.brow); R(18, 13, 4, 1, L.brow); R(10, 12, 1, 1, L.brow); R(21, 12, 1, 1, L.brow); }
      R(11, 14, 2, 2, '#241c2a'); R(19, 14, 2, 2, '#241c2a'); R(11, 14, 1, 1, '#ffffff'); R(19, 14, 1, 1, '#ffffff');
      R(15, 15, 2, 2, SKD); R(15, 17, 1, 1, SKD2);
      R(9, 17, 2, 1, '#f0a090'); R(21, 17, 2, 1, '#f0a090');
      if (fem) {
        R(13, 18, 6, 1, L.lips); R(14, 19, 4, 1, shade(L.lips, -0.3)); R(14, 18, 1, 1, shade(L.lips, 0.35)); // lips
        R(7, 17, 1, 1, L.gold); R(24, 17, 1, 1, L.gold); // stud earrings
      } else {
        R(11, 17, 4, 1, L.beard); R(17, 17, 4, 1, L.beard); R(13, 18, 6, 1, '#b4604a'); R(14, 19, 4, 1, '#f8efe4'); // moustache + smile
        R(8, 18, 2, 3, L.beard); R(22, 18, 2, 3, L.beard); R(10, 20, 12, 2, L.beard); R(10, 20, 12, 1, L.beardL); R(9, 21, 1, 1, L.beard); R(22, 21, 1, 1, L.beard); // trimmed beard
      }
    }
    // ---- toque ----
    const HAT = '#ffffff', HATD = '#dcdde3', HATD2 = '#bfc1ca';
    R(8, 0, 16, 2, HAT); R(6, 2, 20, 4, HAT); R(7, 6, 18, 4, HAT);
    R(22, 2, 4, 4, HATD); R(21, 0, 3, 2, HATD); R(23, 6, 2, 4, HATD); R(25, 2, 1, 4, HATD2);
    R(12, 0, 1, 6, HATD); R(17, 0, 1, 6, HATD); R(13, 0, 1, 1, HATD); R(18, 1, 1, 1, HATD);
    R(7, 8, 18, 1, HATD); R(7, 9, 18, 1, HATD2); R(7, 6, 1, 3, HATD);
    if (side) { R(19, 6, 6, 3, HATD); R(6, 2, 1, 4, HAT); }
    return outline(c);
  }
  const chefCache = {};
  function chefSheet(look, p, hold) {
    look = LOOKS[look] ? look : LOOK_IDS[p] || 'max';
    const k = look + ':' + p + ':' + (hold ? 1 : 0);
    if (chefCache[k]) return chefCache[k];
    const L = LOOKS[look], RC = ROLE[p] || ROLE[0], sh = {};
    for (const d of ['down', 'up', 'left']) sh[d] = [0, 1, 2].map(f => drawChef(L, RC, d, f, hold));
    sh.right = sh.left.map(flipH);
    return (chefCache[k] = sh);
  }

  // ======================= ITEMS (24x24) =======================
  const itemCache = {};
  const C = {
    tomato: '#e23b2e', tomatoD: '#9c2118', tomatoL: '#ff8a78', pink: '#f28577', pinkL: '#f9b3a8', seed: '#ffe08a', stem: '#3f8f3a', stemD: '#2c6b2a', stemL: '#6fbf5a',
    lettuce: '#5fbd4a', lettuceD: '#3f9a34', lettuceD2: '#2f7a28', lettuceL: '#a0e07a', lettuceL2: '#d2f3b0',
    onion: '#a6509b', onionD: '#6e2f64', onionL: '#c98bbd', onionL2: '#efd6ea',
    potato: '#c9a26a', potatoL: '#e4c48e', potatoD: '#8f6a3a', potatoD2: '#5e4322', eye: '#6b4a24', tikki: '#e9d79c', tikkiL: '#f7ecc0', tikkiD: '#c4ad6a', pea: '#5fae45', spice: '#b8402a', cooked: '#d4903a', cookedL: '#f0bf6a', cookedD: '#9a5f1e', cookedD2: '#6a3e10',
    bun: '#d9a055', bunL: '#efcf95', bunD: '#a8702e', sesame: '#f7e6c0', burnt: '#2b2b2e', burntL: '#55555a',
    plate: '#f6f6f4', plateRim: '#cfd3d8', plateIn: '#e8e9ec', plateBlue: '#7fa3c9', soup: '#e8702a', soupL: '#f3a660', cream: '#f8ddb4', bowl: '#eeeeeb', bowlD: '#c6c8cc',
  };
  function tomatoSlice(x, cx, cy, r) {
    blob(x, cx, cy, r, r, C.tomato, { flat: true }); blob(x, cx, cy, r - 1.2, r - 1.2, C.pink, { flat: true }); blob(x, cx, cy, r - 2.6, r - 2.6, C.pinkL, { flat: true });
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + 0.4; rect(x, Math.round(cx + Math.cos(a) * (r - 2) - 0.5), Math.round(cy + Math.sin(a) * (r - 2) - 0.5), 1, 1, C.seed); }
    rect(x, Math.round(cx - 0.5), Math.round(cy - 0.5), 1, 1, C.tomato);
  }
  function onionRing(x, cx, cy, r) { ring(x, cx, cy, r, 1.6, C.onion); ring(x, cx, cy, r - 1.4, 1.2, C.onionL2); ring(x, cx, cy, r - 2.6, 1, C.onionL); }
  function drawRaw(x, tok) {
    const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
    switch (tok) {
      case 'tomato':
        blob(x, 12, 14, 9.5, 8.5, C.tomato, { dark: C.tomatoD, light: C.tomatoL, dark2: '#7a1810' });
        R(9, 8, 2, 2, C.tomatoD); R(13, 7, 2, 3, C.tomatoD); // lobes
        R(11, 3, 2, 3, C.stem); R(10, 5, 1, 1, C.stemD); R(8, 6, 3, 1, C.stem); R(7, 7, 2, 1, C.stemL); R(13, 5, 3, 1, C.stem); R(16, 6, 2, 1, C.stemL); R(12, 6, 2, 2, C.stemD); R(15, 7, 1, 1, C.stem); break;
      case 'lettuce':
        blob(x, 12, 13, 10, 9, C.lettuce, { dark: C.lettuceD, dark2: C.lettuceD2, light: C.lettuceL, spec: C.lettuceL2 });
        R(8, 7, 2, 6, C.lettuceD); R(14, 5, 2, 4, C.lettuceD); R(11, 15, 6, 1, C.lettuceD); R(16, 12, 2, 4, C.lettuceD); R(6, 14, 3, 1, C.lettuceD);
        R(10, 6, 2, 1, C.lettuceL2); R(16, 8, 2, 1, C.lettuceL2); R(5, 12, 2, 1, C.lettuceL); R(3, 15, 2, 2, C.lettuce); R(20, 14, 2, 2, C.lettuce); R(4, 17, 2, 2, C.lettuceD); R(19, 17, 2, 2, C.lettuceD); R(2, 16, 1, 1, C.lettuceD2); break;
      case 'onion':
        blob(x, 12, 14, 9, 9, C.onion, { dark: C.onionD, light: C.onionL, spec: C.onionL2, dark2: '#4e1f46' });
        R(8, 8, 1, 10, '#8a3f80'); R(16, 8, 1, 10, '#8a3f80'); R(12, 6, 1, 14, '#8a3f80'); R(10, 7, 1, 2, C.onionL2);
        R(11, 2, 2, 4, '#c9a96a'); R(10, 1, 1, 2, '#e0c080'); R(13, 2, 1, 2, '#b09050'); R(9, 3, 1, 1, '#c9a96a'); break;
      case 'potato':
        blob(x, 12, 13, 10, 7.5, C.potato, { dark: C.potatoD, dark2: C.potatoD2, light: C.potatoL, spec: '#f3dcae' });
        R(6, 9, 2, 1, C.eye); R(7, 10, 1, 1, C.potatoD2); R(15, 8, 1, 2, C.eye); R(9, 16, 2, 1, C.eye); R(17, 14, 2, 1, C.eye); R(18, 15, 1, 1, C.potatoD2); R(12, 12, 1, 1, C.potatoD); R(4, 14, 1, 1, C.potatoD);
        R(3, 11, 1, 1, C.potatoL); R(20, 10, 1, 2, C.potatoD2); break;
      case 'bun':
        blob(x, 12, 12, 10, 7.5, C.bun, { dark: C.bunD, light: '#e9bd78', spec: C.bunL }); x.clearRect(0, 15, 24, 9);
        R(3, 15, 18, 2, C.bunL); R(3, 17, 18, 2, C.bunD); R(4, 19, 16, 1, '#8a5a24'); R(2, 15, 1, 2, C.bunL); R(21, 15, 1, 2, C.bunL);
        R(7, 8, 2, 1, C.sesame); R(12, 6, 2, 1, C.sesame); R(16, 9, 2, 1, C.sesame); R(9, 12, 2, 1, C.sesame); R(14, 12, 2, 1, C.sesame); R(5, 11, 2, 1, C.sesame); R(18, 12, 1, 1, C.sesame); break;
      case 'tomato+':
        tomatoSlice(x, 15, 8, 6.5); tomatoSlice(x, 8, 15, 6.5); R(17, 14, 4, 6, C.tomato); R(18, 15, 2, 4, C.pink); R(18, 16, 1, 1, C.seed); R(17, 14, 1, 6, C.tomatoD); break;
      case 'lettuce+':
        R(3, 12, 6, 4, C.lettuceL); R(9, 8, 6, 4, C.lettuce); R(14, 14, 6, 4, C.lettuceL); R(7, 16, 6, 4, C.lettuceD); R(16, 7, 5, 4, C.lettuce); R(5, 6, 4, 4, C.lettuceD); R(12, 12, 4, 2, C.lettuce); R(18, 18, 4, 2, C.lettuce);
        R(3, 12, 6, 1, C.lettuceL2); R(9, 8, 6, 1, C.lettuceL); R(14, 14, 6, 1, C.lettuceL2); R(16, 7, 5, 1, C.lettuceL); R(7, 19, 6, 1, C.lettuceD2); R(5, 9, 4, 1, C.lettuceD2); R(9, 11, 6, 1, C.lettuceD); R(14, 17, 6, 1, C.lettuceD); break;
      case 'onion+':
        onionRing(x, 10, 12, 7); onionRing(x, 10, 12, 3.4); onionRing(x, 17, 15, 5); R(14, 18, 1, 1, C.onionD); break;
      case 'potato+': // raw aloo tikki: mashed potato patty with peas and spice flecks
        blob(x, 12, 13, 10, 6, C.tikki, { dark: C.tikkiD, light: C.tikkiL, spec: '#ffffff', dark2: '#a8905a' });
        R(7, 11, 2, 2, C.pea); R(7, 11, 1, 1, '#8fd66a'); R(15, 14, 2, 2, C.pea); R(15, 14, 1, 1, '#8fd66a'); R(11, 15, 1, 1, C.pea);
        R(10, 10, 1, 1, C.spice); R(17, 11, 1, 1, C.spice); R(5, 14, 1, 1, C.spice); R(13, 12, 1, 1, '#c9b070'); break;
      case 'potato*': // fried: golden, crisp edges
        blob(x, 12, 13, 10, 6, C.cooked, { dark: C.cookedD, light: C.cookedL, spec: '#fbe2a8', dark2: C.cookedD2 });
        R(5, 11, 3, 1, C.cookedD); R(11, 10, 3, 1, C.cookedD); R(16, 12, 2, 1, C.cookedD2); R(7, 15, 3, 1, C.cookedD2); R(13, 16, 3, 1, C.cookedD); R(9, 13, 1, 1, C.cookedD2);
        R(8, 11, 2, 2, '#4f8f3a'); R(15, 15, 1, 1, '#4f8f3a'); R(10, 9, 1, 1, C.cookedL); R(18, 14, 1, 1, '#fbe2a8'); break;
      case 'burnt':
        blob(x, 12, 13, 10, 6.5, C.burnt, { dark: '#111114', light: C.burntL, spec: '#6a6a70', dark2: '#050507' }); R(8, 11, 2, 1, C.burntL); R(14, 15, 2, 1, C.burntL); R(16, 10, 1, 1, '#c0392b'); R(7, 15, 1, 1, '#e8742b'); R(11, 13, 2, 1, '#3a3a3e'); break;
      case 'soup': drawBowl(x, true); break;
      case 'plate': drawPlate(x, 15); break;
      case 'pot': drawPot(x, 0, 4); break;
      case 'pan': drawPan(x, 0, 6); break;
      case 'knife': R(3, 3, 5, 12, '#d8dde3'); R(4, 2, 2, 14, '#eef1f4'); R(7, 4, 1, 10, '#aab2bb'); R(4, 15, 4, 1, '#aab2bb'); R(4, 16, 4, 7, '#3a2a20'); R(5, 16, 1, 7, '#5a4030'); R(4, 16, 4, 1, '#8a8a90'); R(5, 18, 2, 1, '#8a8a90'); R(5, 21, 2, 1, '#8a8a90'); break;
      case 'board': bevel(x, 2, 6, 20, 13, '#c08a4a', 0.2); R(4, 9, 10, 1, '#b07a3e'); R(8, 13, 10, 1, '#b07a3e'); R(5, 16, 6, 1, '#b07a3e'); R(18, 8, 2, 2, '#8a5a2a'); break;
      case 'clock': blob(x, 12, 12, 11, 11, '#f8f6ee', { flat: true }); ring(x, 12, 12, 11, 1.5, '#2a2a30'); R(12, 4, 1, 8, '#333'); R(12, 12, 6, 1, '#333'); R(12, 12, 1, 1, '#e03a2d'); R(12, 2, 1, 1, '#333'); R(12, 21, 1, 1, '#333'); R(2, 12, 1, 1, '#333'); R(21, 12, 1, 1, '#333'); break;
    }
  }
  function drawPlate(x, cy) {
    blob(x, 12, cy + 1.5, 11.5, 4.6, '#b9bec6', { flat: true }); blob(x, 12, cy + 0.8, 11.5, 4.6, C.plateRim, { flat: true }); blob(x, 12, cy, 11.5, 4.6, C.plate, { flat: true });
    blob(x, 12, cy, 8, 2.9, C.plateIn, { flat: true }); blob(x, 12, cy - 0.3, 7, 2.3, C.plate, { flat: true });
    rect(x, 4, cy - 3, 4, 1, '#ffffff'); rect(x, 3, cy - 2, 1, 1, '#ffffff');
    for (let a = 0.5; a < 2.7; a += 0.06) rect(x, Math.round(12 + Math.cos(a + Math.PI) * 9.8 - 0.5), Math.round(cy + Math.sin(a + Math.PI) * 3.8 - 0.5), 1, 1, C.plateBlue);
  }
  function drawBowl(x, full) {
    const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
    R(4, 12, 16, 7, C.bowl); R(5, 19, 14, 2, C.bowlD); R(6, 21, 12, 1, '#a8aaae'); R(18, 12, 2, 7, C.bowlD); R(4, 12, 2, 5, '#ffffff'); R(5, 16, 14, 1, C.plateBlue);
    blob(x, 12, 12, 10.5, 5, C.bowl, { flat: true }); blob(x, 12, 13, 10.5, 5, C.bowlD, { flat: true }); blob(x, 12, 12, 10.5, 5, C.bowl, { flat: true }); ring(x, 12, 12, 10.5, 1, '#ffffff');
    if (full) { blob(x, 12, 12, 8.5, 3.6, C.soup, { flat: true }); R(9, 10, 4, 1, C.soupL); R(14, 12, 4, 1, C.cream); R(8, 13, 2, 1, C.soupL); R(6, 12, 1, 1, C.cream); R(15, 10, 2, 1, C.soupL); R(11, 14, 3, 1, '#d4601f'); }
    else blob(x, 12, 12, 8.5, 3.6, '#dcdcd8', { flat: true });
  }
  function drawPan(x, X, Y) {
    const R = (a, b, w, h, col) => rect(x, X + a, Y + b, w, h, col);
    blob(x, X + 10, Y + 8, 9.5, 7, '#26262a', { flat: true }); blob(x, X + 10, Y + 8, 7.5, 5, '#3b3b41', { flat: true }); blob(x, X + 10, Y + 8, 6, 3.8, '#4a4a51', { flat: true });
    R(4, 3, 4, 1, '#5c5c64'); R(3, 4, 1, 1, '#5c5c64'); R(14, 12, 2, 1, '#121215');
    R(18, 6, 10, 4, '#1d1d20'); R(20, 7, 8, 2, '#5a3a24'); R(21, 7, 6, 1, '#7a5234'); R(26, 7, 1, 2, '#2a1a10'); R(18, 7, 2, 2, '#3a3a40');
  }
  function drawPot(x, X, Y) {
    const R = (a, b, w, h, col) => rect(x, X + a, Y + b, w, h, col);
    R(4, 6, 20, 13, '#9aa3ad'); R(4, 6, 2, 13, '#c7ced6'); R(6, 6, 1, 13, '#b4bcc5'); R(21, 6, 3, 13, '#6c747d'); R(4, 17, 20, 2, '#5f6770'); R(5, 19, 18, 1, '#454b53');
    R(0, 9, 4, 2, '#5f6770'); R(24, 9, 4, 2, '#5f6770'); R(0, 8, 2, 1, '#8a929b'); R(26, 8, 2, 1, '#8a929b'); R(1, 11, 2, 1, '#3a3f46'); R(25, 11, 2, 1, '#3a3f46');
    blob(x, X + 14, Y + 6, 10.5, 4, '#5f6770', { flat: true }); blob(x, X + 14, Y + 6, 9, 3, '#2e3238', { flat: true }); R(6, 5, 6, 1, '#d5dbe2');
  }
  function drawMini(x, tok, cx, cy) { // small token on a plate
    const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
    switch (tok) {
      case 'tomato+': tomatoSlice(x, cx, cy, 4.5); break;
      case 'lettuce+': R(cx - 5, cy - 2, 4, 3, C.lettuceL); R(cx - 2, cy - 4, 5, 3, C.lettuce); R(cx + 2, cy - 1, 4, 3, C.lettuceL); R(cx - 4, cy + 1, 5, 2, C.lettuceD); R(cx + 1, cy + 2, 3, 1, C.lettuceD2); R(cx - 2, cy - 4, 5, 1, C.lettuceL2); R(cx - 5, cy - 2, 4, 1, C.lettuceL2); break;
      case 'onion+': onionRing(x, cx, cy, 4.5); onionRing(x, cx + 3, cy + 2, 2.6); break;
      case 'potato*': blob(x, cx, cy, 6.5, 3.6, C.cooked, { dark: C.cookedD, light: C.cookedL, spec: '#fbe2a8', dark2: C.cookedD2 }); R(cx - 4, cy - 1, 2, 1, C.cookedD2); R(cx + 1, cy, 2, 1, C.cookedD2); R(cx - 1, cy + 1, 1, 1, '#4f8f3a'); R(cx - 2, cy - 2, 1, 1, '#4f8f3a'); break;
      case 'bun': blob(x, cx, cy, 6, 4, C.bun, { dark: C.bunD, light: '#e9bd78' }); R(cx - 2, cy - 2, 1, 1, C.sesame); R(cx + 1, cy - 1, 1, 1, C.sesame); R(cx - 1, cy + 1, 1, 1, C.sesame); break;
    }
  }
  function drawPlated(x, toks) {
    const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
    if (toks.includes('soup')) { drawBowl(x, true); return; }
    if (toks.includes('bun')) {
      drawPlate(x, 17);
      let y = 17;
      R(5, y - 2, 14, 3, C.bunL); R(4, y - 1, 1, 2, C.bunL); R(19, y - 1, 1, 2, C.bunL); R(5, y, 14, 1, C.bunD); R(6, y + 1, 12, 1, '#8a5a24'); y -= 3;
      if (toks.includes('potato*')) { R(3, y - 2, 18, 3, C.cooked); R(3, y, 18, 1, C.cookedD2); R(4, y - 2, 4, 1, C.cookedL); R(10, y - 2, 3, 1, C.cookedL); R(3, y - 1, 1, 2, C.cookedD); R(8, y - 1, 1, 1, '#4f8f3a'); R(16, y - 1, 1, 1, C.cookedD2); y -= 3; }
      if (toks.includes('lettuce+')) { R(2, y - 1, 20, 2, C.lettuce); R(3, y - 2, 3, 1, C.lettuceL); R(9, y - 2, 4, 1, C.lettuceL); R(16, y - 2, 3, 1, C.lettuceL); R(5, y, 2, 1, C.lettuceD); R(13, y, 2, 1, C.lettuceD); R(19, y, 2, 1, C.lettuceD2); y -= 2; }
      blob(x, 12, y - 3, 9.5, 5, C.bun, { dark: C.bunD, light: '#e9bd78', spec: C.bunL }); x.clearRect(0, y, 24, 1); R(3, y - 1, 18, 1, C.bun); R(3, y, 18, 1, C.bunD);
      R(7, y - 5, 2, 1, C.sesame); R(12, y - 6, 2, 1, C.sesame); R(16, y - 4, 2, 1, C.sesame); R(9, y - 3, 2, 1, C.sesame); R(14, y - 3, 1, 1, C.sesame); R(5, y - 3, 1, 1, C.sesame);
      return;
    }
    drawPlate(x, 15);
    const pos = toks.length === 1 ? [[12, 13]] : toks.length === 2 ? [[8, 13], [16, 15]] : [[7, 15], [17, 15], [12, 10]];
    toks.slice().sort().forEach((t, i) => drawMini(x, t, pos[i][0], pos[i][1]));
  }
  function item(tok) {
    if (itemCache[tok]) return itemCache[tok];
    const [c, x] = canvas(24, 24);
    if (tok.startsWith('plate')) drawPlated(x, tok.slice(6).split(',').filter(Boolean));
    else drawRaw(x, tok);
    return (itemCache[tok] = outline(c));
  }

  // ======================= TILES (32x32) =======================
  const tileCache = {};
  const FLOOR_A = '#e2c89c', FLOOR_B = '#cfb183', GROUT = '#a98a5c';
  function floorTile(x, X, Y, c, r) {
    const R = (a, b, w, h, col) => rect(x, X + a, Y + b, w, h, col);
    R(0, 0, 32, 32, GROUT);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const k = (c * 2 + i + r * 2 + j) % 2, hv = hash(c * 2 + i + 100, r * 2 + j + 100), col = shade(k ? FLOOR_A : FLOOR_B, (hv - 0.5) * 0.08);
      bevel(x, X + i * 16, Y + j * 16, 15, 15, col, 0.12);
      speckle(x, X + i * 16 + 2, Y + j * 16 + 2, 11, 11, shade(col, -0.12), 3, (c * 2 + i) * 97 + (r * 2 + j));
      if (hv < 0.1) R(i * 16 + 3 + Math.floor(hv * 60), j * 16 + 6, 5, 1, shade(col, -0.2));
      if (hv > 0.92) { R(i * 16 + 4, j * 16 + 4, 2, 2, shade(col, 0.2)); }
    }
  }
  function steelTop(x, X, Y, wood) {
    const R = (a, b, w, h, col) => rect(x, X + a, Y + b, w, h, col);
    if (wood) {
      R(0, 0, 32, 22, '#c99a5b');
      for (let j = 0; j < 22; j += 6) { R(0, j, 32, 1, '#b2824a'); R(0, j + 1, 32, 1, '#d8ad6c'); }
      R(9, 1, 1, 5, '#b2824a'); R(22, 7, 1, 5, '#b2824a'); R(5, 13, 1, 5, '#b2824a'); R(27, 19, 1, 3, '#b2824a'); R(15, 3, 6, 1, '#bd8c52'); R(2, 16, 5, 1, '#bd8c52');
      R(0, 0, 32, 1, '#ebc07f'); R(0, 21, 32, 1, '#8c6134'); R(0, 22, 32, 2, '#6b4525');
      R(0, 24, 32, 8, '#7a5230'); R(0, 24, 32, 1, '#95673d'); R(2, 26, 28, 5, '#6a4426'); R(2, 26, 28, 1, '#5a3820'); R(12, 28, 8, 1, '#d9c3a0'); R(12, 29, 8, 1, '#5a3820'); R(0, 31, 32, 1, '#3e2812');
    } else {
      R(0, 0, 32, 22, '#c3c9d2');
      for (let j = 2; j < 21; j += 3) R(0, j, 32, 1, '#bbc1cb');
      R(0, 0, 32, 1, '#eef1f5'); R(0, 1, 32, 1, '#dde2e8'); R(0, 21, 32, 1, '#8f97a2'); R(0, 20, 32, 1, '#a9b0ba'); R(31, 0, 1, 21, '#aab1bb'); R(0, 0, 1, 21, '#d4d9df');
      R(4, 6, 1, 1, '#e6eaef'); R(19, 12, 1, 1, '#e6eaef'); R(11, 16, 1, 1, '#b0b7c1'); R(26, 5, 1, 1, '#b0b7c1');
      R(0, 22, 32, 10, '#6a717d'); R(0, 22, 32, 1, '#8a919c'); R(2, 24, 28, 6, '#5d646f'); R(2, 24, 28, 1, '#4e545e'); R(2, 29, 28, 1, '#7b828d');
      R(11, 26, 10, 2, '#cfd4da'); R(11, 27, 10, 1, '#9ea5ae'); R(10, 26, 1, 2, '#e4e8ec'); R(0, 30, 32, 2, '#3f444d'); R(31, 22, 1, 10, '#4c525c');
    }
  }
  function stoveBase(x) {
    const R = (a, b, w, h, col) => rect(x, a, b, w, h, col);
    R(0, 0, 32, 22, '#3f444d'); R(0, 0, 32, 1, '#646a75'); R(0, 1, 32, 1, '#52585f'); R(0, 21, 32, 1, '#24272c'); R(31, 0, 1, 21, '#30343b'); R(0, 0, 1, 21, '#4e545d');
    ring(x, 16, 11, 10, 1.4, '#1c1f24'); ring(x, 16, 11, 8.5, 1.2, '#2a2e34'); blob(x, 16, 11, 7, 6, '#23262b', { flat: true });
    R(16, 3, 1, 16, '#4a4f57'); R(8, 11, 16, 1, '#4a4f57'); R(10, 6, 1, 1, '#4a4f57'); R(21, 6, 1, 1, '#4a4f57'); R(10, 16, 1, 1, '#4a4f57'); R(21, 16, 1, 1, '#4a4f57');
    R(0, 22, 32, 10, '#2a2d33'); R(0, 22, 32, 1, '#3c4048'); R(0, 30, 32, 2, '#141518'); R(2, 24, 28, 1, '#1e2126');
    for (const kx of [5, 22]) { R(kx, 25, 5, 4, '#9aa0a8'); R(kx, 25, 5, 1, '#c8cdd3'); R(kx + 2, 26, 1, 2, '#3a3f46'); R(kx, 28, 5, 1, '#6a7078'); }
  }
  function tile(ch, c, r) {
    const key = ch + ':' + c + ':' + r;
    if (tileCache[key]) return tileCache[key];
    const [cv, x] = canvas(32, 32);
    const R = (a, b, w, h, col) => rect(x, a, b, w, h, col);
    switch (ch) {
      case 'C': steelTop(x, 0, 0, r === 4); break;
      case 'D': steelTop(x, 0, 0, r === 4); drawDecor(x, c, r); break;
      case 'L':
        steelTop(x, 0, 0);
        for (let i = 0; i < 4; i++) { const y = 16 - i * 2; blob(x, 16, y + 1.5, 11, 4.5, '#b9bec6', { flat: true }); blob(x, 16, y, 11, 4.5, '#f6f6f4', { flat: true }); ring(x, 16, y, 11, 1, '#e3e5e9'); }
        blob(x, 16, 10, 7, 2.6, '#e8e9ec', { flat: true }); R(8, 7, 4, 1, '#ffffff'); for (let a = 0.7; a < 2.5; a += 0.1) R(Math.round(16 + Math.cos(a + Math.PI) * 9.2), Math.round(10 + Math.sin(a + Math.PI) * 3.6), 1, 1, C.plateBlue);
        break;
      case 'B':
        steelTop(x, 0, 0); bevel(x, 2, 3, 20, 15, '#c08a4a', 0.22); R(4, 6, 12, 1, '#b07a3e'); R(7, 10, 12, 1, '#b07a3e'); R(4, 14, 8, 1, '#b07a3e'); R(14, 13, 2, 1, '#8a5a2a'); R(9, 8, 1, 1, '#8a5a2a'); R(2, 17, 20, 1, '#7a4a20');
        R(25, 3, 4, 10, '#d8dde3'); R(25, 3, 2, 10, '#eef1f4'); R(28, 4, 1, 8, '#aab2bb'); R(25, 13, 4, 1, '#aab2bb'); R(25, 14, 4, 6, '#3a2a20'); R(26, 14, 1, 6, '#5a4030'); R(26, 16, 2, 1, '#8a8a90'); R(26, 18, 2, 1, '#8a8a90'); break;
      case 'V':
        steelTop(x, 0, 0);
        if (c === 2) {
          R(3, 9, 26, 2, '#8a9099'); R(3, 9, 26, 1, '#b4bac2'); R(3, 7, 2, 6, '#5f6770'); R(27, 7, 2, 6, '#5f6770');
          for (const tx of [6, 14, 21]) { R(tx, 2, 7, 9, '#fff9e6'); R(tx, 2, 7, 1, '#ffffff'); R(tx + 1, 4, 5, 1, '#b8b4a8'); R(tx + 1, 6, 4, 1, '#b8b4a8'); R(tx + 1, 8, 5, 1, '#b8b4a8'); R(tx + 3, 1, 1, 2, '#c0392b'); }
        } else {
          R(6, 17, 20, 2, '#b58a24'); R(5, 19, 22, 1, '#8c6a1c'); R(7, 17, 18, 1, '#dcb24a');
          blob(x, 16, 11, 8.5, 7, '#e6b93c', { dark: '#a67d18', light: '#f9df8a', spec: '#fff4c4', dark2: '#7a5a10' }); R(12, 15, 8, 2, '#b58a24'); R(15, 2, 2, 3, '#f6d77a'); R(14, 3, 1, 1, '#d8b84a'); R(17, 3, 1, 2, '#c8a030');
        }
        break;
      case 'S': stoveBase(x); R(13, 25, 6, 2, '#e04040'); R(14, 25, 2, 1, '#ff8080'); break;
      case 'P': stoveBase(x); R(13, 25, 6, 2, '#40c060'); R(14, 25, 2, 1, '#90f0a0'); break;
      case 'X':
        floorTile(x, 0, 0, c, r);
        R(8, 8, 16, 20, '#7d858f'); R(8, 8, 2, 20, '#9aa3ad'); R(22, 8, 2, 20, '#5f6770'); R(12, 8, 1, 20, '#6a727c'); R(18, 8, 1, 20, '#6a727c'); R(8, 26, 16, 2, '#4e555e'); R(8, 14, 16, 1, '#6a727c'); R(8, 22, 16, 1, '#6a727c');
        R(6, 4, 20, 4, '#5f6770'); R(6, 4, 20, 1, '#8b949e'); R(7, 5, 18, 1, '#747c86'); R(14, 2, 4, 2, '#8b949e'); R(10, 7, 4, 2, '#f1e4c6'); R(10, 7, 4, 1, '#ffffff'); R(20, 7, 2, 1, '#3f8f3a');
        R(6, 28, 6, 2, '#3a3f46'); R(12, 29, 4, 1, '#5f6770'); break;
      default: { // crates
        const kind = { t: 'tomato', l: 'lettuce', o: 'onion', p: 'potato', b: 'bun' }[ch];
        R(0, 0, 32, 22, '#7d5428'); R(0, 0, 32, 2, '#c99a5b'); R(0, 0, 2, 22, '#b3843f'); R(30, 0, 2, 22, '#9a6b35'); R(0, 20, 32, 2, '#5e3e1c'); R(2, 2, 28, 1, '#5e3e1c'); R(2, 2, 1, 18, '#5e3e1c');
        R(0, 22, 32, 10, '#9a6b35'); R(0, 22, 32, 1, '#b98849'); R(0, 25, 32, 1, '#6b4820'); R(0, 28, 32, 1, '#6b4820'); R(0, 31, 32, 1, '#4a2f12'); R(0, 24, 32, 1, '#a9793f'); R(0, 27, 32, 1, '#a9793f');
        for (const nx of [2, 28]) for (const ny of [23, 29]) { R(nx, ny, 2, 2, '#d9b070'); R(nx, ny, 1, 1, '#f0d090'); }
        R(10, 23, 12, 5, '#f1e4c6'); R(10, 23, 12, 1, '#ffffff'); R(12, 25, 8, 1, '#8a5a2a'); R(13, 26, 4, 1, '#c0392b');
        const spr = item(kind);
        for (const [px, py, s] of [[1, 2, 17], [13, 1, 17], [6, 6, 18], [15, 8, 16]]) x.drawImage(spr, 0, 0, 24, 24, px, py, s, s);
      }
    }
    return (tileCache[key] = cv);
  }
  function drawDecor(x, c, r) {
    const R = (a, b, w, h, col) => rect(x, a, b, w, h, col);
    const k = ({ '0,0': 0, '12,0': 1, '0,4': 2, '0,7': 3, '12,7': 4, '0,8': 5, '12,8': 1 })[c + ',' + r] ?? Math.floor(hash(c + 1, r + 1) * 6);
    if (k === 0) { // knife block
      R(9, 7, 14, 12, '#8a5a2a'); R(9, 7, 14, 1, '#b07a3e'); R(9, 7, 2, 12, '#a86f38'); R(21, 7, 2, 12, '#5e3e1c'); R(9, 18, 14, 1, '#4a2f12');
      for (let i = 0; i < 4; i++) { R(11 + i * 3, 3, 2, 5, '#3a2a20'); R(11 + i * 3, 2, 2, 1, '#8a8a90'); R(11 + i * 3, 4, 1, 1, '#8a8a90'); }
    } else if (k === 1) { // utensil crock
      R(10, 8, 12, 11, '#c9c3b6'); R(10, 8, 2, 11, '#e6e1d6'); R(20, 8, 2, 11, '#9a948a'); R(10, 18, 12, 1, '#6f6a62'); blob(x, 16, 8, 6, 2.2, '#6f6a62', { flat: true });
      R(12, 1, 1, 8, '#9aa3ad'); R(11, 0, 3, 2, '#9aa3ad'); R(15, 2, 1, 7, '#9aa3ad'); R(14, 1, 3, 1, '#b4bcc5'); R(18, 1, 1, 8, '#8a5a2a'); R(17, 0, 3, 2, '#c08a4a'); R(20, 3, 1, 6, '#9aa3ad'); R(19, 2, 3, 2, '#9aa3ad');
    } else if (k === 2) { // folded towels
      R(7, 10, 18, 4, '#d9534f'); R(7, 10, 18, 1, '#f08a86'); R(7, 13, 18, 1, '#a63a37'); R(8, 6, 16, 4, '#f3efe4'); R(8, 6, 16, 1, '#ffffff'); R(8, 9, 16, 1, '#c9c3b6'); R(9, 2, 14, 4, '#4a86c8'); R(9, 2, 14, 1, '#7fb0e8'); R(9, 5, 14, 1, '#2f5a8c'); R(12, 7, 8, 1, '#4a86c8');
    } else if (k === 3) { // potted herb
      R(10, 11, 12, 8, '#b5623a'); R(10, 11, 12, 1, '#d98a5a'); R(9, 10, 14, 2, '#c9704a'); R(20, 12, 2, 7, '#8a4428'); R(10, 18, 12, 1, '#6a3420');
      R(11, 9, 10, 2, '#4a3220'); for (const [lx, ly] of [[12, 4], [15, 2], [18, 5], [14, 6], [17, 8], [11, 7]]) { R(lx, ly, 3, 2, '#4faa3e'); R(lx, ly, 1, 1, '#8fd66a'); R(lx + 2, ly + 1, 1, 1, '#2f7a28'); } R(15, 4, 2, 6, '#2f7a28');
    } else if (k === 4) { // radio
      bevel(x, 6, 6, 20, 12, '#5a3a24', 0.25); R(8, 8, 8, 8, '#2a2a30'); R(9, 9, 6, 6, '#3f4a40'); R(10, 10, 4, 4, '#2a2a30'); R(18, 8, 6, 2, '#d9c3a0'); R(18, 11, 6, 1, '#9aa3ad'); R(19, 13, 2, 2, '#e8c040'); R(22, 13, 2, 2, '#9aa3ad'); R(23, 1, 1, 6, '#9aa3ad'); R(24, 0, 1, 2, '#c8cdd3');
    } else { // fruit bowl
      blob(x, 16, 13, 11, 4, '#8a5a2a', { flat: true }); blob(x, 16, 12, 10, 3.2, '#c08a4a', { flat: true }); blob(x, 16, 12, 8, 2.2, '#8a5a2a', { flat: true });
      blob(x, 12, 9, 3.5, 3.5, '#e8b23a', { dark: '#b07a18' }); blob(x, 19, 9, 3.5, 3.5, '#e03a2d', { dark: '#9c2118' }); blob(x, 16, 6, 3.5, 3.5, '#6fbf3a', { dark: '#3f8f2a' }); R(16, 2, 1, 2, '#5a3a22');
    }
  }

  // ======================= STATIC MAP: back wall, floor, shadows, margins =======================
  function mapCanvas(MAP, W, H) {
    const BW = (W * T + MX * 2) * A, BH = (OY + H * T + MB) * A;
    const [cv, x] = canvas(BW, BH);
    const R = (a, b, w, h, col) => rect(x, a, b, w, h, col);
    const ox = MX * A, oy = OY * A;
    // dark wall tops around the outside
    R(0, 0, BW, BH, '#1e1a24'); R(0, 0, BW, BH, '#2b2533');
    for (let i = 0; i < BW; i += 4) for (let j = 0; j < BH; j += 4) if (hash(i, j) < 0.15) R(i, j, 2, 1, '#342d3d');
    R(ox - 2, 0, W * TA + 4, oy + H * TA + 2, '#17131c'); // inner shadow line
    // ---- backsplash ----
    R(ox, 0, W * TA, oy, '#a4b4bb');
    for (let j = 0; j < 6; j++) for (let i = -1; i < W * 4 + 1; i++) {
      const X = ox + i * 8 + (j % 2 ? 4 : 0), Y = j * 6; if (X < ox - 8 || X > ox + W * TA) continue;
      const col = hash(i + 7, j + 3) < 0.5 ? '#dde8ec' : '#d3e0e5'; R(Math.max(ox, X), Y, Math.min(7, ox + W * TA - Math.max(ox, X)), 5, col); R(Math.max(ox, X), Y, Math.min(7, ox + W * TA - Math.max(ox, X)), 1, '#eaf2f5');
    }
    R(ox, 0, W * TA, 3, '#5d5260'); R(ox, 3, W * TA, 1, '#8a7f8f'); // cornice shadow
    R(ox, 36, W * TA, 3, '#8d9ea6'); R(ox, 36, W * TA, 1, '#b4c3c9'); R(ox, 39, W * TA, 2, '#6e7e86'); R(ox, 41, W * TA, 7, '#59666d'); R(ox, 41, W * TA, 1, '#7b8a92'); // trim + wall base
    // serving hatch over cols 2-3: an opening into the warm dining room
    { const X = ox + 2 * TA + 4, Wd = 2 * TA - 8;
      R(X - 3, 0, Wd + 6, 44, '#6e4a2a'); R(X - 3, 0, Wd + 6, 2, '#9a6b3a'); R(X, 2, Wd, 42, '#2a1e1e');
      for (let j = 0; j < 40; j++) R(X + 2, 2 + j, Wd - 4, 1, shade('#4a3030', j * 0.012));
      R(X + 6, 6, Wd - 12, 1, '#7a5a40'); R(X + 10, 16, 8, 6, '#1c1410'); R(X + 30, 18, 8, 5, '#1c1410'); // silhouettes of tables
      R(X + Wd / 2 - 1, 2, 2, 10, '#3a2a20'); blob(x, X + Wd / 2, 15, 7, 4, '#e8b060', { flat: true }); blob(x, X + Wd / 2, 14, 5, 2.5, '#fff0b0', { flat: true }); // hanging lamp
      R(X + 4, 36, Wd - 8, 4, '#c08a4a'); R(X + 4, 36, Wd - 8, 1, '#e0b070'); R(X, 40, Wd, 4, '#8a6a4a'); // sill
      R(X + 8, 30, 10, 1, '#e8b060aa'); R(X + 34, 32, 8, 1, '#e8b060aa');
    }
    // range hood over cols 6-8
    { const X = ox + 6 * TA - 8, Wd = 3 * TA + 16;
      R(X, 0, Wd, 22, '#6a717d'); R(X, 0, Wd, 2, '#8f97a2'); R(X, 20, Wd, 2, '#454a53'); R(X + 2, 22, Wd - 4, 2, '#30343b'); R(X, 0, 2, 22, '#7d8591'); R(X + Wd - 2, 0, 2, 22, '#545a65');
      for (let i = 6; i < Wd - 6; i += 6) { R(X + i, 6, 3, 10, '#545a65'); R(X + i, 6, 1, 10, '#454a53'); }
      R(X + Wd / 2 - 7, 17, 14, 4, '#2a2d33'); R(X + Wd / 2 - 5, 18, 10, 2, '#ffe9a0'); R(X + Wd / 2 - 4, 18, 8, 1, '#ffffff');
    }
    // utensil rail over cols 9-10
    { const X = ox + 9 * TA + 4; R(X, 8, 52, 2, '#5f6770'); R(X, 8, 52, 1, '#8a929b'); R(X + 2, 6, 2, 2, '#3a3f46'); R(X + 48, 6, 2, 2, '#3a3f46');
      R(X + 6, 10, 1, 12, '#9aa3ad'); blob(x, X + 6.5, 24, 3, 2.5, '#b4bcc5', { flat: true }); // ladle
      R(X + 16, 10, 1, 8, '#9aa3ad'); for (let k = 0; k < 4; k++) R(X + 14 + k, 18 + k, 1, 6 - k, '#c8cdd3'); R(X + 15, 24, 3, 1, '#c8cdd3'); // whisk
      R(X + 28, 10, 2, 10, '#5a3a24'); blob(x, X + 29, 25, 6, 5, '#2b2b2f', { flat: true }); blob(x, X + 29, 25, 4, 3, '#3b3b41', { flat: true }); // small pan
      R(X + 42, 10, 1, 10, '#9aa3ad'); R(X + 39, 20, 7, 6, '#c08a4a'); R(X + 39, 20, 7, 1, '#d9a665'); R(X + 39, 25, 7, 1, '#8a5a2a'); // spatula
    }
    // shelf with jars over cols 4-5
    { const X = ox + 4 * TA + 2; R(X, 22, 60, 3, '#8a5a2a'); R(X, 22, 60, 1, '#b07a3e'); R(X, 25, 60, 2, '#5e3e1c');
      const jars = [['#e03a2d', 8], ['#f0c040', 6], ['#3f8f3a', 9], ['#c9a96a', 5], ['#a6509b', 8], ['#e8702a', 7], ['#5fbd4a', 6]];
      jars.forEach(([col, h], i) => { const jx = X + 3 + i * 8; R(jx, 22 - h, 6, h, col); R(jx, 22 - h, 1, h, shade(col, 0.35)); R(jx + 5, 22 - h, 1, h, shade(col, -0.3)); R(jx, 20 - h, 6, 2, '#3a2a20'); R(jx + 1, 24 - h, 2, 2, '#ffffff90'); R(jx + 1, 22 - Math.floor(h / 2), 4, 2, '#f1e4c6'); });
    }
    x.drawImage(item('clock'), ox + 3, 2, 24, 24);
    // chalkboard over cols 11-12
    { const X = ox + 11 * TA + 6; R(X, 4, 54, 30, '#8a5a2a'); R(X, 4, 54, 2, '#b07a3e'); R(X + 3, 7, 48, 24, '#2f3a33'); R(X + 4, 8, 46, 1, '#3d4a42');
      R(X + 8, 11, 18, 2, '#dfe8dd'); R(X + 8, 16, 26, 1, '#dfe8ddaa'); R(X + 8, 20, 20, 1, '#dfe8ddaa'); R(X + 8, 24, 30, 1, '#dfe8ddaa'); R(X + 30, 11, 14, 2, '#f0d070'); R(X + 36, 19, 10, 6, '#e8c040'); R(X + 38, 21, 6, 2, '#2f3a33'); }
    // menu neon-ish sign over col 0-1
    { const X = ox + 30; R(X, 12, 36, 16, '#2a2233'); R(X + 1, 13, 34, 14, '#3a2d44'); R(X + 4, 17, 8, 6, '#ff6b8a'); R(X + 14, 17, 18, 6, '#ff6b8a'); R(X + 5, 18, 6, 4, '#3a2d44'); R(X + 15, 18, 16, 4, '#3a2d44'); R(X + 7, 19, 2, 2, '#ff6b8a'); R(X + 17, 19, 2, 2, '#ff6b8a'); R(X + 21, 19, 2, 2, '#ff6b8a'); R(X + 25, 19, 2, 2, '#ff6b8a'); R(X + 29, 19, 2, 2, '#ff6b8a'); }
    // ---- floor ----
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) floorTile(x, ox + c * TA, oy + r * TA, c, r);
    // rubber mats in front of the stoves and the serving window
    const mat = (c0, cw, r) => { const X = ox + c0 * TA + 3, Y = oy + r * TA + 6, Wd = cw * TA - 6; R(X, Y, Wd, 20, '#3a3a42'); R(X, Y, Wd, 1, '#55555f'); R(X, Y + 19, Wd, 1, '#26262c'); for (let i = 3; i < Wd - 3; i += 4) for (let j = 3; j < 18; j += 4) R(X + i, Y + j, 2, 2, '#45454f'); };
    mat(6, 3, 1); mat(2, 2, 1);
    // drop shadows from counters onto the floor (light from the top left)
    const solid = (c, r) => r < 0 || r >= H || c < 0 || c >= W || MAP[r][c] !== '.';
    x.fillStyle = 'rgba(30,20,40,.22)';
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (solid(c, r)) continue;
      if (solid(c, r - 1)) { x.fillRect(ox + c * TA, oy + r * TA, TA, 4); x.fillStyle = 'rgba(30,20,40,.12)'; x.fillRect(ox + c * TA, oy + r * TA + 4, TA, 3); x.fillStyle = 'rgba(30,20,40,.22)'; }
      if (solid(c - 1, r)) { x.fillRect(ox + c * TA, oy + r * TA, 3, TA); }
    }
    R(ox, oy, W * TA, 2, 'rgba(0,0,0,.18)');
    return cv;
  }

  window.KA = { A, T, TA, OY, MX, MB, canvas, shade, outline, flipH, hash, rect, blob, ring, bevel, chefSheet, item, tile, mapCanvas, drawPan, drawPot, LOOKS, LOOK_IDS, ROLE };
})();
