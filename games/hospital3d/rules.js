// Rival Hospital 3D rules: pure simulation, no DOM and no networking. Follows the Theme Hospital mechanics reference:
// reception → GP → diagnosis rooms (building a diagnosis %) → cure room; staff ranks, qualifications, happiness and
// tiredness; machines that wear out and explode; research, training, hospital policy, the casebook's prices, loans;
// emergencies, VIPs, earthquakes, epidemics and rats; targets checked at every quarter-end.
// Loads in the browser as window.RH and in Node (module.exports) so the economy can be tuned headless.
//
// Layout (tiles, 16px): 25 wide x 22 tall. Two horizontal corridors (A: rows 4-6, B: rows 15-17) joined by a
// vertical connector (cols 2-4). Rooms are 4x4 in twenty lots: five above and five below each corridor.
// Everyone walks along a corridor's centre line (LANES) and switches corridors via the connector (CX).
// The entrance is the west end of corridor A; the reception desk sits just inside it.
(function (root) {
  'use strict';
  const VERSION = 2;
  const T = 16, W = 25, H = 22, LANES = [88, 264], LANE = LANES[0], CX = 56, SLOTS = 20, BAND_Y0 = [0, 7, 11, 18];
  const MONTH = 60;                 // real seconds per in-game month
  const MONTHS = 24;                // two years; targets are checked at every quarter-end
  const GRACE = 90;                 // build timer: patients start arriving after this, or when you open the doors
  const EXIT = [-16, LANE], RECEP = [40, 99], DESK_STAFF = [48, 92];
  const PSPEED = 36, SSPEED = 44, BUILD_TIME = 4;
  const START_CASH = 40000, START_REP = 500;
  const TARGETS = { rep: 650, cash: 100000, pct: 65, cured: 200, value: 70000 };
  const LOSE = { cash: -20000, rep: 150 };
  const DEATH_REP = 12, ANGRY_REP = 3, HOME_REP = 1, CROWD = 6, QMAX = 6;
  const LOAN_STEP = 5000, LOAN_RATE = 0.01;

  // ---------- rooms ----------
  // staff: 'doc' any doctor · 'psy' psychiatrist · 'surg' surgeon (x2) · 'res' researcher · 'con' consultant teacher
  //        'nurse' · '' none. power: how much a visit adds to the diagnosis %, det: which cure groups it can detect.
  const ROOMS = {
    gp:       { name: "GP's Office",       short: 'GP',        cat: 'diag',  cost: 2500,  staff: 'doc',   fee: 100, time: 2 },
    gendiag:  { name: 'General Diagnosis', short: 'Gen Diag',  cat: 'diag',  cost: 1000,  staff: 'doc',   fee: 150, time: 4,   power: 0.22, det: 'pharm psych clinic op' },
    cardio:   { name: 'Cardiogram',        short: 'Cardio',    cat: 'diag',  cost: 1500,  staff: 'doc',   fee: 150, time: 5,   power: 0.3,  det: 'pharm op', mach: 10 },
    xray:     { name: 'X-Ray',             short: 'X-Ray',     cat: 'diag',  cost: 8000,  staff: 'doc',   fee: 200, time: 2.5, power: 0.4,  det: 'clinic op', mach: 10 },
    scanner:  { name: 'Scanner',           short: 'Scanner',   cat: 'diag',  cost: 12000, staff: 'doc',   fee: 300, time: 3.5, power: 0.55, det: 'pharm psych clinic op', mach: 10 },
    blood:    { name: 'Blood Machine',     short: 'Blood',     cat: 'diag',  cost: 6000,  staff: 'doc',   fee: 250, time: 3,   power: 0.45, det: 'pharm clinic op', mach: 10 },
    ultra:    { name: 'Ultrascan',         short: 'Ultrascan', cat: 'diag',  cost: 16000, staff: 'doc',   fee: 400, time: 3,   power: 0.7,  det: 'pharm psych clinic op', mach: 10 },
    ward:     { name: 'Ward',              short: 'Ward',      cat: 'treat', cost: 2000,  staff: 'nurse', fee: 100, time: 6,   power: 0.25, det: 'pharm op' },
    psych:    { name: 'Psychiatric',       short: 'Psych',     cat: 'treat', cost: 2500,  staff: 'psy',   fee: 200, time: 6,   power: 0.4,  det: 'psych' },
    pharm:    { name: 'Pharmacy',          short: 'Pharmacy',  cat: 'treat', cost: 1500,  staff: 'nurse', time: 3 },
    op:       { name: 'Operating Theatre', short: 'Theatre',   cat: 'treat', cost: 7500,  staff: 'surg',  time: 7,   mach: 10, need: 2 },
    infl:     { name: 'Inflation',         short: 'Inflation', cat: 'clinic', cost: 4000, staff: 'doc',   time: 4,   mach: 6 },
    tongue:   { name: 'Slack Tongue',      short: 'Tongue',    cat: 'clinic', cost: 3000, staff: 'doc',   time: 2,   mach: 10 },
    fracture: { name: 'Fracture Clinic',   short: 'Fracture',  cat: 'clinic', cost: 2500, staff: 'nurse', time: 4.5, mach: 10 },
    hair:     { name: 'Hair Restoration',  short: 'Hair',      cat: 'clinic', cost: 4500, staff: 'doc',   time: 4.5, mach: 10 },
    elec:     { name: 'Electrolysis',      short: 'Electro',   cat: 'clinic', cost: 7000, staff: 'doc',   time: 5,   mach: 10 },
    jelly:    { name: 'Jelly Vat',         short: 'Jelly Vat', cat: 'clinic', cost: 11000, staff: 'doc',  time: 4.5, mach: 5 },
    decon:    { name: 'Decontamination',   short: 'Decon',     cat: 'clinic', cost: 15000, staff: 'doc',  time: 5,   mach: 10 },
    dna:      { name: 'DNA Fixer',         short: 'DNA',       cat: 'clinic', cost: 20000, staff: 'res',  time: 6,   mach: 10 },
    staff:    { name: 'Staff Room',        short: 'Staff Rm',  cat: 'fac',   cost: 1500,  staff: '' },
    toilet:   { name: 'Toilets',           short: 'Toilets',   cat: 'fac',   cost: 1500,  staff: '' },
    research: { name: 'Research Dept.',    short: 'Research',  cat: 'fac',   cost: 5000,  staff: 'res' },
    training: { name: 'Training Room',     short: 'Training',  cat: 'fac',   cost: 2000,  staff: 'con' },
  };
  const ROOM_ORDER = ['gp', 'gendiag', 'cardio', 'xray', 'blood', 'scanner', 'ultra', 'ward', 'psych', 'pharm', 'op',
    'infl', 'tongue', 'fracture', 'hair', 'elec', 'jelly', 'decon', 'dna', 'staff', 'toilet', 'research', 'training'];
  const CATS = [['diag', 'Diagnosis'], ['treat', 'Treatment'], ['clinic', 'Clinics'], ['fac', 'Facilities']];
  // extras bought for a working room (the till button). max counts include what the room comes with.
  const EXTRAS = {
    ext:   { name: 'Fire extinguisher', cost: 25,  max: 1, desc: 'Lowers the odds of a machine exploding. VIPs look for them.' },
    rad:   { name: 'Radiator',          cost: 20,  max: 1, desc: 'Warmth. Staff in a warm room stay happier.' },
    plant: { name: 'Plant',             cost: 5,   max: 1, desc: 'Cheers the staff up. A handyman has to water it.' },
    bin:   { name: 'Bin',               cost: 15,  max: 1, desc: 'Reduces litter around the hospital.' },
    book:  { name: 'Bookcase',          cost: 30,  max: 2, desc: 'Speeds up the work done here.', rooms: ['psych', 'training', 'research'] },
    desk:  { name: 'Research desk',     cost: 150, max: 3, base: 1, desc: 'One researcher per desk.', rooms: ['research'] },
    chair: { name: 'Lecture chair',     cost: 40,  max: 4, base: 2, desc: 'One student per chair.', rooms: ['training'] },
    seat:  { name: 'Sofa',              cost: 70,  max: 6, base: 2, desc: 'One resting member of staff per sofa.', rooms: ['staff'] },
    cub:   { name: 'Toilet cubicle',    cost: 120, max: 4, base: 2, desc: 'One patient per cubicle.', rooms: ['toilet'] },
    bed:   { name: 'Bed',               cost: 150, max: 4, base: 2, desc: 'More beds, faster ward stays.', rooms: ['ward'] },
  };
  const EXTRA_ORDER = ['ext', 'rad', 'plant', 'bin', 'book', 'desk', 'chair', 'seat', 'cub', 'bed'];
  const extrasFor = kind => EXTRA_ORDER.filter(e => !EXTRAS[e].rooms || EXTRAS[e].rooms.includes(kind));

  // corridor objects: one item per corridor tile (rows 4/6 and 15/17, connector cols 2/4, never in front of a door)
  const DECOR = {
    plant:    { name: 'Plant',             cost: 5,   comfort: 1, desc: 'Happier patients and less vomiting. Needs a handyman to water it.' },
    bench:    { name: 'Bench',             cost: 40,  comfort: 2, desc: 'Seated patients stay happier while they queue.' },
    radiator: { name: 'Radiator',          cost: 20,  comfort: 0, desc: 'Heat. Too cold or too hot and people leave. Heat makes people thirsty.' },
    ext:      { name: 'Fire extinguisher', cost: 25,  comfort: 0, desc: 'VIPs look for them; a mild happiness boost.' },
    drinks:   { name: 'Drinks machine',    cost: 500, comfort: 1, sells: true, desc: 'Sells cans for $20 and cures thirst. More drinks, more toilet trips.' },
  };
  const DECOR_ORDER = ['plant', 'bench', 'radiator', 'ext', 'drinks'];
  const DESK_COST = 150;
  const DOOR_COLS = new Set([6, 7, 10, 11, 14, 15, 18, 19, 22, 23]);
  const decorSpot = (c, r) => ((r === 4 || r === 6 || r === 15 || r === 17) && c >= 5 && c < W && !DOOR_COLS.has(c)) || ((c === 2 || c === 4) && r >= 7 && r <= 14);
  const decorKey = (c, r) => c + ',' + r;
  const MAX_MESS = 40, MAX_COMFORT = 16, CLEAN_TIME = 2.5, REPAIR_TIME = 3.5, WATER_TIME = 1.2;

  // ---------- diseases ----------
  // grp: pharm / psych / clinic / op. fee: base cure charge. w: frequency. from: first month it can turn up.
  // fatal: a failed cure kills; otherwise the patient goes back to a GP. vis: how it shows on the patient (art.js).
  // tags: 'vomit' sick on the floor · 'loo' frequent toilet trips · 'yawn' · 'cont' contagious (epidemics)
  const D = (id, name, room, fee, w, from, fatal, vis, tags, cause) => ({ id, name, room, grp: ROOMS[room].cat === 'clinic' ? 'clinic' : room === 'op' ? 'op' : room, fee, w, from, fatal, vis, tags: tags || '', cause });
  const DISEASES = [
    D('wind',    'Broken Wind',        'pharm', 220, 8, 0, false, '',      'cont',     'Running on a treadmill straight after a meal.'),
    D('nose',    'Chronic Nosehair',   'pharm', 240, 6, 2, false, '',      '',         'Sniffing disdainfully at people beneath you.'),
    D('ankle',   'Corrugated Ankles',  'pharm', 260, 6, 3, false, '',      '',         'Driving over speed bumps.'),
    D('itch',    'Discrete Itching',   'pharm', 230, 7, 1, false, '',      'cont',     'Tiny insects with sharp teeth.'),
    D('gastric', 'Gastric Ejections',  'pharm', 260, 7, 2, false, 'green', 'vomit',    'Very spicy food.'),
    D('gut',     'Gut Rot',            'pharm', 250, 8, 0, false, 'green', 'loo',      'A dodgy whisky cough mixture.'),
    D('piles',   'Heaped Piles',       'pharm', 270, 6, 4, false, '',      'loo',      'Loitering by the water cooler.'),
    D('invis',   'Invisibility',       'pharm', 400, 7, 0, true,  'invis', '',         'A bite from a radioactive invisible ant.'),
    D('sleep',   'Sleeping Illness',   'pharm', 280, 6, 3, false, 'sleep', 'yawn',     'An overactive sleep gland.'),
    D('squits',  'The Squits',         'pharm', 240, 7, 5, false, '',      'loo cont', 'Eating old pizza found under the cooker.'),
    D('transp',  'Transparency',       'pharm', 450, 4, 7, true,  'transp', '',        'Licking the lids of yoghurt pots.'),
    D('cold',    'Uncommon Cold',      'pharm', 200, 9, 0, false, 'cold',  'vomit cont', 'Airborne snot particles.'),
    D('burns',   '3rd Degree Sideburns', 'psych', 420, 5, 3, false, 'burns', '',       'Pining for the 1970s.'),
    D('fakeb',   'Fake Blood',         'psych', 380, 5, 4, false, '',      '',         'The victim of a practical joke.'),
    D('laugh',   'Infectious Laughter', 'psych', 400, 5, 5, false, '',     'cont',     'Watching classic sitcoms.'),
    D('king',    'King Complex',       'psych', 450, 6, 1, false, 'king',  '',         'The spirit of the King has taken over.'),
    D('palms',   'Sweaty Palms',       'psych', 360, 5, 2, false, '',      '',         'A terror of job interviews.'),
    D('tv',      'TV Personalities',   'psych', 420, 4, 6, false, '',      '',         'Daytime television.'),
    D('bloaty',  'Bloaty Head',        'infl',  700, 9, 0, false, 'balloon', '',       'Sniffing cheese and drinking unpurified rainwater.'),
    D('tongue',  'Slack Tongue',       'tongue', 650, 7, 1, false, 'tongue', '',       'Discussing soap operas far too much.'),
    D('bones',   'Fractured Bones',    'fracture', 620, 6, 3, false, 'bones', '',      'Falling off high things onto hard things.'),
    D('bald',    'Baldness',           'hair',  800, 5, 5, false, 'bald',  '',         'Telling lies to be popular.'),
    D('hairy',   'Hairyitis',          'elec',  850, 5, 6, false, 'fur',   '',         'Too much moonlight.'),
    D('jelly',   'Jellyitis',          'jelly', 1000, 4, 9, false, 'jelly', '',        'A gelatin diet and far too much exercise.'),
    D('rad',     'Serious Radiation',  'decon', 1150, 3, 11, true, 'rad',   '',        'Mistaking plutonium for chewing gum.'),
    D('alien',   'Alien DNA',          'dna',   1600, 0, 16, true, 'alien', '',        'Face-huggers from another world.'),
    D('heart',   'Broken Heart',       'op',    1600, 4, 4, true,  '',      '',         'Someone richer, younger and thinner.'),
    D('golf',    'Golf Stones',        'op',    1700, 3, 6, true,  '',      '',         'Poison gas from inside golf balls.'),
    D('lungs',   'Iron Lungs',         'op',    1800, 3, 7, true,  '',      '',         'City smog and too much greasy fast food.'),
    D('kidney',  'Kidney Beans',       'op',    1600, 3, 5, true,  '',      '',         'Crunching ice cubes.'),
    D('nodule',  'Ruptured Nodules',   'op',    1750, 3, 8, true,  '',      '',         'Bungee jumping in cold weather.'),
    D('ribs',    'Spare Ribs',         'op',    1650, 3, 6, true,  'ribs',  '',         'Sitting on cold stone floors.'),
    D('swell',   'Unexpected Swelling', 'op',   1700, 3, 9, true,  '',      '',         'Anything unexpected.'),
  ];
  const DIS_IDX = {}; DISEASES.forEach((d, i) => { DIS_IDX[d.id] = i; });
  const hasTag = (d, t) => (' ' + d.tags + ' ').includes(' ' + t + ' ');
  const cureType = d => (d.grp === 'pharm' ? 'Drug' : d.grp === 'psych' ? 'Psychiatry' : d.grp === 'op' ? 'Surgery' : 'Machine');

  // ---------- research ----------
  const RESEARCH = {
    cure: { name: 'Cure Equipment', list: ['tongue', 'fracture', 'op', 'hair', 'elec', 'jelly', 'decon', 'dna'], cost: [60, 80, 110, 130, 160, 190, 230, 280] },
    diag: { name: 'Diagnosis Equipment', list: ['cardio', 'xray', 'blood', 'scanner', 'computer', 'ultra', 'atom'], cost: [50, 80, 110, 140, 100, 180, 140] },
    drug: { name: 'Drug Research', cost: 45 },
    imp:  { name: 'Improvements', cost: 70, max: 5 },
    spec: { name: 'Specialisation', cost: 50 },
  };
  const FIELDS = ['cure', 'diag', 'drug', 'imp', 'spec'];
  const START_ROOMS = new Set(['gp', 'gendiag', 'ward', 'psych', 'pharm', 'infl', 'staff', 'toilet', 'research', 'training']);
  const QUAL_PTS = { r: 50, p: 65, s: 80 };
  const QUAL_NAME = { r: 'Researcher', p: 'Psychiatrist', s: 'Surgeon' };

  const FIRST = ['Ada', 'Bob', 'Cleo', 'Dev', 'Elsa', 'Fitz', 'Gus', 'Hana', 'Igor', 'Jo', 'Kit', 'Lou', 'Mo', 'Nia', 'Olly', 'Pip', 'Quin', 'Rae', 'Sid', 'Tia',
    'Uma', 'Vic', 'Wes', 'Xan', 'Yuki', 'Zed', 'Bea', 'Cal', 'Dot', 'Eli', 'Flo', 'Gil', 'Ida', 'Jax', 'Kai', 'Lia', 'Max', 'Ned', 'Oz', 'Pat'];
  const LAST = ['Appleby', 'Bunting', 'Crumb', 'Dithers', 'Earwig', 'Fossil', 'Gristle', 'Hogg', 'Inkpen', 'Jolly', 'Kettle', 'Lumb', 'Mudd', 'Nettle',
    'Oddment', 'Pickle', 'Quibble', 'Rumble', 'Snood', 'Tuttle', 'Umble', 'Vole', 'Wobble', 'Yarrow', 'Zouch'];
  const VIPS = ['the Mayor of Greater Trumpton', 'a Premiership footballer', 'the Minister of Health', 'a famous film critic', 'the Lord Lieutenant', 'a celebrity chef'];

  const rnd = () => Math.random();
  const pick = a => a[Math.floor(rnd() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r2 = v => Math.round(v * 100) / 100;

  // ---------- geometry ----------
  const slotBand = k => Math.floor(k / 5);
  const slotTop = k => slotBand(k) % 2 === 0;
  const slotX0 = k => 5 + 4 * (k % 5);
  const slotY0 = k => BAND_Y0[slotBand(k)];
  const slotLane = k => LANES[slotBand(k) >> 1];
  const slotCx = k => slotX0(k) * T + 32;
  function slotAtWorld(x, y) {
    if (x < 80 || x >= W * T) return null;
    const col = Math.floor((x - 80) / 64);
    const band = y < 64 ? 0 : y >= 112 && y < 176 ? 1 : y >= 176 && y < 240 ? 2 : y >= 288 && y < 352 ? 3 : -1;
    return band < 0 ? null : band * 5 + col;
  }
  // q: head of the queue (corridor) · in: patient spot inside · st: staff spot inside
  function spots(k) {
    const cx = slotCx(k), y0 = slotY0(k) * T, L = slotLane(k);
    return slotTop(k) ? { q: [cx, L - 12], in: [cx + 9, y0 + 54], st: [cx - 9, y0 + 50] } : { q: [cx, L + 16], in: [cx + 9, y0 + 56], st: [cx - 9, y0 + 52] };
  }
  // where the i-th staff member stands in a room (operating theatres and research rooms hold several)
  function staffSpot(k, i, kind) {
    const sp = spots(k), top = slotTop(k), y0 = slotY0(k) * T, x0 = slotX0(k) * T;
    if (kind === 'op') return [x0 + 14 + 36 * (i % 2), top ? y0 + 34 : y0 + 30];
    if (kind === 'research') return [x0 + 12 + 20 * (i % 3), top ? y0 + 30 : y0 + 34];
    if (kind === 'training') return [x0 + 14, top ? y0 + 22 : y0 + 42];
    return i ? [sp.st[0] - 12, sp.st[1]] : sp.st;
  }
  // seats in facility rooms: staff-room sofas, toilet cubicles, lecture chairs
  function useSpot(k, i, kind) {
    const top = slotTop(k), y0 = slotY0(k) * T, x0 = slotX0(k) * T;
    if (kind === 'training') return [x0 + 30 + 14 * (i % 2), (top ? y0 + 28 : y0 + 36) + 12 * Math.floor(i / 2) * (top ? 1 : -1)];
    const n = 3, col = i % n, row = Math.floor(i / n);
    return [x0 + 12 + 20 * col, top ? y0 + 22 + 20 * row : y0 + 42 - 20 * row];
  }
  const QUEUE_GAP = 11;
  function queuePos(h, k, i) {
    const sp = spots(k), r = Math.floor(sp.q[1] / T);
    let x = sp.q[0], n = 0;
    for (let guard = 0; guard < 40; guard++) {
      const busy = h && h.decor && h.decor[decorKey(Math.floor(x / T), r)];
      if (!busy) { if (n === i) return [x, sp.q[1]]; n++; }
      if (x - QUEUE_GAP < 84) return [84 - 2 * (i - n), sp.q[1]];
      x -= QUEUE_GAP;
    }
    return [84, sp.q[1]];
  }
  const idlePos = i => [50 + 6 * (i % 2), 124 + 12 * Math.floor(i / 2) % 140];
  const waitPos = i => [66 - 5 * (i % 3), 128 + 9 * Math.floor(i / 3) % 120];
  const laneOf = y => (y < 176 ? LANES[0] : LANES[1]);
  // where to stand to use a corridor object
  function tileStand(c, r) {
    if (c === 2 || c === 4) return [CX + (c === 2 ? -9 : 9), r * T + 8];
    return [c * T + 8, r === 4 || r === 15 ? (r === 4 ? LANES[0] : LANES[1]) - 9 : (r === 6 ? LANES[0] : LANES[1]) + 9];
  }

  // ---------- movement ----------
  function walk(e, speed, dt) {
    if (!e.path.length) { e.mv = 0; return true; }
    const [tx, ty] = e.path[0];
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy), step = speed * dt;
    if (d <= step) { e.x = tx; e.y = ty; e.path.shift(); if (!e.path.length) { e.mv = 0; return true; } return false; }
    e.x += dx / d * step; e.y += dy / d * step; e.mv = 1;
    e.f = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0);
    return false;
  }
  // path along the corridors to (gx, gy), leaving the current room through its door first
  function route(e, gx, gy) {
    const p = [];
    let x = e.x, y = e.y;
    if (e.inRoom != null) {
      const via = slotCx(e.inRoom);
      if (Math.abs(x - via) > 0.5) { p.push([via, y]); x = via; }
      e.inRoom = null;
    }
    const l0 = laneOf(y), l1 = laneOf(gy);
    if (Math.abs(y - l0) > 0.5) { p.push([x, l0]); y = l0; }
    if (l0 !== l1) { if (Math.abs(x - CX) > 0.5) { p.push([CX, l0]); x = CX; } p.push([CX, l1]); y = l1; }
    if (Math.abs(x - gx) > 0.5) { p.push([gx, y]); x = gx; }
    if (Math.abs(y - gy) > 0.5 || !p.length) p.push([gx, gy]);
    e.path = p;
  }
  function enterRoom(e, k, spot) {
    const sp = spots(k);
    route(e, slotCx(k), sp.q[1]);
    e.path.push([slotCx(k), spot[1]], spot);
    e.inRoom = k;
  }

  // ---------- staff ----------
  // doctors carry skill 0..1 (shown as 0..1000) and qualification points q: { r, p, s }
  const rank = st => (st.k !== 'd' ? '' : st.sk >= 0.8 ? 'Consultant' : st.sk >= 0.25 ? 'Doctor' : 'Junior');
  const isCon = st => st.k === 'd' && st.sk >= 0.8;
  const hasQ = (st, q) => st.k === 'd' && st.q && st.q[q] >= QUAL_PTS[q];
  function fairWage(st) {
    if (st.k === 'n') return 60; if (st.k === 'h') return 25; if (st.k === 'r') return 20;
    return (st.sk >= 0.8 ? 205 : st.sk >= 0.25 ? 105 : 75) + (hasQ(st, 'r') ? 20 : 0) + (hasQ(st, 'p') ? 30 : 0) + (hasQ(st, 's') ? 40 : 0);
  }
  const typeName = k => (k === 'd' ? 'Doctor' : k === 'n' ? 'Nurse' : k === 'h' ? 'Handyman' : 'Receptionist');
  function newCand(s, k) {
    const st = { id: s.nextId++, k, nm: (k === 'd' ? 'Dr ' : k === 'n' ? 'Nurse ' : '') + pick(LAST), q: { r: 0, p: 0, s: 0 }, att: r2(0.3 + rnd() * 0.7) };
    if (k === 'd') {
      const u = rnd();
      st.sk = r2(u < 0.55 ? 0.05 + rnd() * 0.2 : u < 0.9 ? 0.25 + rnd() * 0.5 : 0.8 + rnd() * 0.2);
      const qc = st.sk >= 0.25 ? 0.22 : 0.08;
      for (const q of ['r', 'p', 's']) if (rnd() < qc) st.q[q] = QUAL_PTS[q];
    } else st.sk = r2(0.25 + rnd() * 0.75);
    st.sal = Math.round(fairWage(st) * (1 + rnd() * 0.25));
    return st;
  }
  function newPool(s, first) {
    const pool = [];
    for (let i = 0; i < 5; i++) pool.push(newCand(s, 'd'));
    if (first) { pool[0].q.r = QUAL_PTS.r; pool[1].q.p = QUAL_PTS.p; pool[1].sk = Math.max(pool[1].sk, 0.3); for (const c of pool) c.sal = Math.round(fairWage(c) * 1.1); }
    for (let i = 0; i < 3; i++) pool.push(newCand(s, 'n'));
    for (let i = 0; i < 2; i++) pool.push(newCand(s, 'h'));
    for (let i = 0; i < 2; i++) pool.push(newCand(s, 'r'));
    return pool;
  }

  // ---------- state ----------
  function newHospital(s) {
    const eff = DISEASES.map((d, i) => (d.grp === 'pharm' ? r2(0.6 + ((i * 37) % 17) / 100) : 1));
    return {
      cash: START_CASH, loan: 0, rep: START_REP, cured: 0, died: 0, angry: 0, home: 0, seen: 0, visits: 0, open: false,
      rooms: {}, staff: [], pats: [], vis: [], rats: [], acc: 0.4 + rnd() * 0.4, decor: {}, water: {}, mess: [], comfort: 0, drinks: 0, desk: false,
      pol: { home: 40, guess: 80, term: 100, rest: 60, leave: true, heat: 3 },
      price: DISEASES.map(() => 100), dprice: 100,
      res: { alloc: { cure: 20, diag: 20, drug: 20, imp: 20, spec: 20 }, pts: { cure: 0, diag: 0, drug: 0, imp: 0, spec: 0 }, done: { cure: 0, diag: 0, imp: 0 }, spec: -1, eff, disc: 0 },
      known: DISEASES.map(() => 0), cb: DISEASES.map(() => [0, 0, 0]),   // cured, died, earned
      fin: { cur: {}, last: {} }, owed: 0, fax: [], vipNo: 0, vipScore: -1, booms: 0, messMade: 0, warm: 0, boiler: 0,
      epi: null, awards: [], monthDeaths: 0,
    };
  }
  function newState() {
    const s = { v: VERSION, ph: 'ready', t: 0, month: 0, nextId: 1, ev: [], h: null, winner: -1, why: '', prof: [{ nm: '', av: 0 }, { nm: '', av: 1 }], quake: null };
    s.h = [newHospital(s), newHospital(s)];
    s.pool = newPool(s, true);
    return s;
  }
  function start(s) {
    if (s.ph === 'play') return;
    const prof = s.prof;
    Object.assign(s, newState());
    if (prof) s.prof = prof;
    s.ph = 'play';
    s.ev.push({ k: 'start' });
  }
  const staffById = (h, id) => h.staff.find(x => x.id === id);
  const patById = (h, id) => h.pats.find(x => x.id === id);
  const addRep = (h, d) => { h.rep = clamp(Math.round(h.rep + d), 0, 1000); };
  const yearMonth = m => ({ year: Math.floor(m / 12) + 1, month: m % 12 });
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function book(h, what, amt) { h.cash += amt; h.fin.cur[what] = (h.fin.cur[what] || 0) + amt; }
  const curePct = h => (h.seen ? Math.round(100 * h.cured / h.seen) : 0);
  function value(h) {
    let v = h.desk ? DESK_COST : 0;
    for (const k in h.rooms) { const r = h.rooms[k]; if (r.wreck) continue; v += ROOMS[r.k].cost; for (const e in r.ex) v += EXTRAS[e].cost * Math.max(0, r.ex[e] - (EXTRAS[e].base || 0)); }
    for (const k in h.decor) v += DECOR[h.decor[k]].cost;
    return v;
  }
  function progress(h) {
    const tg = TARGETS;
    return { rep: h.rep / tg.rep, cash: h.cash / tg.cash, pct: curePct(h) / tg.pct, cured: h.cured / tg.cured, value: value(h) / tg.value };
  }
  const metTargets = h => Object.values(progress(h)).every(v => v >= 1);
  function score(h) { const p = progress(h); let s = 0; for (const k in p) s += clamp(p[k], 0, 1); return Math.round(s / 5 * 1000); }
  function lost(h) { return h.cash < LOSE.cash ? 'cash' : h.rep < LOSE.rep ? 'rep' : ''; }
  const unlocked = (h, kind) => START_ROOMS.has(kind) || RESEARCH.cure.list.indexOf(kind) >= 0 && RESEARCH.cure.list.indexOf(kind) < h.res.done.cure || RESEARCH.diag.list.indexOf(kind) >= 0 && RESEARCH.diag.list.indexOf(kind) < h.res.done.diag;
  const hasUpgrade = (h, u) => RESEARCH.diag.list.indexOf(u) < h.res.done.diag;
  const roomCost = (h, kind) => Math.round(ROOMS[kind].cost * (1 - h.res.disc));
  const machStr = (h, kind) => (ROOMS[kind].mach || 0) + h.res.done.imp;
  const priceFactor = h => { const r = h.rep; return r <= 500 ? 0.5 + r / 1000 : 1 + (r - 500) / 500; };
  function cureFee(h, i) { const cb = h.cb[i], tot = cb[0] + cb[1]; const rec = tot >= 3 ? 0.9 + 0.2 * cb[0] / tot : 1; return Math.round(DISEASES[i].fee * priceFactor(h) * rec * h.price[i] / 100); }
  const diagFee = (h, kind) => Math.round((ROOMS[kind].fee || 0) * priceFactor(h) * h.dprice / 100);
  function avgPrice(h) { let t = 0, n = 0; DISEASES.forEach((d, i) => { if (h.known[i]) { t += h.price[i]; n++; } }); return ((n ? t / n : 100) + h.dprice) / 2; }
  const roomsOf = (h, kind) => Object.keys(h.rooms).map(Number).filter(k => h.rooms[k].k === kind && !h.rooms[k].wreck && h.rooms[k].bt <= 0);
  const anyRoom = (h, kind) => Object.keys(h.rooms).some(k => h.rooms[k].k === kind && !h.rooms[k].wreck);
  const exCount = (r, e) => (r.ex && r.ex[e]) || 0;

  // ---------- staffing ----------
  function eligible(st, kind) {
    const need = ROOMS[kind].staff;
    if (st.k === 'h' || st.k === 'r') return false;
    if (need === 'nurse') return st.k === 'n';
    if (st.k !== 'd') return false;
    if (need === 'psy') return hasQ(st, 'p');
    if (need === 'surg') return hasQ(st, 's');
    if (need === 'res') return hasQ(st, 'r');
    if (need === 'con') return isCon(st);
    return need === 'doc';
  }
  function capacity(r) {
    if (r.k === 'op') return 2;
    if (r.k === 'research') return exCount(r, 'desk');
    if (ROOMS[r.k].staff) return 1;
    return 0;
  }
  const ready = r => r.bt <= 0 && !r.wreck;
  const free = st => !st.gone && st.slot == null && !st.desk && st.mode === 'idle' && !st.train;
  function assign(h) {
    for (const st of h.staff) if (st.slot != null && (!h.rooms[st.slot] || h.rooms[st.slot].wreck || !h.rooms[st.slot].sts.includes(st.id))) st.slot = null;
    for (const key in h.rooms) { const r = h.rooms[key]; r.sts = r.sts.filter(id => { const st = staffById(h, id); return st && !st.gone && st.slot === +key; }); }
    // the reception desk
    if (h.desk && !h.staff.some(x => x.desk && !x.gone)) {
      const c = h.staff.find(x => x.k === 'r' && free(x));
      if (c) { c.desk = true; route(c, DESK_STAFF[0], DESK_STAFF[1]); }
    }
    const slots = Object.keys(h.rooms).map(Number).sort((a, b) => a - b);
    // specialist rooms (psychiatry, theatre, research, training…) take their specialists back from ordinary rooms
    for (const k of slots) {
      const r = h.rooms[k];
      if (r.wreck || ROOMS[r.k].staff === 'doc' || !ROOMS[r.k].staff || r.sts.length >= capacity(r)) continue;
      if (h.staff.some(x => free(x) && eligible(x, r.k))) continue;
      const st = h.staff.find(x => !x.gone && x.slot != null && x.slot !== k && h.rooms[x.slot] && ROOMS[h.rooms[x.slot].k].staff === 'doc' && eligible(x, r.k) && h.rooms[x.slot].p == null && !x.pin);
      if (st) { unslot(h, st); st.idle = -1; }
    }
    const special = k => (ROOMS[h.rooms[k].k].staff === 'doc' ? 1 : 0);
    for (const k of slots.slice().sort((a, b) => special(a) - special(b) || a - b)) {
      const r = h.rooms[k];
      if (r.wreck) continue;
      while (r.sts.length < capacity(r)) {
        // prefer staff without special qualifications in ordinary rooms so specialists stay available
        const qn = st => (hasQ(st, 'r') ? 1 : 0) + (hasQ(st, 'p') ? 1 : 0) + (hasQ(st, 's') ? 1 : 0) + (isCon(st) ? 1 : 0);
        const special = ROOMS[r.k].staff !== 'doc';
        const cand = h.staff.filter(x => free(x) && eligible(x, r.k)).sort((a, b) => (special ? 0 : qn(a) - qn(b)) || b.sk - a.sk)[0];
        if (!cand) break;
        placeIn(h, cand, k);
      }
    }
    let i = 0;
    for (const st of h.staff) {
      if (st.gone || st.slot != null || st.desk || st.k === 'h' || st.mode !== 'idle') continue;
      const [ix, iy] = idlePos(i++);
      if (st.idle !== i && (Math.abs(st.x - ix) > 1 || Math.abs(st.y - iy) > 1)) { route(st, ix, iy); st.idle = i; }
    }
  }
  function placeIn(h, st, k) {
    const r = h.rooms[k];
    r.sts.push(st.id); st.slot = k; st.idle = -1;
    enterRoom(st, k, staffSpot(k, r.sts.length - 1, r.k));
  }
  function unslot(h, st) {
    if (st.slot != null && h.rooms[st.slot]) { const r = h.rooms[st.slot]; r.sts = r.sts.filter(id => id !== st.id); }
    st.slot = null;
  }
  function roomStaffReady(h, r, k) {
    const need = ROOMS[r.k].need || 1;
    let n = 0, sk = 0, crazy = false;
    for (const id of r.sts) { const st = staffById(h, id); if (st && st.slot === k && !st.path.length && !st.gone) { n++; sk += st.sk; if (st.tired >= 0.95) crazy = true; } }
    return n >= need ? { sk: sk / n, crazy } : null;
  }

  // ---------- patients ----------
  function pickDisease(s, h) {
    const pool = DISEASES.filter(d => d.from <= s.month && d.w > 0);
    let tot = 0; for (const d of pool) tot += d.w;
    let r = rnd() * tot;
    for (const d of pool) { r -= d.w; if (r <= 0) return DIS_IDX[d.id]; }
    return DIS_IDX[pool[pool.length - 1].id];
  }
  function newPatient(s, h, dis) {
    return { id: s.nextId++, nm: pick(FIRST), dis, dx: false, dg: 0, been: [], x: EXIT[0], y: LANE + (rnd() - 0.5) * 6, path: [], st: 'enter', slot: null, t: 0,
      pat: 120 + rnd() * 60, hp: 1, th: rnd() * 0.3, bl: rnd() * 0.3, f: 3, mv: 0, look: Math.floor(rnd() * 8), inRoom: null, ins: rnd() < 0.4, em: 0, inf: 0, vax: 0, mk: 0, prep: 0, gp2: 0 };
  }
  function spawnPatient(s, p) {
    const h = s.h[p], pt = newPatient(s, h, pickDisease(s, h));
    route(pt, RECEP[0], RECEP[1]);
    h.pats.push(pt); h.visits++;
  }
  function reQueue(h, k) {
    const r = h.rooms[k]; if (!r) return;
    let i = 0;
    for (const id of r.q) {
      const pt = patById(h, id); if (!pt || pt.st !== 'queue') { if (pt) i++; continue; }
      const [x, y] = queuePos(h, k, i++);
      if (pt.inRoom != null) continue;
      if (pt.path.length) pt.path[pt.path.length - 1] = [x, y];
      else if (Math.abs(pt.x - x) > 0.5 || Math.abs(pt.y - y) > 0.5) route(pt, x, y);
    }
  }
  function unqueue(h, pt) {
    if (pt.slot != null && h.rooms[pt.slot]) {
      const r = h.rooms[pt.slot];
      const qi = r.q.indexOf(pt.id); if (qi >= 0) { r.q.splice(qi, 1); reQueue(h, pt.slot); }
      if (r.p === pt.id) { r.p = null; r.prog = 0; }
    }
    pt.slot = null;
  }
  function dropFax(h, pred) { h.fax = h.fax.filter(f => !pred(f)); }
  function leave(s, p, pt, why) {
    const h = s.h[p];
    unqueue(h, pt);
    dropFax(h, f => f.pid === pt.id);
    pt.st = 'leave'; pt.why = why;
    route(pt, EXIT[0], EXIT[1] + (rnd() - 0.5) * 6);
  }
  function kill(s, p, pt, where) {
    const h = s.h[p];
    unqueue(h, pt);
    dropFax(h, f => f.pid === pt.id);
    h.died++; h.monthDeaths++; h.seen++; addRep(h, -DEATH_REP); h.cb[pt.dis][1]++;
    s.ev.push({ k: 'died', p, id: pt.id, nm: pt.nm, dis: pt.dis, x: pt.x, y: pt.y, where, em: pt.em });
    h.pats.splice(h.pats.indexOf(pt), 1);
  }
  function sendHome(s, p, pt, why) {
    const h = s.h[p];
    h.home++; h.seen++; addRep(h, -HOME_REP);
    s.ev.push({ k: 'home', p, nm: pt.nm, dis: pt.dis, why });
    leave(s, p, pt, 'home');
  }
  // queue for the best room of a kind; emergency patients jump the queue
  function queueFor(s, p, pt, kind) {
    const h = s.h[p], cands = Object.keys(h.rooms).map(Number).filter(k => h.rooms[k].k === kind && !h.rooms[k].wreck);
    if (!cands.length) return false;
    const staffed = k => (h.rooms[k].sts.length ? 0 : 1);
    cands.sort((a, b) => staffed(a) - staffed(b) || h.rooms[a].q.length - h.rooms[b].q.length || Math.abs(slotCx(a) - pt.x) - Math.abs(slotCx(b) - pt.x));
    const k = cands[0], r = h.rooms[k];
    if (pt.em) { const firstNonEm = r.q.findIndex(id => { const o = patById(h, id); return !o || !o.em; }); r.q.splice(firstNonEm < 0 ? r.q.length : firstNonEm, 0, pt.id); }
    else r.q.push(pt.id);
    pt.slot = k; pt.st = 'queue';
    reQueue(h, k);
    if (!pt.path.length) { const [qx, qy] = queuePos(h, k, r.q.indexOf(pt.id)); route(pt, qx, qy); }
    return true;
  }
  function waitHere(h, pt, secs) {
    pt.st = 'wait'; pt.t = secs; pt.slot = null;
    const n = h.pats.filter(x => x.st === 'wait').length;
    const [x, y] = waitPos(n);
    route(pt, x, y);
  }
  // what a patient does next after a GP visit or a fax decision
  function decide(s, p, pt) {
    const h = s.h[p], d = DISEASES[pt.dis], pol = h.pol;
    const term = Math.max(pol.guess, pol.term) / 100;
    if (pt.dg >= term || pt.em) return goCure(s, p, pt);
    // the next diagnosis room that can still help
    const tried = new Set(pt.been);
    const next = ['gendiag', 'ward', 'psych', 'cardio', 'xray', 'blood', 'scanner', 'ultra']
      .filter(k => !tried.has(k) && ROOMS[k].det && ROOMS[k].det.includes(d.grp) && anyRoom(h, k))
      .sort((a, b) => staffedOf(h, b) - staffedOf(h, a) || h.rooms[bestRoom(h, a)].q.length - h.rooms[bestRoom(h, b)].q.length)[0];
    if (next && (pt.dg < pol.guess / 100 || pol.term > 100)) { pt.back = 1; queueFor(s, p, pt, next); return; }
    if (pt.dg >= pol.guess / 100) return goCure(s, p, pt);
    if (pt.dg < pol.home / 100) return sendHome(s, p, pt, 'diag');
    // between the two thresholds: ask the player
    if (!h.fax.some(f => f.pid === pt.id)) h.fax.push({ id: s.nextId++, k: 'diag', pid: pt.id, nm: pt.nm, dg: Math.round(pt.dg * 100), t: s.t + 25, dis: pt.dis });
    waitHere(h, pt, 40);
  }
  const staffedOf = (h, kind) => roomsOf(h, kind).filter(k => h.rooms[k].sts.length).length;
  function bestRoom(h, kind) { const ks = Object.keys(h.rooms).map(Number).filter(k => h.rooms[k].k === kind && !h.rooms[k].wreck); return ks.sort((a, b) => h.rooms[a].q.length - h.rooms[b].q.length)[0]; }
  function goCure(s, p, pt) {
    const h = s.h[p], d = DISEASES[pt.dis];
    if (!pt.dx) { pt.dx = true; if (!h.known[pt.dis]) { h.known[pt.dis] = 1; s.ev.push({ k: 'newdis', p, dis: pt.dis }); } s.ev.push({ k: 'diag', p, id: pt.id, nm: pt.nm, dis: pt.dis }); maybeEpidemic(s, p, pt); }
    const kind = d.room === 'op' && !pt.prep ? 'ward' : d.room;
    if (kind === 'ward' && d.room === 'op') pt.toPrep = 1;
    if (anyRoom(h, kind) && (d.room !== 'op' || anyRoom(h, 'op'))) { pt.cure = 1; queueFor(s, p, pt, kind); return; }
    if (pt.em) { waitHere(h, pt, 999); return; }
    if (!h.fax.some(f => f.pid === pt.id)) h.fax.push({ id: s.nextId++, k: 'nocure', pid: pt.id, nm: pt.nm, dis: pt.dis, t: s.t + 25, dg: Math.round(pt.dg * 100) });
    waitHere(h, pt, 60);
  }
  function finishRoom(s, p, k, info) {
    const h = s.h[p], r = h.rooms[k], pt = patById(h, r.p), R = ROOMS[r.k];
    r.p = null; r.prog = 0; r.n++;
    if (!pt) return;
    pt.slot = null;
    if (R.mach) { r.used++; if (r.used > r.str) { if (rnd() < 0.18 * (r.used - r.str) * (exCount(r, 'ext') ? 0.5 : 1)) return explode(s, p, k); } }
    const d = DISEASES[pt.dis];
    // diagnosis visits
    if (!pt.cure) {
      if (r.k === 'gp') {
        pt.dg = clamp(pt.dg + (pt.gp2 ? 0.12 + 0.12 * info.sk : 0.35 + 0.45 * info.sk) * (info.crazy ? 0.4 : 1), 0, 1); pt.gp2 = 1;
        for (const id of r.sts) { const st = staffById(h, id); if (st && st.k === 'd') { st.sk = r2(Math.min(1, st.sk + 0.003)); } }
      } else {
        const hit = R.det && R.det.includes(d.grp);
        pt.dg = clamp(pt.dg + (hit ? R.power * (0.75 + 0.25 * info.sk) : 0.03) * (info.crazy ? 0.4 : 1), 0, 1);
        pt.been.push(r.k);
      }
      bill(s, p, pt, diagFee(h, r.k), 'Diagnosis fees');
      if (r.k !== 'gp') { queueFor(s, p, pt, 'gp') || decide(s, p, pt); return; }
      return decide(s, p, pt);
    }
    // ward stay before surgery
    if (pt.toPrep && r.k === 'ward') { pt.toPrep = 0; pt.prep = 1; return queueFor(s, p, pt, 'op') || waitHere(h, pt, 60); }
    // the cure itself
    const eff = d.grp === 'pharm' ? h.res.eff[pt.dis] : d.grp === 'psych' ? 0.99 : d.grp === 'op' ? 0.93 : (r.used > r.str ? 0.85 : 0.97);
    const chance = (pt.em ? 1 : pt.dg) * eff * (0.85 + 0.15 * info.sk) * (info.crazy ? 0.7 : 1);
    if (rnd() < chance) {
      const fee = cureFee(h, pt.dis);
      const refuse = !pt.em && h.price[pt.dis] > 120 && rnd() < (h.price[pt.dis] - 120) / 100;
      h.cured++; h.seen++; h.cb[pt.dis][0]++;
      addRep(h, (d.grp === 'op' ? 4 : 2) + (h.price[pt.dis] < 90 ? 1 : 0));
      if (!refuse) { bill(s, p, pt, fee, pt.em ? 'Emergencies' : 'Cures'); h.cb[pt.dis][2] += fee; }
      if (pt.inf) pt.inf = 0;
      s.ev.push({ k: 'cured', p, id: pt.id, nm: pt.nm, dis: pt.dis, fee: refuse ? 0 : fee, x: pt.x, y: pt.y, slot: k, refuse });
      if (pt.em && h.em) h.em.saved++;
      leave(s, p, pt, 'cured');
    } else if (d.fatal || pt.em) {
      kill(s, p, pt, k);
    } else {
      s.ev.push({ k: 'uncured', p, nm: pt.nm, dis: pt.dis });
      pt.cure = 0; pt.dg *= 0.5; pt.been = []; pt.gp2 = 0;
      queueFor(s, p, pt, 'gp') || sendHome(s, p, pt, 'nogp');
    }
  }
  function bill(s, p, pt, fee, what) {
    const h = s.h[p];
    if (fee <= 0) return;
    if (pt.ins && !pt.em) h.owed += fee;   // insurers pay at the end of the month
    else book(h, what, fee);
  }
  function explode(s, p, k) {
    const h = s.h[p], r = h.rooms[k];
    const pt = r.p != null ? patById(h, r.p) : null;
    r.wreck = true; r.p = null; r.q.slice().forEach(id => { const o = patById(h, id); if (o) { unqueue(h, o); o.st = 'recep'; o.t = 0.5; o.path = []; } }); r.q = [];
    h.booms++; addRep(h, -40);
    s.ev.push({ k: 'boom', p, slot: k, kind: r.k });
    for (const id of r.sts.slice()) { const st = staffById(h, id); if (st) { st.gone = true; st.dead = true; h.staff.splice(h.staff.indexOf(st), 1); } }
    r.sts = [];
    if (pt) { pt.slot = k; kill(s, p, pt, k); }
    assign(h);
  }

  // ---------- events: epidemics, emergencies, VIPs ----------
  function maybeEpidemic(s, p, pt) {
    const h = s.h[p], d = DISEASES[pt.dis];
    if (s.month < 10 || h.epi || !hasTag(d, 'cont') || rnd() > 0.12) return;
    const others = h.pats.filter(x => x !== pt && x.st !== 'leave');
    const n = Math.min(others.length, 2 + Math.floor(rnd() * 4));
    pt.inf = 1;
    for (let i = 0; i < n; i++) { const o = others.splice(Math.floor(rnd() * others.length), 1)[0]; o.inf = 1; }
    h.epi = { dis: pt.dis, phase: 'ask', t: 0 };
    h.fax.push({ id: s.nextId++, k: 'epi', dis: pt.dis, n: n + 1, t: s.t + 30 });
    s.ev.push({ k: 'epi', p, dis: pt.dis, n: n + 1 });
  }
  function endEpidemic(s, p) {
    const h = s.h[p], e = h.epi; if (!e) return;
    const left = h.pats.filter(x => x.inf && x.st !== 'leave').length;
    if (left === 0) { book(h, 'Inspector', 2000); addRep(h, 15); }
    else { book(h, 'Fines', -1000 * left); addRep(h, -6 * left); }
    for (const x of h.pats) x.inf = 0, x.vax = 0, x.mk = 0;
    h.vis = h.vis.filter(v => v.k !== 'insp');
    s.ev.push({ k: 'epiEnd', p, left });
    h.epi = null;
  }
  function emergencyOffer(s, p) {
    const h = s.h[p];
    const cands = DISEASES.filter(d => d.from <= s.month + 2 && (d.w > 0 || s.month >= 16));
    const d = pick(cands), i = DIS_IDX[d.id];
    const n = 3 + Math.floor(rnd() * 5), limit = 70 + Math.floor(rnd() * 30);
    const bonus = Math.round(n * (500 + d.fee) / 100) * 100;
    const has = anyRoom(h, d.room) && (d.room !== 'op' || anyRoom(h, 'ward'));
    h.fax.push({ id: s.nextId++, k: 'emerg', dis: i, n, limit, bonus, has, t: s.t + 30, what: pick(['a coach crash', 'a funfair accident', 'a chemical spill', 'a stampede at the sales', 'a flood at the leisure centre']) });
  }
  function startEmergency(s, p, f) {
    const h = s.h[p];
    h.em = { dis: f.dis, n: f.n, saved: 0, end: s.t + f.limit, bonus: f.bonus, spawn: f.n, next: s.t };
    s.ev.push({ k: 'emStart', p, dis: f.dis, n: f.n });
  }
  function endEmergency(s, p) {
    const h = s.h[p], e = h.em; if (!e) return;
    for (const pt of h.pats.slice()) if (pt.em && pt.st !== 'leave') kill(s, p, pt, -1);
    const pay = e.saved >= e.n / 2 ? Math.round(e.bonus * e.saved / e.n) : 0;
    if (pay) { book(h, 'Emergencies', pay); addRep(h, 10); } else addRep(h, -10);
    s.ev.push({ k: 'emEnd', p, saved: e.saved, n: e.n, pay });
    h.em = null;
  }
  function vipOffer(s, p) { const h = s.h[p]; h.fax.push({ id: s.nextId++, k: 'vip', who: pick(VIPS), t: s.t + 30 }); }
  function startVip(s, p, who) {
    const h = s.h[p];
    const v = { id: s.nextId++, k: 'vip', who, x: EXIT[0], y: LANE, path: [], f: 3, mv: 0, t: 0, legs: 0, inRoom: null };
    route(v, 100 + rnd() * 250, LANES[0] + (rnd() < 0.5 ? -4 : 4));
    h.vis.push(v);
    s.ev.push({ k: 'vipIn', p, who });
  }
  function judgeVip(s, p, v) {
    const h = s.h[p];
    let sc = 0.55;
    sc -= Math.min(0.35, h.mess.length * 0.03) + Math.min(0.2, h.rats.length * 0.05);
    if (h.drinks) sc += 0.06;
    let ext = 0; for (const k in h.decor) if (h.decor[k] === 'ext') ext++; for (const k in h.rooms) ext += exCount(h.rooms[k], 'ext');
    sc += ext >= 3 ? 0.08 : ext ? 0.03 : -0.05;
    sc += anyRoom(h, 'toilet') ? 0.06 : -0.06;
    sc += h.warm >= 0.6 && h.warm <= 1.6 ? 0.05 : -0.08;
    const staff = h.staff.filter(x => !x.gone && x.k !== 'r');
    if (staff.length) sc += (staff.reduce((a, x) => a + x.hap, 0) / staff.length - 0.5) * 0.25 + (staff.reduce((a, x) => a + x.sk, 0) / staff.length - 0.5) * 0.15;
    sc -= h.monthDeaths * 0.04 + h.booms * 0.1;
    sc = clamp(sc, 0, 1);
    const grade = sc >= 0.72 ? 'excellent' : sc >= 0.55 ? 'good' : sc >= 0.38 ? 'poor' : 'terrible';
    const cash = grade === 'excellent' ? 4000 : grade === 'good' ? 800 + Math.round(sc * 2000 / 100) * 100 : 0;
    const rep = grade === 'excellent' ? 25 : grade === 'good' ? 10 : grade === 'poor' ? -10 : -25;
    if (cash) book(h, 'VIP visits', cash);
    addRep(h, rep);
    h.vipScore = Math.max(h.vipScore, sc);
    s.ev.push({ k: 'vipOut', p, who: v.who, grade, cash, rep });
  }

  // ---------- decoration, mess, rats ----------
  const inCorridor = e => e.inRoom == null && e.x > 34 && ((e.y > 66 && e.y < 110) || (e.y > 242 && e.y < 286) || (e.x < 78 && e.y > 66 && e.y < 286));
  const bins = h => { let n = 0; for (const k in h.rooms) n += exCount(h.rooms[k], 'bin'); return n; };
  const messNear = (h, x, y, kind) => h.mess.some(m => (!kind || m.k === kind) && Math.hypot(m.x - x, m.y - y) < 14);
  const decorNear = (h, x, y, kind, dist) => Object.keys(h.decor).some(k => { if (h.decor[k] !== kind) return false; const [c, r] = k.split(',').map(Number); return Math.abs(c * T + 8 - x) + Math.abs(r * T + 8 - y) < dist; });
  function drainRate(h, pt) {
    let r = 1 / (1 + 0.08 * h.comfort);
    if (messNear(h, pt.x, pt.y)) r *= 2;
    if (decorNear(h, pt.x, pt.y, 'bench', 40)) r *= 0.75;
    if (h.warm < 0.6) r *= 1.5; else if (h.warm > 1.6) r *= 1.3;
    if (pt.th > 0.8) r *= 1.3;
    return r;
  }
  function spawnMess(s, p, x, y, kind) { const h = s.h[p]; if (h.mess.length >= MAX_MESS) return; h.mess.push({ id: s.nextId++, x: r2(x), y: r2(y), k: kind }); h.messMade++; }
  function recount(h) {
    let c = 0, d = 0, rads = 0;
    for (const k in h.decor) { const D2 = DECOR[h.decor[k]]; c += D2.comfort; if (D2.sells) d++; if (h.decor[k] === 'radiator') rads++; if (h.decor[k] === 'plant' && (h.water[k] || 0) <= 0) c -= 2; }
    for (const k in h.rooms) rads += exCount(h.rooms[k], 'rad');
    h.comfort = clamp(c, 0, MAX_COMFORT); h.drinks = d; h.rads = rads;
  }
  function warmth(h) { const base = h.rads * h.pol.heat / 14; return h.boiler > 0 ? (Math.floor(h.boiler / 6) % 2 ? 0.2 : 2.2) : base; }
  function placeDecor(s, p, c, r, kind) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p]; c |= 0; r |= 0;
    if (!DECOR[kind] || !decorSpot(c, r)) return 'Can\'t put that there';
    if (h.decor[decorKey(c, r)]) return 'That spot is taken';
    if (h.cash < DECOR[kind].cost) return 'Not enough cash';
    book(h, 'Building', -DECOR[kind].cost); h.decor[decorKey(c, r)] = kind;
    if (kind === 'plant') h.water[decorKey(c, r)] = 1;
    recount(h);
    for (const key in h.rooms) reQueue(h, +key);
    s.ev.push({ k: 'decor', p, kind, c, r });
    return null;
  }
  function removeDecor(s, p, c, r) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], key = decorKey(c | 0, r | 0), kind = h.decor[key];
    if (!kind) return 'Nothing there';
    delete h.decor[key]; delete h.water[key]; book(h, 'Building', Math.round(DECOR[kind].cost / 2)); recount(h);
    for (const k2 in h.rooms) reQueue(h, +k2);
    s.ev.push({ k: 'undecor', p, kind });
    return null;
  }
  function buyDesk(s, p) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p];
    if (h.desk) return 'You already have a reception desk';
    if (h.cash < DESK_COST) return 'Not enough cash';
    book(h, 'Building', -DESK_COST); h.desk = true; assign(h);
    s.ev.push({ k: 'desk', p });
    return null;
  }

  // ---------- actions (host validates; p = 0 host, 1 guest) ----------
  function build(s, p, k, kind) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p];
    if (!(k >= 0 && k < SLOTS) || !ROOMS[kind]) return 'Bad request';
    if (h.rooms[k]) return 'That lot is taken';
    if (!unlocked(h, kind)) return 'That room needs research first';
    const cost = roomCost(h, kind);
    if (h.cash < cost) return 'Not enough cash';
    book(h, 'Building', -cost);
    const ex = {};
    for (const e of extrasFor(kind)) if (EXTRAS[e].base) ex[e] = EXTRAS[e].base;
    h.rooms[k] = { k: kind, bt: BUILD_TIME, sts: [], p: null, prog: 0, dur: 1, n: 0, q: [], dis: -1, str: machStr(h, kind), used: 0, wreck: false, ex, water: 1, users: [] };
    assign(h);
    s.ev.push({ k: 'built', p, slot: k, kind });
    return null;
  }
  function demolish(s, p, k) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], r = h.rooms[k];
    if (!r) return 'No room there';
    if (r.wreck) return 'A room wrecked by an explosion can\'t be touched';
    const kind = r.k;
    const ids = r.q.slice(); if (r.p != null) ids.push(r.p); ids.push(...r.users);
    delete h.rooms[k];
    book(h, 'Building', Math.round(ROOMS[kind].cost * 0.4));
    for (const id of ids) {
      const pt = patById(h, id); if (!pt) continue;
      pt.slot = null; pt.st = 'recep'; pt.t = 0.3;
      if (pt.inRoom === k) route(pt, slotCx(k) + (rnd() < 0.5 ? -16 : 16), slotLane(k)); else pt.path = [];
    }
    for (const st of h.staff) if (st.slot === k || st.room === k) { st.slot = null; st.room = null; st.mode = 'idle'; if (st.inRoom === k) route(st, slotCx(k), slotLane(k)); }
    assign(h);
    s.ev.push({ k: 'razed', p, slot: k, kind });
    return null;
  }
  function buyExtra(s, p, k, e) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], r = h.rooms[k];
    if (!r || r.wreck) return 'No room there';
    if (!EXTRAS[e] || !extrasFor(r.k).includes(e)) return 'That doesn\'t go in here';
    if (exCount(r, e) >= EXTRAS[e].max) return 'No space for another';
    if (h.cash < EXTRAS[e].cost) return 'Not enough cash';
    book(h, 'Building', -EXTRAS[e].cost);
    r.ex[e] = exCount(r, e) + 1;
    if (e === 'plant') r.water = 1;
    recount(h); assign(h);
    s.ev.push({ k: 'extra', p, slot: k, e });
    return null;
  }
  function replaceMachine(s, p, k) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], r = h.rooms[k];
    if (!r || r.wreck || !ROOMS[r.k].mach) return 'No machine there';
    const cost = Math.round(ROOMS[r.k].cost * 0.5);
    if (h.cash < cost) return 'Not enough cash';
    book(h, 'Machines', -cost);
    r.used = 0; r.str = machStr(h, r.k) + (h.specStr && h.specStr[r.k] || 0);
    s.ev.push({ k: 'replaced', p, slot: k, kind: r.k });
    return null;
  }
  function hire(s, p, id) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p];
    const i = s.pool.findIndex(c => c.id === id); if (i < 0) return 'Someone else got there first';
    const c = s.pool[i];
    if (h.cash < c.sal) return 'Not enough cash for the first month';
    s.pool.splice(i, 1);
    book(h, 'Wages', -c.sal);
    h.staff.push(Object.assign({}, c, { slot: null, desk: false, x: EXIT[0], y: LANE, path: [], f: 3, mv: 0, gone: false, inRoom: null, idle: -1, look: c.id % 8, job: null, work: 0, wt: 1, hap: 0.75, tired: 0, mode: 'idle', room: null, train: false, pri: 'all', fax: 0, quit: 0, ext: 0 }));
    assign(h);
    s.ev.push({ k: 'hired', p, nm: c.nm, type: c.k });
    return null;
  }
  function fire(s, p, id) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], st = staffById(h, id);
    if (!st || st.gone) return 'Not on staff';
    dismiss(s, p, st, 'fired');
    return null;
  }
  function dismiss(s, p, st, why) {
    const h = s.h[p];
    st.gone = true; st.job = null; st.work = 0; st.desk = false; st.mode = 'leave';
    unslot(h, st);
    dropFax(h, f => f.sid === st.id);
    route(st, EXIT[0], EXIT[1]);
    assign(h);
    s.ev.push({ k: why, p, nm: st.nm });
  }
  // move a member of staff into a room (bumping the weaker one if it's full)
  function place(s, p, id, k) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], st = staffById(h, id), r = h.rooms[k];
    if (!st || st.gone || !r || r.wreck) return 'Can\'t do that';
    if (!eligible(st, r.k)) return `${st.nm} can't work in a ${ROOMS[r.k].name}`;
    if (st.slot === k) return null;
    if (st.mode === 'rest' || st.mode === 'train') leaveFacility(h, st);
    unslot(h, st); st.desk = false; st.train = false; st.mode = 'idle';
    if (r.sts.length >= capacity(r)) {
      const weakest = r.sts.map(i => staffById(h, i)).filter(Boolean).sort((a, b) => a.sk - b.sk)[0];
      if (weakest) { unslot(h, weakest); weakest.idle = -1; }
    }
    placeIn(h, st, k); st.pin = true;   // placed by hand: assign() won't move them
    assign(h);
    return null;
  }
  function setTrain(s, p, id, on) {
    const h = s.h[p], st = staffById(h, id);
    if (!st || st.k !== 'd') return 'Only doctors can train';
    if (on && isCon(st)) return 'Consultants can\'t be trained any further';
    st.train = !!on;
    if (on && st.slot != null) { unslot(h, st); st.idle = -1; assign(h); }
    if (!on && st.mode === 'train') { leaveFacility(h, st); st.mode = 'idle'; assign(h); }
    return null;
  }
  function setPri(s, p, id, pri) { const st = staffById(s.h[p], id); if (!st || st.k !== 'h') return 'Not a handyman'; st.pri = ['all', 'clean', 'repair', 'water'].includes(pri) ? pri : 'all'; return null; }
  function pay(s, p, id, kind) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], st = staffById(h, id);
    if (!st || st.gone) return 'Not on staff';
    if (kind === 'bonus') { const c = Math.max(10, Math.round(st.sal * 1.2)); if (h.cash < c) return 'Not enough cash'; book(h, 'Wages', -c); st.hap = clamp(st.hap + 0.3, 0, 1); }
    else { st.sal = Math.round(Math.max(st.sal, fairWage(st)) * 1.1); st.hap = clamp(st.hap + 0.4, 0, 1); }
    st.quit = 0; st.fax = 0; dropFax(h, f => f.k === 'raise' && f.sid === st.id);
    s.ev.push({ k: kind === 'bonus' ? 'bonus' : 'raise', p, nm: st.nm, sal: st.sal });
    return null;
  }
  function setPolicy(s, p, pol) {
    const h = s.h[p], P = h.pol;
    if (pol.home != null) P.home = clamp(Math.round(+pol.home), 0, 100);
    if (pol.guess != null) P.guess = clamp(Math.round(+pol.guess), 0, 100);
    if (P.home > P.guess) P.home = P.guess;
    if (pol.term != null) P.term = clamp(Math.round(+pol.term), 50, 200);
    if (pol.rest != null) P.rest = clamp(Math.round(+pol.rest), 10, 100);
    if (pol.leave != null) P.leave = !!pol.leave;
    if (pol.heat != null) { P.heat = clamp(Math.round(+pol.heat), 1, 5); }
    return null;
  }
  function setPrice(s, p, which, pct) {
    const h = s.h[p], v = clamp(Math.round(+pct / 5) * 5, 50, 200);
    if (which === 'diag') h.dprice = v; else if (h.price[which | 0] != null) h.price[which | 0] = v; else return 'Bad request';
    return null;
  }
  function setResearch(s, p, alloc, spec) {
    const h = s.h[p], A = h.res.alloc;
    if (alloc) {
      const want = {}; let tot = 0;
      for (const f of FIELDS) { want[f] = clamp(Math.round(+(alloc[f] != null ? alloc[f] : A[f]) || 0), 0, 100); tot += want[f]; }
      if (tot > 100) return 'The fields can\'t add up to more than 100%';
      Object.assign(A, want);
    }
    if (spec != null) h.res.spec = DISEASES[spec | 0] ? spec | 0 : -1;
    return null;
  }
  function loan(s, p, dir) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p];
    if (dir > 0) { if (h.loan + LOAN_STEP > loanLimit(h)) return 'The bank won\'t lend you any more'; h.loan += LOAN_STEP; book(h, 'Loans', LOAN_STEP); }
    else { if (h.loan <= 0) return 'You have no loan'; if (h.cash < LOAN_STEP) return 'Not enough cash to repay'; h.loan -= LOAN_STEP; book(h, 'Loans', -LOAN_STEP); }
    return null;
  }
  const loanLimit = h => Math.max(20000, Math.round(value(h) * 0.6 / LOAN_STEP) * LOAN_STEP);
  function openDoors(s, p) { const h = s.h[p]; if (s.ph !== 'play' || h.open) return null; h.open = true; s.ev.push({ k: 'open', p }); return null; }
  function shoot(s, p, id) {
    const h = s.h[p], i = h.rats.findIndex(r => r.id === id);
    if (i < 0) return 'Missed!';
    const rt = h.rats[i]; h.rats.splice(i, 1);
    spawnMess(s, p, rt.x, rt.y, 'rat');
    s.ev.push({ k: 'shot', p, x: rt.x, y: rt.y });
    return null;
  }
  function vax(s, p, id) {
    const h = s.h[p], pt = patById(h, id);
    if (!h.epi || h.epi.phase !== 'cover') return 'No cover-up under way';
    if (!pt || !pt.inf) return 'That patient isn\'t infected';
    pt.mk = 1;
    return null;
  }
  function answerFax(s, p, id, c) {
    const h = s.h[p], i = h.fax.findIndex(f => f.id === id);
    if (i < 0) return 'That fax has gone';
    const f = h.fax[i];
    h.fax.splice(i, 1);
    const pt = f.pid != null ? patById(h, f.pid) : null;
    switch (f.k) {
      case 'diag': case 'nocure':
        if (!pt || pt.st === 'leave') return null;
        if (c === 'guess' && f.k === 'diag') return goCure(s, p, pt);
        if (c === 'wait') { waitHere(h, pt, 60); pt.recheck = 1; return null; }
        if (c === 'autopsy' && anyRoom(h, 'research')) {
          addRep(h, -8); h.res.pts.cure += 30; h.res.pts.diag += 30; h.res.pts.drug += 20;
          s.ev.push({ k: 'autopsy', p, nm: pt.nm }); unqueue(h, pt); h.pats.splice(h.pats.indexOf(pt), 1); return null;
        }
        return sendHome(s, p, pt, f.k);
      case 'raise': { const st = staffById(h, f.sid); if (!st) return null; if (c === 'pay') return pay(s, p, st.id, 'raise'); st.fax = 0; if (c === 'sack') dismiss(s, p, st, 'fired'); else st.quit = s.month + 1; return null; }
      case 'emerg': if (c === 'accept' && !h.em) startEmergency(s, p, f); return null;
      case 'vip': if (c === 'accept') { h.vipNo = 0; startVip(s, p, f.who); } else h.vipNo++; return null;
      case 'epi':
        if (!h.epi) return null;
        if (c === 'cover') { h.epi.phase = 'cover'; h.epi.t = s.t + 75; s.ev.push({ k: 'epiCover', p }); }
        else { book(h, 'Fines', -3000); addRep(h, -20); for (const x of h.pats) if (x.inf) x.vax = 1; s.ev.push({ k: 'epiDeclare', p }); h.epi.phase = 'declared'; h.epi.t = s.t + 20; }
        return null;
    }
    return null;
  }
  function expireFax(s, p, f) {
    const h = s.h[p];
    const def = { diag: 'home', nocure: 'home', raise: 'ignore', emerg: 'decline', vip: 'decline', epi: 'declare' }[f.k];
    answerFax(s, p, f.id, def);
  }
  function setProfile(s, p, nm, av) {
    if (!s.prof) s.prof = [{ nm: '', av: 0 }, { nm: '', av: 1 }];
    s.prof[p] = { nm: String(nm == null ? '' : nm).replace(/[^\p{L}\p{N} '.-]/gu, '').trim().slice(0, 12), av: av === 1 ? 1 : 0 };
    s.ev.push({ k: 'profile', p });
  }

  // ---------- research ----------
  function researchTick(s, p, dt) {
    const h = s.h[p], R = h.res;
    let rate = 0;
    for (const key in h.rooms) {
      const r = h.rooms[key]; if (r.k !== 'research' || !ready(r)) continue;
      for (const id of r.sts) { const st = staffById(h, id); if (st && st.slot === +key && !st.path.length && !st.gone) rate += (0.5 + st.sk) * (st.tired >= 0.95 ? 0.5 : 1); }
      rate *= 1 + 0.1 * exCount(r, 'book');
    }
    if (!rate) return;
    rate *= 1 + (hasUpgrade(h, 'computer') ? 0.25 : 0) + (hasUpgrade(h, 'atom') ? 0.25 : 0);
    for (const f of FIELDS) {
      if (!R.alloc[f]) continue;
      R.pts[f] += rate * dt * R.alloc[f] / 100;
      const need = researchCost(h, f);
      if (need == null) { R.pts[f] = 0; continue; }
      if (R.pts[f] >= need) { R.pts[f] -= need; complete(s, p, f); }
    }
  }
  function researchCost(h, f) {
    const R = h.res;
    if (f === 'cure' || f === 'diag') return RESEARCH[f].cost[R.done[f]] == null ? null : RESEARCH[f].cost[R.done[f]];
    if (f === 'drug') return R.eff.some((e, i) => DISEASES[i].grp === 'pharm' && e < 1) ? RESEARCH.drug.cost : null;
    if (f === 'imp') return R.done.imp < RESEARCH.imp.max || R.disc < 0.25 ? RESEARCH.imp.cost : null;
    if (f === 'spec') return R.spec >= 0 ? RESEARCH.spec.cost : null;
    return null;
  }
  function complete(s, p, f) {
    const h = s.h[p], R = h.res;
    let what = '';
    if (f === 'cure' || f === 'diag') { const item = RESEARCH[f].list[R.done[f]]; R.done[f]++; what = item; }
    else if (f === 'drug') { improveDrugs(h); what = 'drugs'; }
    else if (f === 'imp') {
      if (R.done.imp < RESEARCH.imp.max) { R.done.imp++; what = 'strength'; }
      else { R.disc = r2(Math.min(0.25, R.disc + 0.05)); what = 'cheaper'; }
    } else if (f === 'spec') {
      const d = DISEASES[R.spec];
      if (d.grp === 'pharm') { R.eff[R.spec] = r2(Math.min(1, R.eff[R.spec] + 0.05)); }
      else if (ROOMS[d.room].mach) { h.specStr = h.specStr || {}; h.specStr[d.room] = (h.specStr[d.room] || 0) + 1; }
      what = 'spec';
    }
    s.ev.push({ k: 'research', p, f, what, spec: R.spec });
  }
  // below 75%: every drug under 75% goes up; after that the weakest drug is raised until it reaches 100%
  function improveDrugs(h) {
    const E = h.res.eff, ids = DISEASES.map((d, i) => i).filter(i => DISEASES[i].grp === 'pharm');
    const low = ids.filter(i => E[i] < 0.75);
    if (low.length) for (const i of low) E[i] = r2(Math.min(0.75, E[i] + 0.05));
    else { const i = ids.filter(j => E[j] < 1).sort((a, b) => E[a] - E[b])[0]; if (i != null) E[i] = r2(Math.min(1, E[i] + 0.05)); }
  }

  // ---------- facilities: staff room, training, toilets ----------
  function facilityRoom(h, kind, seatKey) {
    return Object.keys(h.rooms).map(Number).find(k => { const r = h.rooms[k]; return r.k === kind && ready(r) && r.users.length < exCount(r, seatKey); });
  }
  function enterFacility(h, e, k) {
    const r = h.rooms[k];
    let i = 0; const taken = new Set(r.users.map(id => { const o = staffById(h, id) || patById(h, id); return o ? o.seat : -1; }));
    while (taken.has(i)) i++;
    r.users.push(e.id); e.seat = i; e.room = k;
    enterRoom(e, k, useSpot(k, i, r.k));
  }
  function leaveFacility(h, e) {
    if (e.room != null && h.rooms[e.room]) { const r = h.rooms[e.room]; r.users = r.users.filter(id => id !== e.id); }
    e.room = null; e.seat = -1;
  }

  // ---------- time ----------
  const arrivals = m => 20 + 1.4 * m;      // patients per month for the whole town
  function monthTick(s) {
    s.month++;
    for (let p = 0; p < 2; p++) {
      const h = s.h[p];
      let sal = 0; for (const st of h.staff) if (!st.gone) sal += st.sal;
      book(h, 'Wages', -sal);
      const heat = Math.round(h.rads * h.pol.heat * 6); if (heat) book(h, 'Heating', -heat);
      if (h.loan) book(h, 'Interest', -Math.round(h.loan * LOAN_RATE));
      if (h.owed) { book(h, 'Insurance', h.owed); h.owed = 0; }
      if (h.mess.length >= 4) addRep(h, -Math.floor(h.mess.length / 3));
      if (h.rats.length) addRep(h, -2 * h.rats.length);
      // staff morale: paid at least the fair wage or not; the size of the gap doesn't matter
      for (const st of h.staff) {
        if (st.gone) continue;
        st.hap = clamp(st.hap + (st.sal >= fairWage(st) ? 0.08 : -0.12), 0, 1);
        if (st.quit && st.quit <= s.month) dismiss(s, p, st, 'resigned');
      }
      // boiler breakdown: lots of radiators, too few handymen
      const handy = h.staff.filter(x => x.k === 'h' && !x.gone).length;
      if (h.rads >= 6 && handy < h.rads / 6 && rnd() < 0.3) { h.boiler = 30; s.ev.push({ k: 'boiler', p }); }
      s.ev.push({ k: 'month', p, m: s.month, fin: h.fin.cur });
      h.fin.last = h.fin.cur; h.fin.cur = {};
      h.monthDeaths = 0;
      // events
      if (s.month >= 4 && !h.em && rnd() < 0.35) emergencyOffer(s, p);
      if (s.month >= 3 && (rnd() < 0.25 || h.vipNo >= 2)) { if (h.vipNo >= 2) { h.vipNo = 0; startVip(s, p, pick(VIPS)); s.ev.push({ k: 'vipSurprise', p }); } else vipOffer(s, p); }
    }
    s.pool = newPool(s, false);
    s.ev.push({ k: 'pool' });
    if (s.month >= 8 && !s.quake && rnd() < 0.22) { s.quake = { t: s.t + 15, big: rnd() < 0.5 }; s.ev.push({ k: 'tremor' }); }
    // year-end appraisal
    if (s.month % 12 === 0) appraisal(s);
    // lose conditions, then quarter-end target checks
    const out = [0, 1].map(p => lost(s.h[p]));
    if (out[0] || out[1]) return finish(s, out[0] && out[1] ? (score(s.h[0]) >= score(s.h[1]) ? 0 : 1) : out[0] ? 1 : 0, 'lost:' + (out[0] || out[1]));
    if (s.month % 3 === 0) {
      const met = [0, 1].filter(p => metTargets(s.h[p]));
      if (met.length) return finish(s, met.length === 1 ? met[0] : score(s.h[0]) >= score(s.h[1]) ? 0 : 1, 'targets');
    }
    if (s.month >= MONTHS) { const a = score(s.h[0]), b = score(s.h[1]); finish(s, a === b ? -1 : a > b ? 0 : 1, 'time'); }
  }
  function finish(s, w, why) { s.winner = w; s.why = why; s.ph = 'over'; s.ev.push({ k: 'over', winner: w, why }); }
  function appraisal(s) {
    const [a, b] = s.h;
    const award = (name, h, cash, rep) => { h.awards.push(name); if (cash) book(h, 'Awards', cash); addRep(h, rep); };
    const better = (fa, fb, name, cash, rep) => { if (fa > fb) award(name, a, cash, rep); else if (fb > fa) award(name, b, cash, rep); };
    better(curePct(a), curePct(b), 'Best cure rate', 3000, 15);
    better(-a.died, -b.died, 'Fewest deaths', 2000, 10);
    better(-a.messMade, -b.messMade, 'Cleanest hospital', 1500, 10);
    better(a.vipScore, b.vipScore, 'VIP favourite', 1500, 10);
    better(value(a), value(b), 'Most valuable hospital', 2000, 5);
    for (const h of s.h) { if (h.died >= 10) { h.awards.push('Citation: too many deaths'); addRep(h, -15); } }
    s.ev.push({ k: 'awards', y: s.month / 12 });
    for (const h of s.h) h.messMade = 0;
  }

  function step(s, dt) {
    if (s.ph !== 'play') return;
    s.t += dt;
    // patients choose a hospital by reputation and price; only hospitals with a staffed reception get any
    const att = s.h.map(h => {
      const open = (h.open || s.t >= GRACE) && h.desk && h.staff.some(x => x.desk && !x.gone && !x.path.length);
      return open ? h.rep * clamp(2 - avgPrice(h) / 100, 0.4, 1.6) + 50 : 0;
    });
    const tot = att[0] + att[1];
    for (let p = 0; p < 2; p++) {
      const h = s.h[p];
      recount(h); h.warm = warmth(h);
      if (h.boiler > 0) h.boiler -= dt;
      if (tot > 0) {
        h.acc += dt * arrivals(s.month) * att[p] / tot / MONTH;
        while (h.acc >= 1 && h.pats.length < 60) { h.acc -= 1; spawnPatient(s, p); }
        if (h.acc >= 1) h.acc = 0.99;
      }
      stepEvents(s, p, dt);
      stepStaff(s, p, dt);
      stepPatients(s, p, dt);
      stepRooms(s, p, dt);
      researchTick(s, p, dt);
      for (let i = h.fax.length - 1; i >= 0; i--) if (h.fax[i] && s.t >= h.fax[i].t) expireFax(s, p, h.fax[i]);
    }
    // earthquakes shake the whole town
    if (s.quake && s.t >= s.quake.t) {
      const big = s.quake.big; s.quake = null;
      s.ev.push({ k: 'quake', big });
      for (let p = 0; p < 2; p++) {
        const h = s.h[p];
        for (const key in h.rooms) {
          const r = h.rooms[key]; if (!ROOMS[r.k].mach || r.wreck || r.bt > 0) continue;
          r.used += (big ? 2 : 1) + Math.floor(rnd() * 3);
          if (r.used > r.str && rnd() < 0.25 * (r.used - r.str) * (exCount(r, 'ext') ? 0.5 : 1)) explode(s, p, +key);
        }
      }
    }
    while (s.ph === 'play' && s.t >= (s.month + 1) * MONTH) monthTick(s);
  }

  function stepEvents(s, p, dt) {
    const h = s.h[p];
    // emergencies: patients arrive in a stream, already diagnosed
    if (h.em) {
      const e = h.em;
      if (e.spawn > 0 && s.t >= e.next) {
        e.spawn--; e.next = s.t + 1.2;
        const pt = newPatient(s, h, e.dis); pt.em = 1; pt.dg = 1; pt.dx = true; pt.pat = 999; pt.ins = false;
        if (!h.known[e.dis]) { h.known[e.dis] = 1; s.ev.push({ k: 'newdis', p, dis: e.dis }); }
        h.pats.push(pt); h.visits++;
        goCure(s, p, pt);
      }
      if (s.t >= e.end || (e.spawn === 0 && !h.pats.some(x => x.em && x.st !== 'leave'))) endEmergency(s, p);
    }
    // epidemics: unvaccinated infected patients spread it; marked ones are vaccinated by a free nurse
    if (h.epi) {
      const e = h.epi;
      e.acc = (e.acc || 0) + dt;
      if (e.acc >= 2) {
        e.acc = 0;
        for (const pt of h.pats) {
          if (!pt.inf || pt.vax || pt.st === 'leave') continue;
          const near = h.pats.find(o => !o.inf && o.st !== 'leave' && Math.hypot(o.x - pt.x, o.y - pt.y) < 20);
          if (near && rnd() < 0.05) near.inf = 1;
        }
      }
      if (e.phase === 'cover') {
        const nurses = h.staff.filter(x => x.k === 'n' && !x.gone).length;
        for (const pt of h.pats) if (pt.mk && !pt.vax) { pt.vt = (pt.vt || 0) + dt * Math.min(2, nurses); if (pt.vt >= 3) { pt.vax = 1; s.ev.push({ k: 'vax', p, id: pt.id }); } }
        if (s.t >= e.t && !h.vis.some(v => v.k === 'insp')) {
          const v = { id: s.nextId++, k: 'insp', x: EXIT[0], y: LANE, path: [], f: 3, mv: 0, t: 0, inRoom: null };
          route(v, RECEP[0] + 8, RECEP[1]); h.vis.push(v); e.phase = 'insp'; s.ev.push({ k: 'inspector', p });
        }
      } else if (e.phase === 'declared' && s.t >= e.t) { for (const x of h.pats) x.inf = 0; h.epi = null; }
    }
    // visitors: VIPs tour the corridors; the health inspector walks to reception
    for (let i = h.vis.length - 1; i >= 0; i--) {
      const v = h.vis[i];
      const arrived = walk(v, 26, dt);
      if (!arrived) continue;
      if (v.k === 'insp') { if (v.done) { h.vis.splice(i, 1); continue; } endEpidemic(s, p); continue; }
      if (v.done) { h.vis.splice(i, 1); continue; }
      v.t += dt;
      if (v.t < 1.5) continue;
      v.t = 0; v.legs++;
      if (v.legs >= 6) { judgeVip(s, p, v); v.done = true; route(v, EXIT[0], EXIT[1]); continue; }
      const L = pick(LANES); route(v, 100 + rnd() * 270, L + (rnd() < 0.5 ? -5 : 5));
    }
    // rats come out when there's litter about
    h.ratT = (h.ratT || 0) + dt;
    if (h.ratT >= 8) {
      h.ratT = 0;
      const litter = h.mess.filter(m => m.k === 'litter').length;
      if (litter >= 3 && h.rats.length < 4 && rnd() < 0.25) { const L = pick(LANES); h.rats.push({ id: s.nextId++, x: 100 + rnd() * 280, y: L + (rnd() < 0.5 ? -12 : 12), path: [], f: 2, mv: 0 }); s.ev.push({ k: 'rat', p }); }
    }
    for (const rt of h.rats) { if (walk(rt, 34, dt)) { const L = laneOf(rt.y); rt.path = [[90 + rnd() * 300, L + (rnd() < 0.5 ? -12 : 12)]]; } }
  }

  function stepStaff(s, p, dt) {
    const h = s.h[p], pol = h.pol;
    for (let i = h.staff.length - 1; i >= 0; i--) { const st = h.staff[i]; if (walk(st, SSPEED, dt) && st.gone) h.staff.splice(i, 1); }
    const cold = h.warm < 0.6, hot = h.warm > 1.6, messy = h.mess.length > 6;
    h.leaveT = (h.leaveT || 0) + dt;
    let reassign = false;
    for (const st of h.staff) {
      if (st.gone) continue;
      const r = st.slot != null ? h.rooms[st.slot] : null;
      // tiredness and happiness
      if (st.k !== 'r') {
        const busy = st.mode === 'rest' ? -dt / 14 : r && r.p != null ? dt / 80 : st.mode === 'train' ? dt / 150 : r && r.k === 'research' ? dt / 120 : st.k === 'h' && st.job != null ? dt / 100 : r ? dt / 400 : -dt / 200;
        st.tired = r2(clamp(st.tired + busy * (st.mode === 'rest' ? 1 + 0.15 * (h.rooms[st.room] ? exCount(h.rooms[st.room], 'seat') : 0) : 1), 0, 1));
      }
      // happiness change per month
      let dh = 0;
      if (st.tired > 0.3) dh -= 0.6 * (st.tired - 0.3);
      if (cold || hot) dh -= 0.1;
      if (messy) dh -= 0.05;
      if (r) dh += (exCount(r, 'plant') ? (r.water > 0 ? 0.04 : -0.05) : 0) + 0.04 * exCount(r, 'rad') + 0.02 * exCount(r, 'ext');
      if (st.mode === 'rest') dh += 0.5;
      st.hap = clamp(st.hap + dh * dt / MONTH, 0, 1);
      // unhappy staff ask for a raise; ignored for a month, they walk out
      if (st.hap < 0.3 && !st.fax && !st.quit) {
        st.fax = 1;
        const ask = Math.round(Math.max(st.sal, fairWage(st)) * 1.1);
        h.fax.push({ id: s.nextId++, k: 'raise', sid: st.id, nm: st.nm, ask, t: s.t + MONTH });
      }
      // resting in the staff room once tiredness passes the policy threshold (never mid-treatment)
      if (st.k !== 'r' && st.mode === 'idle' && st.job == null && st.tired * 100 >= pol.rest && !(r && r.p != null)) {
        const k = facilityRoom(h, 'staff', 'seat');
        if (k != null) { unslot(h, st); st.mode = 'rest'; enterFacility(h, st, k); reassign = true; }
      }
      if (st.mode === 'rest' && st.tired <= 0.05 && !st.path.length) { leaveFacility(h, st); st.mode = 'idle'; st.idle = -1; reassign = true; }
      if (st.mode === 'rest' && st.room != null && !h.rooms[st.room]) { st.mode = 'idle'; st.room = null; reassign = true; }
      // training: students sit in the lecture chairs while a consultant teaches
      if (st.train && st.mode === 'idle' && st.k === 'd' && !isCon(st) && st.slot == null) {
        const k = facilityRoom(h, 'training', 'chair');
        if (k != null && h.rooms[k].sts.length) { st.mode = 'train'; enterFacility(h, st, k); }
      }
      if (st.mode === 'train') {
        const tr = h.rooms[st.room];
        const teacher = tr && tr.sts.map(id => staffById(h, id)).find(x => x && x.slot === st.room && !x.path.length);
        if (!tr) { st.mode = 'idle'; st.room = null; reassign = true; }
        else if (teacher && !st.path.length) {
          const n = Math.max(1, tr.users.length);
          const speed = (0.4 + teacher.sk) * (1 + 0.15 * exCount(tr, 'book')) * (st.tired > 0.5 ? 0.5 : 1) * (st.sk < 0.25 ? 1.5 : st.sk < 0.8 ? 1 : 0.7) / n;
          st.lp = (st.lp || 0) + dt * speed / 6;
          while (st.lp >= 1) {
            st.lp -= 1;
            if (st.sk + 0.02 <= teacher.sk) st.sk = r2(st.sk + 0.02);
            for (const q of ['r', 'p', 's']) if (hasQ(teacher, q) && st.q[q] < QUAL_PTS[q]) { st.q[q] = Math.min(QUAL_PTS[q], st.q[q] + 5); if (st.q[q] >= QUAL_PTS[q]) s.ev.push({ k: 'qual', p, nm: st.nm, q }); }
            if (isCon(st)) { st.train = false; leaveFacility(h, st); st.mode = 'idle'; reassign = true; break; }
          }
        }
      }
      const rk = rank(st);
      if (st.k === 'd' && st.rk && st.rk !== rk) s.ev.push({ k: 'promoted', p, nm: st.nm, rank: rk });
      st.rk = rk;
    }
    // "staff leave rooms": doctors and nurses sitting in quiet rooms go where they're needed
    if (pol.leave && h.leaveT > 3) {
      h.leaveT = 0;
      for (const key in h.rooms) {
        const r = h.rooms[key], k = +key;
        if (!ready(r) || r.sts.length >= (ROOMS[r.k].need || 1) || !r.q.length || ROOMS[r.k].cat === 'fac') continue;
        const donor = h.staff.find(st => !st.gone && st.slot != null && st.slot !== k && eligible(st, r.k) && h.rooms[st.slot] && !h.rooms[st.slot].q.length && h.rooms[st.slot].p == null && ROOMS[h.rooms[st.slot].k].cat !== 'fac' && !st.path.length);
        if (donor) { unslot(h, donor); placeIn(h, donor, k); }
      }
    }
    if (reassign) assign(h); else if ((h.asgT = (h.asgT || 0) + dt) > 1) { h.asgT = 0; assign(h); }
    stepHandymen(s, p, dt);
  }

  function stepHandymen(s, p, dt) {
    const h = s.h[p];
    const taken = new Set(h.staff.filter(x => x.k === 'h' && x.job != null).map(x => x.job));
    for (const st of h.staff) {
      if (st.k !== 'h' || st.gone || st.mode !== 'idle') continue;
      if (st.job != null) {
        const j = st.job;
        let ok = true;
        if (j[0] === 'm') ok = h.mess.some(x => 'm' + x.id === j);
        else if (j[0] === 'r') { const r = h.rooms[+j.slice(1)]; ok = r && !r.wreck && ROOMS[r.k].mach && r.used > 0; }
        else if (j[0] === 'w') ok = true;
        if (!ok) { st.job = null; st.work = 0; st.inRoom != null && route(st, slotCx(st.inRoom), slotLane(st.inRoom)); continue; }
        if (st.path.length) continue;
        const time = j[0] === 'm' ? CLEAN_TIME : j[0] === 'r' ? REPAIR_TIME : WATER_TIME;
        st.work += dt / (time * (1.4 - 0.6 * st.sk));
        if (st.work >= 1) {
          if (j[0] === 'm') { const m = h.mess.find(x => 'm' + x.id === j); if (m) { h.mess.splice(h.mess.indexOf(m), 1); s.ev.push({ k: 'cleaned', p, x: m.x, y: m.y, kind: m.k }); } }
          else if (j[0] === 'r') { const k = +j.slice(1), r = h.rooms[k]; const late = r.used > r.str; if (rnd() < (late ? 0.6 : 0.25)) r.str = Math.max(3, r.str - 1); r.used = 0; s.ev.push({ k: 'repaired', p, slot: k, str: r.str }); }
          else if (j[0] === 'w') { const key = j.slice(1); if (key[0] === 'R') { const r = h.rooms[+key.slice(1)]; if (r) r.water = 1; } else if (h.decor[key] === 'plant') h.water[key] = 1; }
          st.job = null; st.work = 0; st.wt = 0.4;
        }
        continue;
      }
      // choose a job: smoking machines first, then (by priority) mess, worn machines, thirsty plants
      const jobs = [];
      for (const key in h.rooms) {
        const r = h.rooms[key]; if (!ROOMS[r.k].mach || r.wreck || r.bt > 0 || taken.has('r' + key)) continue;
        if (r.used >= r.str - 2 && r.used > 0) jobs.push({ id: 'r' + key, kind: 'repair', urgent: r.used > r.str, x: slotCx(+key), y: spots(+key).in[1], room: +key });
        if (exCount(r, 'plant') && r.water < 0.35 && !taken.has('wR' + key)) jobs.push({ id: 'wR' + key, kind: 'water', x: slotCx(+key), y: spots(+key).st[1], room: +key });
      }
      for (const key in h.decor) if (h.decor[key] === 'plant' && (h.water[key] || 0) < 0.35 && !taken.has('w' + key)) { const [c, r] = key.split(',').map(Number); const [x, y] = tileStand(c, r); jobs.push({ id: 'w' + key, kind: 'water', x, y }); }
      for (const m of h.mess) if (!taken.has('m' + m.id)) jobs.push({ id: 'm' + m.id, kind: 'clean', x: m.x, y: m.y });
      const pri = st.pri || 'all';
      const okJob = j => pri === 'all' || j.kind === pri || j.urgent;
      let best = null, bd = 1e9;
      for (const j of jobs) {
        if (!okJob(j)) continue;
        const d = Math.abs(j.x - st.x) + Math.abs(j.y - st.y) - (j.urgent ? 2000 : 0) - (j.kind === pri ? 300 : 0);
        if (d < bd) { bd = d; best = j; }
      }
      if (best) {
        st.job = best.id; st.work = 0; taken.add(best.id);
        if (best.room != null) { enterRoom(st, best.room, best.kind === 'repair' ? [best.x - 10, best.y] : [best.x + 12, best.y]); }
        else route(st, best.x, best.y);
      } else if (!st.path.length) {
        st.wt -= dt;
        if (st.wt <= 0) { st.wt = 2 + rnd() * 4; const L = pick(LANES); route(st, 90 + rnd() * (W * T - 120), L + (rnd() < 0.5 ? -4 : 4)); }
      }
    }
    // plants dry out
    for (const key in h.decor) if (h.decor[key] === 'plant') h.water[key] = Math.max(0, (h.water[key] == null ? 1 : h.water[key]) - dt / 150);
    for (const key in h.rooms) { const r = h.rooms[key]; if (exCount(r, 'plant')) r.water = Math.max(0, r.water - dt / 150); }
  }

  // reception turns people away once every GP queue is full (max queue size 6 each)
  function gpQueue(h) { const g = Object.values(h.rooms).filter(r => r.k === 'gp' && !r.wreck); if (!g.length) return 0; return Math.min(...g.map(r => r.q.length)) - QMAX + CROWD; }
  function stepPatients(s, p, dt) {
    const h = s.h[p];
    const crowd = h.pats.filter(x => x.st === 'queue' || x.st === 'recep').length;
    const recep = h.staff.find(x => x.desk && !x.gone && !x.path.length);
    let waitN = 0;
    for (let i = h.pats.length - 1; i >= 0; i--) {
      const pt = h.pats[i];
      if (!h.pats.includes(pt)) continue;
      const d = DISEASES[pt.dis];
      const arrived = walk(pt, d.id === 'sleep' ? PSPEED * 0.6 : pt.em ? PSPEED * 1.3 : PSPEED, dt);
      if (pt.st === 'leave') { if (arrived) { if (pt.inf && !pt.vax && h.epi && h.epi.phase === 'cover') h.epi.t = s.t; /* an infected patient got outside: the inspector comes at once */ h.pats.splice(i, 1); } continue; }
      // needs: health, thirst, bladder
      pt.hp -= dt / (d.fatal ? 300 : 520) * (pt.em ? 2.5 : 1);
      if (pt.hp <= 0) { kill(s, p, pt, -1); continue; }
      pt.th = clamp(pt.th + dt / 120 * (h.warm > 1.6 ? 2 : 1), 0, 1);
      pt.bl = clamp(pt.bl + dt / 140 * (hasTag(d, 'loo') ? 2.5 : 1), 0, 1.2);
      if (pt.st === 'enter') { if (arrived) { pt.st = 'recep'; pt.t = 1.4; } continue; }
      if (pt.st === 'recep') {
        if (!recep) continue;
        pt.t -= dt / (1 + 0.1 * Math.max(0, crowd - 4)) * (0.6 + 0.8 * recep.sk);
        if (pt.t > 0) continue;
        if (!pt.cure && !pt.em && gpQueue(h) > CROWD) { h.angry++; addRep(h, -1); s.ev.push({ k: 'crowd', p, nm: pt.nm }); leave(s, p, pt, 'crowd'); continue; }
        if (pt.cure || pt.dx) goCure(s, p, pt);
        else if (!queueFor(s, p, pt, 'gp')) { h.angry++; addRep(h, -2); s.ev.push({ k: 'nogp', p, nm: pt.nm }); leave(s, p, pt, 'nogp'); }
        continue;
      }
      if (pt.st === 'wait') {
        waitN++;
        pt.t -= dt;
        pt.pat -= dt * 0.5;
        if (pt.recheck && (pt.rt = (pt.rt || 0) + dt) > 4) {
          pt.rt = 0;
          const dd = DISEASES[pt.dis];
          if (pt.dx && anyRoom(h, dd.room === 'op' && !pt.prep ? 'ward' : dd.room)) { pt.recheck = 0; goCure(s, p, pt); continue; }
          if (!pt.dx) { pt.recheck = 0; decide(s, p, pt); continue; }
        }
        if (pt.em && (pt.rt = (pt.rt || 0) + dt) > 3) { pt.rt = 0; const dd = DISEASES[pt.dis]; if (anyRoom(h, dd.room === 'op' && !pt.prep ? 'ward' : dd.room)) { goCure(s, p, pt); continue; } }
        if (pt.t <= 0 || pt.pat <= 0) { if (h.fax.some(f => f.pid === pt.id)) { pt.t = 5; continue; } sendHome(s, p, pt, 'wait'); }
        continue;
      }
      if (pt.st === 'queue' || pt.st === 'trip' || pt.st === 'wc') {
        if (pt.st !== 'wc') pt.pat -= dt * drainRate(h, pt) * (pt.em ? 0 : 1);
        if (pt.pat <= 0) { h.angry++; addRep(h, -ANGRY_REP); s.ev.push({ k: 'angry', p, nm: pt.nm, id: pt.id, x: pt.x, y: pt.y }); leaveFacility(h, pt); leave(s, p, pt, 'angry'); continue; }
      }
      if (pt.st === 'queue' && !pt.path.length && !pt.em) {
        const r = h.rooms[pt.slot], qi = r ? r.q.indexOf(pt.id) : -1;
        if (qi >= 1) {
          // a drink or the loo while waiting; patients keep their place in the queue
          if (pt.bl >= 1) {
            const k = facilityRoom(h, 'toilet', 'cub');
            if (k != null) { pt.st = 'wc'; pt.t = 5 + rnd() * 3; enterFacility(h, pt, k); continue; }
            pt.bl = 0.2; pt.pat -= 25; addRep(h, -1); spawnMess(s, p, pt.x + 3, pt.y + 2, 'puddle'); s.ev.push({ k: 'wet', p, nm: pt.nm, x: pt.x, y: pt.y }); continue;
          }
          if (pt.th >= 0.7 && h.drinks) {
            let best = null, bd = 1e9;
            for (const key in h.decor) if (h.decor[key] === 'drinks') { const [c, rr] = key.split(',').map(Number); const [x, y] = tileStand(c, rr); const dd = Math.abs(x - pt.x) + Math.abs(y - pt.y); if (dd < bd) { bd = dd; best = [x, y]; } }
            if (best && bd < 260) { pt.st = 'trip'; pt.t = 1; route(pt, best[0], best[1]); continue; }
          }
        }
      }
      if (pt.st === 'trip' && arrived) {
        pt.t -= dt; if (pt.t > 0) continue;
        book(h, 'Drinks', 20); pt.th = 0; pt.bl = Math.min(1.2, pt.bl + 0.3);
        if (rnd() < 0.5 / (1 + 0.4 * bins(h))) spawnMess(s, p, pt.x + (rnd() - 0.5) * 10, pt.y + 4, 'litter');
        pt.st = 'queue'; const k = pt.slot; const r = h.rooms[k];
        if (r) { const [qx, qy] = queuePos(h, k, r.q.indexOf(pt.id)); route(pt, qx, qy); } else { pt.st = 'recep'; pt.t = 0.2; }
        continue;
      }
      if (pt.st === 'wc' && arrived) {
        pt.t -= dt; if (pt.t > 0) continue;
        pt.bl = 0; leaveFacility(h, pt); pt.st = 'queue';
        const k = pt.slot, r = h.rooms[k];
        if (r) { const [qx, qy] = queuePos(h, k, r.q.indexOf(pt.id)); route(pt, qx, qy); } else { pt.st = 'recep'; pt.t = 0.2; route(pt, RECEP[0] + 10, RECEP[1]); }
        continue;
      }
      // corridor accidents: vomiting spreads to anyone who sees it
      if (inCorridor(pt) && h.mess.length < MAX_MESS) {
        let chance = 0.0009 * (hasTag(d, 'vomit') ? 6 : 1) * (pt.pat < 20 ? 3 : 1) * (messNear(h, pt.x, pt.y, 'vomit') ? 6 : 1) * (decorNear(h, pt.x, pt.y, 'plant', 50) ? 0.6 : 1);
        if (rnd() < chance * dt) { spawnMess(s, p, pt.x + 4, pt.y + 3, 'vomit'); addRep(h, -1); s.ev.push({ k: 'vomit', p, nm: pt.nm, x: pt.x, y: pt.y }); }
      }
    }
    // toilet users waiting for a cubicle hold their place; nothing else to do here
    void waitN;
  }

  function stepRooms(s, p, dt) {
    const h = s.h[p];
    for (const key in h.rooms) {
      const k = +key, r = h.rooms[k];
      if (r.wreck) continue;
      if (r.bt > 0) { r.bt -= dt; if (r.bt <= 0) assign(h); continue; }
      if (ROOMS[r.k].cat === 'fac') continue;
      const info = roomStaffReady(h, r, k);
      if (r.p != null) {
        const pt = patById(h, r.p);
        if (!pt) { r.p = null; r.prog = 0; continue; }
        if (!info || pt.path.length) continue;
        r.prog += dt / r.dur * (info.crazy ? 0.5 : 1);
        if (r.prog >= 1) finishRoom(s, p, k, info);
      } else if (info && r.q.length) {
        // the first patient who is actually standing at the door (not off at the loo)
        const id = r.q.find(id2 => { const o = patById(h, id2); return o && o.st === 'queue' && !o.path.length; });
        r.q = r.q.filter(id2 => patById(h, id2));
        if (id == null) continue;
        const pt = patById(h, id);
        r.q.splice(r.q.indexOf(id), 1); reQueue(h, k);
        const R = ROOMS[r.k];
        const base = r.k === 'gp' && pt.gp2 ? R.time * 0.5 : r.k === 'ward' ? R.time * 2 / (1 + exCount(r, 'bed') / 2) : r.k === 'psych' ? R.time / (1 + 0.15 * exCount(r, 'book')) : R.time;
        r.p = pt.id; r.dis = pt.dis; r.dur = base * (1.4 - 0.6 * info.sk); r.prog = 0;
        pt.st = 'in';
        enterRoom(pt, k, r.k === 'op' ? [slotCx(k), slotTop(k) ? slotY0(k) * T + 24 : slotY0(k) * T + 40] : spots(k).in);
      }
    }
  }

  const api = { VERSION, T, W, H, LANE, LANES, CX, BAND_Y0, SLOTS, MONTH, MONTHS, GRACE, EXIT, RECEP, DESK_STAFF, TARGETS, LOSE, START_CASH, START_REP, DESK_COST, LOAN_STEP, LOAN_RATE,
    ROOMS, ROOM_ORDER, CATS, EXTRAS, EXTRA_ORDER, extrasFor, DISEASES, DIS_IDX, MONTH_NAMES, DECOR, DECOR_ORDER, decorSpot, decorKey, MAX_COMFORT, RESEARCH, FIELDS, QUAL_PTS, QUAL_NAME,
    slotBand, slotTop, slotX0, slotY0, slotLane, slotCx, slotAtWorld, spots, staffSpot, useSpot, queuePos, idlePos, laneOf, tileStand, yearMonth,
    score, progress, metTargets, value, curePct, arrivals, unlocked, hasUpgrade, roomCost, machStr, cureFee, diagFee, priceFactor, loanLimit, researchCost, cureType, hasTag,
    rank, isCon, hasQ, fairWage, typeName, eligible, capacity,
    newState, start, step, build, demolish, buyExtra, replaceMachine, hire, fire, place, setTrain, setPri, pay, setPolicy, setPrice, setResearch, loan, openDoors,
    placeDecor, removeDecor, buyDesk, shoot, vax, answerFax, setProfile, staffById, patById };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RH = api;
})(typeof window !== 'undefined' ? window : globalThis);
