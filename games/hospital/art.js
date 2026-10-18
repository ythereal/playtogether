// Rival Hospital: every sprite is drawn in code at startup (no image files).
// People are 16x24 (feet at y=23), 4 directions x 3 walk frames. Tiles are 16px. Rooms are 64x64.
// Same approach as Manor Mystery: bevelled, outlined furniture sprites on patterned floors, wallpaper back walls.
(function () {
  'use strict';
  const OUT = '#1b1720';
  const T = 16, W = 22, H = 11, BW = W * T, BH = H * T;
  const ROOM = 64, WALL = 14;           // room size · back-wall strip height

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
  function drawPerson(o, dir, f) {
    const [c, x] = canvas(16, 24);
    const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
    const d = o.dis || '', side = dir === 'left', back = dir === 'up';
    const fur = d === 'fur', invis = d === 'invis', green = d === 'gut', big = d === 'balloon', tv = d === 'tv';
    const skin = fur ? '#8a5a2e' : green ? '#8fc46a' : o.skin, skinD = shade(skin, -0.18);
    const hair = fur ? '#5a3418' : o.hair, hairD = shade(hair, -0.3);
    let shirt = o.shirt, pants = o.pants, shoes = '#17181f';
    let dress = o.dress;
    if (o.coat === 'doctor') { shirt = '#f4f4f0'; pants = '#2b2e3a'; dress = false; }
    if (o.coat === 'nurse') { shirt = '#6fa9e0'; pants = '#6fa9e0'; dress = true; shoes = '#f4f4f0'; }
    if (o.coat === 'recep') { shirt = '#d9579a'; pants = '#3a3f5c'; dress = false; }
    if (o.coat === 'mgr') { dress = !!o.dress; }
    if (d === 'royal') { shirt = '#7a2ea0'; }
    const coat = fur ? skin : shirt, coatD = shade(coat, -0.28), coatL = shade(coat, 0.18);
    const lUp = f === 1 ? 1 : 0, rUp = f === 2 ? 1 : 0;

    // ----- legs / skirt -----
    if (!side) {
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
    if (o.coat === 'mgr' && dress && !side) { R(3, 21, 10, 1, '#e3b341'); }
    if (!back && !side) {
      if (o.coat === 'doctor') { R(6, 11, 4, 4, '#9fc4e8'); R(7, 11, 2, 1, '#2b2e3a'); R(7, 12, 1, 3, '#c43c2c'); R(5, 11, 1, 5, '#e0e0da'); R(10, 11, 1, 5, '#e0e0da'); R(5, 14, 1, 2, '#9aa0a8'); R(10, 14, 1, 2, '#9aa0a8'); R(6, 16, 4, 1, '#9aa0a8'); R(7, 17, 2, 1, '#6a7078'); }
      else if (o.coat === 'nurse') { R(5, 13, 6, 6, '#ffffff'); R(5, 12, 2, 1, '#ffffff'); R(9, 12, 2, 1, '#ffffff'); R(7, 14, 2, 1, '#e8533f'); R(6, 15, 4, 1, '#e8533f'); R(7, 16, 2, 1, '#e8533f'); }
      else if (o.coat === 'recep') { R(7, 11, 2, 2, '#f4f4f0'); R(4, 11, 1, 3, '#2b2e3a'); R(3, 11, 2, 1, '#2b2e3a'); }
      else if (o.coat === 'mgr' && !dress) { R(6, 11, 4, 4, '#f4f4f0'); R(7, 11, 2, 1, '#2b2e3a'); R(7, 12, 1, 4, o.tie || '#c43c2c'); R(5, 11, 1, 6, coatL); R(10, 11, 1, 6, coatL); R(4, 17, 1, 1, '#e3b341'); }
      else if (o.coat === 'mgr' && dress) { R(4, 11, 8, 1, '#e3b341'); R(7, 12, 2, 4, '#e3b341'); R(4, 16, 8, 1, '#e3b341'); R(5, 12, 1, 1, '#e3b341'); R(10, 12, 1, 1, '#e3b341'); }
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
      if (o.quiff && !bald && !back) { if (side) { R(3, 1, 6, 1, hair); R(4, 0, 4, 1, hair); } else { R(5, 1, 5, 1, hair); R(6, 0, 3, 1, hair); R(10, 2, 1, 1, shade(hair, 0.25)); } }
      if (o.bindi && !back && !side) R(7, 6, 1, 1, '#c43c2c');
      if (o.earrings && !back) { if (side) R(9, 8, 1, 2, '#e3b341'); else { R(4, 8, 1, 2, '#e3b341'); R(11, 8, 1, 2, '#e3b341'); } }
      if (o.cap && !bald && !back) { R(4, 1, 8, 3, '#2a4a7a'); R(4, 4, 8, 1, '#1a2a4a'); if (!side) R(3, 4, 10, 1, '#1a2a4a'); else R(2, 4, 8, 1, '#1a2a4a'); }
      if (o.cap && back) { R(4, 1, 8, 3, '#2a4a7a'); }
    } else {
      // invisibility: only the clothes, plus a pair of glasses hovering where the face was
      if (!back) { R(5, 6, 3, 1, OUT); R(8, 6, 3, 1, OUT); R(5, 7, 1, 1, OUT); R(10, 7, 1, 1, OUT); R(6, 7, 1, 1, '#9fd8ff'); R(9, 7, 1, 1, '#9fd8ff'); }
    }
    if (d === 'royal') { R(5, 0, 6, 2, '#ffd23f'); R(5, -1, 1, 1, '#ffd23f'); R(8, -1, 1, 1, '#ffd23f'); R(10, -1, 1, 1, '#ffd23f'); R(7, 0, 1, 1, '#e8533f'); R(8, 1, 1, 1, '#3c7bd6'); }
    if (o.coat === 'nurse' && !big && !tv) { R(5, 1, 6, 2, '#ffffff'); R(7, 1, 2, 1, '#e8533f'); }
    if (o.coat === 'recep' && !side) { R(3, 6, 1, 3, '#2b2e3a'); R(3, 9, 2, 1, '#2b2e3a'); }
    return outline(c);
  }
  const personCache = {};
  function personSheet(key, o) {
    if (personCache[key]) return personCache[key];
    const sh = {};
    for (const d of ['down', 'up', 'left']) sh[d] = [0, 1, 2].map(f => drawPerson(o, d, f));
    sh.right = sh.left.map(flipH);
    return (personCache[key] = sh);
  }
  const patientSheet = (lookIdx, dis) => personSheet('p' + lookIdx + ':' + (dis || ''), Object.assign(look(lookIdx), { dis }));
  const staffSheet = (lookIdx, kind) => personSheet('s' + lookIdx + ':' + kind, Object.assign(look(lookIdx), { longHair: false, bun: kind === 'n' && lookIdx % 2 === 0, cap: false, dress: false, coat: kind === 'd' ? 'doctor' : kind === 'n' ? 'nurse' : 'recep' }));
  // the two playable hospital managers
  const AVATARS = [
    { id: 'arjun', name: 'Arjun', skin: '#b5784e', hair: '#141010', shirt: '#2a3a6a', pants: '#1d2029', beard: true, quiff: true, tie: '#c43c2c', coat: 'mgr', clip: true },
    { id: 'priya', name: 'Priya', skin: '#c48a60', hair: '#141010', shirt: '#1f8f87', pants: '#1f8f87', longHair: true, dress: true, bindi: true, earrings: true, coat: 'mgr', clip: true },
  ];
  const managerSheet = av => personSheet('m' + av, AVATARS[av] || AVATARS[0]);
  const portraitCache = {};
  function portrait(av, size) {
    const key = av + ':' + size;
    if (portraitCache[key]) return portraitCache[key];
    const [c, x] = canvas(size, size);
    const g = x.createLinearGradient(0, 0, 0, size); g.addColorStop(0, av ? '#2a6f6a' : '#2a3a6a'); g.addColorStop(1, av ? '#154a46' : '#141f3a');
    x.fillStyle = g; x.fillRect(0, 0, size, size);
    x.drawImage(managerSheet(av).down[0], 0, 0, 16, 14, 0, size * 0.14, size, size * 0.875);
    return (portraitCache[key] = c);
  }
  function ghost() {
    const [c, x] = canvas(14, 16);
    blob(x, 7, 6, 5, 5.5, '#eef2ff', { flat: true });
    rect(x, 2, 8, 10, 5, '#eef2ff'); rect(x, 2, 13, 2, 2, '#eef2ff'); rect(x, 6, 13, 2, 2, '#eef2ff'); rect(x, 10, 13, 2, 2, '#eef2ff');
    rect(x, 4, 5, 2, 2, '#2a2a40'); rect(x, 8, 5, 2, 2, '#2a2a40'); rect(x, 6, 9, 2, 1, '#2a2a40');
    return outline(c, '#8890b8');
  }

  // ======================= FURNITURE =======================
  const FURN = {
    desk() {
      const [c, x] = canvas(32, 24);
      box(x, 0, 8, 32, 16, '#6a4024'); rect(x, 0, 6, 32, 4, '#8a5a34'); rect(x, 0, 6, 32, 1, '#a06c40');
      rect(x, 3, 12, 10, 5, '#4c2c18'); rect(x, 19, 12, 10, 5, '#4c2c18'); rect(x, 7, 14, 2, 1, '#d9a93a'); rect(x, 23, 14, 2, 1, '#d9a93a');
      rect(x, 12, 4, 7, 3, '#f2ecdc'); rect(x, 13, 5, 5, 1, '#c9c0ac');
      rect(x, 22, 0, 9, 7, '#2b2e3a'); rect(x, 23, 1, 7, 5, '#6fd3ff'); rect(x, 24, 2, 3, 1, '#ffffff'); rect(x, 25, 7, 3, 1, '#2b2e3a');
      rect(x, 3, 3, 4, 3, '#e8533f'); rect(x, 4, 2, 2, 1, '#e8533f');
      return outline(c);
    },
    chair() { const [c, x] = canvas(12, 16); box(x, 1, 0, 10, 9, '#3a3f5c'); box(x, 0, 7, 12, 6, '#4a5078'); rect(x, 1, 13, 2, 3, '#222'); rect(x, 9, 13, 2, 3, '#222'); return outline(c); },
    cabinet() {
      const [c, x] = canvas(16, 30);
      box(x, 0, 0, 16, 30, '#6c6f78', '#8a8d96');
      for (const yy of [5, 13, 21]) { rect(x, 2, yy, 12, 6, '#5a5d66'); rect(x, 6, yy + 2, 4, 1, '#1b1720'); rect(x, 3, yy, 10, 1, '#7c7f88'); }
      return outline(c);
    },
    plant() {
      const [c, x] = canvas(16, 26);
      box(x, 4, 18, 8, 8, '#b5643c'); rect(x, 4, 18, 8, 2, '#8f4a2a');
      const leaf = (X, Y, r, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(X, Y, r, r * 0.7, 0, 0, Math.PI * 2); x.fill(); };
      leaf(8, 12, 7, '#2e6b3a'); leaf(4, 8, 4, '#3a8a48'); leaf(12, 7, 4, '#3a8a48'); leaf(8, 4, 4, '#4aa45a'); leaf(6, 13, 3, '#255a30');
      rect(x, 7, 2, 2, 1, '#7acb7a'); rect(x, 3, 6, 2, 1, '#7acb7a'); rect(x, 11, 5, 2, 1, '#7acb7a');
      return outline(c);
    },
    poster(col) {
      const [c, x] = canvas(12, 10);
      rect(x, 0, 0, 12, 10, '#f4f0e6'); rect(x, 1, 1, 10, 8, col); rect(x, 2, 2, 8, 1, '#f4f0e6'); rect(x, 3, 4, 6, 1, '#f4f0e6'); rect(x, 4, 6, 4, 1, '#f4f0e6');
      return outline(c);
    },
    eyechart() { const [c, x] = canvas(12, 14); rect(x, 0, 0, 12, 14, '#f4f0e6'); rect(x, 5, 2, 2, 2, OUT); rect(x, 3, 5, 2, 1, OUT); rect(x, 7, 5, 2, 1, OUT); for (let i = 2; i < 10; i += 2) rect(x, i, 8, 1, 1, OUT); for (let i = 2; i < 10; i += 1) rect(x, i, 11, 1, 1, '#555'); return outline(c); },
    clock() { const [c, x] = canvas(10, 10); x.fillStyle = '#f4f0e6'; x.beginPath(); x.arc(5, 5, 4.5, 0, Math.PI * 2); x.fill(); rect(x, 5, 2, 1, 3, OUT); rect(x, 5, 5, 3, 1, OUT); return outline(c); },
    shelves() {
      const [c, x] = canvas(60, 14);
      box(x, 0, 0, 60, 14, '#8b5a2b', '#a06c40');
      for (let i = 0; i < 14; i++) { const col = ['#e8533f', '#3c7bd6', '#39a85a', '#ffd23f', '#d64f8e', '#f4f0e6'][i % 6]; const h = 5 + (i % 3); rect(x, 3 + i * 4, 11 - h, 3, h, col); rect(x, 3 + i * 4, 11 - h, 1, h, shade(col, 0.4)); rect(x, 4 + i * 4, 10 - h, 1, 1, '#f4f0e6'); }
      rect(x, 0, 11, 60, 1, '#5a3620');
      return outline(c);
    },
    counter() {
      const [c, x] = canvas(30, 18);
      box(x, 0, 4, 30, 14, '#e8e0d0'); rect(x, 0, 2, 30, 4, '#f7f3ea'); rect(x, 0, 2, 30, 1, '#ffffff'); rect(x, 0, 6, 30, 1, '#bbb3a4');
      rect(x, 4, 8, 10, 7, '#d6cdbc'); rect(x, 17, 8, 10, 7, '#d6cdbc'); rect(x, 8, 11, 2, 1, '#6a7078'); rect(x, 21, 11, 2, 1, '#6a7078');
      rect(x, 3, 0, 4, 3, '#3c7bd6'); rect(x, 9, 0, 6, 3, '#f4f0e6'); rect(x, 10, 1, 4, 1, '#e8533f'); rect(x, 20, 1, 3, 2, '#39a85a');
      return outline(c);
    },
    bed() {
      const [c, x] = canvas(20, 28);
      rect(x, 0, 0, 20, 4, '#5a3a22'); rect(x, 0, 0, 20, 1, '#7a5434');
      box(x, 1, 3, 18, 25, '#f4f4f8'); rect(x, 2, 5, 16, 5, '#dfe4f2'); rect(x, 3, 6, 14, 3, '#ffffff');
      rect(x, 1, 12, 18, 14, '#7fb7e6'); rect(x, 1, 12, 18, 1, '#ffffff'); rect(x, 1, 20, 18, 1, '#5e93c4'); rect(x, 1, 25, 18, 2, '#5e93c4');
      rect(x, 0, 26, 2, 2, '#222'); rect(x, 18, 26, 2, 2, '#222');
      return outline(c);
    },
    bedside() { const [c, x] = canvas(12, 16); box(x, 0, 4, 12, 12, '#8b5a2b', '#a06c40'); rect(x, 2, 9, 8, 4, '#6b4320'); rect(x, 5, 11, 2, 1, '#d9a93a'); rect(x, 3, 0, 6, 4, '#f4f0e6'); rect(x, 4, 1, 4, 2, '#ff6b9a'); return outline(c); },
    screen() { const [c, x] = canvas(14, 30); rect(x, 6, 0, 2, 30, '#6a7078'); rect(x, 0, 2, 14, 22, '#bfe3df'); rect(x, 0, 2, 14, 1, '#f4f0e6'); for (let j = 5; j < 23; j += 4) rect(x, 1, j, 12, 1, '#aed7d2'); rect(x, 2, 28, 10, 2, '#6a7078'); return outline(c); },
    couch() {
      const [c, x] = canvas(36, 18);
      box(x, 2, 0, 32, 10, '#6b2d3a'); box(x, 0, 6, 36, 12, '#8a3a4a'); rect(x, 3, 8, 30, 5, '#a04a5a'); rect(x, 3, 8, 30, 1, '#b85a6a');
      rect(x, 0, 6, 3, 10, '#6b2d3a'); rect(x, 33, 6, 3, 10, '#6b2d3a'); rect(x, 1, 17, 2, 1, '#2b1b10'); rect(x, 33, 17, 2, 1, '#2b1b10');
      rect(x, 6, 3, 8, 5, '#f2d9a4'); rect(x, 7, 4, 6, 3, '#e8c48a');
      return outline(c);
    },
    bookshelf() {
      const [c, x] = canvas(28, 30); const wood = '#5a3a22';
      box(x, 0, 0, 28, 30, wood, '#6e4a2c');
      for (const sy of [4, 12, 20]) {
        rect(x, 2, sy, 24, 7, '#2b1b10');
        let bx = 2;
        while (bx < 25) { const bw = 1 + Math.floor(srnd() * 3), bh = 4 + Math.floor(srnd() * 3); const cols = ['#8b2a2a', '#2f5e3a', '#2a4a7a', '#8a6a2a', '#5a2a6a', '#a0522d']; rect(x, bx, sy + 7 - bh, bw, bh, cols[Math.floor(srnd() * cols.length)]); rect(x, bx, sy + 7 - bh, 1, 1, 'rgba(255,255,255,.18)'); bx += bw + (srnd() < 0.15 ? 1 : 0); }
        rect(x, 1, sy + 7, 26, 1, shade(wood, 0.1));
      }
      return outline(c);
    },
    painting() { const [c, x] = canvas(16, 12); rect(x, 0, 0, 16, 12, '#d9a93a'); rect(x, 1, 1, 14, 10, '#3c7bd6'); rect(x, 1, 7, 14, 4, '#39a85a'); rect(x, 10, 2, 3, 3, '#ffd23f'); rect(x, 3, 6, 5, 2, '#2e6b3a'); return outline(c); },
    lamp() { const [c, x] = canvas(10, 30); rect(x, 4, 8, 2, 20, '#d9a93a'); rect(x, 1, 27, 8, 3, '#8a6a2a'); rect(x, 0, 0, 10, 9, '#f2d9a4'); rect(x, 1, 0, 8, 1, '#fff6c8'); rect(x, 0, 8, 10, 1, '#c8a870'); return outline(c); },
    inflator() {
      const [c, x] = canvas(30, 34);
      box(x, 2, 6, 20, 28, '#8aa0b8', '#9fb3c8'); rect(x, 4, 8, 16, 10, '#1d2a3a'); rect(x, 6, 10, 12, 5, '#6fd3ff'); rect(x, 7, 11, 4, 1, '#ffffff');
      rect(x, 5, 20, 3, 3, '#e8533f'); rect(x, 10, 20, 3, 3, '#39a85a'); rect(x, 15, 20, 3, 3, '#ffd23f'); rect(x, 5, 26, 14, 4, '#5c6f85'); rect(x, 6, 27, 12, 2, '#3c4a5a');
      rect(x, 22, 14, 6, 3, '#5c6f85'); rect(x, 26, 0, 4, 16, '#5c6f85'); box(x, 20, 0, 10, 8, '#ffd23f'); rect(x, 22, 2, 6, 4, '#e8b800');
      return outline(c);
    },
    slicer() {
      const [c, x] = canvas(30, 34);
      box(x, 4, 4, 24, 28, '#9aa3b8', '#c8ced8'); rect(x, 7, 7, 18, 8, '#1d2a3a'); rect(x, 9, 9, 14, 2, '#e8533f'); rect(x, 9, 12, 6, 1, '#6fd3ff');
      rect(x, 13, 17, 6, 12, '#e8e8ee'); rect(x, 15, 18, 2, 10, '#8a8f99'); rect(x, 12, 17, 8, 1, '#c8ced8');
      rect(x, 6, 30, 20, 3, '#6b7280'); rect(x, 0, 24, 4, 6, '#ff6b9a'); rect(x, 1, 25, 2, 4, '#e04a7a');
      return outline(c);
    },
    hairchair() {
      const [c, x] = canvas(26, 36);
      rect(x, 10, 0, 6, 8, '#6b7280'); box(x, 3, 6, 20, 12, '#d9d9de', '#e8e8ee'); rect(x, 6, 9, 14, 6, '#c0c4cc'); rect(x, 8, 11, 10, 2, '#6fd3ff');
      box(x, 2, 18, 22, 12, '#e8533f'); rect(x, 4, 20, 18, 7, '#ff7a66'); rect(x, 4, 20, 18, 1, '#ff9a86');
      rect(x, 5, 30, 4, 6, '#6b7280'); rect(x, 17, 30, 4, 6, '#6b7280');
      return outline(c);
    },
    mirror() { const [c, x] = canvas(16, 12); rect(x, 0, 0, 16, 12, '#8b5a2b'); rect(x, 1, 1, 14, 10, '#9fd8ff'); rect(x, 2, 2, 6, 4, '#dff3ff'); rect(x, 9, 7, 4, 2, '#dff3ff'); return outline(c); },
    coil() {
      const [c, x] = canvas(28, 36);
      box(x, 4, 24, 20, 12, '#5c6f85', '#7a8ea8'); rect(x, 7, 27, 14, 2, '#1d2a3a'); rect(x, 9, 31, 10, 2, '#e8533f');
      rect(x, 12, 8, 4, 16, '#8aa0b8'); for (let j = 10; j < 24; j += 2) rect(x, 11, j, 6, 1, '#c8ced8');
      x.fillStyle = '#ffd23f'; x.beginPath(); x.arc(14, 6, 6, 0, Math.PI * 2); x.fill(); x.fillStyle = '#fff6c0'; x.beginPath(); x.arc(12, 4, 2, 0, Math.PI * 2); x.fill();
      return outline(c);
    },
    zapchair() { const [c, x] = canvas(22, 22); box(x, 2, 0, 18, 10, '#6b7280'); box(x, 0, 8, 22, 10, '#9aa3b8'); rect(x, 3, 10, 16, 5, '#b8c0cc'); rect(x, 2, 18, 4, 4, '#4a5260'); rect(x, 16, 18, 4, 4, '#4a5260'); rect(x, 20, 4, 2, 10, '#1d2a3a'); return outline(c); },
    optable() {
      const [c, x] = canvas(36, 24);
      rect(x, 4, 18, 4, 6, '#6b7280'); rect(x, 28, 18, 4, 6, '#6b7280');
      box(x, 0, 6, 36, 14, '#c8ced8'); rect(x, 2, 8, 32, 8, '#e8e8ee'); rect(x, 2, 8, 32, 1, '#ffffff'); rect(x, 4, 10, 10, 4, '#dfe4f2');
      return outline(c);
    },
    oplamp() { const [c, x] = canvas(28, 14); rect(x, 13, 0, 2, 6, '#9aa3b8'); rect(x, 2, 6, 24, 6, '#9aa3b8'); rect(x, 2, 6, 24, 1, '#c8ced8'); rect(x, 4, 10, 20, 4, '#ffd23f'); rect(x, 6, 12, 16, 2, '#fff6c0'); return outline(c); },
    monitor() { const [c, x] = canvas(14, 30); rect(x, 6, 18, 2, 8, '#6b7280'); rect(x, 2, 26, 10, 4, '#6b7280'); box(x, 0, 0, 14, 18, '#8aa0b8'); rect(x, 2, 2, 10, 10, '#1d2a3a'); rect(x, 3, 7, 2, 1, '#39a85a'); rect(x, 5, 5, 1, 3, '#39a85a'); rect(x, 6, 7, 3, 1, '#39a85a'); rect(x, 9, 4, 1, 4, '#39a85a'); rect(x, 10, 7, 1, 1, '#39a85a'); rect(x, 3, 14, 4, 2, '#e8533f'); return outline(c); },
    sink() { const [c, x] = canvas(16, 18); box(x, 0, 4, 16, 14, '#c0c4cc', '#e8e8ee'); rect(x, 3, 6, 10, 5, '#9fd8ff'); rect(x, 7, 0, 2, 6, '#9aa3b8'); rect(x, 5, 0, 6, 1, '#9aa3b8'); return outline(c); },
    bin() { const [c, x] = canvas(8, 10); box(x, 0, 2, 8, 8, '#6b7280'); rect(x, 0, 0, 8, 2, '#8a8f99'); rect(x, 3, 1, 2, 1, '#555'); return outline(c); },
    cooler() { const [c, x] = canvas(10, 26); box(x, 1, 12, 8, 14, '#c0c4cc', '#e8e8ee'); rect(x, 3, 16, 2, 2, '#3c7bd6'); rect(x, 6, 16, 2, 2, '#e8533f'); rect(x, 1, 2, 8, 10, '#9fd8ff'); rect(x, 2, 3, 2, 6, '#dff3ff'); rect(x, 1, 2, 8, 1, '#ffffff'); return outline(c); },
    vending() { const [c, x] = canvas(18, 34); box(x, 0, 0, 18, 34, '#c43c2c', '#e8533f'); rect(x, 2, 3, 14, 18, '#1d2a3a'); for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) rect(x, 3 + i * 3, 5 + j * 5, 2, 3, ['#ffd23f', '#39a85a', '#3c7bd6', '#ff6b9a'][(i + j) % 4]); rect(x, 3, 24, 12, 4, '#1d2a3a'); rect(x, 13, 22, 3, 1, '#ffd23f'); return outline(c); },
    bench() { const [c, x] = canvas(28, 14); rect(x, 2, 8, 2, 6, '#2a2a30'); rect(x, 24, 8, 2, 6, '#2a2a30'); box(x, 0, 0, 28, 4, '#1f8f87'); box(x, 0, 5, 28, 4, '#26a69e'); return outline(c); },
    notice() { const [c, x] = canvas(20, 14); rect(x, 0, 0, 20, 14, '#8b5a2b'); rect(x, 1, 1, 18, 12, '#c8a870'); rect(x, 3, 3, 5, 5, '#f4f0e6'); rect(x, 10, 2, 6, 4, '#ffd23f'); rect(x, 9, 8, 7, 4, '#9fd8ff'); rect(x, 4, 9, 4, 3, '#ff6b9a'); return outline(c); },
    recdesk() {
      const [c, x] = canvas(34, 16);
      box(x, 0, 4, 34, 12, '#7a4b2c'); rect(x, 0, 2, 34, 4, '#a86d44'); rect(x, 0, 2, 34, 1, '#c08a5a'); rect(x, 0, 6, 34, 1, '#5a3620');
      rect(x, 3, 9, 10, 5, '#5a3620'); rect(x, 20, 9, 10, 5, '#5a3620');
      rect(x, 4, 0, 6, 3, '#f2ecdc'); rect(x, 5, 1, 4, 1, '#c9c0ac'); rect(x, 26, 0, 5, 3, '#e8533f'); rect(x, 27, -1, 3, 1, '#e8533f');
      return outline(c);
    },
    ambulance() {
      const [c, x] = canvas(30, 20);
      rect(x, 3, 16, 5, 4, '#1b1720'); rect(x, 21, 16, 5, 4, '#1b1720'); rect(x, 4, 17, 3, 2, '#9aa3b8'); rect(x, 22, 17, 3, 2, '#9aa3b8');
      box(x, 0, 4, 30, 14, '#f4f4f0'); rect(x, 0, 0, 20, 5, '#f4f4f0'); rect(x, 0, 0, 20, 1, '#ffffff');
      rect(x, 2, 2, 7, 5, '#9fd8ff'); rect(x, 11, 2, 7, 5, '#9fd8ff'); rect(x, 20, 6, 9, 5, '#9fd8ff');
      rect(x, 0, 10, 30, 3, '#e8533f'); rect(x, 12, 6, 2, 1, '#e8533f'); rect(x, 11, 7, 4, 1, '#e8533f'); rect(x, 12, 8, 2, 1, '#e8533f');
      rect(x, 3, 0, 4, 2, '#3c7bd6'); rect(x, 13, 0, 4, 2, '#e8533f');
      return outline(c);
    },
    tree() {
      const [c, x] = canvas(24, 30);
      rect(x, 10, 20, 4, 10, '#6b4320'); rect(x, 11, 20, 1, 10, '#8a5a34');
      const leaf = (X, Y, r, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(X, Y, r, r * 0.8, 0, 0, Math.PI * 2); x.fill(); };
      leaf(12, 13, 11, '#2e6b3a'); leaf(7, 10, 6, '#3a8a48'); leaf(16, 8, 6, '#3a8a48'); leaf(12, 5, 5, '#4aa45a'); leaf(9, 17, 4, '#255a30');
      rect(x, 6, 9, 2, 1, '#ff6b9a'); rect(x, 15, 6, 2, 1, '#ff6b9a'); rect(x, 12, 12, 2, 1, '#ffd23f');
      return outline(c);
    },
    bush() { const [c, x] = canvas(18, 12); const leaf = (X, Y, r, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(X, Y, r, r * 0.75, 0, 0, Math.PI * 2); x.fill(); }; leaf(9, 7, 8, '#2e6b3a'); leaf(5, 5, 4, '#3a8a48'); leaf(12, 4, 4, '#4aa45a'); rect(x, 4, 3, 1, 1, '#7acb7a'); rect(x, 13, 7, 1, 1, '#7acb7a'); return outline(c); },
    sign() { const [c, x] = canvas(24, 16); rect(x, 11, 10, 2, 6, '#6b7280'); box(x, 0, 0, 24, 11, '#f4f4f0', '#ffffff'); rect(x, 3, 2, 18, 7, '#3c7bd6'); rect(x, 10, 3, 4, 5, '#ffffff'); rect(x, 8, 4, 8, 3, '#ffffff'); rect(x, 11, 4, 2, 3, '#e8533f'); rect(x, 10, 5, 4, 1, '#e8533f'); return outline(c); },
    doors() {
      const [c, x] = canvas(10, 48);
      rect(x, 0, 0, 10, 48, '#8a8f99'); rect(x, 2, 2, 6, 20, '#bfe3ff'); rect(x, 2, 26, 6, 20, '#bfe3ff'); rect(x, 3, 3, 1, 18, '#ffffff'); rect(x, 3, 27, 1, 18, '#ffffff');
      rect(x, 0, 22, 10, 4, '#6a7078'); rect(x, 6, 10, 2, 4, '#1b1720'); rect(x, 6, 34, 2, 4, '#1b1720');
      return outline(c);
    },
    light() { const [c, x] = canvas(14, 6); rect(x, 2, 0, 10, 2, '#6a7078'); rect(x, 0, 2, 14, 4, '#fff6c8'); rect(x, 1, 3, 12, 2, '#ffffff'); return outline(c); },
  };
  const furnCache = {};
  function furniture(name, arg) { const k = name + (arg || ''); return furnCache[k] || (furnCache[k] = FURN[name](arg)); }

  // ======================= FLOORS, WALLS, MAP =======================
  const C = { grass: '#6fae4a', grassD: '#5f9a3e', pave: '#cfc8ba', paveD: '#bbb4a5', hall: '#ece6d8', hallD: '#ddd6c6', lot: '#cbc3b4', lotD: '#b8af9f' };
  function speckle(x, X, Y, w, h, col, n, seed) { for (let i = 0; i < n; i++) rect(x, X + Math.floor(hash(seed + i, X + Y) * (w - 1)), Y + Math.floor(hash(seed * 3 + i, X - Y) * (h - 1)), 1, 1, col); }
  // room floors: 'tile' (grout grid), 'plank' (wood grain), 'carpet' (pattern), 'lino' (big checks)
  function floor(x, X, Y, w, h, kind, a, b) {
    rect(x, X, Y, w, h, a);
    if (kind === 'tile') {
      for (let j = 0; j < h; j += 8) for (let i = 0; i < w; i += 8) { if (((i + j) / 8) % 2) rect(x, X + i, Y + j, 8, 8, b); rect(x, X + i, Y + j, 8, 1, shade(a, -0.1)); rect(x, X + i, Y + j, 1, 8, shade(a, -0.1)); }
    } else if (kind === 'plank') {
      for (let j = 0; j < h; j += 5) { rect(x, X, Y + j, w, 1, shade(a, -0.18)); const off = (j / 5) % 2 ? 24 : 8; for (let i = off; i < w; i += 32) rect(x, X + i, Y + j, 1, 5, shade(a, -0.18)); for (let i = 2; i < w; i += 7) rect(x, X + i + (j % 3), Y + j + 2, 3, 1, b); }
    } else if (kind === 'carpet') {
      for (let j = 0; j < h; j += 4) for (let i = (j / 4) % 2 ? 2 : 0; i < w; i += 4) rect(x, X + i, Y + j, 2, 2, b);
      for (let j = 0; j < h; j += 16) for (let i = 0; i < w; i += 16) rect(x, X + i + 7, Y + j + 7, 2, 2, shade(b, 0.2));
    } else {
      for (let j = 0; j < h; j += 16) for (let i = 0; i < w; i += 16) { if (((i + j) / 16) % 2) rect(x, X + i, Y + j, 16, 16, b); rect(x, X + i, Y + j, 16, 1, shade(a, 0.1)); }
    }
  }
  function wallpaper(x, X, Y, w, col, style) {
    rect(x, X, Y, w, WALL, col);
    const d = shade(col, -0.1), l = shade(col, 0.12);
    if (style === 'stripe') for (let i = 0; i < w; i += 6) rect(x, X + i, Y, 2, WALL, d);
    else if (style === 'dots') for (let j = 2; j < WALL - 2; j += 5) for (let i = (j % 10 ? 1 : 4); i < w; i += 6) rect(x, X + i, Y + j, 1, 1, l);
    else if (style === 'tiles') { for (let j = 0; j < WALL; j += 5) rect(x, X, Y + j, w, 1, d); for (let i = 0; i < w; i += 9) rect(x, X + i, Y, 1, WALL, d); }
    rect(x, X, Y, w, 1, l);                                     // cornice
    rect(x, X, Y + WALL - 3, w, 3, shade(col, -0.35));           // baseboard
    rect(x, X, Y + WALL - 3, w, 1, shade(col, -0.15));
    rect(x, X, Y + WALL, w, 2, 'rgba(0,0,0,.18)');               // shadow on the floor
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
  };
  // furniture per room: [name, x, y, arg]. People stand in the lower half (patient right, staff left).
  const LAYOUT = {
    gp:     [['eyechart', 6, 2], ['clock', 44, 3], ['desk', 4, 16], ['chair', 10, 36], ['cabinet', 46, 8], ['plant', 48, 36]],
    pharm:  [['shelves', 2, 1], ['counter', 4, 18], ['sink', 44, 20], ['bin', 54, 46], ['poster', 48, 2, '#e8533f']],
    ward:   [['bed', 4, 8], ['bedside', 26, 18], ['bed', 40, 8], ['screen', 46, 36], ['poster', 26, 2, '#3c7bd6']],
    psych:  [['bookshelf', 2, 2], ['painting', 36, 2], ['lamp', 4, 32], ['couch', 24, 18], ['plant', 48, 40]],
    infl:   [['inflator', 4, 4], ['monitor', 46, 10], ['poster', 36, 2, '#e8533f'], ['bin', 54, 46]],
    tongue: [['slicer', 32, 4], ['cabinet', 4, 8], ['poster', 10, 2, '#ff6b9a'], ['sink', 4, 42]],
    hair:   [['hairchair', 6, 6], ['mirror', 40, 2], ['cabinet', 46, 12], ['plant', 48, 40]],
    elec:   [['coil', 34, 2], ['zapchair', 4, 12], ['monitor', 48, 20], ['bin', 4, 46]],
    op:     [['oplamp', 18, 1], ['optable', 14, 14], ['monitor', 2, 8], ['sink', 48, 10], ['cabinet', 48, 30]],
  };
  const roomCache = {};
  function roomCanvas(kind) {
    if (roomCache[kind]) return roomCache[kind];
    const [c, x] = canvas(ROOM, ROOM);
    const st = ROOM_STYLE[kind];
    floor(x, 0, WALL, ROOM, ROOM - WALL, st.floor[0], st.floor[1], st.floor[2]);
    wallpaper(x, 0, 0, ROOM, st.wall[0], st.wall[1]);
    rect(x, 0, WALL, 2, ROOM - WALL, 'rgba(0,0,0,.14)'); rect(x, ROOM - 2, WALL, 2, ROOM - WALL, 'rgba(0,0,0,.14)');
    for (const [name, X, Y, arg] of LAYOUT[kind]) {
      const sp = furniture(name, arg);
      x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(X + 1, Y + sp.height - 1, sp.width - 1, 1);
      x.drawImage(sp, X, Y);
    }
    rect(x, 0, 0, 1, ROOM, shade(st.wall[0], -0.5)); rect(x, ROOM - 1, 0, 1, ROOM, shade(st.wall[0], -0.5));
    return (roomCache[kind] = c);
  }
  function scaffold() {
    const [c, x] = canvas(ROOM, ROOM);
    rect(x, 0, 0, ROOM, ROOM, 'rgba(60,50,40,.3)');
    for (let i = 0; i < 4; i++) { rect(x, 2 + i * 20, 4, 2, 56, '#c8a05a'); rect(x, 2, 8 + i * 16, 60, 2, '#c8a05a'); }
    box(x, 10, 40, 14, 12, '#a0703a'); rect(x, 12, 42, 10, 8, '#c08a4a'); box(x, 36, 42, 16, 10, '#a0703a'); rect(x, 38, 44, 12, 6, '#c08a4a');
    rect(x, 26, 18, 10, 1, '#ffd23f'); rect(x, 26, 20, 10, 1, '#1b1720'); rect(x, 26, 22, 10, 1, '#ffd23f');
    return c;
  }
  function baseMap() {
    const [c, x] = canvas(BW, BH);
    const R = (X, Y, w, h, col) => rect(x, X, Y, w, h, col);
    // outside: grass with a paved path to the door
    R(0, 0, 32, BH, C.grass);
    for (let i = 0; i < 90; i++) R(Math.floor(hash(i, 7) * 31), Math.floor(hash(i, 11) * (BH - 1)), 1, 1, C.grassD);
    for (let i = 0; i < 14; i++) { const X = Math.floor(hash(i, 21) * 29) + 1, Y = Math.floor(hash(i, 33) * (BH - 2)); if (Y > 56 && Y < 120) continue; R(X, Y, 2, 1, ['#ffd23f', '#ff6b9a', '#f4f4f0'][i % 3]); R(X, Y + 1, 2, 1, shade(['#ffd23f', '#ff6b9a', '#f4f4f0'][i % 3], -0.2)); }
    for (let r = 4; r <= 6; r++) for (let col = 0; col < 2; col++) { R(col * T, r * T, 16, 16, (col + r) % 2 ? C.pave : C.paveD); R(col * T, r * T, 16, 1, shade(C.pave, 0.1)); }
    R(0, 63, 32, 1, C.paveD); R(0, 112, 32, 1, C.paveD);
    x.drawImage(furniture('ambulance'), 1, 30); x.drawImage(furniture('tree'), 4, 118); x.drawImage(furniture('bush'), 2, 8); x.drawImage(furniture('bush'), 12, 150); x.drawImage(furniture('sign'), 4, 44);
    // corridor floor: linoleum with a coloured guide line
    for (let r = 4; r <= 6; r++) for (let col = 2; col < W; col++) { R(col * T, r * T, 16, 16, (col + r) % 2 ? C.hall : C.hallD); R(col * T, r * T, 16, 1, shade(C.hall, 0.12)); R(col * T, r * T, 1, 16, shade(C.hall, -0.08)); }
    R(32, 87, BW - 32, 2, '#2fa39a'); R(32, 87, BW - 32, 1, '#5fc4bb');
    // corridor walls: the fronts of the top rooms (y 62-64) and the back wall of the bottom rooms is drawn per room
    R(32, 62, BW - 32, 2, '#6a5a4a'); R(32, 64, BW - 32, 2, 'rgba(0,0,0,.2)');
    R(32, 110, BW - 32, 2, '#6a5a4a');
    // entrance doors + mat + reception desk
    R(12, 70, 20, 14, '#b0503a'); R(14, 72, 16, 10, '#c86048'); R(16, 74, 12, 6, '#b0503a');
    x.drawImage(furniture('doors'), -2, 64);
    x.drawImage(furniture('recdesk'), 0, 96);
    // empty lots
    for (let k = 0; k < 10; k++) {
      const X = (2 + 4 * (k % 5)) * T, Y = k < 5 ? 0 : 112;
      R(X, Y, ROOM, ROOM, C.lot);
      for (let j = 0; j < ROOM; j += 4) for (let i = 0; i < ROOM; i += 4) if (hash(i + X, j + Y) < 0.12) R(X + i, Y + j, 2, 1, C.lotD);
      x.setLineDash([3, 3]); x.strokeStyle = shade(C.lot, -0.25); x.lineWidth = 1; x.strokeRect(X + 2.5, Y + 2.5, ROOM - 5, ROOM - 5); x.setLineDash([]);
      R(X, Y, 1, ROOM, shade(C.lot, -0.4)); R(X + ROOM - 1, Y, 1, ROOM, shade(C.lot, -0.4));
    }
    // vending machine at the far end, notice board by the entrance
    x.drawImage(furniture('vending'), 334, 70); x.drawImage(furniture('notice'), 36, 66);
    // ceiling lights along the corridor
    for (let i = 0; i < 5; i++) x.drawImage(furniture('light'), 57 + i * 64, 60);
    return c;
  }

  window.HA = { T, W, H, BW, BH, ROOM, WALL, OUT, canvas, shade, outline, flipH, hash, rect, box, blob, look, patientSheet, staffSheet, AVATARS, managerSheet, portrait, ghost, furniture, baseMap, roomCanvas, scaffold, ROOM_STYLE, C };
})();
