// Manor Mystery: all pixel art is generated in code at startup (no image files).
// Characters: 16x24 frames, 4 directions x 3 frames. Furniture/tiles: 16px grid.
(function () {
  'use strict';
  const OUT = '#17121f';

  function canvas(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    return [c, x];
  }
  function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(h, amt) { // amt -1..1 (negative = darker)
    const [r, g, b] = hex2rgb(h);
    const f = v => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    return '#' + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  // 1px dark outline around every opaque shape
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

  // ======================= CHARACTERS =======================
  const LOOKS = {
    detA:      { skin: '#f0c8a0', hair: '#4a2e1e', coat: '#b88a50', pants: '#3d3328', shoes: '#2a1e16', shirt: '#e8e0d0', hat: 'fedora', hatCol: '#5b4632', band: '#c43c2c', scarf: '#c43c2c' },
    detB:      { skin: '#e2b58c', hair: '#1f1a17', coat: '#557c85', pants: '#2c3438', shoes: '#1d2326', shirt: '#e8e0d0', hat: 'fedora', hatCol: '#2d383c', band: '#2bb5a8', scarf: '#2bb5a8' },
    colonel:   { skin: '#e8b890', hair: '#d4d4d4', coat: '#6b7a3a', pants: '#4a4f2c', shoes: '#2a2418', mustache: '#ececec', medals: true },
    doctor:    { skin: '#f2d0b0', hair: '#2b2b2b', coat: '#e7eaee', pants: '#34475c', shoes: '#22252b', shirt: '#9fc4e8', glasses: true },
    vane:      { skin: '#f5d3bd', hair: '#2a1a12', coat: '#b3243c', pants: '#b3243c', shoes: '#3a0e18', longHair: true, dress: true, lips: '#8e1a2e' },
    reverend:  { skin: '#d9a57c', hair: '#8a7a6a', coat: '#26252e', pants: '#26252e', shoes: '#17161c', collar: true, thinHair: true },
    finch:     { skin: '#f7dcc8', hair: '#e0bb6a', coat: '#4a70b8', pants: '#4a70b8', shoes: '#22325a', bun: true, dress: true, pearls: true },
    butler:    { skin: '#e2b48e', hair: '#1e1e1e', coat: '#1b1b22', pants: '#1b1b22', shoes: '#0e0e12', shirt: '#f4f4f4', bowtie: true },
    professor: { skin: '#eac3a0', hair: '#bdb6ad', coat: '#7a5a3a', pants: '#4a3a2a', shoes: '#2a1e16', shirt: '#e8e0d0', glasses: true, beard: '#bdb6ad', thinHair: true },
    countess:  { skin: '#f3d6c6', hair: '#141018', coat: '#5a2a72', pants: '#5a2a72', shoes: '#2a1036', bun: true, dress: true, lips: '#7a1a4a', pearls: true },
    inspector: { skin: '#e9bf98', hair: '#3a2a20', coat: '#24365e', pants: '#1a2440', shoes: '#11151f', hat: 'cap', hatCol: '#1a2440', mustache: '#3a2a20', shirt: '#dfe6f0' },
    victim:    { skin: '#dcc4b2', hair: '#9a9a9a', coat: '#4a2f5a', pants: '#222', shoes: '#111', shirt: '#eee' },
  };

  function drawPerson(L, dir, f) {
    const [c, x] = canvas(16, 24);
    const R = (X, Y, w, h, col) => { x.fillStyle = col; x.fillRect(X, Y, w, h); };
    const coatD = shade(L.coat, -0.28), coatL = shade(L.coat, 0.18), skinD = shade(L.skin, -0.18), hairD = shade(L.hair, -0.3);
    const side = dir === 'left';
    const back = dir === 'up';

    // ----- legs / skirt -----
    const lUp = f === 1 ? 1 : 0, rUp = f === 2 ? 1 : 0;
    if (!side) {
      if (L.dress) {
        R(3, 17, 10, 5, L.coat); R(3, 21, 10, 1, coatD); R(12, 17, 1, 5, coatD); R(3, 17, 1, 4, coatL);
        R(5, 22 - lUp, 2, 1, L.skin); R(9, 22 - rUp, 2, 1, L.skin);
        R(4, 23 - lUp, 3, 1, L.shoes); R(9, 23 - rUp, 3, 1, L.shoes);
      } else {
        R(5, 19 - lUp, 2, 4, L.pants); R(9, 19 - rUp, 2, 4, shade(L.pants, -0.12));
        R(4, 23 - lUp, 3, 1, L.shoes); R(9, 23 - rUp, 3, 1, L.shoes);
      }
    } else {
      const apart = f !== 0;
      if (L.dress) {
        R(4, 17, 8, 5, L.coat); R(4, 21, 8, 1, coatD); R(4, 17, 1, 4, coatL);
        if (apart) { R(4, 22, 2, 1, L.skin); R(9, 22, 2, 1, skinD); R(3, 23, 3, 1, L.shoes); R(9, 23, 3, 1, L.shoes); }
        else { R(6, 22, 3, 1, L.skin); R(5, 23, 4, 1, L.shoes); }
      } else if (apart) {
        const back2 = f === 1 ? shade(L.pants, -0.2) : L.pants, front2 = f === 1 ? L.pants : shade(L.pants, -0.2);
        R(9, 19, 2, 4, back2); R(5, 19, 2, 4, front2);
        R(4, 23, 3, 1, L.shoes); R(9, 23, 3, 1, L.shoes);
      } else {
        R(6, 19, 4, 4, L.pants); R(8, 19, 1, 4, shade(L.pants, -0.15)); R(5, 23, 5, 1, L.shoes);
      }
    }

    // ----- body -----
    const bx = side ? 5 : 4, bw = side ? 6 : 8;
    R(bx, 11, bw, 8, L.coat);
    R(bx, 18, bw, 1, coatD); R(bx + bw - 1, 11, 1, 8, coatD); R(bx, 11, 1, 7, coatL);
    if (L.dress && !side) R(4, 15, 8, 1, coatD); // waist
    if (!back && !side) {
      if (L.shirt) { R(7, 11, 2, 3, L.shirt); R(6, 11, 1, 1, L.shirt); R(9, 11, 1, 1, L.shirt); }
      if (L.scarf) { R(5, 11, 6, 1, L.scarf); R(6, 12, 1, 3, L.scarf); R(6, 15, 1, 1, shade(L.scarf, -0.3)); }
      if (L.collar) R(7, 11, 2, 1, '#f2f2f2');
      if (L.bowtie) { R(6, 11, 4, 1, '#111'); R(7, 11, 2, 1, '#3a3a44'); }
      if (L.medals) { R(5, 13, 1, 2, '#e3b341'); R(6, 13, 1, 1, '#c0392b'); R(6, 14, 1, 1, '#2f6fbf'); }
      if (L.pearls) { R(5, 11, 6, 1, '#f7f2e8'); R(6, 12, 4, 1, '#f7f2e8'); }
      if (!L.dress && !L.collar && !L.bowtie) { R(7, 15, 1, 1, coatD); R(7, 17, 1, 1, coatD); } // buttons
    }
    if (back && L.scarf) R(5, 11, 6, 1, L.scarf);
    if (side && L.scarf) R(5, 11, 5, 1, L.scarf);

    // ----- arms -----
    if (!side) {
      const la = f === 1 ? -1 : 0, ra = f === 2 ? -1 : 0;
      R(3, 11, 1, 6 + la, coatD); R(12, 11, 1, 6 + ra, coatD);
      R(3, 17 + la, 1, 1, L.skin); R(12, 17 + ra, 1, 1, L.skin);
    } else {
      const hx = f === 1 ? 5 : f === 2 ? 9 : 7;
      R(7, 11, 2, 5, coatD); R(hx === 7 ? 7 : hx, 16, 2, 1, coatD); R(hx === 7 ? 7 : hx, 17, 2, 1, L.skin);
    }

    // ----- head -----
    R(4, 3, 8, 8, L.skin);
    R(11, 4, 1, 6, skinD);
    x.clearRect(4, 3, 1, 1); x.clearRect(11, 3, 1, 1); x.clearRect(4, 10, 1, 1); x.clearRect(11, 10, 1, 1);
    R(6, 10, 4, 1, skinD); // jaw shadow / neck

    // hair
    if (back) {
      R(4, 3, 8, 7, L.hair); R(5, 2, 6, 1, L.hair); R(4, 9, 8, 1, hairD); x.clearRect(4, 3, 1, 1); x.clearRect(11, 3, 1, 1);
      if (L.longHair) { R(4, 10, 8, 4, L.hair); R(4, 13, 8, 1, hairD); }
      if (L.bun) { R(6, 0, 4, 3, L.hair); R(7, 0, 2, 1, shade(L.hair, 0.25)); }
      if (L.thinHair) { R(5, 3, 6, 2, L.skin); }
    } else if (side) {
      R(4, 2, 7, 2, L.hair); R(8, 3, 4, 6, L.hair); R(8, 8, 3, 1, hairD); R(9, 4, 1, 1, shade(L.hair, 0.2));
      if (L.longHair) { R(8, 9, 4, 5, L.hair); R(9, 13, 3, 1, hairD); }
      if (L.bun) { R(9, 0, 3, 3, L.hair); }
      if (L.thinHair) { R(4, 2, 5, 1, L.skin); }
      R(5, 7, 1, 1, '#1d1620');                // eye
      R(3, 7, 1, 2, L.skin);                    // nose
      if (L.mustache) R(3, 9, 3, 1, L.mustache);
      if (L.beard) { R(3, 9, 5, 2, L.beard); R(4, 8, 1, 1, L.beard); }
      if (L.glasses) { R(4, 6, 3, 1, '#20202a'); R(4, 7, 1, 1, '#20202a'); R(6, 7, 1, 1, '#20202a'); }
      if (L.lips) R(4, 9, 1, 1, L.lips);
    } else {
      R(5, 2, 6, 1, L.hair); R(4, 3, 8, 2, L.hair); R(4, 5, 1, 2, L.hair); R(11, 5, 1, 2, L.hair);
      R(5, 3, 3, 1, shade(L.hair, 0.2));
      x.clearRect(4, 3, 1, 1); x.clearRect(11, 3, 1, 1);
      if (L.longHair) { R(3, 4, 1, 9, L.hair); R(12, 4, 1, 9, L.hair); R(4, 7, 1, 5, L.hair); R(11, 7, 1, 5, L.hair); }
      if (L.bun) { R(6, 0, 4, 2, L.hair); R(7, 0, 2, 1, shade(L.hair, 0.25)); }
      if (L.thinHair) { R(5, 3, 6, 1, L.skin); R(6, 2, 4, 1, L.skin); }
      R(6, 7, 1, 1, '#1d1620'); R(9, 7, 1, 1, '#1d1620');            // eyes
      R(5, 8, 1, 1, shade(L.skin, -0.06)); R(10, 8, 1, 1, shade(L.skin, -0.06));
      if (L.mustache) R(6, 9, 4, 1, L.mustache);
      if (L.beard) { R(5, 8, 1, 2, L.beard); R(10, 8, 1, 2, L.beard); R(5, 10, 6, 1, L.beard); R(6, 9, 4, 1, L.beard); R(7, 9, 2, 1, shade(L.skin, -0.3)); }
      if (L.glasses) { R(5, 6, 3, 1, '#20202a'); R(8, 6, 3, 1, '#20202a'); R(5, 7, 1, 1, '#20202a'); R(10, 7, 1, 1, '#20202a'); R(7, 7, 2, 1, '#20202a'); }
      if (L.lips) R(7, 9, 2, 1, L.lips);
    }

    // hats
    if (L.hat === 'fedora') {
      const hc = L.hatCol, hd = shade(hc, -0.3), hl = shade(hc, 0.2);
      if (side) { R(1, 4, 11, 1, hd); R(4, 1, 7, 3, hc); R(4, 3, 7, 1, L.band); R(5, 1, 3, 1, hl); x.clearRect(1, 4, 1, 1); R(2, 4, 1, 1, hd); }
      else { R(2, 4, 12, 1, hd); R(4, 1, 8, 3, hc); R(4, 3, 8, 1, L.band); R(5, 1, 2, 1, hl); R(7, 1, 2, 1, hd); }
    } else if (L.hat === 'cap') {
      const hc = L.hatCol;
      if (side) { R(4, 1, 8, 3, hc); R(1, 4, 6, 1, '#0b0f18'); R(5, 2, 1, 1, '#e3b341'); }
      else { R(4, 1, 8, 3, hc); R(4, 4, 8, 1, '#0b0f18'); if (!back) R(7, 2, 2, 1, '#e3b341'); }
    }
    return outline(c);
  }

  const sheets = {};
  function sheet(look) {
    if (sheets[look]) return sheets[look];
    const L = LOOKS[look], s = {};
    for (const d of ['down', 'up', 'left']) s[d] = [0, 1, 2].map(f => drawPerson(L, d, f));
    s.right = s.left.map(flipH);
    return (sheets[look] = s);
  }

  // Head-and-shoulders portrait, scaled up, with a backdrop
  const portraits = {};
  function portrait(look, size = 48) {
    const key = look + size;
    if (portraits[key]) return portraits[key];
    const src = sheet(look).down[0];
    const [c, x] = canvas(size, size);
    const g = x.createLinearGradient(0, 0, 0, size); g.addColorStop(0, '#3a3046'); g.addColorStop(1, '#1d1726');
    x.fillStyle = g; x.fillRect(0, 0, size, size);
    const s = size / 16;
    x.imageSmoothingEnabled = false;
    x.drawImage(src, 0, 0, 16, 16, 0, size * 0.12, size, size);
    return (portraits[key] = c);
  }

  // A body lying down (rotated idle frame) with a dark stain
  function bodySprite() {
    const [c, x] = canvas(32, 22);
    x.fillStyle = 'rgba(90,10,20,.85)'; x.beginPath(); x.ellipse(9, 12, 8, 4, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(130,20,30,.8)'; x.beginPath(); x.ellipse(7, 11, 4, 2, 0, 0, Math.PI * 2); x.fill();
    x.save(); x.translate(4, 18); x.rotate(-Math.PI / 2); x.drawImage(sheet('victim').down[0], 0, 0); x.restore();
    return c;
  }

  // ======================= FURNITURE =======================
  function box(x, X, Y, w, h, col, top) {
    x.fillStyle = col; x.fillRect(X, Y, w, h);
    x.fillStyle = shade(col, -0.25); x.fillRect(X, Y + h - 1, w, 1); x.fillRect(X + w - 1, Y, 1, h);
    x.fillStyle = shade(col, 0.15); x.fillRect(X, Y, w - 1, 1);
    if (top) { x.fillStyle = top; x.fillRect(X, Y, w, Math.min(3, h)); x.fillStyle = shade(top, 0.15); x.fillRect(X, Y, w, 1); }
  }
  const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

  const FURN = {
    bookshelf() {
      const [c, x] = canvas(32, 32); const wood = '#5a3a22';
      box(x, 0, 0, 32, 32, wood, '#6e4a2c');
      for (const sy of [4, 12, 20]) {
        x.fillStyle = '#2b1b10'; x.fillRect(2, sy, 28, 7);
        let bx = 2;
        while (bx < 29) {
          const bw = 1 + Math.floor(rnd() * 3), bh = 4 + Math.floor(rnd() * 3);
          const cols = ['#8b2a2a', '#2f5e3a', '#2a4a7a', '#8a6a2a', '#5a2a6a', '#a0522d', '#3f3f5a'];
          x.fillStyle = cols[Math.floor(rnd() * cols.length)]; x.fillRect(bx, sy + 7 - bh, bw, bh);
          x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(bx, sy + 7 - bh, 1, 1);
          bx += bw + (rnd() < 0.15 ? 1 : 0);
        }
        x.fillStyle = shade(wood, 0.1); x.fillRect(1, sy + 7, 30, 1);
      }
      x.fillStyle = '#2b1b10'; x.fillRect(2, 28, 28, 3);
      return outline(c);
    },
    clock() {
      const [c, x] = canvas(16, 34);
      box(x, 2, 0, 12, 34, '#4a2a18', '#5e3820');
      x.fillStyle = '#f3e7c9'; x.beginPath(); x.arc(8, 7, 4, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2a1a10'; x.fillRect(8, 4, 1, 3); x.fillRect(8, 7, 2, 1);
      x.fillStyle = '#21140c'; x.fillRect(5, 14, 6, 14);
      x.fillStyle = '#d9a93a'; x.fillRect(8, 14, 1, 9); x.beginPath(); x.arc(8.5, 24, 2, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#e8c46a'; x.fillRect(4, 12, 8, 1);
      return outline(c);
    },
    desk_lamp() { return FURN.desk(true); },
    desk(lamp) {
      const [c, x] = canvas(32, 24);
      box(x, 0, 8, 32, 16, '#6a4024');
      x.fillStyle = '#8a5a34'; x.fillRect(0, 6, 32, 4); x.fillStyle = '#a06c40'; x.fillRect(0, 6, 32, 1);
      x.fillStyle = '#4c2c18'; x.fillRect(3, 12, 10, 5); x.fillRect(19, 12, 10, 5);
      x.fillStyle = '#d9a93a'; x.fillRect(7, 14, 2, 1); x.fillRect(23, 14, 2, 1);
      x.fillStyle = '#f2ecdc'; x.fillRect(12, 4, 7, 3); x.fillStyle = '#c9c0ac'; x.fillRect(13, 5, 5, 1);
      if (lamp) { x.fillStyle = '#d9a93a'; x.fillRect(25, 2, 1, 5); x.fillStyle = '#2f6f45'; x.fillRect(22, 0, 7, 3); x.fillStyle = '#4c9a63'; x.fillRect(22, 0, 7, 1); }
      else { x.fillStyle = '#222'; x.fillRect(24, 3, 2, 4); x.fillStyle = '#b8b0a0'; x.fillRect(5, 3, 5, 3); }
      return outline(c);
    },
    fireplace() {
      const [c, x] = canvas(32, 32);
      box(x, 0, 2, 32, 30, '#8a8478');
      for (let i = 0; i < 6; i++) { x.fillStyle = shade('#8a8478', rnd() * 0.2 - 0.1); x.fillRect(2 + Math.floor(rnd() * 26), 6 + Math.floor(rnd() * 24), 4, 2); }
      x.fillStyle = '#5a3a22'; x.fillRect(0, 0, 32, 5); x.fillStyle = '#7a5434'; x.fillRect(0, 0, 32, 1);
      x.fillStyle = '#120c0c'; x.fillRect(7, 12, 18, 20);
      x.fillStyle = '#3a2a1a'; x.fillRect(9, 28, 14, 3);
      x.fillStyle = '#d9a93a'; x.fillRect(5, 1, 2, 3); x.fillRect(25, 1, 2, 3); // candles on mantel
      return outline(c);
    },
    cabinet() {
      const [c, x] = canvas(32, 26);
      box(x, 0, 0, 32, 26, '#5a4a3a', '#6a5848');
      for (const yy of [4, 11, 18]) { x.fillStyle = '#4a3c2e'; x.fillRect(2, yy, 28, 6); x.fillStyle = '#c9b48a'; x.fillRect(14, yy + 2, 4, 1); }
      return outline(c);
    },
    armchair(col) {
      const [c, x] = canvas(16, 18);
      box(x, 1, 0, 14, 10, shade(col, -0.1));
      box(x, 0, 6, 16, 12, col); x.fillStyle = shade(col, 0.2); x.fillRect(3, 8, 10, 4);
      x.fillStyle = shade(col, -0.35); x.fillRect(0, 6, 3, 10); x.fillRect(13, 6, 3, 10);
      x.fillStyle = '#2b1b10'; x.fillRect(1, 17, 2, 1); x.fillRect(13, 17, 2, 1);
      return outline(c);
    },
    armchair_green() { return FURN.armchair('#3f6b4a'); },
    armchair_red() { return FURN.armchair('#8a2f38'); },
    plant() {
      const [c, x] = canvas(16, 26);
      box(x, 4, 18, 8, 8, '#b5643c'); x.fillStyle = '#8f4a2a'; x.fillRect(4, 18, 8, 2);
      const leaf = (X, Y, r, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(X, Y, r, r * 0.7, 0, 0, Math.PI * 2); x.fill(); };
      leaf(8, 12, 7, '#2e6b3a'); leaf(4, 8, 4, '#3a8a48'); leaf(12, 7, 4, '#3a8a48'); leaf(8, 4, 4, '#4aa45a'); leaf(6, 13, 3, '#255a30');
      x.fillStyle = '#7acb7a'; x.fillRect(7, 2, 2, 1); x.fillRect(3, 6, 2, 1); x.fillRect(11, 5, 2, 1);
      return outline(c);
    },
    planter() {
      const [c, x] = canvas(32, 22);
      box(x, 0, 10, 32, 12, '#7a5a3a', '#4a3020');
      const fl = (X, Y, col) => { x.fillStyle = '#3a7a44'; x.fillRect(X, Y, 1, 10 - (Y - 2)); x.fillStyle = col; x.fillRect(X - 1, Y, 3, 2); x.fillStyle = shade(col, 0.35); x.fillRect(X, Y, 1, 1); };
      fl(4, 4, '#d77ac0'); fl(9, 2, '#f2f2f2'); fl(14, 5, '#d77ac0'); fl(19, 3, '#c95aa8'); fl(24, 2, '#f2f2f2'); fl(28, 5, '#d77ac0');
      return outline(c);
    },
    bench() {
      const [c, x] = canvas(32, 16);
      x.fillStyle = '#2a2a30'; x.fillRect(2, 8, 2, 8); x.fillRect(28, 8, 2, 8);
      box(x, 0, 0, 32, 4, '#8a6a44'); box(x, 0, 6, 32, 4, '#9a7a50');
      return outline(c);
    },
    potting() {
      const [c, x] = canvas(32, 22);
      x.fillStyle = '#4a3020'; x.fillRect(2, 10, 2, 12); x.fillRect(28, 10, 2, 12);
      box(x, 0, 8, 32, 5, '#8a6a44');
      box(x, 3, 3, 6, 5, '#b5643c'); box(x, 12, 4, 5, 4, '#b5643c'); x.fillStyle = '#3a8a48'; x.fillRect(4, 0, 4, 3);
      x.fillStyle = '#9aa0a8'; x.fillRect(21, 5, 7, 2); x.fillRect(26, 3, 1, 4);
      return outline(c);
    },
    stove() {
      const [c, x] = canvas(32, 28);
      box(x, 0, 4, 32, 24, '#2b2b33', '#3c3c46');
      x.fillStyle = '#16161c'; x.fillRect(4, 12, 11, 12); x.fillRect(18, 12, 10, 12);
      x.fillStyle = '#ff7a2a'; x.fillRect(6, 19, 7, 3); x.fillStyle = '#ffd36a'; x.fillRect(8, 20, 3, 1);
      x.fillStyle = '#9aa0a8'; x.fillRect(20, 15, 6, 1);
      box(x, 6, 0, 9, 6, '#6a6a74'); x.fillStyle = '#8a8a94'; x.fillRect(6, 0, 9, 1);
      return outline(c);
    },
    counter() {
      const [c, x] = canvas(32, 22);
      box(x, 0, 4, 32, 18, '#8a6a44');
      x.fillStyle = '#d9d4c8'; x.fillRect(0, 2, 32, 4); x.fillStyle = '#efebe2'; x.fillRect(0, 2, 32, 1);
      x.fillStyle = '#6a5034'; x.fillRect(3, 9, 12, 10); x.fillRect(17, 9, 12, 10);
      x.fillStyle = '#f4f4f4'; x.fillRect(5, 0, 5, 2); x.fillRect(19, 0, 6, 2);
      return outline(c);
    },
    pantry() {
      const [c, x] = canvas(32, 32);
      box(x, 0, 0, 32, 32, '#7a5a3a', '#8a6a44');
      for (const sy of [5, 14, 23]) {
        x.fillStyle = '#3a2818'; x.fillRect(2, sy, 28, 7);
        for (let i = 0; i < 6; i++) { const cols = ['#c0392b', '#e3b341', '#6a9a3a', '#d9772a', '#8a4a9a']; x.fillStyle = cols[(i + sy) % 5]; x.fillRect(3 + i * 5, sy + 2, 3, 5); x.fillStyle = '#e8e0d0'; x.fillRect(3 + i * 5, sy + 1, 3, 1); }
      }
      return outline(c);
    },
    kitchen_table() {
      const [c, x] = canvas(32, 32);
      x.fillStyle = '#5a3a22'; x.fillRect(2, 20, 2, 12); x.fillRect(28, 20, 2, 12);
      box(x, 0, 6, 32, 16, '#a07a4a'); x.fillStyle = '#b88c58'; x.fillRect(0, 6, 32, 2);
      x.fillStyle = '#d9a35a'; x.beginPath(); x.ellipse(10, 12, 5, 3, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#c0392b'; x.fillRect(20, 10, 3, 3); x.fillStyle = '#6a9a3a'; x.fillRect(24, 11, 3, 3);
      x.fillStyle = '#e8e0d0'; x.fillRect(4, 16, 6, 3);
      return outline(c);
    },
    dining_table() {
      const [c, x] = canvas(80, 34);
      // chairs behind
      for (const cx of [6, 22, 38, 54, 70]) { box(x, cx - 3, 0, 8, 10, '#5a2a2a'); }
      x.fillStyle = '#4a2a18'; x.fillRect(3, 26, 3, 8); x.fillRect(74, 26, 3, 8);
      box(x, 0, 8, 80, 20, '#f0ece2'); x.fillStyle = '#d9d3c4'; x.fillRect(0, 22, 80, 6);
      x.fillStyle = '#c9c2b0'; for (let i = 4; i < 80; i += 8) x.fillRect(i, 26, 4, 2);
      for (const px of [8, 24, 56, 72]) { x.fillStyle = '#fafafa'; x.beginPath(); x.ellipse(px, 15, 4, 2.5, 0, 0, Math.PI * 2); x.fill(); x.fillStyle = '#c9c2b0'; x.fillRect(px - 1, 15, 3, 1); }
      // candelabra
      x.fillStyle = '#d9a93a'; x.fillRect(39, 6, 2, 12); x.fillRect(35, 10, 10, 1); x.fillRect(35, 7, 1, 4); x.fillRect(44, 7, 1, 4);
      x.fillStyle = '#f4f0e0'; x.fillRect(35, 4, 1, 3); x.fillRect(39, 3, 2, 3); x.fillRect(44, 4, 1, 3);
      return outline(c);
    },
    sideboard() {
      const [c, x] = canvas(32, 22);
      box(x, 0, 4, 32, 18, '#5a3424', '#6e4230');
      x.fillStyle = '#4a2a1c'; x.fillRect(2, 9, 13, 10); x.fillRect(17, 9, 13, 10);
      x.fillStyle = '#d9a93a'; x.fillRect(13, 13, 1, 2); x.fillRect(18, 13, 1, 2);
      x.fillStyle = '#c9ccd2'; x.fillRect(4, 0, 6, 4); x.fillRect(22, 1, 5, 3); x.fillStyle = '#eef0f4'; x.fillRect(4, 0, 6, 1);
      return outline(c);
    },
    drinks() {
      const [c, x] = canvas(32, 30);
      box(x, 0, 0, 32, 30, '#4a2a1c', '#5e3624');
      x.fillStyle = '#1a1010'; x.fillRect(2, 4, 28, 10);
      const b = (X, col, h) => { x.fillStyle = col; x.fillRect(X, 14 - h, 3, h); x.fillRect(X + 1, 14 - h - 2, 1, 2); x.fillStyle = 'rgba(255,255,255,.3)'; x.fillRect(X, 14 - h, 1, h - 1); };
      b(4, '#7a2a1a', 7); b(9, '#2a5a2a', 8); b(14, '#c9a24a', 6); b(19, '#5a1a2a', 8); b(24, '#a0c0d0', 7);
      x.fillStyle = '#3a2016'; x.fillRect(2, 17, 13, 10); x.fillRect(17, 17, 13, 10);
      return outline(c);
    },
    piano() {
      const [c, x] = canvas(32, 34);
      x.fillStyle = '#0f0f14'; x.beginPath(); x.moveTo(2, 8); x.lineTo(30, 8); x.lineTo(30, 20); x.quadraticCurveTo(28, 32, 14, 30); x.lineTo(2, 30); x.closePath(); x.fill();
      x.fillStyle = '#26262e'; x.fillRect(4, 10, 24, 2);
      x.fillStyle = '#0f0f14'; x.beginPath(); x.moveTo(4, 9); x.lineTo(24, 0); x.lineTo(26, 2); x.lineTo(8, 10); x.fill(); // lid
      x.fillStyle = '#f4f4f0'; x.fillRect(2, 30, 18, 3); x.fillStyle = '#111'; for (let i = 3; i < 20; i += 2) x.fillRect(i, 30, 1, 2);
      x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(5, 14, 10, 1);
      return outline(c);
    },
    statue() {
      const [c, x] = canvas(16, 36);
      box(x, 2, 26, 12, 10, '#bdb6a8', '#d6d0c4');
      x.fillStyle = '#efebe4'; x.fillRect(6, 4, 4, 4); x.fillRect(5, 8, 6, 9); x.fillRect(6, 17, 4, 9);
      x.fillStyle = '#d6d0c4'; x.fillRect(9, 8, 2, 18); x.fillRect(3, 9, 2, 6);
      return outline(c);
    },
    pillar() {
      const [c, x] = canvas(16, 44);
      box(x, 2, 0, 12, 4, '#d6d0c4'); box(x, 2, 40, 12, 4, '#d6d0c4');
      x.fillStyle = '#ece8e0'; x.fillRect(4, 4, 8, 36);
      x.fillStyle = '#d6d0c4'; x.fillRect(6, 4, 1, 36); x.fillRect(9, 4, 1, 36); x.fillStyle = '#c4beb0'; x.fillRect(11, 4, 1, 36);
      return outline(c);
    },
    chaise() {
      const [c, x] = canvas(32, 18);
      box(x, 0, 6, 32, 10, '#6a3a7a'); box(x, 0, 0, 10, 12, '#5a2f6a');
      x.fillStyle = '#8a5a9a'; x.fillRect(11, 7, 19, 2);
      x.fillStyle = '#d9a93a'; x.fillRect(2, 16, 2, 2); x.fillRect(28, 16, 2, 2);
      return outline(c);
    },
    cue_rack() {
      const [c, x] = canvas(32, 30);
      box(x, 2, 0, 28, 30, '#4a2e1e', '#5a3a26');
      x.fillStyle = '#2a1a10'; x.fillRect(4, 4, 24, 22);
      for (let i = 0; i < 6; i++) { x.fillStyle = '#d9b47a'; x.fillRect(6 + i * 4, 5, 1, 20); x.fillStyle = '#3a2a1a'; x.fillRect(6 + i * 4, 18, 1, 7); x.fillStyle = '#eef'; x.fillRect(6 + i * 4, 5, 1, 1); }
      x.fillStyle = '#d9a93a'; x.fillRect(4, 26, 24, 1);
      return outline(c);
    },
    billiard() {
      const [c, x] = canvas(48, 34);
      x.fillStyle = '#3a2214'; x.fillRect(3, 26, 4, 8); x.fillRect(41, 26, 4, 8); x.fillRect(22, 26, 4, 8);
      box(x, 0, 2, 48, 26, '#5a3420');
      x.fillStyle = '#1f6a3e'; x.fillRect(4, 5, 40, 18); x.fillStyle = '#257a48'; x.fillRect(4, 5, 40, 2);
      x.fillStyle = '#0d0a08'; for (const [px, py] of [[4, 5], [23, 5], [43, 5], [4, 22], [23, 22], [43, 22]]) x.fillRect(px, py, 2, 2);
      const ball = (X, Y, col) => { x.fillStyle = col; x.fillRect(X, Y, 2, 2); x.fillStyle = 'rgba(255,255,255,.6)'; x.fillRect(X, Y, 1, 1); };
      ball(12, 12, '#f4f4f0'); ball(30, 10, '#e3b341'); ball(33, 13, '#2a4aa0'); ball(31, 16, '#1a1a1a'); ball(36, 11, '#8a2a9a');
      x.fillStyle = '#d9b47a'; x.fillRect(6, 15, 14, 1); x.fillStyle = '#3a2a1a'; x.fillRect(6, 15, 4, 1);
      return outline(c);
    },
    trophy() {
      const [c, x] = canvas(32, 30);
      box(x, 0, 0, 32, 30, '#4a2e1e', '#5a3a26');
      x.fillStyle = '#1a1210'; x.fillRect(3, 4, 26, 10); x.fillRect(3, 16, 26, 10);
      const cup = (X, Y) => { x.fillStyle = '#e3b341'; x.fillRect(X, Y, 4, 3); x.fillRect(X + 1, Y + 3, 2, 2); x.fillRect(X, Y + 5, 4, 1); x.fillStyle = '#fff3b0'; x.fillRect(X, Y, 1, 1); };
      cup(6, 7); cup(14, 6); cup(22, 7); cup(9, 19); cup(19, 19);
      x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(3, 4, 2, 22);
      return outline(c);
    },
    wine_rack() {
      const [c, x] = canvas(32, 32);
      box(x, 0, 0, 32, 32, '#4a2e1e', '#5a3a26');
      for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) {
        const X = 3 + k * 5, Y = 4 + r * 7;
        x.fillStyle = '#1a0e08'; x.fillRect(X, Y, 4, 5);
        x.fillStyle = rnd() < 0.85 ? (rnd() < 0.5 ? '#3a1220' : '#1f3a1a') : '#1a0e08'; x.beginPath(); x.arc(X + 2, Y + 2.5, 1.6, 0, Math.PI * 2); x.fill();
      }
      return outline(c);
    },
    crates() {
      const [c, x] = canvas(32, 26);
      const crate = (X, Y, w, h) => { box(x, X, Y, w, h, '#9a7444'); x.fillStyle = '#7a5630'; x.fillRect(X + 1, Y + 3, w - 2, 1); x.fillRect(X + 1, Y + h - 4, w - 2, 1); x.fillRect(X + w / 2, Y + 1, 1, h - 2); };
      crate(0, 10, 18, 16); crate(16, 12, 16, 14); crate(4, 0, 14, 11);
      x.fillStyle = '#e3c87a'; x.fillRect(6, 9, 3, 2); x.fillRect(20, 11, 2, 1);
      return outline(c);
    },
    barrel() {
      const [c, x] = canvas(16, 18);
      box(x, 2, 2, 12, 16, '#7a5230'); x.fillStyle = '#3a3a40'; x.fillRect(2, 5, 12, 1); x.fillRect(2, 13, 12, 1);
      x.fillStyle = '#5a3a20'; x.beginPath(); x.ellipse(8, 3, 6, 2, 0, 0, Math.PI * 2); x.fill();
      return outline(c);
    },
    bust() {
      const [c, x] = canvas(16, 30);
      box(x, 3, 14, 10, 16, '#4a3a2a', '#5a4836');
      x.fillStyle = '#e6e0d4'; x.fillRect(5, 9, 6, 5); x.fillRect(6, 3, 4, 6); x.fillStyle = '#c9c2b4'; x.fillRect(9, 4, 1, 9);
      return outline(c);
    },
  };
  const furnCache = {};
  function furniture(type) { return furnCache[type] || (furnCache[type] = FURN[type]()); }

  // animated fire for fireplace / stove (3 frames, 14x12)
  const fireFrames = [0, 1, 2].map(k => {
    const [c, x] = canvas(14, 12);
    const fl = (X, h, col) => { x.fillStyle = col; x.fillRect(X, 12 - h, 2, h); };
    const hs = [[5, 8, 10, 7, 4], [7, 10, 8, 9, 5], [4, 9, 11, 6, 6]][k];
    hs.forEach((h, i) => fl(1 + i * 2.5, h, '#e2552a'));
    hs.forEach((h, i) => fl(2 + i * 2.5, Math.max(2, h - 3), '#ffa53a'));
    hs.forEach((h, i) => fl(2.5 + i * 2.5, Math.max(1, h - 6), '#ffe08a'));
    return c;
  });

  // ======================= ICONS (16x16) =======================
  const ICONS = {
    candlestick(x) { R(x, 7, 9, 2, 5, '#d9a93a'); R(x, 4, 14, 8, 2, '#d9a93a'); R(x, 6, 12, 4, 2, '#c08a2a'); R(x, 7, 3, 2, 6, '#f4f0e0'); R(x, 7, 1, 2, 2, '#ffb84a'); },
    opener(x) { R(x, 3, 11, 4, 3, '#6a3a22'); x.fillStyle = '#d6dbe2'; x.beginPath(); x.moveTo(6, 11); x.lineTo(14, 2); x.lineTo(15, 3); x.lineTo(8, 13); x.fill(); R(x, 5, 10, 3, 1, '#d9a93a'); },
    rope(x) { x.strokeStyle = '#b08a52'; x.lineWidth = 2; for (const r of [6, 4, 2]) { x.beginPath(); x.ellipse(8, 9, r, r * 0.7, 0, 0, Math.PI * 2); x.stroke(); } R(x, 12, 2, 2, 6, '#b08a52'); },
    revolver(x) { R(x, 2, 5, 11, 3, '#5a5f68'); R(x, 6, 5, 4, 5, '#707680'); R(x, 7, 8, 3, 6, '#5a3a22'); R(x, 12, 4, 1, 1, '#5a5f68'); R(x, 5, 9, 1, 2, '#3a3e46'); },
    vial(x) { R(x, 6, 2, 4, 2, '#6a3a22'); R(x, 6, 4, 4, 2, '#cfe8f0'); R(x, 4, 6, 8, 8, '#cfe8f0'); R(x, 5, 9, 6, 4, '#4ac04a'); R(x, 5, 7, 1, 3, '#ffffff'); },
    poker(x) { x.fillStyle = '#4a4a52'; x.beginPath(); x.moveTo(3, 13); x.lineTo(12, 3); x.lineTo(13, 4); x.lineTo(4, 14); x.fill(); R(x, 11, 2, 1, 4, '#4a4a52'); R(x, 2, 12, 3, 3, '#d9a93a'); },
    cigar(x) { R(x, 3, 7, 9, 3, '#7a4a28'); R(x, 9, 7, 2, 3, '#c0392b'); R(x, 12, 7, 2, 3, '#9a9a9a'); R(x, 13, 4, 1, 2, '#c8c8c8'); },
    glove(x) { R(x, 5, 6, 7, 8, '#e9eef2'); for (let i = 0; i < 4; i++) R(x, 5 + i * 2, 2 + (i % 2), 1, 5, '#e9eef2'); R(x, 3, 8, 2, 3, '#e9eef2'); R(x, 9, 9, 3, 2, '#c0392b'); },
    hairpin(x) { R(x, 3, 3, 1, 10, '#b3243c'); R(x, 6, 3, 1, 10, '#b3243c'); R(x, 3, 3, 4, 1, '#b3243c'); R(x, 10, 5, 4, 4, '#e3b341'); R(x, 11, 6, 2, 2, '#b3243c'); },
    page(x) { R(x, 3, 2, 10, 12, '#efe6cf'); for (let i = 4; i < 12; i += 2) R(x, 5, i, 6, 1, '#7a6a5a'); R(x, 3, 2, 3, 1, '#c0392b'); R(x, 10, 11, 3, 3, '#d8cbb0'); },
    pearl(x) { R(x, 7, 2, 2, 5, '#d9a93a'); x.fillStyle = '#f7f2e8'; x.beginPath(); x.arc(8, 10, 4, 0, Math.PI * 2); x.fill(); R(x, 6, 8, 2, 2, '#ffffff'); },
    cloth(x) { x.fillStyle = '#9aa0a8'; x.beginPath(); x.moveTo(2, 5); x.lineTo(13, 3); x.lineTo(14, 12); x.lineTo(3, 14); x.fill(); R(x, 5, 6, 6, 1, '#c8ccd2'); R(x, 6, 9, 6, 1, '#c8ccd2'); },
    pen(x) { x.fillStyle = '#1f2a4a'; x.beginPath(); x.moveTo(3, 13); x.lineTo(11, 3); x.lineTo(13, 5); x.lineTo(5, 15); x.fill(); R(x, 11, 2, 2, 2, '#d9a93a'); R(x, 2, 13, 2, 2, '#d9a93a'); R(x, 6, 12, 3, 2, '#2a3a8a'); },
    locket(x) { x.strokeStyle = '#c9ccd2'; x.lineWidth = 1; x.beginPath(); x.moveTo(3, 1); x.lineTo(8, 6); x.lineTo(13, 1); x.stroke(); x.fillStyle = '#c9ccd2'; x.beginPath(); x.ellipse(8, 10, 4, 4.5, 0, 0, Math.PI * 2); x.fill(); R(x, 7, 8, 2, 2, '#8a8f98'); R(x, 6, 8, 1, 1, '#ffffff'); },
    cue(x) { x.fillStyle = '#d9b47a'; x.beginPath(); x.moveTo(2, 14); x.lineTo(13, 1); x.lineTo(14, 2); x.lineTo(4, 15); x.fill(); x.fillStyle = '#3a2a1a'; x.beginPath(); x.moveTo(2, 14); x.lineTo(6, 9); x.lineTo(8, 10); x.lineTo(4, 15); x.fill(); R(x, 13, 1, 1, 1, '#2a6aaa'); },
    bottle(x) { R(x, 7, 1, 2, 4, '#1f3a1a'); R(x, 6, 1, 4, 1, '#c9a24a'); R(x, 5, 5, 6, 10, '#1f3a1a'); R(x, 6, 8, 4, 4, '#efe6cf'); R(x, 6, 6, 1, 7, 'rgba(255,255,255,.3)'); },
    stain(x) { x.fillStyle = '#7a1420'; x.beginPath(); x.ellipse(8, 9, 6, 4, 0.3, 0, Math.PI * 2); x.fill(); R(x, 3, 4, 2, 2, '#7a1420'); R(x, 12, 3, 2, 2, '#7a1420'); R(x, 6, 7, 2, 1, '#a62030'); },
    magnifier(x) { x.strokeStyle = '#c9ccd2'; x.lineWidth = 2; x.beginPath(); x.arc(7, 7, 4, 0, Math.PI * 2); x.stroke(); R(x, 10, 10, 2, 2, '#6a3a22'); R(x, 12, 12, 2, 2, '#6a3a22'); R(x, 5, 5, 2, 1, '#ffffff'); },
    body(x) { R(x, 2, 6, 12, 5, '#4a2f5a'); R(x, 12, 6, 3, 4, '#dcc4b2'); R(x, 4, 11, 7, 2, '#7a1420'); },
  };
  function R(x, X, Y, w, h, c) { x.fillStyle = c; x.fillRect(X, Y, w, h); }
  const iconCache = {};
  function icon(name) {
    if (iconCache[name]) return iconCache[name];
    const [c, x] = canvas(16, 16);
    (ICONS[name] || ICONS.magnifier)(x);
    return (iconCache[name] = outline(c));
  }

  window.MM_ART = { canvas, shade, outline, LOOKS, sheet, portrait, bodySprite, furniture, fireFrames, icon };
})();
