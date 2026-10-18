// Manor Mystery: world data, collision, and case generation.
// Everything here is static except genCase(seed). Only the HOST ever calls genCase;
// the guest never receives the seed, so the solution stays secret until the game ends.
(function () {
  'use strict';
  const T = 16;            // tile size in pixels
  const W = 49, H = 27;    // map size in tiles

  // ---------- rooms ----------
  const ROOMS = [
    { id: 0, name: 'Library',      x: 1,  y: 1,  w: 11, h: 8, floor: 'wood_dark', wall: 'green',  wing: 'north' },
    { id: 1, name: 'Study',        x: 13, y: 1,  w: 11, h: 8, floor: 'carpet',    wall: 'red',    wing: 'north' },
    { id: 2, name: 'Conservatory', x: 25, y: 1,  w: 11, h: 8, floor: 'tile_green',wall: 'glass',  wing: 'north' },
    { id: 3, name: 'Billiard Room',x: 37, y: 1,  w: 11, h: 8, floor: 'parquet',   wall: 'teal',   wing: 'north' },
    { id: 4, name: 'Kitchen',      x: 1,  y: 17, w: 11, h: 9, floor: 'checker',   wall: 'cream',  wing: 'south' },
    { id: 5, name: 'Dining Room',  x: 13, y: 17, w: 11, h: 9, floor: 'wood_light',wall: 'blue',   wing: 'south' },
    { id: 6, name: 'Ballroom',     x: 25, y: 17, w: 11, h: 9, floor: 'marble',    wall: 'gold',   wing: 'south' },
    { id: 7, name: 'Wine Cellar',  x: 37, y: 17, w: 11, h: 9, floor: 'stone',     wall: 'brick',  wing: 'south' },
  ];
  const NR = ROOMS.length;
  const HALL = { id: NR, name: 'Hall', x: 1, y: 10, w: 47, h: 6, floor: 'hall', wall: 'panel' };
  const DOOR_X = [6, 18, 30, 42];

  // tiles: 0 = floor, 1 = wall
  const grid = new Uint8Array(W * H).fill(1);
  const roomAt = new Int8Array(W * H).fill(-1);
  for (const r of [...ROOMS, HALL]) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { grid[y * W + x] = 0; roomAt[y * W + x] = r.id; }
  }
  for (const dx of DOOR_X) for (const row of [9, 16]) for (const x of [dx, dx + 1]) {
    grid[row * W + x] = 0; roomAt[row * W + x] = NR;
  }
  const isWall = (tx, ty) => tx < 0 || ty < 0 || tx >= W || ty >= H || grid[ty * W + tx] === 1;
  const roomOf = (tx, ty) => (tx < 0 || ty < 0 || tx >= W || ty >= H ? -1 : roomAt[ty * W + tx]);

  // ---------- furniture ----------
  // x, y, w, h = collision footprint in tiles. `search` = a spot that can hold a clue.
  const F = [];
  function add(type, x, y, w, h, room, search, label) { F.push({ id: F.length, type, x, y, w, h, room, search: !!search, label: label || null }); }
  const [LIB, STU, CON, BIL, KIT, DIN, BAL, CEL] = [0, 1, 2, 3, 4, 5, 6, 7];
  // Library
  add('bookshelf', 2, 1, 2, 1, LIB, true, 'Bookshelf');
  add('bookshelf', 4, 1, 2, 1, LIB);
  add('bookshelf', 7, 1, 2, 1, LIB);
  add('clock', 10, 1, 1, 1, LIB, true, 'Grandfather clock');
  add('desk_lamp', 5, 5, 2, 1, LIB, true, 'Reading desk');
  add('armchair_green', 9, 5, 1, 1, LIB);
  add('plant', 1, 8, 1, 1, LIB);
  // Study
  add('fireplace', 14, 1, 2, 1, STU, true, 'Fireplace');
  add('desk', 17, 3, 2, 1, STU, true, 'Writing desk');
  add('cabinet', 21, 1, 2, 1, STU, true, 'Filing cabinet');
  add('armchair_red', 15, 6, 1, 1, STU);
  add('armchair_red', 21, 6, 1, 1, STU);
  // Conservatory
  add('plant', 26, 1, 1, 1, CON);
  add('plant', 28, 1, 1, 1, CON);
  add('planter', 31, 1, 2, 1, CON, true, 'Orchid planter');
  add('plant', 34, 1, 1, 1, CON);
  add('bench', 29, 5, 2, 1, CON, true, 'Garden bench');
  add('potting', 33, 6, 2, 1, CON, true, 'Potting table');
  add('plant', 26, 8, 1, 1, CON);
  add('plant', 35, 8, 1, 1, CON);
  // Billiard Room
  add('cue_rack', 38, 1, 2, 1, BIL, true, 'Cue rack');
  add('billiard', 40, 4, 3, 2, BIL, true, 'Billiard table');
  add('trophy', 45, 1, 2, 1, BIL, true, 'Trophy cabinet');
  add('armchair_green', 46, 6, 1, 1, BIL);
  add('armchair_green', 38, 6, 1, 1, BIL);
  add('plant', 47, 8, 1, 1, BIL);
  // Kitchen
  add('stove', 1, 17, 2, 1, KIT, true, 'Stove');
  add('counter', 3, 17, 2, 1, KIT);
  add('pantry', 9, 17, 2, 1, KIT, true, 'Pantry shelves');
  add('kitchen_table', 5, 21, 2, 2, KIT, true, 'Kitchen table');
  add('barrel', 1, 25, 1, 1, KIT);
  add('barrel', 10, 25, 1, 1, KIT);
  // Dining Room
  add('sideboard', 14, 17, 2, 1, DIN, true, 'Sideboard');
  add('drinks', 21, 17, 2, 1, DIN, true, 'Drinks cabinet');
  add('dining_table', 16, 20, 5, 2, DIN, true, 'Dining table');
  add('plant', 13, 25, 1, 1, DIN);
  add('plant', 23, 25, 1, 1, DIN);
  // Ballroom
  add('piano', 26, 18, 2, 2, BAL, true, 'Grand piano');
  add('statue', 34, 17, 1, 1, BAL, true, 'Marble statue');
  add('pillar', 28, 22, 1, 1, BAL);
  add('pillar', 33, 22, 1, 1, BAL);
  add('chaise', 31, 24, 2, 1, BAL, true, 'Chaise longue');
  // Wine Cellar
  add('wine_rack', 38, 17, 2, 1, CEL, true, 'Wine rack');
  add('wine_rack', 45, 17, 2, 1, CEL);
  add('crates', 38, 23, 2, 1, CEL, true, 'Crates');
  add('barrel', 46, 21, 1, 1, CEL, true, 'Old barrel');
  add('barrel', 47, 22, 1, 1, CEL);
  add('barrel', 45, 25, 1, 1, CEL);
  // Hall
  add('plant', 1, 10, 1, 1, NR);
  add('plant', 47, 10, 1, 1, NR);
  add('bust', 12, 10, 1, 1, NR);
  add('bust', 36, 10, 1, 1, NR);

  const solid = new Uint8Array(W * H);
  for (const f of F) for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) solid[y * W + x] = 1;
  const blocked = (tx, ty) => isWall(tx, ty) || solid[ty * W + tx] === 1;

  // Is a character's feet box free at pixel position (px, py)? (py = feet line)
  const FOOT_W = 10, FOOT_H = 6;
  function canStand(px, py) {
    const x0 = Math.floor((px - FOOT_W / 2) / T), x1 = Math.floor((px + FOOT_W / 2 - 0.01) / T);
    const y0 = Math.floor((py - FOOT_H) / T), y1 = Math.floor((py - 0.01) / T);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (blocked(x, y)) return false;
    return true;
  }

  // Special interactables in the hall
  const BODY = { x: 24, y: 12, label: 'The body' };                 // tile of the body (2 wide)
  const INSPECTOR = { px: 28 * T + 8, py: 12 * T + 14 };
  const SPAWN = { A: { px: 23 * T + 8, py: 14 * T + 12 }, B: { px: 26 * T + 8, py: 14 * T + 12 } };

  // ---------- cast ----------
  const SUSPECTS = [
    { name: 'Colonel Ashford', short: 'Ashford', look: 'colonel',  trace: 'A half-smoked cigar',        traceIcon: 'cigar',   voice: 'Hrmph. ' },
    { name: 'Dr. Hale',        short: 'Hale',    look: 'doctor',   trace: 'A torn surgical glove',      traceIcon: 'glove',   voice: 'Let me be precise. ' },
    { name: 'Miss Vane',       short: 'Vane',    look: 'vane',     trace: 'A crimson hairpin',          traceIcon: 'hairpin', voice: 'Darling, really. ' },
    { name: 'Reverend Moss',   short: 'Moss',    look: 'reverend', trace: 'A page torn from a prayer book', traceIcon: 'page', voice: 'Bless me. ' },
    { name: 'Lady Finch',      short: 'Finch',   look: 'finch',    trace: 'A pearl earring',            traceIcon: 'pearl',   voice: 'How dreadful. ' },
    { name: 'Mr. Crane',       short: 'Crane',   look: 'butler',   trace: 'A silver-polishing cloth',   traceIcon: 'cloth',   voice: 'If I may, detective. ' },
    { name: 'Professor Quill', short: 'Quill',   look: 'professor',trace: 'An ink-stained fountain pen', traceIcon: 'pen',    voice: 'Fascinating. ' },
    { name: 'Countess Orlova', short: 'Orlova',  look: 'countess', trace: 'A silver locket',            traceIcon: 'locket',  voice: 'Pah. ' },
  ];
  const WEAPONS = [
    { name: 'Candlestick',   icon: 'candlestick' },
    { name: 'Letter Opener', icon: 'opener' },
    { name: 'Rope',          icon: 'rope' },
    { name: 'Revolver',      icon: 'revolver' },
    { name: 'Poison Vial',   icon: 'vial' },
    { name: 'Fire Poker',    icon: 'poker' },
    { name: 'Billiard Cue',  icon: 'cue' },
    { name: 'Wine Bottle',   icon: 'bottle' },
  ];
  const FLAVOR = {
    bookshelf: 'Rows of dusty novels. Nothing hidden between them.',
    clock: 'The clock stopped at 9:47. Probably nothing; it does that.',
    desk_lamp: 'Reading glasses and a half-finished crossword.',
    fireplace: 'Warm ashes. Nothing but charred logs.',
    desk: 'Unpaid bills addressed to Lord Blackwood. Nothing useful.',
    cabinet: 'Old ledgers, neatly filed. Nothing out of place.',
    planter: 'Prize orchids. The soil is undisturbed.',
    bench: 'A damp cushion and a gardening magazine.',
    potting: 'Trowels, seed packets and empty pots.',
    stove: 'A pot of soup gone cold. Nothing else.',
    pantry: 'Jars of preserves, all neatly labelled.',
    kitchen_table: 'Bread crumbs and a cook\'s apron.',
    sideboard: 'Polished silverware, all accounted for.',
    drinks: 'Brandy and port. Someone has been helping themselves.',
    dining_table: 'Dessert plates, half-eaten. Dinner ended abruptly.',
    piano: 'Sheet music for a waltz. The keys are dusty.',
    statue: 'A marble Venus. Nothing tucked behind her.',
    chaise: 'Cushions plumped. Nothing underneath.',
    cue_rack: 'A row of cues, chalked and ready.',
    billiard: 'A game abandoned halfway. The red ball is missing.',
    trophy: 'Tarnished trophies from the county shooting club.',
    wine_rack: 'Dusty bottles of claret. A few gaps on the rack.',
    crates: 'Straw and empty crates from the last delivery.',
    barrel: 'The barrel sloshes. Just wine.',
  };

  // ---------- seeded RNG ----------
  function rngFrom(seed) {
    let a = seed >>> 0;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ---------- case generation (host only) ----------
  function genCase(seed) {
    const rnd = rngFrom(seed);
    const int = n => Math.floor(rnd() * n);
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = int(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const range = n => Array.from({ length: n }, (_, i) => i);
    const NS = SUSPECTS.length, NW = WEAPONS.length;
    const killer = int(NS), weapon = int(NW), room = int(NR);
    const spotsIn = r => F.filter(f => f.search && f.room === r).map(f => f.id);
    const free = new Set(F.filter(f => f.search).map(f => f.id));
    const spot = {}; // furniture id -> clue
    const take = (r) => { const opts = shuffle(spotsIn(r).filter(id => free.has(id))); if (!opts.length) return null; free.delete(opts[0]); return opts[0]; };

    // murder room: struggle + killer's trace
    spot[take(room)] = { kind: 'struggle' };
    spot[take(room)] = { kind: 'trace', who: killer };
    // bloody weapon hidden in another room
    const otherRooms = shuffle(range(NR).filter(r => r !== room));
    spot[take(otherRooms[0])] = { kind: 'weapon', w: weapon, bloody: true };
    // clean weapons scattered anywhere there's space
    for (const w of shuffle(range(NW).filter(w => w !== weapon))) {
      let id = null;
      for (const r of shuffle(range(NR))) { id = take(r); if (id !== null) break; }
      spot[id] = { kind: 'weapon', w, bloody: false };
    }
    // red herrings: three innocents' belongings in rooms where nothing happened
    const innocents = shuffle(range(NS).filter(s => s !== killer));
    for (const who of innocents.slice(0, 3)) {
      for (const r of shuffle(otherRooms.slice())) { const id = take(r); if (id !== null) { spot[id] = { kind: 'trace', who }; break; } }
    }

    // alibis: innocents in groups of 2, 2 and 3, each in a room that isn't the murder room
    const alibiRooms = shuffle(range(NR).filter(r => r !== room));
    const sizes = [2, 2, 3], groups = [];
    let k = 0;
    sizes.forEach((n, gi) => { groups.push({ room: alibiRooms[gi], members: innocents.slice(k, k + n) }); k += n; });
    const claim = groups[int(groups.length)];
    const claimWith = claim.members[int(claim.members.length)];
    const hinters = shuffle(innocents.slice()).slice(0, 2);
    const hinter = hinters[0], hinter2 = hinters[1];

    // where everyone is standing now (after the murder); NR = the hall
    const npcRooms = range(NS).map(() => int(NR + 1));
    return { seed, killer, weapon, room, spot, groups, claim: { room: claim.room, with: claimWith }, hinter, hinter2, npcRooms, npcSeed: int(1e9) };
  }

  const names = list => (list.length === 1 ? list[0] : list.length === 2 ? list[0] + ' and ' + list[1] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]);

  // What examining `id` reveals. ids: 'f<n>' furniture, 'n<n>' suspect, 'body', 'insp'.
  function reveal(c, id) {
    if (id === 'body') return { id, kind: 'clue', icon: 'body', title: 'Lord Blackwood', text: 'Lord Blackwood is dead. The doctor puts the time between 9 and 10 pm. Scuff marks show the body was dragged here from another room.' };
    if (id[0] === 'n') {
      const s = +id.slice(1), sus = SUSPECTS[s];
      let text;
      if (s === c.killer) {
        text = 'I was in the ' + ROOMS[c.claim.room].name + ' with ' + SUSPECTS[c.claim.with].name + ' all evening.';
      } else {
        const g = c.groups.find(g => g.members.includes(s));
        const others = g.members.filter(m => m !== s).map(m => SUSPECTS[m].name);
        text = 'Between nine and ten I was in the ' + ROOMS[g.room].name + ' with ' + names(others) + '. ' +
          (others.length === 1 ? 'Just the two of us.' : 'Nobody else came in.');
        if (s === c.hinter) text += ' Around a quarter to ten I heard a crash from the ' + ROOMS[c.room].wing + ' wing.';
        if (s === c.hinter2) text += ' Just before ten I saw someone slip out of a room on the ' + (ROOMS[c.room].x < 25 ? 'west' : 'east') + ' side of the house.';
      }
      return { id, kind: 'statement', icon: 'portrait:' + s, title: sus.name, text: sus.voice + text };
    }
    if (id[0] === 'f') {
      const f = F[+id.slice(1)], clue = c.spot[f.id], where = ROOMS[f.room].name;
      if (!clue) return { id, kind: 'nothing', icon: 'magnifier', title: f.label + ' · ' + where, text: FLAVOR[f.type] || 'Nothing of interest.' };
      if (clue.kind === 'struggle') return { id, kind: 'clue', icon: 'stain', title: 'Signs of a struggle · ' + where, text: 'An overturned chair and a dark stain soaked into the floor. Lord Blackwood was killed here, in the ' + where + '.' };
      if (clue.kind === 'trace') return { id, kind: 'clue', icon: SUSPECTS[clue.who].traceIcon, title: SUSPECTS[clue.who].trace + ' · ' + where, text: SUSPECTS[clue.who].trace + ', found in the ' + where + '. It belongs to ' + SUSPECTS[clue.who].name + '.' };
      if (clue.kind === 'weapon') {
        const w = WEAPONS[clue.w];
        return clue.bloody
          ? { id, kind: 'clue', icon: w.icon, title: 'The ' + w.name + ' · ' + where, text: 'The ' + w.name + ', stuffed out of sight. It has been wiped, but there is blood in the grooves. This is the murder weapon.' }
          : { id, kind: 'clue', icon: w.icon, title: 'The ' + w.name + ' · ' + where, text: 'The ' + w.name + '. Clean and dusty. It hasn\'t been used tonight.' };
      }
    }
    return null;
  }

  // Where a suspect should idle this case: a random free tile in their room.
  function npcStart(c, i) {
    const rnd = rngFrom(c.npcSeed + i * 7919);
    const r = c.npcRooms[i] === NR ? HALL : ROOMS[c.npcRooms[i]];
    for (let k = 0; k < 200; k++) {
      const tx = r.x + 1 + Math.floor(rnd() * (r.w - 2)), ty = r.y + 1 + Math.floor(rnd() * (r.h - 2));
      const px = tx * T + 8, py = ty * T + 12;
      if (canStand(px, py) && !(r === HALL && Math.abs(tx - 25) < 5)) return { px, py, room: r };
    }
    return { px: r.x * T + 24, py: r.y * T + 28, room: r };
  }

  window.MM_WORLD = { T, W, H, NR, ROOMS, HALL, DOOR_X, F, SUSPECTS, WEAPONS, BODY, INSPECTOR, SPAWN,
    isWall, roomOf, blocked, canStand, genCase, reveal, npcStart, rngFrom, FOOT_W, FOOT_H };
})();
