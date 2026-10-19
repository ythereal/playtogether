// Rival Hospital: every sprite is drawn in code at startup (no image files).
// People are 16x24 (feet at y=23), 4 directions x 3 walk frames. Tiles are 16px. Rooms are 64x64.
// Same approach as Manor Mystery: bevelled, outlined furniture sprites on patterned floors, wallpaper back walls.
(function () {
  'use strict';
  const OUT = '#1b1720';
  const T = 16, W = 22, H = 11;

  // The scene is drawn at SS times its logical resolution. Art made while HI is set gets an SS-times canvas whose
  // context is pre-scaled, so painters keep working in logical pixels but curves, outlines and fine detail come out
  // sharper. c.lw / c.lh give the logical size to draw it at.
  const SS = 2;
  let HI = 1;
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.ceil(w * HI); c.height = Math.ceil(h * HI); c.lw = w; c.lh = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; if (HI !== 1) x.scale(HI, HI); return [c, x]; }
  function hcanvas(w, h) { const k = HI; HI = SS; try { return canvas(w, h); } finally { HI = k; } }
  const hiRes = fn => { const k = HI; HI = SS; try { return fn(); } finally { HI = k; } };
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
  function flipH(c) { const k = HI; HI = 1; const [o, x] = canvas(c.width, c.height); HI = k; x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(c, 0, 0); o.lw = c.lw || c.width; o.lh = c.lh || c.height; return o; }
  // ---------- remastering pixel sprites: Scale2x, then light and shade for volume, then a fine outline ----------
  function scale2x(c) {
    const w = c.width, h = c.height, src = new Uint32Array(c.getContext('2d').getImageData(0, 0, w, h).data.buffer);
    const k = HI; HI = 1; const [o, x] = canvas(w * 2, h * 2); HI = k;
    const img = x.createImageData(w * 2, h * 2), dst = new Uint32Array(img.data.buffer);
    const at = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : src[j * w + i]);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const P = at(i, j), A = at(i, j - 1), B = at(i + 1, j), C = at(i - 1, j), D = at(i, j + 1), o0 = (j * 2) * w * 2 + i * 2, o1 = o0 + w * 2;
      dst[o0] = C === A && C !== D && A !== B ? A : P;
      dst[o0 + 1] = A === B && A !== C && B !== D ? B : P;
      dst[o1] = D === C && D !== B && C !== A ? C : P;
      dst[o1 + 1] = B === D && B !== A && D !== C ? D : P;
    }
    x.putImageData(img, 0, 0);
    return o;
  }
  // light from the top left: pixels near the upper-left edge of a shape brighten, near the lower-right edge darken
  function volume(c) {
    const x = c.getContext('2d'), w = c.width, h = c.height, d = x.getImageData(0, 0, w, h), a = d.data, al = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : a[(j * w + i) * 4 + 3]);
    const src = new Uint8ClampedArray(a);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4; if (src[k + 3] < 40) continue;
      let f = 0;
      if (!al(i - 2, j) || !al(i, j - 2)) f += 0.16;
      if (!al(i + 2, j) || !al(i, j + 2)) f -= 0.2;
      if (!f) continue;
      for (let ch = 0; ch < 3; ch++) a[k + ch] = f > 0 ? src[k + ch] + (255 - src[k + ch]) * f : src[k + ch] * (1 + f);
    }
    x.putImageData(d, 0, 0);
    return c;
  }
  function remaster(c) { const o = outline(volume(scale2x(c)), '#231d2a'); o.lw = c.lw || c.width; o.lh = c.lh || c.height; return o; }
  function hash(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  const rect = (x, X, Y, w, h, col) => { x.fillStyle = col; x.fillRect(X, Y, w, h); };
  // bevelled box: light top edge, dark bottom/right edge, optional top surface colour
  function box(x, X, Y, w, h, col, top) {
    x.fillStyle = col; x.fillRect(X, Y, w, h);
    x.fillStyle = shade(col, -0.25); x.fillRect(X, Y + h - 1, w, 1); x.fillRect(X + w - 1, Y, 1, h);
    x.fillStyle = shade(col, 0.15); x.fillRect(X, Y, w - 1, 1);
    if (top) { x.fillStyle = top; x.fillRect(X, Y, w, Math.min(3, h)); x.fillStyle = shade(top, 0.15); x.fillRect(X, Y, w, 1); }
  }
  function blob(x, cx, cy, rx, ry, col, o) {
    o = o || {};
    const dark = o.dark || shade(col, -0.3), light = o.light || shade(col, 0.35);
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
  const srnd = (() => { let s = 97531; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

  // ======================= PEOPLE =======================
  const SKINS = ['#f3cfa6', '#e0b088', '#c88a5c', '#8d5a3b', '#f6d7bb', '#b07a52', '#f0c4a0', '#6e4630'];
  const HAIRS = ['#2a1a12', '#6b3a1e', '#c98a3a', '#e8d07a', '#1a1a1a', '#9a3b2a', '#6a6a70', '#d1a05a'];
  const SHIRTS = ['#e8533f', '#3c7bd6', '#39a85a', '#e5a62a', '#8e5bd6', '#1f8f87', '#d64f8e', '#7a8ca0', '#c43c2c', '#4a70b8'];
  const PANTS = ['#2b2e3a', '#3a3f5c', '#5a4634', '#2f4a3a', '#444', '#1d2029', '#6b4a7a', '#8a6a44'];
  // eight patient looks: outfit + hairstyle + accessories
  function look(i) {
    const k = i % 8;
    return { skin: SKINS[k], hair: HAIRS[(i * 3 + 1) % 8], shirt: SHIRTS[(i * 5 + 2) % 10], pants: PANTS[(i * 7 + 3) % 8],
      longHair: k === 1 || k === 6, bun: k === 3, dress: k === 1 || k === 3, glasses: k === 2 || k === 7, cap: k === 4, mustache: k === 5, beard: k === 7 };
  }

  // o: look + { coat: 'doctor'|'nurse'|'recep', dis: disease id or null }
  function drawPerson(o, dir, f, raw, sit) {
    const [c, x] = canvas(16, 24);
    const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
    const d = o.dis || '', side = dir === 'left', back = dir === 'up';
    const fur = d === 'fur', invis = d === 'invis', green = d === 'gut' || d === 'green', big = d === 'balloon', tv = d === 'tv';
    const transp = d === 'transp', jelly = d === 'jelly', rad = d === 'rad', alien = d === 'alien', king = d === 'king', burns = d === 'burns';
    const skin = fur ? '#8a5a2e' : green ? '#8fc46a' : transp ? '#d6eef6' : jelly ? '#7fd66e' : rad ? '#b4f06a' : alien ? '#7fb069' : o.skin, skinD = shade(skin, -0.18);
    const hair = fur ? '#5a3418' : king ? '#141418' : o.hair, hairD = shade(hair, -0.3);
    let shirt = o.shirt, pants = o.pants, shoes = '#17181f';
    let dress = o.dress;
    if (o.coat === 'doctor') { shirt = '#f4f4f0'; pants = '#2b2e3a'; dress = false; }
    if (o.coat === 'surgeon') { shirt = '#5fae8a'; pants = '#5fae8a'; dress = false; shoes = '#f4f4f0'; }
    if (o.coat === 'vip') { shirt = '#26283a'; pants = '#1d1f2c'; dress = false; }
    if (o.coat === 'insp') { shirt = '#6a6f7a'; pants = '#4a4f5a'; dress = false; }
    if (king) { shirt = '#f4f4f0'; pants = '#f4f4f0'; dress = false; }
    if (jelly) { shirt = shade(shirt, 0.15); }
    if (o.coat === 'nurse') { shirt = '#6fa9e0'; pants = '#6fa9e0'; dress = true; shoes = '#f4f4f0'; }
    if (o.coat === 'recep') { shirt = '#d9579a'; pants = '#3a3f5c'; dress = false; }
    if (o.coat === 'handy') { shirt = '#3c6fb0'; pants = '#3c6fb0'; dress = false; }
    if (o.coat === 'mgr') { dress = !!o.dress; }
    if (d === 'royal') { shirt = '#7a2ea0'; }
    const coat = fur ? skin : shirt, coatD = shade(coat, -0.28), coatL = shade(coat, 0.18);
    const lUp = f === 1 ? 1 : 0, rUp = f === 2 ? 1 : 0;

    // ----- legs / skirt -----
    // seated: the head and body sit 3px lower and the lap and legs are drawn over them at the end
    if (sit) x.translate(0, 3);
    else if (!side) {
      if (dress) {
        R(3, 17, 10, 5, coat); R(3, 21, 10, 1, coatD); R(12, 17, 1, 5, coatD); R(3, 17, 1, 4, coatL);
        if (!invis) { R(5, 22 - lUp, 2, 1, skin); R(9, 22 - rUp, 2, 1, skin); }
        R(4, 23 - lUp, 3, 1, shoes); R(9, 23 - rUp, 3, 1, shoes);
      } else {
        R(5, 19 - lUp, 2, 4, pants); R(9, 19 - rUp, 2, 4, shade(pants, -0.12));
        R(4, 23 - lUp, 3, 1, shoes); R(9, 23 - rUp, 3, 1, shoes);
      }
    } else {
      const apart = f !== 0;
      if (dress) {
        R(4, 17, 8, 5, coat); R(4, 21, 8, 1, coatD); R(4, 17, 1, 4, coatL);
        if (apart) { if (!invis) { R(4, 22, 2, 1, skin); R(9, 22, 2, 1, skinD); } R(3, 23, 3, 1, shoes); R(9, 23, 3, 1, shoes); }
        else { if (!invis) R(6, 22, 3, 1, skin); R(5, 23, 4, 1, shoes); }
      } else if (apart) {
        R(9, 19, 2, 4, f === 1 ? shade(pants, -0.2) : pants); R(5, 19, 2, 4, f === 1 ? pants : shade(pants, -0.2));
        R(4, 23, 3, 1, shoes); R(9, 23, 3, 1, shoes);
      } else { R(6, 19, 4, 4, pants); R(8, 19, 1, 4, shade(pants, -0.15)); R(5, 23, 5, 1, shoes); }
    }

    // ----- body -----
    const bx = side ? 5 : 4, bw = side ? 6 : 8;
    const tall = o.coat === 'doctor' ? 9 : 8;
    R(bx, 11, bw, tall, coat); R(bx, 10 + tall, bw, 1, coatD); R(bx + bw - 1, 11, 1, tall, coatD); R(bx, 11, 1, tall - 1, coatL);
    if (fur) for (let i = 0; i < bw; i += 2) R(bx + i, 10 + (i % 4 ? 0 : -1) + 1, 1, 1, skin);
    if (dress && !side && o.coat !== 'mgr') R(4, 15, 8, 1, coatD);
    if (!back && !side) {
      if (o.coat === 'doctor') { R(6, 11, 4, 4, '#9fc4e8'); R(7, 11, 2, 1, '#2b2e3a'); R(7, 12, 1, 3, '#c43c2c'); R(5, 11, 1, 5, '#e0e0da'); R(10, 11, 1, 5, '#e0e0da'); R(5, 14, 1, 2, '#9aa0a8'); R(10, 14, 1, 2, '#9aa0a8'); R(6, 16, 4, 1, '#9aa0a8'); R(7, 17, 2, 1, '#6a7078'); }
      else if (o.coat === 'nurse') { R(5, 13, 6, 6, '#ffffff'); R(5, 12, 2, 1, '#ffffff'); R(9, 12, 2, 1, '#ffffff'); R(7, 14, 2, 1, '#e8533f'); R(6, 15, 4, 1, '#e8533f'); R(7, 16, 2, 1, '#e8533f'); }
      else if (o.coat === 'recep') { R(7, 11, 2, 2, '#f4f4f0'); R(4, 11, 1, 3, '#2b2e3a'); R(3, 11, 2, 1, '#2b2e3a'); }
      else if (o.coat === 'handy') { R(6, 11, 4, 2, '#f4f0e6'); R(5, 13, 1, 4, '#f4f0e6'); R(10, 13, 1, 4, '#f4f0e6'); R(6, 15, 4, 3, '#2f5a90'); }
      else if (o.coat === 'mgr') { R(6, 11, 4, 4, '#f4f4f0'); R(5, 11, 1, 6, coatL); R(10, 11, 1, 6, coatL); if (o.notie) { R(7, 12, 2, 1, '#e3b341'); } else { R(7, 11, 2, 1, '#2b2e3a'); R(7, 12, 1, 4, o.tie || '#c43c2c'); } R(4, 17, 1, 1, '#e3b341'); }
      else if (o.coat === 'surgeon') { R(6, 11, 4, 2, '#4a9474'); R(7, 13, 2, 1, '#4a9474'); }
      else if (o.coat === 'vip') { R(6, 11, 4, 4, '#f4f4f0'); R(7, 11, 2, 1, '#c43c2c'); R(7, 12, 2, 3, '#c43c2c'); R(4, 12, 1, 6, '#e3b341'); R(5, 13, 1, 1, '#e3b341'); R(6, 14, 1, 1, '#e3b341'); R(10, 12, 1, 1, '#e3b341'); }
      else if (o.coat === 'insp') { R(6, 11, 4, 3, '#f4f4f0'); R(7, 11, 2, 4, '#2b2e3a'); R(10, 13, 1, 2, '#e3b341'); }
      else if (king) { R(5, 11, 6, 2, '#e3b341'); R(7, 13, 2, 5, '#e3b341'); R(4, 17, 8, 1, '#e3b341'); R(7, 18, 2, 1, '#ffd23f'); }
      else if (d === 'ribs') { for (let j = 12; j < 18; j += 2) R(5, j, 6, 1, '#f4f0e6'); R(7, 11, 2, 7, '#f4f0e6'); }
      else if (!fur) { R(7, 11, 2, 2, coatL); R(7, 14, 1, 1, coatD); R(7, 16, 1, 1, coatD); }
    }
    // ----- arms -----
    if (!side) {
      const la = f === 1 ? -1 : 0, ra = f === 2 ? -1 : 0;
      R(3, 11, 1, 6 + la, coatD); R(12, 11, 1, 6 + ra, coatD);
      if (!invis) { R(3, 17 + la, 1, 1, skin); R(12, 17 + ra, 1, 1, skin); }
      if (d === 'bones') { R(12, 11, 1, 7, '#ffffff'); R(11, 14, 2, 2, '#ffffff'); R(10, 13, 1, 1, '#9fd8ff'); }
    } else {
      const hx = f === 1 ? 5 : f === 2 ? 9 : 7;
      R(7, 11, 2, 5, coatD); R(hx === 7 ? 7 : hx, 16, 2, 1, coatD); if (!invis) R(hx === 7 ? 7 : hx, 17, 2, 1, skin);
    }

    if (o.clip && !back) { if (!side) { R(1, 14, 4, 5, '#8a6a44'); R(2, 15, 2, 3, '#f4f4f0'); R(2, 13, 2, 1, '#6a7078'); } else { R(2, 14, 3, 5, '#8a6a44'); R(3, 15, 1, 3, '#f4f4f0'); } }
    // ----- head -----
    if (tv) {
      R(3, 1, 10, 9, '#8a8f99'); R(3, 1, 10, 1, '#b8bcc4'); R(12, 1, 1, 9, '#5c6068'); R(4, 2, 8, 6, '#1d2a3a');
      R(5, 3, 3, 2, '#6fd3ff'); R(9, 5, 2, 1, '#6fd3ff'); R(5, 6, 6, 1, '#2f5a7a'); R(11, 8, 1, 1, '#e8533f');
      R(7, 0, 1, 1, '#c8ccd4'); R(5, -1, 1, 2, '#c8ccd4'); R(9, -1, 1, 2, '#c8ccd4');
      R(6, 10, 4, 1, skinD);
    } else if (big) {
      blob(x, 8, 5.5, 6.4, 5.6, skin, { light: shade(skin, 0.3) });
      R(6, 10, 4, 1, skinD);
      if (!back) {
        if (side) { R(4, 5, 1, 1, OUT); R(2, 7, 2, 1, skinD); R(3, 8, 2, 1, '#c0604a'); }
        else { R(5, 5, 1, 1, OUT); R(10, 5, 1, 1, OUT); R(6, 8, 4, 1, '#c0604a'); R(4, 7, 1, 1, '#e8a090'); R(11, 7, 1, 1, '#e8a090'); }
        R(6, 1, 2, 1, shade(skin, 0.5));
      } else { R(4, 1, 8, 3, hair); }
    } else if (alien) {
      blob(x, 8, 5, 5.6, 5.4, skin, { light: shade(skin, 0.3) }); R(6, 9, 4, 2, skin); R(7, 10, 2, 1, skinD);
      if (!back) {
        if (side) { R(4, 4, 2, 3, OUT); R(4, 4, 1, 1, '#6fd3ff'); }
        else { R(4, 4, 3, 3, OUT); R(9, 4, 3, 3, OUT); R(4, 4, 1, 1, '#9fffa0'); R(9, 4, 1, 1, '#9fffa0'); R(7, 8, 2, 1, OUT); }
      }
    } else if (!invis) {
      R(4, 3, 8, 8, skin); R(11, 4, 1, 6, skinD);
      x.clearRect(4, 3, 1, 1); x.clearRect(11, 3, 1, 1); x.clearRect(4, 10, 1, 1); x.clearRect(11, 10, 1, 1);
      R(6, 10, 4, 1, skinD);
      const bald = d === 'bald';
      if (back) {
        if (!bald) { R(4, 3, 8, 7, hair); R(5, 2, 6, 1, hair); R(4, 9, 8, 1, hairD); x.clearRect(4, 3, 1, 1); x.clearRect(11, 3, 1, 1); }
        else { R(5, 2, 6, 1, skin); R(6, 3, 2, 1, '#ffffff'); }
        if (o.longHair && !bald) { R(4, 10, 8, 4, hair); R(4, 13, 8, 1, hairD); }
        if (o.bun && !bald) { R(6, 0, 4, 3, hair); R(7, 0, 2, 1, shade(hair, 0.25)); }
      } else if (side) {
        if (!bald) { R(4, 2, 7, 2, hair); R(8, 3, 4, 6, hair); R(8, 8, 3, 1, hairD); R(9, 4, 1, 1, shade(hair, 0.2)); }
        else { R(5, 2, 6, 1, skin); R(6, 2, 2, 1, '#ffffff'); }
        if (o.longHair && !bald) { R(8, 9, 4, 5, hair); R(9, 13, 3, 1, hairD); }
        if (o.bun && !bald) R(9, 0, 3, 3, hair);
        if (d === 'sleep') R(4, 7, 2, 1, OUT); else R(5, 7, 1, 1, OUT);
        R(3, 7, 1, 2, skin); if (d === 'cold') { R(3, 7, 1, 2, '#e8533f'); R(3, 9, 1, 1, '#9fd8ff'); }
        if (o.mustache) R(3, 9, 3, 1, hair);
        if (o.beard) { R(3, 9, 5, 2, hair); R(4, 8, 1, 1, hair); }
        if (o.glasses) { R(4, 6, 3, 1, '#20202a'); R(4, 7, 1, 1, '#20202a'); R(6, 7, 1, 1, '#20202a'); }
        if (d === 'tongue') { R(3, 9, 2, 5, '#ff6b9a'); R(3, 12, 2, 2, '#e04a7a'); }
      } else {
        if (!bald) { R(5, 2, 6, 1, hair); R(4, 3, 8, 2, hair); R(4, 5, 1, 2, hair); R(11, 5, 1, 2, hair); R(5, 3, 3, 1, shade(hair, 0.2)); x.clearRect(4, 3, 1, 1); x.clearRect(11, 3, 1, 1); }
        else { R(5, 2, 6, 1, skin); R(6, 2, 2, 1, '#ffffff'); R(5, 3, 1, 1, '#ffffff'); }
        if (o.longHair && !bald) { R(3, 4, 1, 9, hair); R(12, 4, 1, 9, hair); R(4, 7, 1, 5, hair); R(11, 7, 1, 5, hair); }
        if (o.bun && !bald) { R(6, 0, 4, 2, hair); R(7, 0, 2, 1, shade(hair, 0.25)); }
        if (d === 'sleep') { R(6, 7, 2, 1, OUT); R(9, 7, 2, 1, OUT); } else { R(6, 7, 1, 1, OUT); R(9, 7, 1, 1, OUT); }
        R(5, 8, 1, 1, shade(skin, -0.06)); R(10, 8, 1, 1, shade(skin, -0.06));
        if (d === 'cold') { R(7, 7, 2, 2, '#e8533f'); R(8, 9, 1, 1, '#9fd8ff'); } else R(7, 9, 2, 1, '#c0604a');
        if (o.mustache) R(6, 9, 4, 1, hair);
        if (o.beard) { R(5, 8, 1, 2, hair); R(10, 8, 1, 2, hair); R(5, 10, 6, 1, hair); R(6, 9, 4, 1, hair); }
        if (o.glasses) { R(5, 6, 3, 1, '#20202a'); R(8, 6, 3, 1, '#20202a'); R(5, 7, 1, 1, '#20202a'); R(10, 7, 1, 1, '#20202a'); R(7, 7, 2, 1, '#20202a'); }
        if (d === 'tongue') { R(7, 10, 2, 5, '#ff6b9a'); R(7, 13, 2, 2, '#e04a7a'); }
        if (d === 'bones') { R(4, 3, 8, 2, '#ffffff'); R(4, 5, 1, 2, '#ffffff'); R(6, 4, 1, 1, '#e8e8e8'); }
      }
      if (fur) { for (let i = 4; i < 12; i += 2) R(i, 2 + (i % 4 ? 0 : -1), 1, 1, skin); R(3, 5, 1, 3, skin); R(12, 5, 1, 3, skin); }
      if (transp && !back) { if (side) { R(4, 6, 2, 2, '#7a8ca0'); R(4, 9, 3, 1, '#9fb4c6'); } else { R(5, 6, 2, 2, '#7a8ca0'); R(9, 6, 2, 2, '#7a8ca0'); R(6, 9, 4, 1, '#9fb4c6'); R(7, 8, 2, 1, '#9fb4c6'); } }
      if (jelly) { R(5, 4, 2, 1, '#d6ffc8'); R(5, 5, 1, 1, '#d6ffc8'); R(10, 9, 1, 1, shade(skin, -0.3)); }
      if (rad && !back) { R(5, 4, 1, 1, '#f4ffd0'); R(10, 9, 1, 1, '#f4ffd0'); }
      if ((burns || king) && !back) { const sb = king ? hair : hair; if (side) { R(8, 5, 2, 5, sb); } else { R(4, 5, 2, 5, sb); R(10, 5, 2, 5, sb); R(4, 9, 1, 1, sb); R(11, 9, 1, 1, sb); } }
      if (king && !back) { if (side) { R(2, 1, 8, 2, hair); R(3, 0, 5, 1, hair); R(3, 6, 3, 1, '#e3b341'); } else { R(4, 0, 8, 3, hair); R(5, -1, 5, 1, hair); R(5, 6, 6, 1, '#e3b341'); R(5, 7, 2, 1, '#e3b341'); R(9, 7, 2, 1, '#e3b341'); } }
      if (burns && !side && !back) { R(4, 11, 2, 2, coatL); R(10, 11, 2, 2, coatL); }
      if (o.quiff && !bald && !back) { if (side) { R(3, 1, 6, 1, hair); R(4, 0, 4, 1, hair); } else { R(5, 1, 5, 1, hair); R(6, 0, 3, 1, hair); R(10, 2, 1, 1, shade(hair, 0.25)); } }
      if (o.earrings && !back) { if (side) R(9, 8, 1, 2, '#e3b341'); else { R(4, 8, 1, 2, '#e3b341'); R(11, 8, 1, 2, '#e3b341'); } }
      if (o.cap && !bald && !back) { R(4, 1, 8, 3, '#2a4a7a'); R(4, 4, 8, 1, '#1a2a4a'); if (!side) R(3, 4, 10, 1, '#1a2a4a'); else R(2, 4, 8, 1, '#1a2a4a'); }
      if (o.cap && back) { R(4, 1, 8, 3, '#2a4a7a'); }
    } else {
      // invisibility: only the clothes, plus a pair of glasses hovering where the face was
      if (!back) { R(5, 6, 3, 1, OUT); R(8, 6, 3, 1, OUT); R(5, 7, 1, 1, OUT); R(10, 7, 1, 1, OUT); R(6, 7, 1, 1, '#9fd8ff'); R(9, 7, 1, 1, '#9fd8ff'); }
    }
    if (d === 'royal') { R(5, 0, 6, 2, '#ffd23f'); R(5, -1, 1, 1, '#ffd23f'); R(8, -1, 1, 1, '#ffd23f'); R(10, -1, 1, 1, '#ffd23f'); R(7, 0, 1, 1, '#e8533f'); R(8, 1, 1, 1, '#3c7bd6'); }
    if (o.coat === 'nurse' && !big && !tv) { R(5, 1, 6, 2, '#ffffff'); R(7, 1, 2, 1, '#e8533f'); }
    if (o.coat === 'surgeon') { R(4, 2, 8, 2, '#5fae8a'); R(4, 1, 8, 1, '#4a9474'); if (!back && !side) R(5, 8, 6, 3, '#9fd4bc'); }
    if (o.tophat) { R(3, 2, 10, 1, '#1d1f2c'); R(5, -1, 6, 3, '#26283a'); R(5, 1, 6, 1, '#c43c2c'); R(6, -1, 2, 1, '#4a4f6a'); }
    if (o.coat === 'insp' && !o.tophat) { R(3, 2, 10, 1, '#3a3f48'); R(5, 0, 6, 2, '#4a4f5a'); }
    if (o.coat === 'recep' && !side) { R(3, 6, 1, 3, '#2b2e3a'); R(3, 9, 2, 1, '#2b2e3a'); }
    if (sit) {
      x.setTransform(HI, 0, 0, HI, 0, 0);
      // hips on the seat (about 4px up), thighs forward over the lap, short shins down to the floor
      const leg = dress ? coat : pants, legD = shade(leg, -0.18), shin = dress && !invis ? skin : leg;
      if (back) { R(4, 20, 8, 2, leg); R(4, 21, 8, 1, legD); R(4, 23, 3, 1, shoes); R(9, 23, 3, 1, shoes); }
      else if (side) {
        R(2, 19, 8, 2, leg); R(2, 19, 8, 1, shade(leg, 0.15)); R(2, 20.5, 8, 0.5, legD);   // thighs out in front
        R(2, 21, 2, 2, shin); R(3, 21, 1, 2, shade(shin, -0.15)); R(0, 23, 4, 1, shoes);      // a shin and a shoe
      } else {
        R(4, 19, 8, 3, leg); R(4, 19, 8, 1, shade(leg, 0.15)); R(4, 21, 8, 1, legD); R(8, 19, 1, 3, legD);   // the lap
        R(5, 22, 2, 1, shin); R(9, 22, 2, 1, shade(shin, -0.12)); R(4, 23, 3, 1, shoes); R(9, 23, 3, 1, shoes);
      }
    }
    return raw ? c : outline(c);
  }
  // the remastered person: upscaled and shaded, then given highlights only possible at the higher resolution
  function hiPerson(o, dir, f, sit) {
    const c = remaster(drawPerson(o, dir, f, true, sit)), x = c.getContext('2d');
    const P = (X, Y, w, h, col) => { x.fillStyle = col; x.fillRect(X, Y, w, h); };   // in remastered pixels (half a logical pixel)
    const d = o.dis || '', plainHead = !['tv', 'balloon', 'alien', 'invis'].includes(d);
    if (plainHead && dir === 'down' && d !== 'sleep') { P(12, 14, 1, 1, '#ffffff'); P(18, 14, 1, 1, '#ffffff'); }   // a glint in each eye
    if (plainHead && dir === 'down') { x.globalAlpha = 0.35; P(10, 17, 2, 1, '#e8806a'); P(20, 17, 2, 1, '#e8806a'); x.globalAlpha = 1; }   // cheeks
    if (plainHead && dir === 'left' && d !== 'sleep') P(10, 14, 1, 1, '#ffffff');
    return c;
  }
  const personCache = {};
  function personSheet(key, o) {
    if (personCache[key]) return personCache[key];
    const sh = {};
    for (const d of ['down', 'up', 'left']) sh[d] = [0, 1, 2].map(f => hiPerson(o, d, f));
    sh.right = sh.left.map(flipH);
    // one seated pose per direction
    sh.sit = { down: hiPerson(o, 'down', 0, true), up: hiPerson(o, 'up', 0, true), left: hiPerson(o, 'left', 0, true) };
    sh.sit.right = flipH(sh.sit.left);
    return (personCache[key] = sh);
  }
  const patientSheet = (lookIdx, dis) => personSheet('p' + lookIdx + ':' + (dis || ''), Object.assign(look(lookIdx), { dis }));
  // kind 'd' doctor, 's' doctor with the surgeon qualification (scrubs), 'n' nurse, 'h' handyman, 'r' receptionist
  const staffSheet = (lookIdx, kind) => personSheet('s' + lookIdx + ':' + kind, Object.assign(look(lookIdx), { longHair: false, bun: kind === 'n' && lookIdx % 2 === 0, dress: false, coat: kind === 'd' ? 'doctor' : kind === 's' ? 'surgeon' : kind === 'n' ? 'nurse' : kind === 'h' ? 'handy' : 'recep', cap: kind === 'h' }));
  const vipSheet = () => personSheet('vip', { skin: '#e0b088', hair: '#6a6a70', shirt: '#26283a', pants: '#1d1f2c', coat: 'vip', tophat: true, mustache: true });
  const inspSheet = () => personSheet('insp', { skin: '#f0c4a0', hair: '#2a1a12', shirt: '#6a6f7a', pants: '#4a4f5a', coat: 'insp', glasses: true, clip: true });
  // the two playable hospital managers
  const AVATARS = [
    { id: 'max', name: 'Max', skin: '#e0b088', hair: '#4a2e1e', shirt: '#2a3a6a', pants: '#1d2029', quiff: true, tie: '#c43c2c', coat: 'mgr', clip: true },
    { id: 'zoe', name: 'Zoe', skin: '#f0c4a0', hair: '#c98a3a', shirt: '#8a2f38', pants: '#2b2e3a', longHair: true, notie: true, earrings: true, coat: 'mgr', clip: true },
  ];
  const managerSheet = av => personSheet('m' + av, AVATARS[av] || AVATARS[0]);
  const portraitCache = {};
  function portrait(av, size) {
    const key = av + ':' + size;
    if (portraitCache[key]) return portraitCache[key];
    const [c, x] = canvas(size, size);
    const g = x.createLinearGradient(0, 0, 0, size); g.addColorStop(0, av ? '#2a6f6a' : '#2a3a6a'); g.addColorStop(1, av ? '#154a46' : '#141f3a');
    x.fillStyle = g; x.fillRect(0, 0, size, size);
    const m = managerSheet(av).down[0], k = m.width / 16;
    x.drawImage(m, 0, 0, 16 * k, 14 * k, 0, size * 0.14, size, size * 0.875);
    return (portraitCache[key] = c);
  }
  // the advisor who talks you through the game: a doctor with a head mirror, glasses and a bow tie. talk = mouth open
  const advCache = {};
  function advisorFace(talk) { const key = talk ? 1 : 0; return advCache[key] || (advCache[key] = hiRes(() => drawAdvisor(talk))); }
  function drawAdvisor(talk) {
    const [c, x] = canvas(40, 44);
    const ell = (X, Y, rx, ry, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(X, Y, rx, ry, 0, 0, Math.PI * 2); x.fill(); };
    // white coat, shoulders and lapels
    x.fillStyle = '#f4f4f0'; x.beginPath(); x.moveTo(3, 44); x.quadraticCurveTo(4, 31, 20, 30); x.quadraticCurveTo(36, 31, 37, 44); x.fill();
    rect(x, 15, 31, 10, 13, '#9fc6e8'); rect(x, 19, 31, 2, 13, '#3c7bd6');
    x.fillStyle = '#dcdcd6'; x.beginPath(); x.moveTo(14, 31); x.lineTo(19, 44); x.lineTo(12, 44); x.fill(); x.beginPath(); x.moveTo(26, 31); x.lineTo(21, 44); x.lineTo(28, 44); x.fill();
    rect(x, 15, 32, 4, 3, '#e8762f'); rect(x, 21, 32, 4, 3, '#e8762f'); rect(x, 19, 32, 2, 3, '#c45a1c');   // bow tie
    rect(x, 17, 26, 6, 6, '#e8b48a');   // neck
    // head, ears, ginger hair round a bald crown
    ell(20, 17, 10, 11, '#f2c49a'); ell(9.5, 18, 2, 3, '#e8b48a'); ell(30.5, 18, 2, 3, '#e8b48a');
    ell(10, 13, 3, 5, '#d9772f'); ell(30, 13, 3, 5, '#d9772f'); rect(x, 8, 10, 3, 6, '#d9772f'); rect(x, 29, 10, 3, 6, '#d9772f');
    ell(20, 8, 7, 3, '#f7d4ae');
    // head mirror on its band
    rect(x, 11, 9, 18, 2, '#4a4d55'); ell(16, 8, 4, 4, '#c8ced8'); ell(16, 8, 2.6, 2.6, '#eef4fa'); rect(x, 15, 7, 1, 1, '#ffffff');
    // glasses, eyes, brows, nose
    x.strokeStyle = '#2b2e3a'; x.lineWidth = 1; x.beginPath(); x.arc(15.5, 18, 3, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.arc(24.5, 18, 3, 0, Math.PI * 2); x.stroke(); rect(x, 18, 17, 4, 1, '#2b2e3a');
    rect(x, 15, 18, 2, 2, '#2b2e3a'); rect(x, 24, 18, 2, 2, '#2b2e3a'); rect(x, 13, 13, 5, 1, '#b8601f'); rect(x, 22, 13, 5, 1, '#b8601f');
    rect(x, 19, 20, 2, 4, '#e0a47a');
    // moustache and mouth
    rect(x, 15, 24, 10, 2, '#c8642a'); rect(x, 14, 25, 2, 1, '#c8642a'); rect(x, 24, 25, 2, 1, '#c8642a');
    if (talk) { ell(20, 28, 3, 2, '#7a2a2a'); rect(x, 18, 27, 4, 1, '#ffffff'); } else rect(x, 17, 27, 6, 1, '#9a4a3a');
    return outline(c);
  }
  function ghost() { return hiRes(drawGhost); }
  function drawGhost() {
    const [c, x] = canvas(14, 16);
    blob(x, 7, 6, 5, 5.5, '#eef2ff', { flat: true });
    rect(x, 2, 8, 10, 5, '#eef2ff'); rect(x, 2, 13, 2, 2, '#eef2ff'); rect(x, 6, 13, 2, 2, '#eef2ff'); rect(x, 10, 13, 2, 2, '#eef2ff');
    rect(x, 4, 5, 2, 2, '#2a2a40'); rect(x, 8, 5, 2, 2, '#2a2a40'); rect(x, 6, 9, 2, 1, '#2a2a40');
    return outline(c, '#8890b8');
  }

  // ======================= BILLBOARD SPRITES (drawn upright in the iso view) =======================
  const FURN = {
    plant() {
      const [c, x] = canvas(16, 26);
      box(x, 4, 18, 8, 8, '#b5643c'); rect(x, 4, 18, 8, 2, '#8f4a2a');
      const leaf = (X, Y, r, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(X, Y, r, r * 0.7, 0, 0, Math.PI * 2); x.fill(); };
      leaf(8, 12, 7, '#2e6b3a'); leaf(4, 8, 4, '#3a8a48'); leaf(12, 7, 4, '#3a8a48'); leaf(8, 4, 4, '#4aa45a'); leaf(6, 13, 3, '#255a30');
      rect(x, 7, 2, 2, 1, '#7acb7a'); rect(x, 3, 6, 2, 1, '#7acb7a'); rect(x, 11, 5, 2, 1, '#7acb7a');
      return outline(c);
    },
    lamp() { const [c, x] = canvas(10, 30); rect(x, 4, 8, 2, 20, '#d9a93a'); rect(x, 1, 27, 8, 3, '#8a6a2a'); rect(x, 0, 0, 10, 9, '#f2d9a4'); rect(x, 1, 0, 8, 1, '#fff6c8'); rect(x, 0, 8, 10, 1, '#c8a870'); return outline(c); },
    tree() {
      const [c, x] = canvas(24, 30);
      rect(x, 10, 20, 4, 10, '#6b4320'); rect(x, 11, 20, 1, 10, '#8a5a34');
      const leaf = (X, Y, r, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(X, Y, r, r * 0.8, 0, 0, Math.PI * 2); x.fill(); };
      leaf(12, 13, 11, '#2e6b3a'); leaf(7, 10, 6, '#3a8a48'); leaf(16, 8, 6, '#3a8a48'); leaf(12, 5, 5, '#4aa45a'); leaf(9, 17, 4, '#255a30');
      rect(x, 6, 9, 2, 1, '#ff6b9a'); rect(x, 15, 6, 2, 1, '#ff6b9a'); rect(x, 12, 12, 2, 1, '#ffd23f');
      return outline(c);
    },
    // Theme Hospital's grounds: a big round tree, a street lamp
    bigtree() {
      const [c, x] = canvas(34, 46);
      rect(x, 15, 30, 4, 16, '#6b4320'); rect(x, 16, 30, 1, 16, '#8a5a34'); rect(x, 13, 44, 8, 2, '#5a3a1c');
      const leaf = (X, Y, r, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(X, Y, r, r * 0.9, 0, 0, Math.PI * 2); x.fill(); };
      leaf(17, 20, 15, '#2a7a2a'); leaf(10, 24, 8, '#256a26'); leaf(25, 23, 8, '#256a26');
      leaf(12, 15, 8, '#3a9a36'); leaf(22, 13, 8, '#3a9a36'); leaf(17, 8, 7, '#48ad40'); leaf(14, 19, 6, '#48ad40');
      leaf(12, 12, 3, '#6fcf5a'); leaf(20, 7, 3, '#6fcf5a'); leaf(24, 15, 2, '#6fcf5a'); leaf(9, 20, 2, '#5cbd4c');
      for (let i = 0; i < 26; i++) rect(x, 4 + Math.floor(hash(i, 5) * 26), 4 + Math.floor(hash(i, 9) * 26), 1, 1, i % 2 ? '#1f5a20' : '#7ad86a');
      return outline(c);
    },
    streetlamp() {
      const [c, x] = canvas(14, 44);
      rect(x, 3, 41, 6, 3, '#4a4d55'); rect(x, 5, 8, 2, 34, '#5c6068'); rect(x, 5, 8, 1, 34, '#8a8f99');
      rect(x, 6, 5, 6, 2, '#5c6068'); rect(x, 9, 4, 5, 4, '#3a3d44'); rect(x, 10, 7, 3, 2, '#fff2a8'); rect(x, 10, 8, 3, 1, '#ffd23f');
      return outline(c);
    },
    bush() { const [c, x] = canvas(18, 12); const leaf = (X, Y, r, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(X, Y, r, r * 0.75, 0, 0, Math.PI * 2); x.fill(); }; leaf(9, 7, 8, '#2e6b3a'); leaf(5, 5, 4, '#3a8a48'); leaf(12, 4, 4, '#4aa45a'); rect(x, 4, 3, 1, 1, '#7acb7a'); rect(x, 13, 7, 1, 1, '#7acb7a'); return outline(c); },
    sign() { const [c, x] = canvas(24, 16); rect(x, 11, 10, 2, 6, '#6b7280'); box(x, 0, 0, 24, 11, '#f4f4f0', '#ffffff'); rect(x, 3, 2, 18, 7, '#3c7bd6'); rect(x, 10, 3, 4, 5, '#ffffff'); rect(x, 8, 4, 8, 3, '#ffffff'); rect(x, 11, 4, 2, 3, '#e8533f'); rect(x, 10, 5, 4, 1, '#e8533f'); return outline(c); },
    deadplant() {
      const [c, x] = canvas(16, 26);
      box(x, 4, 18, 8, 8, '#b5643c'); rect(x, 4, 18, 8, 2, '#8f4a2a');
      rect(x, 7, 8, 2, 10, '#7a5a2a'); rect(x, 4, 10, 3, 1, '#9a7a3a'); rect(x, 9, 12, 4, 1, '#9a7a3a'); rect(x, 3, 11, 1, 3, '#a88a4a'); rect(x, 12, 13, 1, 3, '#a88a4a');
      rect(x, 5, 16, 2, 2, '#b89a5a'); rect(x, 10, 17, 2, 1, '#b89a5a');
      return outline(c);
    },
    mop() { const [c, x] = canvas(8, 22); rect(x, 3, 0, 2, 16, '#c8a05a'); rect(x, 1, 15, 6, 5, '#e8e0d0'); rect(x, 0, 17, 8, 3, '#d6cdbc'); return outline(c); },
  };
  const furnCache = {};
  function furniture(name) { return furnCache[name] || (furnCache[name] = hiRes(FURN[name])); }

  // ======================= FLOORS, WALLS, MAP =======================
  const C = { grass: '#6fae4a', grassD: '#5f9a3e', pave: '#cfc8ba', paveD: '#bbb4a5', hall: '#eceef0', hallD: '#b9bec6', lot: '#cbc3b4', lotD: '#b8af9f' };
  function speckle(x, X, Y, w, h, col, n, seed) { for (let i = 0; i < n; i++) rect(x, X + Math.floor(hash(seed + i, X + Y) * (w - 1)), Y + Math.floor(hash(seed * 3 + i, X - Y) * (h - 1)), 1, 1, col); }
  // room floors: 'tile' (grout grid), 'plank' (wood grain), 'carpet' (pattern), 'lino' (big checks)
  function floor(x, X, Y, w, h, kind, a, b) {
    const q = 0.5;   // fine detail: half a logical pixel, one pixel on the remastered canvases
    rect(x, X, Y, w, h, a);
    if (kind === 'tile') {
      // glazed tiles: alternate shades, bevelled edges, a gloss streak, grout between
      for (let j = 0; j < h; j += 8) for (let i = 0; i < w; i += 8) {
        const c = ((i + j) / 8) % 2 ? b : a;
        rect(x, X + i, Y + j, 8, 8, c);
        rect(x, X + i, Y + j, 8, q, shade(c, 0.25)); rect(x, X + i, Y + j, q, 8, shade(c, 0.18));
        rect(x, X + i, Y + j + 8 - q, 8, q, shade(c, -0.18)); rect(x, X + i + 8 - q, Y + j, q, 8, shade(c, -0.14));
        rect(x, X + i + 1.5, Y + j + 1.5, 2, q, shade(c, 0.4));
      }
    } else if (kind === 'plank') {
      // floorboards: staggered seams, grain lines, a knot here and there, a highlight on each board's edge
      for (let j = 0; j < h; j += 5) {
        const tone = shade(a, (hash(j, X) - 0.5) * 0.1);
        rect(x, X, Y + j, w, 5, tone); rect(x, X, Y + j, w, q, shade(tone, 0.18)); rect(x, X, Y + j + 4.5, w, q, shade(a, -0.25));
        const off = (j / 5) % 2 ? 24 : 8;
        for (let i = off; i < w; i += 32) { rect(x, X + i, Y + j, q, 5, shade(a, -0.28)); rect(x, X + i + q, Y + j, q, 5, shade(a, 0.12)); }
        for (let i = 0; i < w; i += 3) if (hash(i, j + Y) < 0.6) rect(x, X + i + hash(j, i) * 2, Y + j + 1 + Math.floor(hash(i + 1, j) * 6) / 2, 2 + hash(i, j) * 3, q, shade(tone, -0.1));
        if (hash(j, w) < 0.4) { const kx = X + Math.floor(hash(j, 3) * (w - 4)); rect(x, kx, Y + j + 2, 1.5, 1, shade(a, -0.3)); }
      }
    } else if (kind === 'carpet') {
      // woven carpet: a fine twill and a small medallion pattern
      for (let j = 0; j < h; j += 1) for (let i = (j % 2) * q; i < w; i += 1) rect(x, X + i, Y + j, q, q, shade(a, -0.08));
      for (let j = 0; j < h; j += 4) for (let i = (j / 4) % 2 ? 2 : 0; i < w; i += 4) { rect(x, X + i, Y + j, 1.5, 1.5, b); rect(x, X + i, Y + j, 1.5, q, shade(b, 0.12)); }
      for (let j = 0; j < h; j += 16) for (let i = 0; i < w; i += 16) { rect(x, X + i + 6.5, Y + j + 7.5, 3, 1, shade(b, 0.25)); rect(x, X + i + 7.5, Y + j + 6.5, 1, 3, shade(b, 0.25)); rect(x, X + i + 7.5, Y + j + 7.5, 1, 1, shade(b, 0.45)); }
    } else {
      // lino: big checks with a soft speckle and a sheen
      for (let j = 0; j < h; j += 16) for (let i = 0; i < w; i += 16) { const c = ((i + j) / 16) % 2 ? b : a; rect(x, X + i, Y + j, 16, 16, c); rect(x, X + i, Y + j, 16, q, shade(a, 0.14)); rect(x, X + i, Y + j, q, 16, shade(a, 0.1)); }
      for (let i = 0; i < w * h / 6; i++) rect(x, X + Math.floor(hash(i, X + 7) * w * 2) / 2, Y + Math.floor(hash(Y + 3, i) * h * 2) / 2, q, q, shade(a, i % 2 ? -0.1 : 0.12));
    }
  }
  const ROOM_STYLE = {
    gp:     { floor: ['plank', '#c9a06a', '#b28a58'], wall: ['#d7c7a5', 'stripe'] },
    pharm:  { floor: ['tile', '#bfe3df', '#aed7d2'], wall: ['#a6d8d2', 'tiles'] },
    ward:   { floor: ['lino', '#dbe7f3', '#cbdaeb'], wall: ['#c3d7ea', 'dots'] },
    psych:  { floor: ['carpet', '#9a4a5a', '#8a3e4e'], wall: ['#6b3a48', 'stripe'] },
    infl:   { floor: ['tile', '#d9d9de', '#c9c9cf'], wall: ['#9aa3b8', 'tiles'] },
    tongue: { floor: ['tile', '#e6d2d7', '#d9c2c8'], wall: ['#d8a9b8', 'dots'] },
    hair:   { floor: ['plank', '#f0e0c4', '#dcc8a4'], wall: ['#e4c7a0', 'stripe'] },
    elec:   { floor: ['lino', '#cfd4e0', '#bfc5d4'], wall: ['#8e97ad', 'tiles'] },
    op:     { floor: ['tile', '#cfe8d8', '#bedbc8'], wall: ['#9fcbb2', 'tiles'] },
    gendiag: { floor: ['lino', '#e6dcc8', '#d8ccb4'], wall: ['#c9b48a', 'stripe'] },
    cardio: { floor: ['tile', '#f0d8d8', '#e4c8c8'], wall: ['#d89a9a', 'dots'] },
    xray:   { floor: ['tile', '#c8ccd8', '#b8bcca'], wall: ['#7a8498', 'tiles'] },
    scanner: { floor: ['lino', '#dfe6f0', '#cfd8e6'], wall: ['#a8b8d0', 'tiles'] },
    blood:  { floor: ['tile', '#f2e0e0', '#e6cfcf'], wall: ['#c46a6a', 'stripe'] },
    ultra:  { floor: ['lino', '#d8eef4', '#c6e2ea'], wall: ['#7ab8c8', 'dots'] },
    fracture: { floor: ['tile', '#e8e4dc', '#d8d2c6'], wall: ['#b8aa92', 'tiles'] },
    jelly:  { floor: ['tile', '#dcefd2', '#cae4bc'], wall: ['#7ab86a', 'dots'] },
    decon:  { floor: ['tile', '#e6e6c8', '#d6d6b0'], wall: ['#a8a86a', 'tiles'] },
    dna:    { floor: ['lino', '#d6d2ea', '#c4bede'], wall: ['#4a4a7a', 'stripe'] },
    staff:  { floor: ['carpet', '#4a6a8a', '#3e5c7a'], wall: ['#d9b46a', 'stripe'] },
    toilet: { floor: ['tile', '#f4f4f8', '#dfe4f2'], wall: ['#b8d0e6', 'tiles'] },
    research: { floor: ['lino', '#e2e2d6', '#d2d2c4'], wall: ['#8a9a7a', 'stripe'] },
    training: { floor: ['plank', '#b88a58', '#a07848'], wall: ['#c9b08a', 'stripe'] },
  };

  window.HA = { SS, T, W, H, OUT, canvas, hcanvas, hiRes, remaster, shade, outline, flipH, hash, rect, box, blob, look, patientSheet, staffSheet, vipSheet, inspSheet, AVATARS, managerSheet, portrait, advisorFace, ghost, furniture, floor, ROOM_STYLE, C };
})();
