// Kitchen Rush: every sprite is drawn in code at startup (no image files).
// Chefs: 16x24, 4 directions x 3 walk frames (x2 for the "holding" pose). Tiles: 16px. Items: 12x12.
(function () {
  'use strict';
  const OUT = '#1b1720';
  const T = 16, OY = 12; // OY: height of the back-wall strip above the kitchen

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
  // shaded ellipse: darker rim on the lower right, highlight top left
  function blob(x, cx, cy, rx, ry, col, o) {
    o = o || {};
    const dark = o.dark || shade(col, -0.32), light = o.light || shade(col, 0.35);
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx), y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const u = (i + 0.5 - cx) / rx, v = (j + 0.5 - cy) / ry, d = u * u + v * v;
      if (d > 1) continue;
      let c = col;
      if (!o.flat && d > 0.55 && u + v > 0.25) c = dark;
      else if (!o.flat && d < 0.5 && d > 0.12 && u < -0.1 && v < -0.1) c = light;
      x.fillStyle = c; x.fillRect(i, j, 1, 1);
    }
  }
  function ring(x, cx, cy, r, col, inner) {
    for (let j = -r - 1; j <= r + 1; j++) for (let i = -r - 1; i <= r + 1; i++) {
      const d = Math.hypot(i + 0.5 - (cx - Math.floor(cx)), j + 0.5 - (cy - Math.floor(cy)));
      const X = Math.floor(cx) + i, Y = Math.floor(cy) + j;
      if (d <= r) { x.fillStyle = d > r - 1.1 ? col : inner; x.fillRect(X, Y, 1, 1); }
    }
  }

  // ======================= CHEFS =======================
  const LOOKS = [
    { skin: '#f0c8a0', hair: '#4a2e1e', apron: '#e8533f', scarf: '#c43c2c', mustache: '#5a3a22' },
    { skin: '#c88a5c', hair: '#1f1a17', apron: '#1f8f87', scarf: '#2bb5a8', tuft: true },
  ];
  function drawChef(L, dir, f, hold) {
    const [c, x] = canvas(16, 24);
    const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
    const WH = '#f7f7f4', WD = '#d2d2cf', WL = '#ffffff';
    const AP = L.apron, APD = shade(L.apron, -0.32), APL = shade(L.apron, 0.22);
    const skinD = shade(L.skin, -0.18), PANTS = '#2b2e3a', PD = '#1d2029', SHOE = '#17181f';
    const side = dir === 'left', back = dir === 'up';
    // legs
    const lUp = f === 1 ? 1 : 0, rUp = f === 2 ? 1 : 0;
    if (!side) {
      R(5, 19 - lUp, 2, 4, PANTS); R(9, 19 - rUp, 2, 4, PD);
      R(4, 23 - lUp, 3, 1, SHOE); R(9, 23 - rUp, 3, 1, SHOE);
    } else if (f !== 0) {
      R(9, 19, 2, 4, f === 1 ? PD : PANTS); R(5, 19, 2, 4, f === 1 ? PANTS : PD); R(4, 23, 3, 1, SHOE); R(9, 23, 3, 1, SHOE);
    } else { R(6, 19, 4, 4, PANTS); R(8, 19, 1, 4, PD); R(5, 23, 5, 1, SHOE); }
    // jacket
    const bx = side ? 5 : 4, bw = side ? 6 : 8;
    R(bx, 11, bw, 8, WH); R(bx + bw - 1, 11, 1, 8, WD); R(bx, 18, bw, 1, WD); R(bx, 11, 1, 7, WL);
    if (back) { R(5, 11, 1, 4, AP); R(10, 11, 1, 4, AP); R(6, 15, 4, 1, AP); R(7, 16, 2, 2, APD); R(4, 11, 8, 1, L.scarf); }
    else if (!side) {
      R(5, 13, 6, 6, AP); R(5, 18, 6, 1, APD); R(10, 13, 1, 6, APD); R(5, 13, 1, 5, APL); R(7, 16, 2, 1, APD);
      R(6, 11, 4, 1, L.scarf); R(7, 12, 2, 1, L.scarf); R(8, 13, 1, 1, shade(L.scarf, -0.3));
      R(5, 12, 1, 1, '#9aa0a8'); R(10, 12, 1, 1, '#9aa0a8');
    } else { R(5, 13, 4, 6, AP); R(5, 18, 4, 1, APD); R(5, 13, 1, 5, APL); R(5, 11, 4, 1, L.scarf); }
    // arms
    if (!side) {
      if (hold && !back) { R(3, 11, 1, 4, WD); R(12, 11, 1, 4, WD); R(3, 15, 2, 1, WD); R(11, 15, 2, 1, WD); R(4, 15, 2, 2, L.skin); R(10, 15, 2, 2, L.skin); }
      else { const la = f === 1 ? -1 : 0, ra = f === 2 ? -1 : 0; R(3, 11, 1, 6 + la, WD); R(12, 11, 1, 6 + ra, WD); R(3, 17 + la, 1, 1, L.skin); R(12, 17 + ra, 1, 1, L.skin); }
    } else if (hold) { R(7, 11, 2, 3, WD); R(3, 13, 5, 1, WD); R(2, 13, 1, 2, L.skin); R(3, 14, 2, 1, L.skin); }
    else { const hx = f === 1 ? 5 : f === 2 ? 9 : 7; R(7, 11, 2, 5, WD); R(hx, 16, 2, 1, WD); R(hx, 17, 2, 1, L.skin); }
    // head
    R(4, 5, 8, 6, L.skin); R(11, 5, 1, 6, skinD); x.clearRect(4, 10, 1, 1); x.clearRect(11, 10, 1, 1); R(5, 10, 6, 1, skinD);
    if (back) { R(4, 5, 8, 3, L.hair); R(4, 7, 8, 1, shade(L.hair, -0.3)); }
    else if (side) {
      R(9, 5, 3, 3, L.hair); if (L.tuft) R(8, 5, 2, 1, L.hair);
      R(5, 7, 1, 1, '#241c2a'); R(3, 7, 1, 2, L.skin); R(4, 8, 1, 1, skinD);
      if (L.mustache) R(3, 9, 3, 1, L.mustache); else R(4, 9, 1, 1, '#b4604a');
    } else {
      R(4, 5, 1, 2, L.hair); R(11, 5, 1, 2, L.hair); if (L.tuft) { R(5, 5, 3, 1, L.hair); R(9, 5, 2, 1, L.hair); }
      R(6, 7, 1, 1, '#241c2a'); R(9, 7, 1, 1, '#241c2a');
      R(5, 8, 1, 1, '#f0a090'); R(10, 8, 1, 1, '#f0a090');
      if (L.mustache) { R(6, 9, 4, 1, L.mustache); R(5, 9, 1, 1, L.mustache); R(10, 9, 1, 1, L.mustache); } else R(7, 9, 2, 1, '#b4604a');
    }
    // toque
    const HAT = '#ffffff', HATD = '#d6d9e0';
    R(4, 0, 8, 1, HAT); R(3, 1, 10, 2, HAT); R(4, 3, 8, 2, HAT);
    R(12, 1, 1, 2, HATD); R(11, 0, 1, 1, HATD); R(6, 0, 1, 1, HATD); R(9, 0, 1, 1, HATD); R(4, 4, 8, 1, HATD); R(4, 3, 1, 1, HATD);
    if (side) R(10, 3, 2, 1, HATD);
    return outline(c);
  }
  const chefCache = {};
  function chefSheet(p, hold) {
    const k = p + ':' + (hold ? 1 : 0);
    if (chefCache[k]) return chefCache[k];
    const L = LOOKS[p], sh = {};
    for (const d of ['down', 'up', 'left']) sh[d] = [0, 1, 2].map(f => drawChef(L, d, f, hold));
    sh.right = sh.left.map(flipH);
    return (chefCache[k] = sh);
  }

  // ======================= ITEMS (12x12) =======================
  const itemCache = {};
  const C = {
    tomato: '#e03a2d', tomatoL: '#ff9d8c', tomatoD: '#9c2118', pink: '#f28577', seed: '#ffe08a', stem: '#3f8f3a', stemD: '#2c6b2a',
    lettuce: '#5fbd4a', lettuceD: '#3f9a34', lettuceL: '#a0e07a', onion: '#a6509b', onionD: '#6e2f64', onionL: '#e5bddf',
    meat: '#d1505a', meatL: '#e3737c', meatD: '#9a2e3a', fat: '#f1cfd2', patty: '#c84a55', cooked: '#7b4a2b', cookedL: '#a56a3e', cookedD: '#4e2d18',
    bun: '#d9a055', bunL: '#efcf95', bunD: '#a8702e', sesame: '#f7e6c0', burnt: '#2b2b2e', burntL: '#55555a',
    plate: '#f6f6f4', plateRim: '#cfd3d8', plateIn: '#e8e9ec', soup: '#e8702a', soupL: '#f3a660', cream: '#f8ddb4', bowl: '#eeeeeb', bowlD: '#c6c8cc',
  };
  function drawRaw(x, tok) {
    const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
    switch (tok) {
      case 'tomato':
        blob(x, 6, 7, 4.6, 4.1, C.tomato, { dark: C.tomatoD, light: C.tomatoL });
        R(5, 2, 2, 1, C.stem); R(4, 3, 1, 1, C.stem); R(7, 3, 1, 1, C.stem); R(6, 3, 1, 1, C.stemD); R(5, 4, 1, 1, C.stemD); break;
      case 'lettuce':
        blob(x, 6, 6.5, 4.6, 4.2, C.lettuce, { dark: C.lettuceD, light: C.lettuceL });
        R(4, 4, 1, 3, C.lettuceD); R(7, 3, 1, 2, C.lettuceD); R(6, 8, 3, 1, C.lettuceD); R(8, 6, 1, 2, C.lettuceD);
        R(5, 3, 1, 1, C.lettuceL); R(8, 4, 1, 1, C.lettuceL); R(3, 7, 1, 1, C.lettuceL); R(1, 8, 1, 1, C.lettuce); R(10, 7, 1, 1, C.lettuce); R(2, 9, 1, 1, C.lettuceD); break;
      case 'onion':
        blob(x, 6, 6.8, 4.3, 4.4, C.onion, { dark: C.onionD, light: C.onionL });
        R(4, 4, 1, 5, '#8a3f80'); R(8, 4, 1, 5, '#8a3f80'); R(6, 1, 1, 2, '#c9a96a'); R(5, 1, 1, 1, '#c9a96a'); R(7, 2, 1, 1, '#c9a96a'); break;
      case 'meat':
        R(1, 3, 10, 7, C.meat); R(1, 3, 1, 7, C.meatL); R(1, 3, 10, 1, C.meatL); R(2, 9, 9, 1, C.meatD); R(10, 4, 1, 6, C.meatD);
        R(3, 5, 1, 1, C.fat); R(6, 7, 2, 1, C.fat); R(7, 4, 1, 1, C.fat); R(4, 8, 1, 1, C.fat); R(8, 6, 1, 1, C.fat); x.clearRect(1, 3, 1, 1); x.clearRect(10, 9, 1, 1); x.clearRect(1, 9, 1, 1); x.clearRect(10, 3, 1, 1); break;
      case 'bun':
        R(2, 10, 8, 1, C.bunL); R(2, 11, 8, 1, C.bunD);
        blob(x, 6, 7, 5, 3.6, C.bun, { dark: C.bunD, light: '#e9bd78' }); x.clearRect(0, 10, 12, 2); R(2, 9, 8, 1, C.bunL); R(2, 10, 8, 1, C.bunD);
        R(4, 5, 1, 1, C.sesame); R(7, 4, 1, 1, C.sesame); R(8, 7, 1, 1, C.sesame); R(5, 8, 1, 1, C.sesame); R(3, 7, 1, 1, C.sesame); break;
      case 'tomato+':
        ring(x, 8, 4, 3, C.tomato, C.pink); R(7, 3, 1, 1, C.seed); R(9, 4, 1, 1, C.seed); R(8, 5, 1, 1, C.seed);
        ring(x, 4, 8, 3, C.tomato, C.pink); R(3, 7, 1, 1, C.seed); R(5, 8, 1, 1, C.seed); R(4, 9, 1, 1, C.seed);
        R(9, 8, 2, 3, C.tomato); R(10, 8, 1, 1, C.pink); break;
      case 'lettuce+':
        R(2, 6, 3, 2, C.lettuceL); R(5, 4, 3, 2, C.lettuce); R(7, 7, 3, 2, C.lettuceL); R(4, 8, 3, 2, C.lettuceD); R(8, 4, 2, 2, C.lettuce); R(3, 3, 2, 2, C.lettuceD); R(6, 6, 2, 1, C.lettuce); R(9, 9, 2, 1, C.lettuce); break;
      case 'onion+':
        ring(x, 5, 6, 3.5, C.onion, C.onionL); ring(x, 5, 6, 1.5, '#b06aa8', C.onionL); ring(x, 9, 8, 2.5, C.onionD, C.onionL); break;
      case 'meat+':
        blob(x, 6, 7, 5, 2.9, C.patty, { dark: C.meatD, light: C.meatL }); R(4, 6, 1, 1, C.meatD); R(7, 7, 1, 1, C.meatD); R(5, 8, 1, 1, C.fat); break;
      case 'meat*':
        blob(x, 6, 7, 5, 2.9, C.cooked, { dark: C.cookedD, light: C.cookedL }); R(3, 6, 2, 1, C.cookedD); R(6, 6, 2, 1, C.cookedD); R(4, 8, 2, 1, C.cookedD); R(7, 8, 2, 1, C.cookedD); R(5, 5, 1, 1, C.cookedL); break;
      case 'burnt':
        blob(x, 6, 7, 5, 3, C.burnt, { dark: '#111114', light: C.burntL }); R(4, 6, 1, 1, C.burntL); R(7, 8, 1, 1, C.burntL); R(8, 5, 1, 1, '#c0392b'); R(3, 8, 1, 1, '#3a3a3e'); break;
      case 'soup': drawBowl(x, true); break;
      case 'plate': drawPlate(x); break;
      case 'pot': drawPot(x, 0, 1); break;
      case 'pan': drawPan(x, 0, 3); break;
      case 'knife': R(1, 2, 2, 6, '#d8dde3'); R(2, 1, 1, 7, '#eef1f4'); R(3, 2, 1, 5, '#aab2bb'); R(1, 8, 2, 4, '#3a2a20'); R(1, 8, 2, 1, '#8a8a90'); break;
      case 'board': R(1, 3, 10, 7, '#c08a4a'); R(1, 3, 10, 1, '#d9a665'); R(1, 9, 10, 1, '#8a5a2a'); R(10, 3, 1, 7, '#8a5a2a'); R(3, 5, 5, 1, '#b07a3e'); break;
      case 'clock': blob(x, 6, 6, 5.5, 5.5, '#f8f6ee', { flat: true }); R(6, 2, 1, 4, '#333'); R(6, 6, 3, 1, '#333'); R(6, 6, 1, 1, '#e03a2d'); break;
    }
  }
  function drawPlate(x, cy) {
    cy = cy || 8;
    blob(x, 6, cy, 5.8, 3.2, C.plate, { flat: true }); blob(x, 6, cy + 0.6, 5.8, 3.2, C.plateRim, { flat: true }); blob(x, 6, cy, 5.8, 3.2, C.plate, { flat: true });
    blob(x, 6, cy, 3.6, 1.7, C.plateIn, { flat: true }); blob(x, 6, cy - 0.3, 3, 1.2, C.plate, { flat: true }); rect(x, 2, cy - 2, 2, 1, '#ffffff');
  }
  function drawBowl(x, full) {
    const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
    R(2, 6, 8, 4, C.bowl); R(3, 10, 6, 1, C.bowlD); R(9, 6, 1, 4, C.bowlD); R(2, 6, 1, 3, '#ffffff');
    blob(x, 6, 6, 5.3, 2.5, C.bowl, { flat: true }); blob(x, 6, 6.5, 5.3, 2.5, C.bowlD, { flat: true }); blob(x, 6, 6, 5.3, 2.5, C.bowl, { flat: true });
    if (full) { blob(x, 6, 6, 4.2, 1.8, C.soup, { flat: true }); R(5, 5, 2, 1, C.soupL); R(7, 6, 2, 1, C.cream); R(4, 7, 1, 1, C.soupL); R(3, 6, 1, 1, C.cream); }
    else blob(x, 6, 6, 4.2, 1.8, '#dcdcd8', { flat: true });
  }
  function drawPan(x, X, Y) {
    const R = (a, b, w, h, col) => rect(x, X + a, Y + b, w, h, col);
    blob(x, X + 5, Y + 4, 4.8, 3.4, '#2b2b2f', { flat: true }); blob(x, X + 5, Y + 4, 3.6, 2.3, '#3d3d43', { flat: true }); R(2, 2, 2, 1, '#55555c');
    R(9, 3, 4, 2, '#1d1d20'); R(12, 3, 2, 2, '#3a2a20'); R(10, 3, 2, 1, '#333338');
  }
  function drawPot(x, X, Y) {
    const R = (a, b, w, h, col) => rect(x, X + a, Y + b, w, h, col);
    R(2, 3, 10, 7, '#9aa3ad'); R(2, 3, 1, 7, '#c7ced6'); R(11, 3, 1, 7, '#6c747d'); R(2, 9, 10, 1, '#5f6770'); R(0, 5, 2, 1, '#5f6770'); R(12, 5, 2, 1, '#5f6770'); R(0, 4, 1, 1, '#8a929b'); R(13, 4, 1, 1, '#8a929b');
    blob(x, X + 7, Y + 3, 5.2, 1.9, '#5f6770', { flat: true }); blob(x, X + 7, Y + 3, 4.2, 1.2, '#2e3238', { flat: true });
  }
  function drawMini(x, tok, cx, cy) { // small token drawn on a plate
    const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
    switch (tok) {
      case 'tomato+': ring(x, cx, cy, 2.4, C.tomato, C.pink); R(cx, cy - 1, 1, 1, C.seed); R(cx - 1, cy, 1, 1, C.seed); break;
      case 'lettuce+': R(cx - 3, cy - 1, 2, 2, C.lettuceL); R(cx - 1, cy - 2, 3, 2, C.lettuce); R(cx + 1, cy, 2, 2, C.lettuceL); R(cx - 2, cy + 1, 3, 1, C.lettuceD); break;
      case 'onion+': ring(x, cx, cy, 2.4, C.onion, C.onionL); R(cx + 2, cy + 1, 1, 1, C.onionD); break;
      case 'meat*': blob(x, cx, cy, 3.4, 1.9, C.cooked, { dark: C.cookedD, light: C.cookedL }); R(cx - 2, cy, 1, 1, C.cookedD); R(cx + 1, cy, 1, 1, C.cookedD); break;
      case 'bun': blob(x, cx, cy, 3.2, 2.1, C.bun, { dark: C.bunD, light: '#e9bd78' }); R(cx - 1, cy - 1, 1, 1, C.sesame); R(cx + 1, cy, 1, 1, C.sesame); break;
    }
  }
  function drawPlated(x, toks) {
    if (toks.includes('soup')) { drawBowl(x, true); return; }
    if (toks.includes('bun')) {
      drawPlate(x, 9);
      const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
      let y = 9;
      R(3, y - 1, 6, 2, C.bunL); R(2, y - 1, 1, 1, C.bunL); R(9, y - 1, 1, 1, C.bunL); R(3, y, 6, 1, C.bunD); y -= 2;
      if (toks.includes('meat*')) { R(2, y - 1, 8, 2, C.cooked); R(2, y, 8, 1, C.cookedD); R(3, y - 1, 2, 1, C.cookedL); y -= 2; }
      if (toks.includes('lettuce+')) { R(1, y, 10, 1, C.lettuce); R(2, y - 1, 2, 1, C.lettuceL); R(6, y - 1, 3, 1, C.lettuceL); R(4, y, 1, 1, C.lettuceD); R(8, y, 1, 1, C.lettuceD); y -= 1; }
      blob(x, 6, y - 1, 4.6, 2.4, C.bun, { dark: C.bunD, light: '#e9bd78' }); x.clearRect(0, y + 1, 12, 1); R(2, y, 8, 1, C.bun);
      R(4, y - 2, 1, 1, C.sesame); R(7, y - 3, 1, 1, C.sesame); R(8, y - 1, 1, 1, C.sesame); R(5, y - 1, 1, 1, C.sesame);
      return;
    }
    drawPlate(x, 8);
    const pos = toks.length === 1 ? [[6, 7]] : toks.length === 2 ? [[4, 7], [8, 8]] : [[4, 8], [8, 8], [6, 6]];
    toks.slice().sort().forEach((t, i) => drawMini(x, t, pos[i][0], pos[i][1]));
  }
  function item(tok) {
    if (itemCache[tok]) return itemCache[tok];
    const [c, x] = canvas(12, 12);
    if (tok.startsWith('plate')) drawPlated(x, tok.slice(6).split(',').filter(Boolean));
    else drawRaw(x, tok);
    return (itemCache[tok] = outline(c));
  }

  // ======================= TILES (16x16) =======================
  const tileCache = {};
  function floorTile(x, X, Y, c, r) {
    const R = (a, b, w, h, col) => rect(x, X + a, Y + b, w, h, col);
    R(0, 0, 16, 16, '#b89a6c');
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const k = (c * 2 + i + r * 2 + j) % 2, col = k ? '#e6d2ac' : '#d4ba8e';
      R(i * 8, j * 8, 7, 7, col);
      R(i * 8, j * 8, 7, 1, shade(col, 0.25)); R(i * 8, j * 8, 1, 7, shade(col, 0.18));
      const hv = hash(c * 2 + i, r * 2 + j);
      if (hv < 0.12) R(i * 8 + 2 + Math.floor(hv * 30), j * 8 + 3, 2, 1, shade(col, -0.12));
      if (hv > 0.9) R(i * 8 + 4, j * 8 + 5, 1, 1, shade(col, -0.18));
    }
  }
  function steelTop(x, wood) {
    const R = (a, b, w, h, col) => rect(x, a, b, w, h, col);
    if (wood) {
      R(0, 0, 16, 11, '#c99a5b'); R(0, 0, 16, 1, '#e0b676'); R(0, 4, 16, 1, '#b2824a'); R(0, 8, 16, 1, '#b2824a'); R(5, 1, 1, 3, '#b2824a'); R(11, 5, 1, 3, '#b2824a'); R(3, 9, 1, 2, '#b2824a');
      R(0, 10, 16, 1, '#8c6134'); R(0, 11, 16, 5, '#7a5230'); R(0, 15, 16, 1, '#4f3419'); R(0, 11, 16, 1, '#95673d'); R(15, 0, 1, 11, '#b2824a');
    } else {
      R(0, 0, 16, 11, '#c3c9d2'); R(0, 0, 16, 1, '#e4e8ed'); R(0, 10, 16, 1, '#8f97a2'); R(15, 0, 1, 10, '#aab1bb');
      R(3, 3, 1, 1, '#d2d7de'); R(9, 6, 1, 1, '#d2d7de'); R(6, 8, 1, 1, '#b4bbc5');
      R(0, 11, 16, 5, '#6a717d'); R(0, 11, 16, 1, '#7d8591'); R(0, 15, 16, 1, '#454a53'); R(5, 13, 6, 1, '#cfd4da'); R(5, 14, 6, 1, '#4c525c'); R(15, 11, 1, 5, '#5a606b');
    }
  }
  function tile(ch, c, r) {
    const key = ch + ':' + c + ':' + r;
    if (tileCache[key]) return tileCache[key];
    const [cv, x] = canvas(16, 16);
    const R = (a, b, w, h, col) => rect(x, a, b, w, h, col);
    switch (ch) {
      case 'C': steelTop(x, r === 4); break;
      case 'L': steelTop(x); for (let i = 0; i < 3; i++) { const y = 8 - i; blob(x, 8, y + 1, 5.6, 2.3, '#c9cdd3', { flat: true }); blob(x, 8, y, 5.6, 2.3, '#f6f6f4', { flat: true }); } blob(x, 8, 6, 3.4, 1.2, '#e8e9ec', { flat: true }); break;
      case 'B':
        steelTop(x); R(1, 2, 10, 7, '#c08a4a'); R(1, 2, 10, 1, '#d9a665'); R(1, 8, 10, 1, '#8a5a2a'); R(10, 2, 1, 7, '#8a5a2a'); R(1, 2, 1, 6, '#d9a665');
        R(12, 2, 2, 5, '#d8dde3'); R(12, 2, 1, 5, '#eef1f4'); R(12, 7, 2, 3, '#3a2a20'); break;
      case 'V':
        steelTop(x);
        if (c === 2) { R(2, 4, 12, 1, '#8a9099'); R(3, 1, 4, 4, '#fff9e6'); R(4, 2, 2, 1, '#aaa'); R(4, 3, 2, 1, '#aaa'); R(9, 1, 4, 4, '#fff9e6'); R(10, 2, 2, 1, '#aaa'); R(10, 3, 2, 1, '#aaa'); R(2, 3, 1, 2, '#5f6770'); R(13, 3, 1, 2, '#5f6770'); }
        else { R(4, 8, 8, 1, '#b58a24'); R(3, 9, 10, 1, '#8c6a1c'); blob(x, 8, 6.5, 3.6, 3, '#e6b93c', { dark: '#a67d18', light: '#f9df8a' }); R(7, 2, 2, 1, '#f6d77a'); R(8, 1, 1, 1, '#d8b84a'); }
        break;
      case 'S': case 'P':
        R(0, 0, 16, 11, '#3f444d'); R(0, 0, 16, 1, '#5c626c'); R(0, 10, 16, 1, '#24272c'); R(15, 0, 1, 10, '#30343b');
        blob(x, 8, 5.5, 5, 4, '#23262b', { flat: true }); blob(x, 8, 5.5, 3.6, 2.8, '#2f333a', { flat: true }); R(4, 5, 8, 1, '#4a4f57'); R(8, 2, 1, 7, '#4a4f57');
        R(0, 11, 16, 5, '#2a2d33'); R(0, 15, 16, 1, '#141518'); R(3, 13, 2, 2, '#9aa0a8'); R(11, 13, 2, 2, '#9aa0a8'); R(3, 13, 1, 1, '#c8cdd3'); R(11, 13, 1, 1, '#c8cdd3'); R(7, 13, 2, 1, ch === 'S' ? '#e04040' : '#40c060');
        break;
      case 'X':
        floorTile(x, 0, 0, c, r);
        R(4, 4, 8, 10, '#7d858f'); R(4, 4, 1, 10, '#9aa3ad'); R(11, 4, 1, 10, '#5f6770'); R(6, 4, 1, 10, '#6a727c'); R(9, 4, 1, 10, '#6a727c'); R(4, 13, 8, 1, '#4e555e');
        R(3, 2, 10, 2, '#5f6770'); R(3, 2, 10, 1, '#8b949e'); R(7, 1, 2, 1, '#8b949e'); R(5, 3, 2, 1, '#f1e4c6'); break;
      default: // crates
        { const kind = { t: 'tomato', l: 'lettuce', o: 'onion', m: 'meat', b: 'bun' }[ch];
          R(0, 0, 16, 11, '#7d5428'); R(0, 0, 16, 1, '#c99a5b'); R(0, 0, 1, 11, '#b3843f'); R(15, 0, 1, 11, '#9a6b35'); R(0, 10, 16, 1, '#5e3e1c');
          R(0, 11, 16, 5, '#9a6b35'); R(0, 12, 16, 1, '#6b4820'); R(0, 14, 16, 1, '#6b4820'); R(0, 15, 16, 1, '#4a2f12'); R(1, 11, 1, 1, '#d9b070'); R(14, 11, 1, 1, '#d9b070'); R(1, 13, 1, 1, '#d9b070'); R(14, 13, 1, 1, '#d9b070');
          const spr = item(kind), [sm, sx] = canvas(12, 12); sx.drawImage(spr, 0, 0);
          x.drawImage(spr, 0, 0, 12, 12, 1, 1, 8, 8); x.drawImage(spr, 0, 0, 12, 12, 6, 2, 8, 8); x.drawImage(spr, 0, 0, 12, 12, 3, 3, 9, 9); }
    }
    return (tileCache[key] = cv);
  }

  // ======================= BACK WALL + FLOOR (static) =======================
  function mapCanvas(MAP, W, H) {
    const [cv, x] = canvas(W * T, H * T + OY);
    const R = (a, b, w, h, col) => rect(x, a, b, w, h, col);
    // backsplash
    R(0, 0, W * T, OY, '#aebfc6');
    for (let j = 0; j < 2; j++) for (let i = 0; i < W * 4; i++) R(i * 4, j * 4, 3, 3, (i + j) % 2 ? '#dbe6ea' : '#d2dfe4');
    R(0, 8, W * T, 3, '#8d9ea6'); R(0, 11, W * T, 1, '#5e6c73'); R(0, 8, W * T, 1, '#a3b3ba');
    // serving hatch over the window tiles (cols 2-3)
    R(32, 0, 32, 11, '#2a1e1e'); R(34, 0, 28, 10, '#4a3030');
    for (let j = 0; j < 10; j++) R(34, j, 28, 1, shade('#5a3a30', j * 0.09));
    R(36, 2, 24, 1, '#7a5a40'); R(40, 4, 3, 3, '#e0b060'); R(52, 5, 3, 2, '#e0b060'); R(46, 3, 2, 2, '#c08040');
    R(32, 0, 1, 11, '#6e4a2a'); R(63, 0, 1, 11, '#6e4a2a'); R(32, 10, 32, 1, '#8a6a4a');
    // range hood over the stoves (cols 6-8)
    R(95, 0, 50, 8, '#6a717d'); R(95, 0, 50, 1, '#8f97a2'); R(95, 7, 50, 1, '#454a53'); R(99, 3, 42, 1, '#545a65'); R(99, 5, 42, 1, '#545a65'); R(118, 2, 4, 4, '#2a2d33'); R(119, 3, 2, 2, '#e8c040');
    // spice shelf (cols 4-5) and clock (col 10)
    R(66, 7, 28, 1, '#8a5a2a'); R(66, 8, 28, 1, '#5e3e1c'); R(68, 2, 3, 5, '#e03a2d'); R(72, 3, 3, 4, '#f0c040'); R(76, 2, 3, 5, '#3f8f3a'); R(80, 4, 3, 3, '#c9a96a'); R(84, 3, 3, 4, '#a6509b'); R(88, 2, 3, 5, '#e8702a');
    for (let i = 0; i < 6; i++) R(68 + i * 4, 2 + (i % 2), 1, 1, '#ffffffa0');
    x.drawImage(item('clock'), 163, -1);
    // chalkboard menu (cols 11-12)
    R(177, 0, 30, 10, '#8a5a2a'); R(178, 1, 28, 8, '#2f3a33'); R(180, 3, 10, 1, '#dfe8dd'); R(180, 5, 14, 1, '#dfe8ddaa'); R(180, 7, 8, 1, '#dfe8ddaa'); R(196, 2, 6, 5, '#e8c040'); R(197, 3, 4, 3, '#2f3a33');
    // floor
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) floorTile(x, c * T, OY + r * T, c, r);
    // wall shadow on the first floor row
    R(0, OY, W * T, 1, 'rgba(0,0,0,.12)');
    return cv;
  }

  window.KA = { T, OY, canvas, shade, outline, flipH, hash, rect, blob, chefSheet, item, tile, mapCanvas, drawPan, drawPot, LOOKS };
})();
