// Rival Hospital: the town the single-player campaign is played in. Theme Hospital's level maps are 128x128 tiles cut
// into numbered plots: plot 0 is the town (streets, pavements, lawns, houses, a park), plot 1 is the building you start
// with, and every other plot is for sale at $25 a tile once the level puts it on the market. Unowned plots are mown
// grass; buying one puts its building up, and divider walls between plots you own come down.
// The town is laid round the two-player map's building, which keeps its coordinates: the town reaches into negative
// tile coordinates (X0, Y0). Pure data plus a builder, no DOM; loads in the browser as window.RT and in Node.
(function (root) {
  'use strict';
  const X0 = -40, Y0 = -44, W = 128, H = 128;
  const GRASS = 0, PAVE = 1, ROAD = 2, LOT = 3, WATER = 4, FLOOR = 5, HOUSE = 6;
  // streets three tiles wide: [x, y, w, h], v = runs north-south
  const ROADS = [
    { r: [-6, Y0, 3, H], v: true },        // the avenue past the front of the hospital (the two-player map's road)
    { r: [-26, -29, 3, 79], v: true },     // west street
    { r: [46, -29, 3, 79], v: true },      // east street
    { r: [X0, -32, W, 3], v: false },      // north road
    { r: [-3, -14, 90, 3], v: false },     // north street, behind the hospital
    { r: [-3, 30, 90, 3], v: false },      // south street
    { r: [X0, 50, W, 3], v: false },       // south road, by the park
  ];
  // plots for sale. rect [x, y, w, h]; door: the middle of its three front-door tiles, inside the plot, and the way
  // they face (0 N, 1 E, 2 S, 3 W). lvl: the first level that puts it on the market.
  const PLOTS = [
    { id: 2, nm: 'North wing', rect: [9, -10, 23, 10], door: [20, -10, 0], lvl: 2 },
    { id: 3, nm: 'East wing', rect: [32, 0, 13, 26], door: [44, 12, 1], lvl: 3 },
    { id: 4, nm: 'Corner wing', rect: [32, -10, 13, 10], door: [38, -10, 0], lvl: 4 },
    { id: 5, nm: 'Eastgate House', rect: [50, -10, 14, 16], door: [50, -2, 3], lvl: 5 },
    { id: 6, nm: 'Old Infirmary', rect: [50, 8, 14, 18], door: [50, 16, 3], lvl: 6 },
    { id: 7, nm: 'South Lodge', rect: [9, 34, 16, 14], door: [16, 34, 0], lvl: 7 },
    { id: 8, nm: 'Mill Building', rect: [27, 34, 18, 14], door: [35, 34, 0], lvl: 8 },
    { id: 9, nm: 'North Hall', rect: [9, -27, 23, 12], door: [20, -16, 2], lvl: 9 },
    { id: 10, nm: 'Westfield House', rect: [-21, -10, 14, 20], door: [-8, 0, 1], lvl: 10 },
    { id: 11, nm: 'Old Schoolhouse', rect: [-21, 14, 14, 18], door: [-8, 22, 1], lvl: 11 },
    { id: 12, nm: 'Riverside Works', rect: [50, 34, 22, 14], door: [60, 34, 0], lvl: 12 },
    { id: 13, nm: 'Market Hall', rect: [33, -27, 13, 12], door: [40, -16, 2], lvl: 12 },
  ];
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  // a cheap deterministic hash in [0, 1)
  function hash(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  // spec.indoor(x, y): plot 1's floor (the two-player building). spec.doorOut: the tile outside its front doors.
  // spec.keep(x, y): tiles the two-player map already paints outside the building (car park, path, forecourt).
  function build(spec) {
    const N = W * H, kind = new Uint8Array(N), plot = new Uint8Array(N), road = new Uint8Array(N);   // road: 1 runs N-S, 2 runs E-W, 3 both
    const at = (x, y) => (y - Y0) * W + (x - X0);
    const inMap = (x, y) => x >= X0 && y >= Y0 && x < X0 + W && y < Y0 + H;
    const set = (x, y, k) => { if (inMap(x, y)) kind[at(x, y)] = k; };
    const fill = (r, k) => { for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) set(x, y, k); };
    for (const R of ROADS) { fill(R.r, ROAD); for (let y = R.r[1]; y < R.r[1] + R.r[3]; y++) for (let x = R.r[0]; x < R.r[0] + R.r[2]; x++) if (inMap(x, y)) road[at(x, y)] |= R.v ? 1 : 2; }
    // plot 1: the hospital you start with; the rest as listed
    const plots = [{ id: 1, nm: 'Your hospital', rect: null, door: null, lvl: 1, tiles: 0 }];
    for (let y = Y0; y < Y0 + H; y++) for (let x = X0; x < X0 + W; x++) if (spec.indoor(x, y)) { plot[at(x, y)] = 1; kind[at(x, y)] = FLOOR; plots[0].tiles++; }
    for (const P of PLOTS) {
      const p = Object.assign({ tiles: 0 }, P);
      const [x0, y0, w, h] = P.rect;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { plot[at(x, y)] = p.id; kind[at(x, y)] = FLOOR; p.tiles++; }
      plots.push(p);
    }
    // the two-player map's own outside: the car park (nobody walks across it), the path from the avenue, the forecourt
    // in front of the doors and on down to the south street's pavement
    for (let y = 17; y <= 25; y++) for (let x = -3; x <= -1; x++) set(x, y, LOT);
    fill([-3, 13, 5, 3], PAVE);
    fill([2, 12, 7, 17], PAVE);
    // the park: a pond with a path round it
    fill([2, 57, 23, 13], PAVE); fill([3, 58, 21, 11], GRASS); fill([8, 60, 11, 6], WATER);
    // pavements along every street
    for (let y = Y0; y < Y0 + H; y++) for (let x = X0; x < X0 + W; x++) {
      if (kind[at(x, y)] !== GRASS) continue;
      for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (inMap(nx, ny) && kind[at(nx, ny)] === ROAD) { kind[at(x, y)] = PAVE; break; } }
    }
    // the entrances: three door edges per plot (plot 1's front doors open on to the forecourt)
    const doors = [];   // [inside x, y, outside x, y, plot id]
    const doorList = d => { const [x, y, f] = d, a = f % 2 === 0 ? [1, 0] : [0, 1], [dx, dy] = DIRS[f], out = []; for (let k = -1; k <= 1; k++) out.push([x + a[0] * k, y + a[1] * k, x + a[0] * k + dx, y + a[1] * k + dy]); return out; };
    plots[0].door = spec.door;
    for (const p of plots) for (const [ix, iy, ox, oy] of doorList(p.door)) { doors.push([ix, iy, ox, oy, p.id]); if (kind[at(ox, oy)] !== ROAD) set(ox, oy, PAVE); }
    // ---- scenery ----
    const scen = [];
    const free = (x0, y0, w, h, m) => { for (let y = y0 - m; y < y0 + h + m; y++) for (let x = x0 - m; x < x0 + w + m; x++) { if (!inMap(x, y)) return false; const i = at(x, y); if (kind[i] !== GRASS || plot[i] || spec.keep(x, y)) return false; } return true; };
    // houses: rows along the outer streets, each in its own garden, a different colour and roof
    const WALLS = ['#e8dcc4', '#d9b48c', '#c86a4a', '#e6e2d6', '#b8c4cc', '#d8c47a'], ROOFS = ['#8a3b2e', '#5a5f6e', '#6a4a3a', '#3e5a7a'];
    let hn = 0;
    const house = (x, y, w, h) => { if (!free(x, y, w, h, 1)) return; fill([x, y, w, h], HOUSE); scen.push({ k: 'house', x, y, w, h, wall: WALLS[hn % WALLS.length], roof: ROOFS[(hn * 3 + 1) % ROOFS.length], n: hn++ }); };
    for (let x = X0 + 2; x < X0 + W - 6; x += 7) { house(x, -42, 5, 5); house(x, -28, 5, 4); house(x, 74, 5, 5); house(x, 55, 5, 5); }
    for (let y = -27; y < 50; y += 7) { house(-37, y, 5, 5); house(-33, y, 5, 5); house(66, y, 5, 5); house(74, y, 5, 5); house(81, y, 5, 5); }
    // trees on the lawns, thicker in the park; hedges and flower beds by the houses
    for (let y = Y0 + 1; y < Y0 + H - 1; y++) for (let x = X0 + 1; x < X0 + W - 1; x++) {
      const park = x >= 0 && x <= 44 && y >= 54 && y <= 72;
      if (x >= -8 && x <= 36 && y >= -12 && y <= 30) continue;   // the two-player map's own grounds have their trees
      if (!free(x, y, 1, 1, 1)) continue;
      const v = hash(x * 7 + 3, y * 13 + 5);
      if (v < (park ? 0.11 : 0.045)) scen.push({ k: hash(x, y) < 0.8 ? 'tree' : 'bush', x: x * 16 + 8, y: y * 16 + 8 });
    }
    // street lamps along the pavements, benches and lamps round the pond
    for (let y = Y0; y < Y0 + H; y++) for (let x = X0; x < X0 + W; x++) {
      const i = at(x, y); if (kind[i] !== PAVE) continue;
      const nearRoad = DIRS.some(([dx, dy]) => inMap(x + dx, y + dy) && kind[at(x + dx, y + dy)] === ROAD);
      if (nearRoad && ((x * 5 + y * 3) % 11 === 0) && !doors.some(d => Math.abs(d[2] - x) + Math.abs(d[3] - y) < 3) && !spec.keep(x, y)) scen.push({ k: 'lamp', x: x * 16 + 8, y: y * 16 + 8 });
    }
    for (const [x, y] of [[5, 57], [13, 57], [21, 57], [5, 69], [13, 69], [21, 69]]) scen.push({ k: 'bench', x: x * 16 + 8, y: y * 16 + 8, f: y > 60 ? 0 : 2 });
    for (const [x, y] of [[2, 57], [24, 57], [2, 69], [24, 69]]) scen.push({ k: 'lamp', x: x * 16 + 8, y: y * 16 + 8 });
    // unowned plots: Theme Hospital's mown lawn with a flower bed or bush now and then (gone once you buy it)
    for (const p of plots) if (p.rect) {
      const [x0, y0, w, h] = p.rect;
      for (let y = y0 + 1; y < y0 + h - 1; y += 4) for (let x = x0 + 1; x < x0 + w - 1; x += 4) if (hash(x + p.id, y) < 0.3) scen.push({ k: hash(y, x) < 0.5 ? 'bush' : 'flowers', x: x * 16 + 8, y: y * 16 + 8, plot: p.id });
    }
    return { X0, Y0, W, H, kind, plot, road, plots, doors, scen, at, GRASS, PAVE, ROAD, LOT, WATER, FLOOR, HOUSE };
  }
  const api = { X0, Y0, W, H, build, PLOTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RT = api;
})(typeof window !== 'undefined' ? window : globalThis);
