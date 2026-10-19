// Rival Hospital 3D rules: pure simulation, no DOM and no networking. Follows the Theme Hospital mechanics reference:
// reception → GP → diagnosis rooms (building a diagnosis %) → cure room; staff ranks, qualifications, happiness and
// tiredness; machines that wear out and explode; research, training, hospital policy, the casebook's prices, loans;
// emergencies, VIPs, earthquakes, epidemics and rats; targets checked at every quarter-end.
// Loads in the browser as window.RH and in Node (module.exports) so the economy can be tuned headless.
//
// Layout: a grid of 16px tiles, W x H. Columns 0-1 are outside (a path leads in at rows 4-6); the rest is open
// hospital floor. Rooms are built anywhere on it, Theme Hospital style: drag a blueprint, place a door and windows,
// wait for the site to clear, place the furniture, finish. Everyone walks tile to tile (breadth-first search), and
// walls block movement except through doors. The lobby by the entrance (reception desk, waiting area) stays open.
(function (root) {
  'use strict';
  const VERSION = 3;
  const T = 16, W = 32, H = 26;
  const MONTH = 60;                 // real seconds per in-game month
  const DAY = MONTH / 30;           // the spec's daily happiness effects tick once per in-game day
  const MONTHS = 24;                // two years; targets are checked at every quarter-end
  const GRACE = 120;                // build timer: patients start arriving after this, or when you open the doors
  // the reception desk stands across the lobby facing the front doors: patients check in on the door side (RECEP),
  // the receptionist sits behind it (DESK_STAFF), so seen from the entrance they're never in front of the doors
  const EXIT = [-16, 88], RECEP = [56, 94], DESK_STAFF = [88, 94];
  const PSPEED = 36, SSPEED = 44;
  const START_CASH = 40000, START_REP = 500;
  const TARGETS = { rep: 650, cash: 100000, pct: 65, cured: 200, value: 70000 };
  const LOSE = { cash: -20000, rep: 150 };
  const DEATH_REP = 12, ANGRY_REP = 3, HOME_REP = 1, CROWD = 6, QMAX = 6;
  const LOAN_STEP = 5000, LOAN_RATE = 0.01;

  // ---------- single player: the 12-level campaign (Theme Hospital single-player spec) ----------
  // Targets per level, null = not a target there. start = starting cash. intro = what the level brings in.
  // Win: every target met at a quarter-end check with no loan. Lose: checked at year end, after the awards.
  const LEVELS = [
    { nm: 'Toxicity', rep: 300, cash: 1000, pct: 40, cured: 10, value: 55000, start: 40000, intro: 'The basic rooms' },
    { nm: 'Sleepy Hollow', rep: 300, cash: 10000, pct: 40, cured: 40, value: 60000, start: 40000, intro: 'Research and consultants' },
    { nm: 'Largechester', rep: null, cash: 20000, pct: null, cured: 60, value: 80000, start: 50000, intro: 'Emergencies and surgery' },
    { nm: 'Frimpton-on-Sea', rep: 500, cash: 50000, pct: null, cured: null, value: 100000, start: 50000, intro: 'Training' },
    { nm: 'Simpleton', rep: 400, cash: 50000, pct: 45, cured: 200, value: 120000, start: 50000, intro: 'Earthquakes' },
    { nm: 'Festering-on-the-Wold', rep: null, cash: 150000, pct: 50, cured: 300, value: 140000, start: 50000, intro: 'Epidemics' },
    { nm: 'Greenpool', rep: 600, cash: 200000, pct: null, cured: 350, value: 160000, start: 50000, intro: '' },
    { nm: 'Manquay', rep: null, cash: 300000, pct: 55, cured: 500, value: 180000, start: 60000, intro: '' },
    { nm: 'Eastville', rep: null, cash: 400000, pct: 60, cured: 500, value: 200000, start: 60000, intro: '' },
    { nm: 'Eggsenham', rep: 650, cash: 500000, pct: 65, cured: 500, value: 220000, start: 60000, intro: 'Better drugs' },
    { nm: 'Croaking', rep: 700, cash: 500000, pct: 70, cured: 600, value: 240000, start: 70000, intro: 'Alien DNA' },
    { nm: 'Battenberg', rep: 800, cash: 750000, pct: 70, cured: 750, value: 250000, start: 70000, intro: 'Everything' },
  ];
  // the level each feature first appears on
  const LVL_FROM = { research: 2, emerg: 3, op: 3, training: 4, quake: 5, epi: 6, dna: 11 };
  const lvlOK = (s, f) => !s.solo || s.solo.lvl >= LVL_FROM[f];
  const RIVAL_NAMES = ['ORAC', 'Colossus', 'HAL', 'Multivac', 'Holly', 'Deep Thought', 'Zen', 'Skynet', 'Marvin', 'Cerebro', 'Mother', 'Jayne'];
  // the lobby by the entrance: never built on (reception desk, idle staff, waiting patients)
  const LOBBY = { x0: 2, y0: 3, x1: 5, y1: 9 };
  const DESK_TILES = [[4, 5], [4, 6]];
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // N E S W

  // ---------- objects ----------
  // fw x fd: footprint in tiles with the front facing south. use: 'front' (stand on the tile in front), 'self' (stand
  // on the object's own tile). who: p patient, s staff, rest (staff room), stu (student), teach. block: nobody walks
  // through it. side: sits on a tile edge against a wall. back: must back onto a wall. str: machine strength.
  const O = (name, cost, fw, fd, o) => Object.assign({ name, cost, fw, fd, use: null, who: null, block: true, side: false, back: false, str: 0 }, o || {});
  const OBJ = {
    desk:     O('Desk', 150, 2, 1, { use: 'front', who: 's' }),
    cabinet:  O('Filing cabinet', 50, 1, 1, { back: true }),
    chair:    O('Chair', 20, 1, 1, { use: 'self', who: 'p', block: false }),
    screen:   O('Screen', 80, 1, 1),
    trolley:  O('Crash trolley', 200, 2, 1, { use: 'front', who: 'p' }),
    cardio:   O('Cardio machine', 950, 2, 1, { use: 'front', who: 'p', str: 13 }),
    scanner:  O('Scanner', 7500, 2, 2, { use: 'front', who: 'p', str: 12 }),
    console:  O('Console', 450, 1, 1, { use: 'front', who: 's' }),
    ultra:    O('Ultrascanner', 6000, 2, 1, { use: 'front', who: 'p', str: 9 }),
    bloodm:   O('Blood machine', 3000, 1, 1, { use: 'front', who: 'p', str: 10 }),
    xray:     O('X-ray', 5500, 2, 2, { use: 'front', who: 'p', str: 12 }),
    shield:   O('Radiation shield', 500, 1, 1, { use: 'front', who: 's' }),
    couch:    O('Couch', 100, 2, 1, { use: 'front', who: 'p' }),
    comfy:    O('Comfy chair', 50, 1, 1, { use: 'self', who: 's', block: false }),
    bed:      O('Bed', 150, 1, 2, { use: 'front', who: 'p', back: true }),
    pcab:     O('Pharmacy cabinet', 1000, 2, 1, { use: 'front', who: 'p', back: true }),
    optable:  O('Operating table', 4000, 2, 1, { use: 'front', who: 'p', str: 12 }),
    sscreen:  O('Surgeon screen', 200, 1, 1, { use: 'front', who: 's' }),
    sink:     O('Sink', 80, 1, 1, { use: 'front', who: 's', back: true }),
    xview:    O('X-ray viewer', 1470, 1, 1, { back: true }),
    inflator: O('Inflator', 2500, 2, 1, { use: 'front', who: 'p', str: 8 }),
    slicer:   O('Slicer', 1500, 2, 1, { use: 'front', who: 'p', str: 10 }),
    cast:     O('Cast remover', 2000, 2, 1, { use: 'front', who: 'p', str: 11 }),
    hairr:    O('Hair restorer', 3550, 1, 1, { use: 'front', who: 'p', str: 8 }),
    electro:  O('Electrolyser', 6050, 1, 1, { use: 'front', who: 'p', str: 8 }),
    jellym:   O('Jelly moulder', 6500, 2, 2, { use: 'front', who: 'p', str: 7 }),
    shower:   O('Decontamination shower', 9050, 1, 1, { use: 'front', who: 'p', str: 10 }),
    dnaf:     O('DNA fixer', 12550, 2, 1, { use: 'front', who: 'p', str: 7 }),
    sofa:     O('Sofa', 150, 2, 1, { use: 'front', who: 'rest', rest: 0.05 }),
    vgame:    O('Video game', 200, 1, 1, { use: 'front', who: 'rest', rest: 0.08 }),
    pool:     O('Pool table', 300, 2, 1, { use: 'front', who: 'rest', rest: 0.074 }),
    tv:       O('TV', 120, 1, 1, { back: true }),
    toilet:   O('Toilet', 250, 1, 1, { use: 'self', who: 'p', block: false }),
    autopsy:  O('Autopsy machine', 4000, 2, 1, { use: 'front', who: 's' }),
    computer: O('Computer', 500, 1, 1, { use: 'front', who: 's', needs: 'computer' }),
    atom:     O('Atom analyser', 1000, 1, 1, { needs: 'atom' }),
    lchair:   O('Lecture chair', 50, 1, 1, { use: 'self', who: 'stu', block: false }),
    proj:     O('Projector', 100, 1, 1, { use: 'front', who: 'teach' }),
    ext:      O('Fire extinguisher', 25, 1, 1, { side: true, block: false }),
    rad:      O('Radiator', 20, 1, 1, { side: true, block: false }),
    bin:      O('Bin', 15, 1, 1, { side: true, block: false }),
    plant:    O('Plant', 5, 1, 1),
    bookcase: O('Bookcase', 30, 2, 1, { back: true }),
    skeleton: O('Skeleton', 40, 1, 1, { back: true }),
  };
  const STD4 = ['ext', 'rad', 'plant', 'bin'];

  // ---------- rooms ----------
  // cost: default total (shell + required objects). min: minimum square side. swing: three-tile double door.
  // req: required objects. extra: objects you can buy. p: the patient's object, s: the staff's objects (in order).
  // staff: 'doc' any doctor · 'psy' psychiatrist · 'surg' surgeon (x2) · 'res' researcher · 'con' consultant teacher
  //        'nurse' · '' none. power: how much a visit adds to the diagnosis %, det: which cure groups it can detect.
  // wall: white / green / yellow (imaging) / blue (clinics)
  const R = (name, short, cat, cost, min, staff, req, o) => Object.assign({ name, short, cat, cost, min, staff, req, extra: STD4, swing: false, wall: 'white' }, o || {});
  const ROOMS = {
    gp:       R("GP's Office", 'GP', 'diag', 2500, 4, 'doc', ['desk', 'cabinet', 'chair'], { fee: 100, time: 2, p: 'chair', s: ['desk'] }),
    gendiag:  R('General Diagnosis', 'Gen Diag', 'diag', 1000, 5, 'doc', ['screen', 'trolley'], { fee: 150, time: 4, power: 0.22, det: 'pharm psych clinic op', p: 'trolley', wall: 'green' }),
    cardio:   R('Cardiogram', 'Cardio', 'diag', 1500, 4, 'doc', ['cardio', 'screen'], { fee: 150, time: 5, power: 0.3, det: 'pharm op', p: 'cardio', wall: 'yellow' }),
    xray:     R('X-Ray', 'X-Ray', 'diag', 8000, 6, 'doc', ['xray', 'shield'], { fee: 200, time: 2.5, power: 0.4, det: 'clinic op', p: 'xray', s: ['shield'], wall: 'yellow' }),
    scanner:  R('Scanner', 'Scanner', 'diag', 12000, 5, 'doc', ['scanner', 'console', 'screen'], { fee: 300, time: 3.5, power: 0.55, det: 'pharm psych clinic op', p: 'scanner', s: ['console'], wall: 'yellow' }),
    blood:    R('Blood Machine', 'Blood', 'diag', 6000, 4, 'doc', ['bloodm'], { fee: 250, time: 3, power: 0.45, det: 'pharm clinic op', p: 'bloodm', wall: 'yellow' }),
    ultra:    R('Ultrascan', 'Ultrascan', 'diag', 8000, 4, 'doc', ['ultra'], { fee: 400, time: 3, power: 0.7, det: 'pharm psych clinic op', p: 'ultra', wall: 'yellow' }),
    ward:     R('Ward', 'Ward', 'treat', 2000, 6, 'nurse', ['desk', 'bed'], { fee: 100, time: 6, power: 0.25, det: 'pharm op', p: 'bed', s: ['desk'], swing: true, extra: STD4.concat(['desk', 'bed']), both: true }),
    psych:    R('Psychiatric', 'Psych', 'treat', 2500, 5, 'psy', ['screen', 'couch', 'comfy'], { fee: 200, time: 6, power: 0.4, det: 'psych', p: 'couch', s: ['comfy'], extra: STD4.concat(['bookcase', 'skeleton']), both: true }),
    pharm:    R('Pharmacy', 'Pharmacy', 'treat', 1500, 4, 'nurse', ['pcab'], { time: 3, p: 'pcab' }),
    op:       R('Operating Theatre', 'Theatre', 'treat', 8000, 6, 'surg', ['optable', 'sscreen', 'sink', 'xview'], { time: 7, need: 2, p: 'optable', s: ['sscreen', 'sink'], swing: true }),
    infl:     R('Inflation', 'Inflation', 'clinic', 4000, 4, 'doc', ['inflator'], { time: 4, p: 'inflator', wall: 'blue' }),
    tongue:   R('Slack Tongue', 'Tongue', 'clinic', 3000, 4, 'doc', ['slicer'], { time: 2, p: 'slicer', wall: 'blue' }),
    fracture: R('Fracture Clinic', 'Fracture', 'clinic', 2500, 4, 'nurse', ['cast'], { time: 4.5, p: 'cast', wall: 'blue' }),
    hair:     R('Hair Restoration', 'Hair', 'clinic', 4500, 4, 'doc', ['hairr', 'console'], { time: 4.5, p: 'hairr', s: ['console'], wall: 'blue' }),
    elec:     R('Electrolysis', 'Electro', 'clinic', 7000, 5, 'doc', ['electro', 'console'], { time: 5, p: 'electro', s: ['console'], wall: 'blue' }),
    jelly:    R('Jelly Vat', 'Jelly Vat', 'clinic', 11000, 4, 'doc', ['jellym'], { time: 4.5, p: 'jellym', wall: 'blue' }),
    decon:    R('Decontamination', 'Decon', 'clinic', 15000, 5, 'doc', ['shower', 'console'], { time: 5, p: 'shower', s: ['console'], wall: 'blue' }),
    dna:      R('DNA Fixer', 'DNA', 'clinic', 13500, 5, 'res', ['dnaf', 'console'], { time: 6, p: 'dnaf', s: ['console'], swing: true, wall: 'blue' }),
    staff:    R('Staff Room', 'Staff Rm', 'fac', 1500, 4, '', ['sofa'], { extra: ['ext', 'rad', 'plant', 'sofa', 'pool', 'tv', 'vgame'], wall: 'green' }),
    toilet:   R('Toilets', 'Toilets', 'fac', 1500, 4, '', ['toilet', 'sink'], { extra: STD4.concat(['toilet', 'sink']), wall: 'green' }),
    research: R('Research Dept.', 'Research', 'fac', 5000, 5, 'res', ['desk', 'cabinet', 'autopsy'], { extra: STD4.concat(['computer', 'desk', 'cabinet', 'atom']), wall: 'green' }),
    training: R('Training Room', 'Training', 'fac', 2000, 4, 'con', ['lchair', 'proj'], { extra: STD4.concat(['lchair', 'bookcase', 'skeleton']), wall: 'green' }),
  };
  for (const k in ROOMS) {
    const Rm = ROOMS[k];
    Rm.reqCost = Rm.req.reduce((a, o) => a + OBJ[o].cost, 0);
    Rm.shell = Rm.cost - Rm.reqCost;
    const m = OBJ[Rm.p] && OBJ[Rm.p].str; if (m) Rm.mach = m;
  }
  const ROOM_ORDER = ['gp', 'gendiag', 'cardio', 'xray', 'blood', 'scanner', 'ultra', 'ward', 'psych', 'pharm', 'op',
    'infl', 'tongue', 'fracture', 'hair', 'elec', 'jelly', 'decon', 'dna', 'staff', 'toilet', 'research', 'training'];
  const CATS = [['diag', 'Diagnosis'], ['treat', 'Treatment'], ['clinic', 'Clinics'], ['fac', 'Facilities']];
  const inCat = (kind, cat) => ROOMS[kind].cat === cat || (cat === 'diag' && ROOMS[kind].both);

  // corridor objects: one per corridor tile
  const DECOR = {
    plant:    { name: 'Plant',             cost: 5,   comfort: 1, block: true, desc: 'Happier patients and less vomiting. Needs a handyman to water it.' },
    bench:    { name: 'Bench',             cost: 40,  comfort: 2, block: true, desc: 'Seated patients stay happier while they queue.' },
    radiator: { name: 'Radiator',          cost: 20,  comfort: 0, desc: 'Heat. Too cold or too hot and people leave. Heat makes people thirsty.' },
    ext:      { name: 'Fire extinguisher', cost: 25,  comfort: 0, desc: 'VIPs look for them; a mild happiness boost.' },
    drinks:   { name: 'Drinks machine',    cost: 500, comfort: 1, block: true, sells: true, desc: 'Sells cans for $20 and cures thirst. More drinks, more toilet trips.' },
  };
  const DECOR_ORDER = ['plant', 'bench', 'radiator', 'ext', 'drinks'];
  const DESK_COST = 150;
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
  const MP_RESEARCH = 2.5;   // the two-player duel lasts only 24 months, so its research runs faster than the campaign's
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

  // ============================ the grid ============================
  const idx = (x, y) => y * W + x;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const indoor = (x, y) => x >= 2 && y >= 0 && x < W && y < H;
  const outPath = (x, y) => x >= 0 && x < 2 && y >= 4 && y <= 6;
  const inLobby = (x, y) => x >= LOBBY.x0 && x <= LOBBY.x1 && y >= LOBBY.y0 && y <= LOBBY.y1;
  const tileOf = v => Math.floor(v / T);
  const center = (tx, ty) => [tx * T + 8, ty * T + 8];
  const inRect = (rc, x, y) => x >= rc.x && y >= rc.y && x < rc.x + rc.w && y < rc.y + rc.h;
  const WALLED = new Set(['furnish', 'built', 'emptying', 'wreck']);
  const AVOID = new Set(['door', 'win', 'wait']);
  const walled = r => WALLED.has(r.phase);
  const isBuilt = r => r.phase === 'built';
  const exitTile = () => [0, 5];
  // the door's tiles inside the room (three for a swing door)
  function doorTiles(r) {
    if (!r.door) return [];
    const { x, y, d } = r.door;
    if (!ROOMS[r.k].swing) return [[x, y]];
    const a = d % 2 === 0 ? [1, 0] : [0, 1];
    return [[x - a[0], y - a[1]], [x, y], [x + a[0], y + a[1]]];
  }
  const doorOut = r => doorTiles(r).map(([x, y]) => [x + DIRS[r.door.d][0], y + DIRS[r.door.d][1]]);
  const edgeKey = (i, j) => (i < j ? i + ',' + j : j + ',' + i);
  // the derived layout of a hospital: which room owns each tile, what blocks, door edges. Cached per layout version.
  function layout(h) {
    if (h._L && h._L.lv === h.lv) return h._L;
    const N = W * H, room = new Int32Array(N), bp = new Int32Array(N), block = new Uint8Array(N), avoid = new Uint8Array(N), near = new Uint8Array(N), doors = new Set();
    for (const key in h.rooms) {
      const r = h.rooms[key], rc = r.rect;
      for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) {
        const i = idx(x, y);
        bp[i] = r.id;
        if (walled(r)) room[i] = r.id;
        if (AVOID.has(r.phase)) avoid[i] = 1;
        if (r.phase === 'wreck') block[i] = 1;
      }
      if (AVOID.has(r.phase)) for (let y = rc.y - 1; y <= rc.y + rc.h; y++) for (let x = rc.x - 1; x <= rc.x + rc.w; x++) if (inMap(x, y) && !inLobby(x, y)) near[idx(x, y)] = 1;
      if (walled(r)) {
        for (const [x, y] of doorTiles(r)) { const [dx, dy] = DIRS[r.door.d]; doors.add(edgeKey(idx(x, y), idx(x + dx, y + dy))); }
        for (const ob of r.objs) if (OBJ[ob.o].block) for (const [x, y] of objTiles(ob.o, ob.x, ob.y, ob.r).foot) block[idx(x, y)] = 1;
      }
    }
    for (const k in h.decor) if (DECOR[h.decor[k]].block) { const [c, r] = k.split(',').map(Number); block[idx(c, r)] = 1; }
    if (h.desk) for (const [x, y] of DESK_TILES) block[idx(x, y)] = 1;
    const L = { lv: h.lv, room, bp, block, avoid, near, doors };
    Object.defineProperty(h, '_L', { value: L, writable: true, configurable: true, enumerable: false });
    return L;
  }
  const walkable = (x, y) => indoor(x, y) || outPath(x, y);
  function edgeOpen(L, x, y, nx, ny) {
    if (!walkable(nx, ny) || !walkable(x, y)) return false;
    const a = L.room[idx(x, y)], b = L.room[idx(nx, ny)];
    return a === b || L.doors.has(edgeKey(idx(x, y), idx(nx, ny)));
  }
  const roomAtTile = (h, x, y) => (inMap(x, y) ? layout(h).room[idx(x, y)] : 0);
  // breadth-first search from tile (sx, sy) to (gx, gy). Blocked tiles can be the start or the goal; blueprint
  // sites are avoided unless you start inside one. Unreachable goal: the path to the nearest reachable tile.
  function findPath(h, sx, sy, gx, gy) {
    const L = layout(h), N = W * H;
    if (!walkable(sx, sy)) { sx = clamp(sx, 0, W - 1); sy = clamp(sy, 4, 6); if (sx < 2) sx = 0; }
    const s = idx(sx, sy), g = inMap(gx, gy) ? idx(gx, gy) : -1;
    const prev = new Int32Array(N).fill(-1), q = new Int32Array(N);
    const startAvoid = L.avoid[s];
    let head = 0, tail = 0, best = s, bd = Math.abs(sx - gx) + Math.abs(sy - gy);
    q[tail++] = s; prev[s] = s;
    while (head < tail) {
      const i = q[head++]; if (i === g) { best = g; break; }
      const x = i % W, y = (i / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (!inMap(nx, ny)) continue;
        const j = idx(nx, ny);
        if (prev[j] !== -1 || !edgeOpen(L, x, y, nx, ny)) continue;
        if (L.block[j] && j !== g) continue;
        if (L.avoid[j] && !startAvoid && j !== g) continue;
        prev[j] = i; q[tail++] = j;
        const dd = Math.abs(nx - gx) + Math.abs(ny - gy); if (dd < bd) { bd = dd; best = j; }
      }
    }
    const out = [];
    for (let i = best; i !== s; i = prev[i]) out.push([i % W, (i / W) | 0]);
    out.reverse();
    return { tiles: out, reached: best === g };
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
  // a walking path to the world point (gx, gy): tile to tile through doors, then the exact spot
  function route(h, e, gx, gy) {
    let sx = tileOf(e.x), sy = tileOf(e.y);
    const p = [];
    if (e.x < 0) { p.push([8, clamp(e.y, 72, 104)]); sx = 0; sy = clamp(tileOf(e.y), 4, 6); }
    const out = gx < 0;
    const [tx, ty] = out ? exitTile() : [tileOf(gx), tileOf(gy)];
    const res = findPath(h, sx, sy, tx, ty);
    const tiles = res.tiles;
    // straight runs collapse to their corners
    for (let i = 0; i < tiles.length; i++) {
      const [x, y] = tiles[i], nx = tiles[i + 1];
      if (i > 0 && nx && i < tiles.length - 1) { const [px2, py2] = tiles[i - 1]; if ((px2 === x && nx[0] === x) || (py2 === y && nx[1] === y)) continue; }
      p.push(center(x, y));
    }
    if (out) p.push([gx, gy + (rnd() - 0.5) * 6]);
    else if (res.reached) p.push([gx, gy]);
    if (!p.length) p.push([gx, gy]);
    e.path = p;
  }
  // after the layout changes (walls, furniture, corridor objects) everyone works out their way again
  function rerouteAll(h) {
    for (const list of [h.pats, h.staff, h.vis, h.rats]) for (const e of list) if (e.path.length) { const g = e.path[e.path.length - 1]; route(h, e, g[0], g[1]); }
  }
  function changed(h) { h.lv = (h.lv || 0) + 1; for (const k in h.rooms) computeQueue(h, h.rooms[k]); rerouteAll(h); }

  // ============================ objects in rooms ============================
  // tiles an object covers at tile (x, y) with rotation rot (0: front faces south, 1 west, 2 north, 3 east)
  function objDims(o, rot) { const B = OBJ[o]; return rot % 2 ? [B.fd, B.fw] : [B.fw, B.fd]; }
  function rotTile(o, rot, cx, cy) {
    const B = OBJ[o];
    switch (rot & 3) {
      case 1: return [B.fd - 1 - cy, cx];
      case 2: return [B.fw - 1 - cx, B.fd - 1 - cy];
      case 3: return [cy, B.fw - 1 - cx];
      default: return [cx, cy];
    }
  }
  function objTiles(o, x, y, rot) {
    const B = OBJ[o], foot = [];
    for (let cy = 0; cy < B.fd; cy++) for (let cx = 0; cx < B.fw; cx++) { const [a, b] = rotTile(o, rot, cx, cy); foot.push([x + a, y + b]); }
    let use = null;
    if (B.use === 'front') { const [a, b] = rotTile(o, rot, 0, B.fd); use = [x + a, y + b]; }
    else if (B.use === 'self') use = foot[0];
    const back = [];
    for (let cx = 0; cx < B.fw; cx++) { const [a, b] = rotTile(o, rot, cx, 0); back.push([x + a, y + b]); }
    return { foot, use, back, bdir: rot & 3, fdir: (2 + rot) & 3 };
  }
  // is this edge of the room a wall (rather than open floor of the same room)?
  const perimeter = (rc, x, y, d) => inRect(rc, x, y) && !inRect(rc, x + DIRS[d][0], y + DIRS[d][1]);
  const isDoorEdge = (r, x, y, d) => !!r.door && d === r.door.d && doorTiles(r).some(([a, b]) => a === x && b === y);
  function occupancy(r, ignore) {
    const foot = new Set(), use = new Set(), side = new Set(), blk = new Set();
    for (const ob of r.objs) {
      if (ob.id === ignore) continue;
      const t = objTiles(ob.o, ob.x, ob.y, ob.r), B = OBJ[ob.o];
      if (B.side) { side.add(t.foot[0].join(',') + ':' + t.bdir); continue; }
      for (const f of t.foot) { foot.add(f.join(',')); if (B.block) blk.add(f.join(',')); }
      if (t.use && B.use === 'front') use.add(t.use.join(','));
    }
    return { foot, use, side, blk };
  }
  // can object o go at (x, y, rot) in room r? Returns per-tile results for the preview.
  // The view looks at the hospital from the south-west, so every room's south and west walls are the two nearest the
  // camera. Nothing bigger than a tile goes against them, nothing backs onto them: it would hide the room (and a
  // large piece straddling two wall sections would be drawn across the wall).
  const NEAR_SIDES = new Set([2, 3]);
  const FRONT_WHY = 'Keep that away from the two front walls: it would block the view into the room';
  function objCheck(h, r, o, x, y, rot, ignore) {
    const B = OBJ[o], rc = r.rect, t = objTiles(o, x, y, rot), occ = occupancy(r, ignore);
    const dt = new Set(doorTiles(r).map(a => a.join(',')));
    let ok = true, why = '';
    const tiles = [];
    if (B.side) {
      const [fx, fy] = t.foot[0];
      const good = inRect(rc, fx, fy) && perimeter(rc, fx, fy, t.bdir) && !isDoorEdge(r, fx, fy, t.bdir) && !occ.side.has(fx + ',' + fy + ':' + t.bdir) && !occ.foot.has(fx + ',' + fy) && !NEAR_SIDES.has(t.bdir);
      tiles.push([fx, fy, good]);
      if (!good) { ok = false; why = NEAR_SIDES.has(t.bdir) ? FRONT_WHY : 'It has to go against a wall'; }
      return { ok, why, tiles, use: null };
    }
    for (const [fx, fy] of t.foot) {
      const k = fx + ',' + fy;
      const good = inRect(rc, fx, fy) && !occ.foot.has(k) && !occ.use.has(k) && !dt.has(k);
      tiles.push([fx, fy, good]); if (!good) { ok = false; why = why || 'Not enough free floor there'; }
    }
    if (ok && B.back) for (const [bx, by] of t.back) if (!perimeter(rc, bx, by, t.bdir) || isDoorEdge(r, bx, by, t.bdir)) { ok = false; why = 'It has to back onto a wall'; }
    if (ok && (B.back && NEAR_SIDES.has(t.bdir) || B.fw * B.fd > 1 && t.foot.some(([fx, fy]) => fx === rc.x || fy === rc.y + rc.h - 1))) {
      ok = false; why = FRONT_WHY; for (const tl of tiles) if (tl[0] === rc.x || tl[1] === rc.y + rc.h - 1) tl[2] = false;
    }
    let use = null;
    if (t.use && B.use === 'front') {
      const [ux, uy] = t.use, k = ux + ',' + uy;
      const good = inRect(rc, ux, uy) && !occ.foot.has(k);
      use = [ux, uy, good]; if (!good) { ok = false; why = why || 'Nobody could reach it'; }
    }
    // nothing may cut anyone off from the door or from another object's use tile
    if (ok) {
      const blocked = new Set(occ.blk); if (B.block) for (const f of t.foot) blocked.add(f.join(','));
      const need = [];
      for (const ob of r.objs) { if (ob.id === ignore || OBJ[ob.o].side) continue; const tt = objTiles(ob.o, ob.x, ob.y, ob.r); if (tt.use) need.push(tt.use.join(',')); }
      if (t.use) need.push(t.use.join(','));
      const seen = new Set(), q = [];
      for (const d of dt) if (!blocked.has(d)) { seen.add(d); q.push(d); }
      while (q.length) {
        const [cx, cy] = q.pop().split(',').map(Number);
        for (const [dx, dy] of DIRS) { const nx = cx + dx, ny = cy + dy, k = nx + ',' + ny; if (!inRect(rc, nx, ny) || seen.has(k) || blocked.has(k)) continue; seen.add(k); q.push(k); }
      }
      if (need.some(k => !seen.has(k))) { ok = false; why = 'That would cut something off from the door'; }
    }
    return { ok, why, tiles, use };
  }
  // the hospital has to have researched this object before it can be bought
  const objAvailable = (h, o) => !OBJ[o].needs || hasUpgrade(h, OBJ[o].needs);
  // put every object waiting in the list somewhere sensible ("place for me")
  function autoFurnish(h, r) {
    const order = r.list.map((o, i) => i).sort((a, b) => (OBJ[r.list[b]].fw * OBJ[r.list[b]].fd) - (OBJ[r.list[a]].fw * OBJ[r.list[a]].fd));
    const placed = [];
    for (const li of order) {
      const o = r.list[li]; let done = false;
      const rc = r.rect, cands = [];
      for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) for (let rot = 0; rot < 4; rot++) cands.push([x, y, rot]);
      // walls first for things that back onto walls; otherwise prefer the far side from the door
      const [dx0, dy0] = r.door ? [r.door.x, r.door.y] : [rc.x, rc.y];
      cands.sort((a, b) => (Math.abs(b[0] - dx0) + Math.abs(b[1] - dy0)) - (Math.abs(a[0] - dx0) + Math.abs(a[1] - dy0)));
      for (const [x, y, rot] of cands) {
        if (!objCheck(h, r, o, x, y, rot).ok) continue;
        r.objs.push({ id: h._oid = (h._oid || 0) + 1, o, x, y, r: rot, w: 1 }); placed.push(li); done = true; break;
      }
      if (!done) continue;
    }
    placed.sort((a, b) => b - a).forEach(li => r.list.splice(li, 1));
    return placed.length;
  }

  // ============================ building checks ============================
  // corridor tiles reachable from the entrance, with the tiles in `extra` treated as walled off
  function corridorReach(h, extra) {
    const L = layout(h), seen = new Uint8Array(W * H), q = [];
    const ok = (x, y) => walkable(x, y) && !L.room[idx(x, y)] && !L.block[idx(x, y)] && !(L.bp[idx(x, y)] && !extra.self.has(L.bp[idx(x, y)])) && !extra.tiles.has(idx(x, y));
    const [ex, ey] = exitTile(); seen[idx(ex, ey)] = 1; q.push(idx(ex, ey));
    while (q.length) {
      const i = q.pop(), x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (!inMap(nx, ny)) continue; const j = idx(nx, ny); if (seen[j] || !ok(nx, ny)) continue; seen[j] = 1; q.push(j); }
    }
    return { seen, ok };
  }
  function rectTiles(rc) { const t = new Set(); for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) if (inMap(x, y)) t.add(idx(x, y)); return t; }
  // would walling off these tiles cut off any part of the hospital?
  function cutsOff(h, tiles, selfId) {
    const before = corridorReach(h, { tiles: new Set(), self: new Set([selfId]) }), after = corridorReach(h, { tiles, self: new Set([selfId]) });
    for (let i = 0; i < W * H; i++) if (before.seen[i] && !tiles.has(i) && !after.seen[i]) return true;
    // every other room's door must stay reachable
    for (const key in h.rooms) { const r = h.rooms[key]; if (r.id === selfId || !r.door) continue; for (const [x, y] of doorOut(r)) if (inMap(x, y) && !after.seen[idx(x, y)] && before.seen[idx(x, y)]) return true; }
    return false;
  }
  // a blueprint: every tile free indoor floor, the minimum size met, and nothing cut off
  function bpCheck(h, kind, rc, selfId) {
    const L = layout(h), Rm = ROOMS[kind], tiles = [];
    let ok = true, why = '';
    for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) {
      let good = indoor(x, y) && !inLobby(x, y);
      if (good) { const i = idx(x, y); good = (!L.bp[i] || L.bp[i] === selfId) && !h.decor[decorKey(x, y)]; }
      tiles.push([x, y, good]); if (!good) { ok = false; why = 'The blueprint is on something (another room, an object or the lobby)'; }
    }
    if (rc.w < Rm.min || rc.h < Rm.min) { ok = false; why = `Too small: a ${Rm.name} needs at least ${Rm.min}×${Rm.min}`; }
    if (ok) { const set = new Set(); for (const [x, y] of tiles) set.add(idx(x, y)); if (cutsOff(h, set, selfId)) { ok = false; why = 'That would cut off part of the hospital'; } }
    return { ok, why, tiles };
  }
  // the door: on a brand-new wall, clear corridor floor on both sides, reachable from the entrance
  function doorCheck(h, r, x, y, d) {
    const rc = r.rect, L = layout(h), tiles = [];
    const along = d % 2 === 0 ? [1, 0] : [0, 1];
    const list = ROOMS[r.k].swing ? [[x - along[0], y - along[1]], [x, y], [x + along[0], y + along[1]]] : [[x, y]];
    let ok = true, why = '';
    const reach = corridorReach(h, { tiles: rectTiles(rc), self: new Set() });
    for (const [tx, ty] of list) {
      const nx = tx + DIRS[d][0], ny = ty + DIRS[d][1];
      let good = perimeter(rc, tx, ty, d) && indoor(nx, ny);
      if (good) { const j = idx(nx, ny); good = !L.bp[j] && !h.decor[decorKey(nx, ny)] && !DESK_TILES.some(([a, b]) => a === nx && b === ny) && reach.seen[j]; }
      if (good && r.objs.some(ob => objTiles(ob.o, ob.x, ob.y, ob.r).foot.some(([a, b]) => a === tx && b === ty))) good = false;
      tiles.push([tx, ty, good]);
      if (!good) { ok = false; why = 'A door needs clear corridor on the other side of a new wall'; }
    }
    return { ok, why, tiles };
  }
  function winCheck(h, r, x, y, d) {
    const L = layout(h), nx = x + DIRS[d][0], ny = y + DIRS[d][1];
    if (!perimeter(r.rect, x, y, d) || isDoorEdge(r, x, y, d)) return false;
    return indoor(nx, ny) && !L.bp[idx(nx, ny)];
  }
  function decorCheck(h, c, r, kind) {
    const L = layout(h);
    if (!indoor(c, r) || inLobby(c, r) || L.bp[idx(c, r)] || h.decor[decorKey(c, r)] || L.block[idx(c, r)]) return false;
    for (const key in h.rooms) { const rm = h.rooms[key]; if (rm.door && doorOut(rm).some(([a, b]) => a === c && b === r)) return false; }
    if (DECOR[kind] && DECOR[kind].block && cutsOff(h, new Set([idx(c, r)]), -1)) return false;
    return true;
  }

  // ============================ room spots ============================
  // where the patient, the staff and anyone resting stand, worked out from the furniture
  function computeSpots(h, r) {
    const Rm = ROOMS[r.k], sp = { p: null, s: [], seats: [], sh: [], seatRest: [] };
    const useOf = ob => { const t = objTiles(ob.o, ob.x, ob.y, ob.r); return t.use ? center(t.use[0], t.use[1]) : center(t.foot[0][0], t.foot[0][1]); };
    const pObj = r.objs.find(ob => ob.o === Rm.p);
    if (pObj) sp.p = useOf(pObj);
    const used = new Set();
    for (const o of Rm.s || []) { const ob = r.objs.find(x => x.o === o && !used.has(x.id)); if (ob) { used.add(ob.id); sp.s.push(useOf(ob)); } }
    if (r.k === 'research') for (const ob of r.objs) if ((ob.o === 'desk' || ob.o === 'computer')) sp.s.push(useOf(ob));
    if (r.k === 'training') { const pr = r.objs.find(x => x.o === 'proj'); sp.s = pr ? [useOf(pr)] : []; for (const ob of r.objs) if (ob.o === 'lchair') sp.seats.push(useOf(ob)); }
    if (r.k === 'staff') for (const ob of r.objs) if (OBJ[ob.o].who === 'rest') { sp.seats.push(useOf(ob)); sp.seatRest.push(OBJ[ob.o].rest); }
    if (r.k === 'toilet') for (const ob of r.objs) if (ob.o === 'toilet') sp.seats.push(useOf(ob));
    // no staff object: stand on a free tile beside the patient
    const p0 = sp.p || center(r.rect.x + (r.rect.w >> 1), r.rect.y + (r.rect.h >> 1));
    if (!sp.p) sp.p = p0;
    const need = Math.max(Rm.need || (Rm.staff ? 1 : 0), 0);
    if (sp.s.length < need && Rm.cat !== 'fac') {
      const occ = occupancy(r), px0 = tileOf(p0[0]), py0 = tileOf(p0[1]);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = px0 + dx, y = py0 + dy;
        if (sp.s.length >= need) break;
        if (inRect(r.rect, x, y) && !occ.foot.has(x + ',' + y)) sp.s.push(center(x, y));
      }
    }
    while (sp.s.length < need) sp.s.push([p0[0] - 6, p0[1]]);
    // daily happiness for staff at each spot: windows, extra space, objects within two tiles
    const area = r.rect.w * r.rect.h, minA = Rm.min * Rm.min;
    const base = Math.round(Math.log(Math.max(1, r.wins.length))) / 1000 * (r.k === 'staff' ? 2 : 1) + Math.round(Math.log(area / minA)) / 1000;
    const near = (x, y) => {
      let v = base;
      for (const ob of r.objs) {
        const t = objTiles(ob.o, ob.x, ob.y, ob.r);
        if (!t.foot.some(([a, b]) => Math.max(Math.abs(a - tileOf(x)), Math.abs(b - tileOf(y))) <= 2)) continue;
        v += ob.o === 'ext' ? 0.002 : ob.o === 'bookcase' ? 0.003 : ob.o === 'skeleton' ? 0.002 : ob.o === 'bin' ? 0.001 : ob.o === 'tv' ? 0.0005 : ob.o === 'plant' ? (ob.w > 0.35 ? 0.001 : ob.w > 0 ? -0.002 : -0.003) : 0;
      }
      return v;
    };
    sp.sh = sp.s.map(([x, y]) => near(x, y));
    sp.seatHap = sp.seats.map(([x, y]) => near(x, y));
    r.sp = sp;
  }
  // corridor tiles in front of the door where patients queue, nearest first
  function computeQueue(h, r) {
    if (!r.door || !isBuilt(r)) { r.qt = []; r.qs = []; return; }
    const L = layout(h), seen = new Set(), q = [], out = [], qs = [], benches = new Set();
    for (const [x, y] of doorOut(r)) if (inMap(x, y)) { seen.add(idx(x, y)); q.push([x, y]); }
    while (q.length && (out.length < 10 || (qs.length < 3 && seen.size < 90))) {
      const [x, y] = q.shift(); const i = idx(x, y);
      if (L.room[i] || L.avoid[i]) continue;
      if (!L.block[i] && !inLobby(x, y) && !L.near[i] && out.length < 10) out.push([x, y]);
      // benches within reach of the door: [standing tile x, y, bench x, y]
      if (!L.block[i] && qs.length < 3) for (const [dx, dy] of DIRS) { const bx = x + dx, by = y + dy, k = decorKey(bx, by); if (h.decor[k] === 'bench' && !benches.has(k)) { benches.add(k); qs.push([x, y, bx, by]); break; } }
      for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (!indoor(nx, ny)) continue; const j = idx(nx, ny); if (seen.has(j) || L.room[j] || L.block[j]) continue; seen.add(j); q.push([nx, ny]); }
    }
    r.qt = out.length ? out : doorOut(r);
    r.qs = qs;
  }
  const roomCenter = r => [(r.rect.x + r.rect.w / 2) * T, (r.rect.y + r.rect.h / 2) * T];
  const doorPoint = r => { const [x, y] = doorOut(r)[ROOMS[r.k].swing ? 1 : 0]; return center(x, y); };

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
    const pool = [], n = s.solo ? { d: 8, n: 8, h: 3, r: 2 } : { d: 5, n: 3, h: 2, r: 2 };
    for (let i = 0; i < n.d; i++) pool.push(newCand(s, 'd'));
    if (s.solo && s.solo.lvl < LVL_FROM.research) for (const c of pool) if (c.sk >= 0.8) { c.sk = r2(0.3 + rnd() * 0.45); c.sal = Math.round(fairWage(c) * (1 + rnd() * 0.25)); }
    if (first) { pool[0].q.r = QUAL_PTS.r; pool[1].q.p = QUAL_PTS.p; pool[1].sk = Math.max(pool[1].sk, 0.3); for (const c of pool) c.sal = Math.round(fairWage(c) * 1.1); }
    for (let i = 0; i < n.n; i++) pool.push(newCand(s, 'n'));
    for (let i = 0; i < n.h; i++) pool.push(newCand(s, 'h'));
    for (let i = 0; i < n.r; i++) pool.push(newCand(s, 'r'));
    return pool;
  }

  // ---------- state ----------
  function newHospital(s) {
    const eff = DISEASES.map((d, i) => (d.grp === 'pharm' ? r2(0.6 + ((i * 37) % 17) / 100) : 1));
    return {
      cash: START_CASH, loan: 0, rep: START_REP, cured: 0, died: 0, angry: 0, home: 0, seen: 0, visits: 0, open: false, lv: 1,
      rooms: {}, staff: [], pats: [], vis: [], rats: [], acc: 0.4 + rnd() * 0.4, decor: {}, water: {}, mess: [], comfort: 0, drinks: 0, desk: false, rads: 0,
      pol: { home: 40, guess: 80, term: 100, rest: 60, leave: true, heat: 3 },
      price: DISEASES.map(() => 100), dprice: 100,
      res: { alloc: { cure: 20, diag: 20, drug: 20, imp: 20, spec: 20 }, pts: { cure: 0, diag: 0, drug: 0, imp: 0, spec: 0 }, done: { cure: 0, diag: 0, imp: 0 }, spec: -1, eff, disc: 0 },
      known: DISEASES.map(() => 0), cb: DISEASES.map(() => [0, 0, 0]),   // cured, died, earned
      fin: { cur: {}, last: {} }, owed: 0, fax: [], vipNo: 0, vipScore: -1, booms: 0, messMade: 0, warm: 0, boiler: 0,
      epi: null, awards: [], monthDeaths: 0, built: {},
    };
  }
  // lvl (1–12) starts a single-player campaign level: one hospital (h[0]) against three statistical rivals
  function newState(lvl) {
    const s = { v: VERSION, ph: 'ready', t: 0, month: 0, nextId: 1, ev: [], h: null, winner: -1, why: '', prof: [{ nm: '', av: 0 }, { nm: '', av: 1 }], quake: null };
    s.h = [newHospital(s), newHospital(s)];
    if (lvl) setupSolo(s, clamp(lvl | 0, 1, LEVELS.length));
    s.pool = newPool(s, true);
    return s;
  }
  function start(s) {
    if (s.ph === 'play') return;
    const prof = s.prof, names = s.solo && s.solo.rivals.map(r => r.nm);   // keep the rivals the briefing named
    const carry = s.solo && s.solo.carry;
    Object.assign(s, newState(s.solo ? s.solo.lvl : 0));
    if (prof) s.prof = prof;
    if (names) s.solo.rivals.forEach((r, i) => { r.nm = names[i]; });
    if (carry) carryOver(s, carry);
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
  const disc = h => 1 - (h.res ? h.res.disc : 0);
  const objCost = (h, o) => Math.round(OBJ[o].cost * (OBJ[o].str ? disc(h) : 1));
  const roomCost = (h, kind) => ROOMS[kind].shell + ROOMS[kind].req.reduce((a, o) => a + objCost(h, o), 0);
  const shellCost = (h, kind) => ROOMS[kind].shell;
  // what the hospital is worth: paid rooms and their furniture, corridor objects, the desk
  function value(h) {
    let v = (h.desk ? DESK_COST : 0) + (h.land || 0);
    for (const k in h.rooms) {
      const r = h.rooms[k]; if (r.phase === 'wreck') continue;
      if (r.paid) v += ROOMS[r.k].shell;
      for (const ob of r.objs) v += OBJ[ob.o].cost;
      for (const o of r.list) v += OBJ[o].cost;
    }
    for (const k in h.decor) v += DECOR[h.decor[k]].cost;
    return v;
  }
  function progress(h) {
    const tg = h.tg || TARGETS, now = { rep: h.rep, cash: h.cash, pct: curePct(h), cured: h.cured, value: value(h) }, out = {};
    for (const k in now) if (tg[k] != null) out[k] = now[k] / tg[k];
    return out;
  }
  const metTargets = h => Object.values(progress(h)).every(v => v >= 1);
  function score(h) { const p = progress(h); let s = 0, n = 0; for (const k in p) { s += clamp(p[k], 0, 1); n++; } return Math.round(s / (n || 1) * 1000); }
  function lost(h) { return h.cash < LOSE.cash ? 'cash' : h.rep < LOSE.rep ? 'rep' : ''; }
  const unlocked = (h, kind) => !(h.ban && h.ban.includes(kind)) && (START_ROOMS.has(kind) || RESEARCH.cure.list.indexOf(kind) >= 0 && RESEARCH.cure.list.indexOf(kind) < h.res.done.cure || RESEARCH.diag.list.indexOf(kind) >= 0 && RESEARCH.diag.list.indexOf(kind) < h.res.done.diag);
  const hasUpgrade = (h, u) => RESEARCH.diag.list.indexOf(u) < h.res.done.diag;
  const machStr = (h, kind) => (ROOMS[kind].mach || 0) + h.res.done.imp + ((h.specStr && h.specStr[kind]) || 0);
  const priceFactor = h => { const r = h.rep; return r <= 500 ? 0.5 + r / 1000 : 1 + (r - 500) / 500; };
  function cureFee(h, i) { const cb = h.cb[i], tot = cb[0] + cb[1]; const rec = tot >= 3 ? 0.9 + 0.2 * cb[0] / tot : 1; return Math.round(DISEASES[i].fee * priceFactor(h) * rec * h.price[i] / 100); }
  const diagFee = (h, kind) => Math.round((ROOMS[kind].fee || 0) * priceFactor(h) * h.dprice / 100);
  function avgPrice(h) { let t = 0, n = 0; DISEASES.forEach((d, i) => { if (h.known[i]) { t += h.price[i]; n++; } }); return ((n ? t / n : 100) + h.dprice) / 2; }
  const roomList = h => Object.keys(h.rooms).map(k => h.rooms[k]);
  const roomsOf = (h, kind) => roomList(h).filter(r => r.k === kind && isBuilt(r));
  const anyRoom = (h, kind) => roomList(h).some(r => r.k === kind && isBuilt(r));
  const countObj = (r, o) => r.objs.reduce((a, ob) => a + (ob.o === o ? 1 : 0), 0);
  const hasObj = (r, o) => r.objs.some(ob => ob.o === o);

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
  // how many staff a room takes: two surgeons, one researcher per desk or computer, otherwise one
  function capacity(r) {
    if (!ROOMS[r.k].staff) return 0;
    if (r.k === 'op') return 2;
    if (r.k === 'research') return Math.max(1, countObj(r, 'desk') + countObj(r, 'computer'));
    return 1;
  }
  const seatsOf = r => (r.sp ? r.sp.seats.length : 0);
  const ready = r => isBuilt(r);
  const free = st => !st.gone && st.slot == null && !st.desk && st.mode === 'idle' && !st.train;
  // idle staff and waiting patients gather in the lobby by the entrance
  const LOBBY_TILES = [];
  const LAND_VALUE = (W - 2) * H * 25 + 20000;
  for (let y = LOBBY.y0; y <= LOBBY.y1; y++) for (let x = LOBBY.x0; x <= LOBBY.x1; x++) if (!DESK_TILES.some(([a, b]) => a === x && b === y) && !(x <= 3 && y >= 4 && y <= 6) && !(x === 5 && y >= 5 && y <= 6)) LOBBY_TILES.push([x, y]);
  const idlePos = i => { const [x, y] = LOBBY_TILES[(i * 5) % LOBBY_TILES.length]; return [x * T + 4 + (i % 3) * 4, y * T + 6 + ((i >> 1) % 2) * 4]; };
  const waitPos = i => { const [x, y] = LOBBY_TILES[(i * 3 + 7) % LOBBY_TILES.length]; return [x * T + 5 + (i % 2) * 6, y * T + 9]; };
  function assign(h) {
    for (const st of h.staff) if (st.slot != null && (!h.rooms[st.slot] || !isBuilt(h.rooms[st.slot]) || !h.rooms[st.slot].sts.includes(st.id))) st.slot = null;
    for (const key in h.rooms) { const r = h.rooms[key]; r.sts = isBuilt(r) ? r.sts.filter(id => { const st = staffById(h, id); return st && !st.gone && st.slot === r.id; }) : []; }
    if (h.desk && !h.staff.some(x => x.desk && !x.gone)) {
      const c = h.staff.find(x => x.k === 'r' && free(x));
      if (c) { c.desk = true; route(h, c, DESK_STAFF[0], DESK_STAFF[1]); }
    }
    const rooms = roomList(h).filter(isBuilt).sort((a, b) => a.id - b.id);
    // specialist rooms (psychiatry, theatre, research, training…) take their specialists back from ordinary rooms
    for (const r of rooms) {
      if (ROOMS[r.k].staff === 'doc' || !ROOMS[r.k].staff || r.sts.length >= capacity(r)) continue;
      if (h.staff.some(x => free(x) && eligible(x, r.k))) continue;
      const st = h.staff.find(x => !x.gone && x.slot != null && x.slot !== r.id && h.rooms[x.slot] && ROOMS[h.rooms[x.slot].k].staff === 'doc' && eligible(x, r.k) && h.rooms[x.slot].p == null && !x.pin);
      if (st) { unslot(h, st); st.idle = -1; }
    }
    const special = r => (ROOMS[r.k].staff === 'doc' ? 1 : 0);
    for (const r of rooms.slice().sort((a, b) => special(a) - special(b) || a.id - b.id)) {
      while (r.sts.length < capacity(r)) {
        const qn = st => (hasQ(st, 'r') ? 1 : 0) + (hasQ(st, 'p') ? 1 : 0) + (hasQ(st, 's') ? 1 : 0) + (isCon(st) ? 1 : 0);
        const sp = ROOMS[r.k].staff !== 'doc';
        const cand = h.staff.filter(x => free(x) && eligible(x, r.k)).sort((a, b) => (sp ? 0 : qn(a) - qn(b)) || b.sk - a.sk)[0];
        if (!cand) break;
        placeIn(h, cand, r);
      }
    }
    let i = 0;
    for (const st of h.staff) {
      if (st.gone || st.slot != null || st.desk || st.k === 'h' || st.mode !== 'idle') continue;
      const [ix, iy] = idlePos(i++);
      if (st.idle !== i && (Math.abs(st.x - ix) > 1 || Math.abs(st.y - iy) > 1)) { route(h, st, ix, iy); st.idle = i; }
    }
  }
  function placeIn(h, st, r) {
    r.sts.push(st.id); st.slot = r.id; st.idle = -1;
    const sp = r.sp && r.sp.s[r.sts.length - 1] || roomCenter(r);
    route(h, st, sp[0], sp[1]);
  }
  function unslot(h, st) {
    if (st.slot != null && h.rooms[st.slot]) { const r = h.rooms[st.slot]; r.sts = r.sts.filter(id => id !== st.id); }
    st.slot = null;
  }
  function roomStaffReady(h, r) {
    const need = ROOMS[r.k].need || 1;
    let n = 0, sk = 0, crazy = false;
    for (const id of r.sts) { const st = staffById(h, id); if (st && st.slot === r.id && !st.path.length && !st.gone) { n++; sk += st.sk; if (st.tired >= 0.95) crazy = true; } }
    return n >= need ? { sk: sk / n, crazy } : null;
  }

  // ---------- patients ----------
  function pickDisease(s) {
    const pool = DISEASES.filter(d => d.from <= s.month && d.w > 0 && (d.room !== 'op' || lvlOK(s, 'op')) && (d.room !== 'dna' || lvlOK(s, 'dna')));
    let tot = 0; for (const d of pool) tot += d.w;
    let r = rnd() * tot;
    for (const d of pool) { r -= d.w; if (r <= 0) return DIS_IDX[d.id]; }
    return DIS_IDX[pool[pool.length - 1].id];
  }
  function newPatient(s, h, dis) {
    return { id: s.nextId++, nm: pick(FIRST), dis, dx: false, dg: 0, been: [], x: EXIT[0], y: EXIT[1] + (rnd() - 0.5) * 6, path: [], st: 'enter', slot: null, t: 0,
      pat: 120 + rnd() * 60, hp: 1, th: rnd() * 0.3, bl: rnd() * 0.3, f: 3, mv: 0, look: Math.floor(rnd() * 8), ins: rnd() < 0.4, em: 0, inf: 0, vax: 0, mk: 0, prep: 0, gp2: 0 };
  }
  function spawnPatient(s, p) {
    const h = s.h[p], pt = newPatient(s, h, pickDisease(s));
    route(h, pt, RECEP[0] + (rnd() - 0.5) * 8, RECEP[1] + (rnd() - 0.5) * 6);
    h.pats.push(pt); h.visits++;
  }
  function queuePos(h, r, i) {
    // after whoever is next in line, the queue sits down on benches near the door, two to a bench (standing on the
    // tile beside the bench; the view seats them on it), then the rest stand
    const qs = r.qs || [];
    if (i >= 1 && i - 1 < qs.length * 2) { const k = i - 1, b = qs[Math.floor(k / 2)]; return [b[0] * T + 8 + (k % 2 ? 3 : -3), b[1] * T + 8 + Math.sign(b[3] - b[1]) * 4]; }
    if (i >= 1) i -= qs.length * 2;
    const qt = r.qt && r.qt.length ? r.qt : r.door ? doorOut(r) : [[tileOf(roomCenter(r)[0]), tileOf(roomCenter(r)[1])]];
    const [x, y] = qt[Math.min(Math.floor(i / 2), qt.length - 1)];
    const j = i % 2 ? 4 : -4, over = Math.max(0, Math.floor(i / 2) - qt.length + 1);
    return [x * T + 8 + j, y * T + 8 + (i % 2 ? 3 : -3) + Math.min(5, over)];
  }
  function reQueue(h, r) {
    if (!r) return;
    let i = 0;
    for (const id of r.q) {
      const pt = patById(h, id); if (!pt || pt.st !== 'queue') { if (pt) i++; continue; }
      const [x, y] = queuePos(h, r, i++);
      const last = pt.path[pt.path.length - 1];
      if (last && Math.abs(last[0] - x) < 0.5 && Math.abs(last[1] - y) < 0.5) continue;
      if (Math.abs(pt.x - x) > 0.5 || Math.abs(pt.y - y) > 0.5) route(h, pt, x, y);
    }
  }
  function unqueue(h, pt) {
    if (pt.slot != null && h.rooms[pt.slot]) {
      const r = h.rooms[pt.slot];
      const qi = r.q.indexOf(pt.id); if (qi >= 0) { r.q.splice(qi, 1); reQueue(h, r); }
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
    route(h, pt, EXIT[0], EXIT[1]);
  }
  function kill(s, p, pt, where) {
    const h = s.h[p];
    unqueue(h, pt);
    dropFax(h, f => f.pid === pt.id);
    leaveFacility(h, pt);
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
    const h = s.h[p], cands = roomsOf(h, kind);
    if (!cands.length) return false;
    const staffed = r => (r.sts.length ? 0 : 1);
    cands.sort((a, b) => staffed(a) - staffed(b) || a.q.length - b.q.length || Math.hypot(roomCenter(a)[0] - pt.x, roomCenter(a)[1] - pt.y) - Math.hypot(roomCenter(b)[0] - pt.x, roomCenter(b)[1] - pt.y));
    const r = cands[0];
    if (pt.em) { const firstNonEm = r.q.findIndex(id => { const o = patById(h, id); return !o || !o.em; }); r.q.splice(firstNonEm < 0 ? r.q.length : firstNonEm, 0, pt.id); }
    else r.q.push(pt.id);
    pt.slot = r.id; pt.st = 'queue';
    const [qx, qy] = queuePos(h, r, r.q.indexOf(pt.id)); route(h, pt, qx, qy);
    reQueue(h, r);
    return true;
  }
  function waitHere(h, pt, secs) {
    pt.st = 'wait'; pt.t = secs; pt.slot = null;
    const n = h.pats.filter(x => x.st === 'wait').length;
    const [x, y] = waitPos(n);
    route(h, pt, x, y);
  }
  // what a patient does next after a GP visit or a fax decision
  function decide(s, p, pt) {
    const h = s.h[p], d = DISEASES[pt.dis], pol = h.pol;
    const term = Math.max(pol.guess, pol.term) / 100;
    if (pt.dg >= term || pt.em) return goCure(s, p, pt);
    const tried = new Set(pt.been);
    const next = ['gendiag', 'ward', 'psych', 'cardio', 'xray', 'blood', 'scanner', 'ultra']
      .filter(k => !tried.has(k) && ROOMS[k].det && ROOMS[k].det.includes(d.grp) && anyRoom(h, k))
      .sort((a, b) => staffedOf(h, b) - staffedOf(h, a) || bestRoom(h, a).q.length - bestRoom(h, b).q.length)[0];
    if (next && (pt.dg < pol.guess / 100 || pol.term > 100)) { queueFor(s, p, pt, next); return; }
    if (pt.dg >= pol.guess / 100) return goCure(s, p, pt);
    if (pt.dg < pol.home / 100) return sendHome(s, p, pt, 'diag');
    if (!h.fax.some(f => f.pid === pt.id)) h.fax.push({ id: s.nextId++, k: 'diag', pid: pt.id, nm: pt.nm, dg: Math.round(pt.dg * 100), t: s.t + 25, dis: pt.dis });
    waitHere(h, pt, 40);
  }
  const staffedOf = (h, kind) => roomsOf(h, kind).filter(r => r.sts.length).length;
  const bestRoom = (h, kind) => roomsOf(h, kind).sort((a, b) => a.q.length - b.q.length)[0];
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
  function finishRoom(s, p, r, info) {
    const h = s.h[p], pt = patById(h, r.p), Rm = ROOMS[r.k];
    r.p = null; r.prog = 0; r.n++;
    if (!pt) return;
    pt.slot = null;
    if (Rm.mach) { r.used++; if (r.used > r.str && rnd() < 0.18 * (r.used - r.str) * (hasObj(r, 'ext') ? 0.5 : 1)) return explode(s, p, r); }
    const d = DISEASES[pt.dis];
    if (!pt.cure) {
      if (r.k === 'gp') {
        pt.dg = clamp(pt.dg + (pt.gp2 ? 0.12 + 0.12 * info.sk : 0.35 + 0.45 * info.sk) * (info.crazy ? 0.4 : 1), 0, 1); pt.gp2 = 1;
        for (const id of r.sts) { const st = staffById(h, id); if (st && st.k === 'd') st.sk = r2(Math.min(1, st.sk + 0.003)); }
      } else {
        const hit = Rm.det && Rm.det.includes(d.grp);
        pt.dg = clamp(pt.dg + (hit ? Rm.power * (0.75 + 0.25 * info.sk) : 0.03) * (info.crazy ? 0.4 : 1), 0, 1);
        pt.been.push(r.k);
      }
      bill(s, p, pt, diagFee(h, r.k), 'Diagnosis fees');
      if (r.k !== 'gp') { queueFor(s, p, pt, 'gp') || decide(s, p, pt); return; }
      return decide(s, p, pt);
    }
    if (pt.toPrep && r.k === 'ward') { pt.toPrep = 0; pt.prep = 1; return queueFor(s, p, pt, 'op') || waitHere(h, pt, 60); }
    const eff = d.grp === 'pharm' ? h.res.eff[pt.dis] : d.grp === 'psych' ? 0.99 : d.grp === 'op' ? 0.93 : (r.used > r.str ? 0.85 : 0.97);
    const chance = (pt.em ? 1 : pt.dg) * eff * (0.85 + 0.15 * info.sk) * (info.crazy ? 0.7 : 1);
    if (rnd() < chance) {
      const fee = cureFee(h, pt.dis);
      const refuse = !pt.em && h.price[pt.dis] > 120 && rnd() < (h.price[pt.dis] - 120) / 100;
      h.cured++; h.seen++; h.cb[pt.dis][0]++;
      addRep(h, (d.grp === 'op' ? 4 : 2) + (h.price[pt.dis] < 90 ? 1 : 0));
      if (!refuse) { bill(s, p, pt, fee, pt.em ? 'Emergencies' : 'Cures'); h.cb[pt.dis][2] += fee; }
      if (pt.inf) pt.inf = 0;
      s.ev.push({ k: 'cured', p, id: pt.id, nm: pt.nm, dis: pt.dis, fee: refuse ? 0 : fee, x: pt.x, y: pt.y, refuse });
      if (pt.em && h.em) h.em.saved++;
      leave(s, p, pt, 'cured');
    } else if (d.fatal || pt.em) {
      kill(s, p, pt, r.id);
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
  // everyone inside dies, the room is out of use for good, hospital value drops by its build cost
  function explode(s, p, r) {
    const h = s.h[p];
    const pt = r.p != null ? patById(h, r.p) : null;
    evacuate(s, p, r);
    r.phase = 'wreck'; r.p = null;
    h.booms++; addRep(h, -40);
    s.ev.push({ k: 'boom', p, room: r.id, kind: r.k, x: roomCenter(r)[0], y: roomCenter(r)[1] });
    for (const st of h.staff.slice()) if (tileIn(r, st)) { st.gone = true; st.dead = true; unslot(h, st); h.staff.splice(h.staff.indexOf(st), 1); }
    r.sts = [];
    if (pt && h.pats.includes(pt)) kill(s, p, pt, r.id);
    for (const o of h.pats.slice()) if (tileIn(r, o) && o.st !== 'leave') kill(s, p, o, r.id);
    changed(h); assign(h);
  }
  const tileIn = (r, e) => inRect(r.rect, tileOf(e.x), tileOf(e.y));
  // send everyone queuing for or using a room somewhere else
  function evacuate(s, p, r) {
    const h = s.h[p];
    const ids = r.q.slice(); if (r.p != null) ids.push(r.p);
    r.q = []; r.p = null; r.prog = 0;
    for (const id of ids) {
      const pt = patById(h, id); if (!pt) continue;
      pt.slot = null;
      if (pt.st === 'in' || pt.st === 'queue') { pt.st = 'recep'; pt.t = 0.2; route(h, pt, RECEP[0] + (rnd() - 0.5) * 10, RECEP[1]); }
    }
    for (const id of (r.users || []).slice()) { const e = staffById(h, id) || patById(h, id); if (e) { leaveFacility(h, e); if (e.mode === 'rest' || e.mode === 'train') e.mode = 'idle'; if (e.st === 'wc') { e.st = 'recep'; e.t = 0.2; } } }
    r.users = [];
    for (const st of h.staff) if (st.slot === r.id) unslot(h, st);
    r.sts = [];
  }

  // ---------- events: epidemics, emergencies, VIPs ----------
  function maybeEpidemic(s, p, pt) {
    const h = s.h[p], d = DISEASES[pt.dis];
    if (s.month < 10 || h.epi || !hasTag(d, 'cont') || !lvlOK(s, 'epi') || rnd() > 0.12) return;
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
  // a random corridor tile to stroll to
  function corridorSpot(h) {
    const L = layout(h);
    for (let tries = 0; tries < 40; tries++) {
      const x = 2 + Math.floor(rnd() * (W - 2)), y = Math.floor(rnd() * H), i = idx(x, y);
      if (!L.room[i] && !L.block[i] && !L.avoid[i] && !L.bp[i] && !L.near[i]) return [x * T + 4 + rnd() * 8, y * T + 4 + rnd() * 8];
    }
    return [RECEP[0], RECEP[1] + 24];
  }
  function vipOffer(s, p) { const h = s.h[p]; h.fax.push({ id: s.nextId++, k: 'vip', who: pick(VIPS), t: s.t + 30 }); }
  function startVip(s, p, who) {
    const h = s.h[p];
    const v = { id: s.nextId++, k: 'vip', who, x: EXIT[0], y: EXIT[1], path: [], f: 3, mv: 0, t: 0, legs: 0 };
    const [x, y] = corridorSpot(h); route(h, v, x, y);
    h.vis.push(v);
    s.ev.push({ k: 'vipIn', p, who });
  }
  function judgeVip(s, p, v) {
    const h = s.h[p];
    let sc = 0.55;
    sc -= Math.min(0.35, h.mess.length * 0.03) + Math.min(0.2, h.rats.length * 0.05);
    if (h.drinks) sc += 0.06;
    let ext = 0; for (const k in h.decor) if (h.decor[k] === 'ext') ext++; for (const r of roomList(h)) ext += countObj(r, 'ext');
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
  const inCorridor = (h, e) => { const x = tileOf(e.x), y = tileOf(e.y); return indoor(x, y) && !layout(h).room[idx(x, y)] && !inLobby(x, y); };
  const binCount = h => roomList(h).reduce((a, r) => a + (isBuilt(r) ? countObj(r, 'bin') : 0), 0);
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
    for (const r of roomList(h)) if (walled(r)) rads += countObj(r, 'rad');
    h.comfort = clamp(c, 0, MAX_COMFORT); h.drinks = d; h.rads = rads;
  }
  function warmth(h) { const base = h.rads * h.pol.heat / 14; return h.boiler > 0 ? (Math.floor(h.boiler / 6) % 2 ? 0.2 : 2.2) : base; }
  // where to stand to use a corridor object or water a plant: a free neighbouring tile
  function standBy(h, tx, ty) {
    const L = layout(h);
    for (const [dx, dy] of DIRS) { const x = tx + dx, y = ty + dy; if (walkable(x, y) && !L.block[idx(x, y)] && L.room[idx(x, y)] === L.room[idx(tx, ty)]) return center(x, y); }
    return center(tx, ty);
  }
  function placeDecor(s, p, c, r, kind) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p]; c |= 0; r |= 0;
    if (!DECOR[kind]) return 'Bad request';
    if (!decorCheck(h, c, r, kind)) return 'Can\'t put that there';
    if (h.cash < DECOR[kind].cost) return 'Not enough cash';
    book(h, 'Building', -DECOR[kind].cost); h.decor[decorKey(c, r)] = kind;
    if (kind === 'plant') h.water[decorKey(c, r)] = 1;
    recount(h); changed(h);
    for (const rm of roomList(h)) reQueue(h, rm);
    s.ev.push({ k: 'decor', p, kind, c, r });
    return null;
  }
  function removeDecor(s, p, c, r) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], key = decorKey(c | 0, r | 0), kind = h.decor[key];
    if (!kind) return 'Nothing there';
    delete h.decor[key]; delete h.water[key]; book(h, 'Building', Math.round(DECOR[kind].cost / 2)); recount(h); changed(h);
    for (const rm of roomList(h)) reQueue(h, rm);
    s.ev.push({ k: 'undecor', p, kind });
    return null;
  }
  function buyDesk(s, p) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p];
    if (h.desk) return 'You already have a reception desk';
    if (h.cash < DESK_COST) return 'Not enough cash';
    book(h, 'Building', -DESK_COST); h.desk = true; changed(h); assign(h);
    s.ev.push({ k: 'desk', p });
    return null;
  }

  // ============================ building rooms ============================
  // phases: bp (blueprint, being moved) → door → win → wait (site clearing) → furnish → built; emptying (being
  // edited, waiting for everyone to leave) → furnish; wreck (a machine exploded). Only one room is edited at a time.
  const editing = h => roomList(h).find(r => r.phase !== 'built' && r.phase !== 'wreck');
  function bpPlace(s, p, id, kind, rc) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p];
    rc = { x: rc.x | 0, y: rc.y | 0, w: rc.w | 0, h: rc.h | 0 };
    if (rc.w < 1 || rc.h < 1 || rc.w > 14 || rc.h > 14) return 'Bad request';
    let r = id != null ? h.rooms[id] : null;
    if (r) {
      if (r.phase !== 'bp') return 'That room isn\'t a blueprint';
      kind = r.k;
    } else {
      if (!ROOMS[kind]) return 'Bad request';
      if (editing(h)) return 'Finish the room you\'re building first';
      if (!unlocked(h, kind)) return 'That room needs research first';
      if (h.cash < roomCost(h, kind)) return 'Not enough cash: try a loan from the Bank';
    }
    const c = bpCheck(h, kind, rc, r ? r.id : -1);
    if (!c.ok) return c.why;
    if (!r) {
      r = { id: s.nextId++, k: kind, phase: 'door', rect: rc, door: null, wins: [], objs: [], list: [], paid: false, furnished: false,
        sts: [], p: null, prog: 0, dur: 1, n: 0, q: [], qt: [], dis: -1, str: 0, used: 0, users: [], sp: null };
      h.rooms[r.id] = r;
      s.ev.push({ k: 'bp', p, room: r.id, kind });
    } else { r.rect = rc; r.phase = 'door'; r.door = null; r.wins = []; }
    changed(h);
    return null;
  }
  function doorPlace(s, p, id, x, y, d) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || (r.phase !== 'door' && r.phase !== 'win')) return 'Not now';
    const c = doorCheck(h, r, x | 0, y | 0, d & 3);
    if (!c.ok) return c.why;
    r.door = { x: x | 0, y: y | 0, d: d & 3 }; r.phase = 'win';
    r.wins = r.wins.filter(w => !isDoorEdge(r, w[0], w[1], w[2]));
    changed(h);
    return null;
  }
  function winToggle(s, p, id, x, y, d) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || r.phase !== 'win') return 'Not now';
    x |= 0; y |= 0; d &= 3;
    const i = r.wins.findIndex(w => w[0] === x && w[1] === y && w[2] === d);
    if (i >= 0) { r.wins.splice(i, 1); return null; }
    if (!winCheck(h, r, x, y, d)) return 'A window needs a new wall facing the corridor';
    r.wins.push([x, y, d]);
    return null;
  }
  function winsDone(s, p, id) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || r.phase !== 'win') return 'Not now';
    r.phase = 'wait'; r.waitT = 0;
    return null;
  }
  // furniture: the next object in the list goes at (x, y, rot); objects are paid for as they join the list
  function objPlace(s, p, id, li, x, y, rot) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || (r.phase !== 'furnish' && !(r.phase === 'built' && STD4.includes(r.list[li])))) return 'Not now';
    const o = r.list[li | 0]; if (!o) return 'Nothing to place';
    const c = objCheck(h, r, o, x | 0, y | 0, rot & 3);
    if (!c.ok) return c.why;
    r.list.splice(li | 0, 1);
    r.objs.push({ id: h._oid = (h._oid || 0) + 1, o, x: x | 0, y: y | 0, r: rot & 3, w: 1 });
    if (isBuilt(r)) { computeSpots(h, r); recount(h); }
    changed(h);
    return null;
  }
  function objPick(s, p, id, oid) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || r.phase !== 'furnish') return 'Edit the room first';
    const i = r.objs.findIndex(ob => ob.id === oid); if (i < 0) return 'Nothing there';
    r.list.unshift(r.objs[i].o); r.objs.splice(i, 1);
    changed(h);
    return null;
  }
  // sell a placed object or one waiting in the list: refunded in full
  function objSell(s, p, id, oid, li) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || r.phase !== 'furnish') return 'Edit the room first';
    let o;
    if (oid != null && oid >= 0) { const i = r.objs.findIndex(ob => ob.id === oid); if (i < 0) return 'Nothing there'; o = r.objs[i].o; r.objs.splice(i, 1); }
    else { o = r.list[li | 0]; if (!o) return 'Nothing there'; r.list.splice(li | 0, 1); }
    book(h, 'Building', objCost(h, o));
    changed(h);
    return null;
  }
  function objBuy(s, p, id, o) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || !OBJ[o]) return 'Bad request';
    const ok = r.phase === 'furnish' ? (ROOMS[r.k].extra.includes(o) || ROOMS[r.k].req.includes(o)) : r.phase === 'built' && STD4.includes(o) && ROOMS[r.k].extra.includes(o);
    if (!ok) return 'That doesn\'t go in here';
    if (!objAvailable(h, o)) return 'That needs research first';
    const c = objCost(h, o);
    book(h, 'Building', -c);   // like the original, extras can take you into debt
    r.list.push(o);
    s.ev.push({ k: 'bought', p, room: r.id, o });
    return null;
  }
  function autoPlace(s, p, id) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || (r.phase !== 'furnish' && r.phase !== 'built') || !r.list.length) return 'Nothing to place';
    const n = autoFurnish(h, r);
    if (!n) return 'There isn\'t room for that';
    if (isBuilt(r)) { computeSpots(h, r); recount(h); }
    changed(h);
    return r.list.length ? 'Some things didn\'t fit: make the room bigger or sell something' : null;
  }
  // plants, radiators, extinguishers and bins can go into a working room without emptying it
  function addExtra(s, p, id, o) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || !isBuilt(r) || !STD4.includes(o) || !ROOMS[r.k].extra.includes(o)) return 'That doesn\'t go in here';
    const e = objBuy(s, p, id, o); if (e) return e;
    if (!autoFurnish(h, r) || r.list.includes(o)) { r.list = r.list.filter(x => x !== o); book(h, 'Building', objCost(h, o)); return 'There\'s no free spot for it: edit the room to make space'; }
    computeSpots(h, r); recount(h); changed(h);
    return null;
  }
  function missingReq(r) {
    const need = {}; for (const o of ROOMS[r.k].req) need[o] = (need[o] || 0) + 1;
    for (const ob of r.objs) if (need[ob.o]) need[ob.o]--;
    return Object.keys(need).filter(o => need[o] > 0);
  }
  // the final tick: the shell is charged the first time, the room opens
  function finishBuild(s, p, id) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || r.phase !== 'furnish') return 'Not now';
    const miss = missingReq(r);
    if (miss.length) return 'Still to place: ' + miss.map(o => OBJ[o].name).join(', ');
    if (!r.paid) { book(h, 'Building', -shellCost(h, r.k)); r.paid = true; }
    r.phase = 'built';
    // anything left unplaced goes back to the shop at full price
    for (const o of r.list) book(h, 'Building', objCost(h, o));
    r.list = [];
    if (ROOMS[r.k].mach) { const m = r.objs.find(ob => ob.o === ROOMS[r.k].p); r.str = machStr(h, r.k); if (!r.everBuilt) r.used = 0; void m; }
    computeSpots(h, r); recount(h); changed(h);
    const first = !h.built[r.k]; h.built[r.k] = 1; r.everBuilt = true;
    s.ev.push({ k: 'built', p, room: r.id, kind: r.k, first, hint: staffHint(h, r) });
    assign(h);
    return null;
  }
  function staffHint(h, r) {
    const need = ROOMS[r.k].staff; if (!need) return '';
    return h.staff.some(st => !st.gone && eligible(st, r.k)) ? '' : need;
  }
  // one step back: furniture → door (walls come down, furniture kept), door/windows/waiting → blueprint,
  // blueprint → delete (half the shell back if it was paid, objects at full price)
  function buildBack(s, p, id) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || r.phase === 'built' || r.phase === 'wreck' || r.phase === 'emptying') return 'Not now';
    if (r.phase === 'furnish') { for (const ob of r.objs) r.list.push(ob.o); r.objs = []; r.phase = 'door'; r.door = null; r.wins = []; changed(h); return null; }
    if (r.phase === 'door' || r.phase === 'win' || r.phase === 'wait') { r.phase = 'bp'; r.door = null; r.wins = []; changed(h); return null; }
    if (r.phase === 'bp') return deleteRoom(s, p, id);
    return 'Not now';
  }
  function deleteRoom(s, p, id) {
    const h = s.h[p], r = h.rooms[id];
    if (!r) return 'No room there';
    if (r.phase === 'wreck') return 'A destroyed room can\'t be deleted (clear the wreckage instead)';
    evacuate(s, p, r);
    if (r.paid) book(h, 'Building', Math.round(shellCost(h, r.k) / 2));
    for (const ob of r.objs) book(h, 'Building', objCost(h, ob.o));
    for (const o of r.list) book(h, 'Building', objCost(h, o));
    delete h.rooms[id];
    for (const st of h.staff) if (st.room === id) { st.room = null; if (st.mode === 'rest' || st.mode === 'train') st.mode = 'idle'; }
    changed(h); recount(h); assign(h);
    s.ev.push({ k: 'razed', p, kind: r.k, paid: r.paid });
    return null;
  }
  // editing a working room: it stops taking patients, everyone leaves, then you're back at the furniture step
  function editRoom(s, p, id) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || r.phase !== 'built') return 'Not now';
    if (editing(h)) return 'Finish the room you\'re building first';
    evacuate(s, p, r);
    r.phase = 'emptying';
    changed(h); assign(h);
    return null;
  }
  // CorsixTH's optional removal of a destroyed room: twice the build cost minus 40% of the required objects
  function clearWreck(s, p, id) {
    const h = s.h[p], r = h.rooms[id];
    if (!r || r.phase !== 'wreck') return 'Not now';
    const cost = 2 * ROOMS[r.k].cost - Math.round(0.4 * ROOMS[r.k].reqCost);
    if (h.cash < cost) return 'Not enough cash';
    book(h, 'Building', -cost);
    delete h.rooms[id];
    changed(h);
    s.ev.push({ k: 'cleared', p, kind: r.k });
    return null;
  }
  const wreckCost = kind => 2 * ROOMS[kind].cost - Math.round(0.4 * ROOMS[kind].reqCost);
  function stepBuilding(s, p, dt) {
    const h = s.h[p];
    for (const r of roomList(h)) {
      // anyone on a building site (or the ring around it) is told to leave
      if (AVOID.has(r.phase) || r.phase === 'emptying') {
        r.waitT = (r.waitT || 0) + dt;
        if (r.waitT < 1 / 6) continue;   // re-check every ten ticks
        r.waitT = 0;
        const margin = r.phase === 'emptying' ? 0 : 1, rc = r.rect;
        const ring = { x: rc.x - margin, y: rc.y - margin, w: rc.w + 2 * margin, h: rc.h + 2 * margin };
        const onSite = (x, y) => inRect(ring, x, y) && (inRect(rc, x, y) || !inLobby(x, y));
        let busy = false;
        for (const list of [h.pats, h.staff, h.vis, h.rats]) for (const e of list) {
          const ex = tileOf(e.x), ey = tileOf(e.y);
          if (!onSite(ex, ey)) continue;
          const last = e.path[e.path.length - 1];
          const staying = !last || onSite(tileOf(last[0]), tileOf(last[1]));
          if (!staying && !inRect(rc, ex, ey)) continue;   // just walking past
          busy = true;
          if (staying) {
            if (e.st === 'queue' && e.slot != null && h.rooms[e.slot]) { reQueue(h, h.rooms[e.slot]); if (e.path.length) continue; }
            const [x, y] = corridorSpot(h); route(h, e, x, y);
          }
        }
        if (busy) continue;
        if (r.phase === 'wait') {
          // walls, door and floor go up; litter and rat holes under the room are swept away
          h.mess = h.mess.filter(m => !inRect(rc, tileOf(m.x), tileOf(m.y)));
          r.phase = 'furnish';
          if (!r.furnished) { for (const o of ROOMS[r.k].req) { book(h, 'Building', -objCost(h, o)); r.list.push(o); } r.furnished = true; }
          changed(h);
          s.ev.push({ k: 'walls', p, room: r.id });
        } else if (r.phase === 'emptying') { r.phase = 'furnish'; changed(h); }
      }
    }
  }

  // ---------- actions (host validates; p = 0 host, 1 guest) ----------
  function replaceMachine(s, p, id) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], r = h.rooms[id];
    if (!r || !isBuilt(r) || !ROOMS[r.k].mach) return 'No machine there';
    const cost = Math.round(objCost(h, ROOMS[r.k].p) * 0.5);
    if (h.cash < cost) return 'Not enough cash';
    book(h, 'Machines', -cost);
    r.used = 0; r.str = machStr(h, r.k);
    s.ev.push({ k: 'replaced', p, room: id, kind: r.k });
    return null;
  }
  const replaceCost = (h, kind) => Math.round(objCost(h, ROOMS[kind].p) * 0.5);
  function hire(s, p, id) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p];
    const i = s.pool.findIndex(c => c.id === id); if (i < 0) return 'Someone else got there first';
    const c = s.pool[i];
    if (h.cash < c.sal) return 'Not enough cash for the first month';
    s.pool.splice(i, 1);
    book(h, 'Wages', -c.sal);
    h.staff.push(Object.assign({}, c, { slot: null, desk: false, x: EXIT[0], y: EXIT[1], path: [], f: 3, mv: 0, gone: false, idle: -1, look: c.id % 8, job: null, work: 0, wt: 1, hap: 0.75, tired: 0, mode: 'idle', room: null, train: false, pri: 'all', fax: 0, quit: 0 }));
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
    st.gone = true; st.job = null; st.work = 0; st.desk = false;
    leaveFacility(h, st); st.mode = 'leave';
    unslot(h, st);
    dropFax(h, f => f.sid === st.id);
    route(h, st, EXIT[0], EXIT[1]);
    assign(h);
    s.ev.push({ k: why, p, nm: st.nm });
  }
  // pick up a member of staff and drop them in a room (bumping the weaker one if it's full)
  function place(s, p, id, rid) {
    if (s.ph !== 'play') return 'Not now';
    const h = s.h[p], st = staffById(h, id), r = h.rooms[rid];
    if (!st || st.gone || !r || !isBuilt(r)) return 'Can\'t do that';
    if (!eligible(st, r.k)) return `${st.nm} can't work in a ${ROOMS[r.k].name}`;
    if (st.slot === rid) return null;
    if (st.mode === 'rest' || st.mode === 'train') leaveFacility(h, st);
    unslot(h, st); st.desk = false; st.train = false; st.mode = 'idle';
    if (r.sts.length >= capacity(r)) {
      const weakest = r.sts.map(i => staffById(h, i)).filter(Boolean).sort((a, b) => a.sk - b.sk)[0];
      if (weakest) { unslot(h, weakest); weakest.idle = -1; }
    }
    placeIn(h, st, r); st.pin = true;
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
    if (pol.heat != null) P.heat = clamp(Math.round(+pol.heat), 1, 5);
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
    const h = s.h[p], Rs = h.res;
    let rate = 0;
    for (const r of roomList(h)) {
      if (r.k !== 'research' || !isBuilt(r)) continue;
      let rr = 0;
      for (const id of r.sts) { const st = staffById(h, id); if (st && st.slot === r.id && !st.path.length && !st.gone) rr += (0.5 + st.sk) * (st.tired >= 0.95 ? 0.5 : 1); }
      rate += rr * (1 + 0.15 * countObj(r, 'computer') + 0.25 * countObj(r, 'atom'));
    }
    if (!rate) return;
    if (!s.solo) rate *= MP_RESEARCH;
    for (const f of FIELDS) {
      if (!Rs.alloc[f]) continue;
      Rs.pts[f] += rate * dt * Rs.alloc[f] / 100;
      const need = researchCost(h, f);
      if (need == null) { Rs.pts[f] = 0; continue; }
      if (Rs.pts[f] >= need) { Rs.pts[f] -= need; complete(s, p, f); }
    }
  }
  function researchCost(h, f) {
    const Rs = h.res;
    if (f === 'cure' || f === 'diag') return RESEARCH[f].cost[Rs.done[f]] == null ? null : RESEARCH[f].cost[Rs.done[f]];
    if (f === 'drug') return Rs.eff.some((e, i) => DISEASES[i].grp === 'pharm' && e < 1) ? RESEARCH.drug.cost : null;
    if (f === 'imp') return Rs.done.imp < RESEARCH.imp.max || Rs.disc < 0.25 ? RESEARCH.imp.cost : null;
    if (f === 'spec') return Rs.spec >= 0 ? RESEARCH.spec.cost : null;
    return null;
  }
  function complete(s, p, f) {
    const h = s.h[p], Rs = h.res;
    let what = '';
    if (f === 'cure' || f === 'diag') { const item = RESEARCH[f].list[Rs.done[f]]; Rs.done[f]++; what = item; }
    else if (f === 'drug') { improveDrugs(h); what = 'drugs'; }
    else if (f === 'imp') {
      if (Rs.done.imp < RESEARCH.imp.max) { Rs.done.imp++; what = 'strength'; }
      else { Rs.disc = r2(Math.min(0.25, Rs.disc + 0.05)); what = 'cheaper'; }
    } else if (f === 'spec') {
      const d = DISEASES[Rs.spec];
      if (d.grp === 'pharm') Rs.eff[Rs.spec] = r2(Math.min(1, Rs.eff[Rs.spec] + 0.05));
      else if (ROOMS[d.room].mach) { h.specStr = h.specStr || {}; h.specStr[d.room] = (h.specStr[d.room] || 0) + 1; }
      what = 'spec';
    }
    s.ev.push({ k: 'research', p, f, what, spec: Rs.spec });
  }
  // below 75%: every drug under 75% goes up; after that the weakest drug is raised until it reaches 100%
  function improveDrugs(h) {
    const E = h.res.eff, ids = DISEASES.map((d, i) => i).filter(i => DISEASES[i].grp === 'pharm');
    const low = ids.filter(i => E[i] < 0.75);
    if (low.length) for (const i of low) E[i] = r2(Math.min(0.75, E[i] + 0.05));
    else { const i = ids.filter(j => E[j] < 1).sort((a, b) => E[a] - E[b])[0]; if (i != null) E[i] = r2(Math.min(1, E[i] + 0.05)); }
  }

  // ---------- facilities: staff room, training, toilets ----------
  function facilityRoom(h, kind) {
    return roomList(h).find(r => r.k === kind && isBuilt(r) && r.users.length < seatsOf(r));
  }
  function enterFacility(h, e, r) {
    let i = 0; const taken = new Set(r.users.map(id => { const o = staffById(h, id) || patById(h, id); return o ? o.seat : -1; }));
    while (taken.has(i)) i++;
    r.users.push(e.id); e.seat = i; e.room = r.id;
    const sp = r.sp.seats[i] || roomCenter(r);
    route(h, e, sp[0], sp[1]);
  }
  function leaveFacility(h, e) {
    if (e.room != null && h.rooms[e.room]) { const r = h.rooms[e.room]; r.users = r.users.filter(id => id !== e.id); }
    e.room = null; e.seat = -1;
  }
  // how fast a training room teaches: projectors 10, skeletons 15, bookcases 20, each kind ln(count) + 1
  function teachSpeed(r) {
    let v = 0;
    for (const [o, val] of [['proj', 10], ['skeleton', 15], ['bookcase', 20]]) { const n = countObj(r, o); if (n) v += (Math.log(n) + 1) * val; }
    return 0.6 + v / 25;
  }

  // ---------- time ----------
  const arrivals = m => 10 + 1.6 * m;      // patients per month for the whole town, rising through the match
  function monthTick(s) {
    s.month++;
    for (let p = 0; p < (s.solo ? 1 : 2); p++) {
      const h = s.h[p];
      let sal = 0; for (const st of h.staff) if (!st.gone) sal += st.sal;
      book(h, 'Wages', -sal);
      const heat = Math.round(h.rads * h.pol.heat * 6); if (heat) book(h, 'Heating', -heat);
      if (h.loan) book(h, 'Interest', -Math.round(h.loan * (h.lrate != null ? h.lrate : LOAN_RATE)));
      if (h.owed) { book(h, 'Insurance', h.owed); h.owed = 0; }
      if (h.mess.length >= 4) addRep(h, -Math.floor(h.mess.length / 3));
      if (h.rats.length) addRep(h, -2 * h.rats.length);
      // staff morale: paid at least the fair wage or not; the size of the gap doesn't matter
      for (const st of h.staff) {
        if (st.gone) continue;
        st.hap = clamp(st.hap + (st.sal >= fairWage(st) ? 0.08 : -0.12), 0, 1);
        if (st.quit && st.quit <= s.month) dismiss(s, p, st, 'resigned');
      }
      const handy = h.staff.filter(x => x.k === 'h' && !x.gone).length;
      if (h.rads >= 6 && handy < h.rads / 6 && rnd() < 0.3) { h.boiler = 30; s.ev.push({ k: 'boiler', p }); }
      s.ev.push({ k: 'month', p, m: s.month, fin: h.fin.cur });
      h.fin.last = h.fin.cur; h.fin.cur = {};
      h.monthDeaths = 0;
      if (s.month >= 4 && !h.em && lvlOK(s, 'emerg') && rnd() < 0.35) emergencyOffer(s, p);
      if (s.solo && h.rep < h.yMinRep) h.yMinRep = h.rep;
      if (s.month >= 3 && (rnd() < 0.25 || h.vipNo >= 2)) { if (h.vipNo >= 2) { h.vipNo = 0; startVip(s, p, pick(VIPS)); s.ev.push({ k: 'vipSurprise', p }); } else vipOffer(s, p); }
    }
    s.pool = newPool(s, false);
    s.ev.push({ k: 'pool' });
    if (s.month >= 8 && !s.quake && lvlOK(s, 'quake') && rnd() < 0.22) { s.quake = { t: s.t + 15, big: rnd() < 0.5 }; s.ev.push({ k: 'tremor' }); }
    if (s.solo) return soloMonth(s);
    if (s.month % 12 === 0) appraisal(s);
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
    const att = s.h.map(h => {
      const open = (h.open || s.t >= GRACE) && h.desk && h.staff.some(x => x.desk && !x.gone && !x.path.length);
      return open ? h.rep * clamp(2 - avgPrice(h) / 100, 0.4, 1.6) + 50 : 0;
    });
    const tot = att[0] + att[1];
    if (s.solo) stepRivals(s, dt, att[0]);
    for (let p = 0; p < (s.solo ? 1 : 2); p++) {
      const h = s.h[p];
      recount(h); h.warm = warmth(h);
      if (h.boiler > 0) h.boiler -= dt;
      if (s.solo) {
        h.acc += dt * townRate(s) * s.solo.share[0] / MONTH;
        while (h.acc >= 1 && h.pats.length < 60) { h.acc -= 1; spawnPatient(s, p); }
        if (h.acc >= 1) h.acc = 0.99;
      } else if (tot > 0) {
        h.acc += dt * arrivals(s.month) * att[p] / tot / MONTH;
        while (h.acc >= 1 && h.pats.length < 60) { h.acc -= 1; spawnPatient(s, p); }
        if (h.acc >= 1) h.acc = 0.99;
      }
      stepBuilding(s, p, dt);
      stepEvents(s, p, dt);
      stepStaff(s, p, dt);
      stepPatients(s, p, dt);
      stepRooms(s, p, dt);
      researchTick(s, p, dt);
      for (let i = h.fax.length - 1; i >= 0; i--) if (h.fax[i] && s.t >= h.fax[i].t) expireFax(s, p, h.fax[i]);
    }
    if (s.quake && s.t >= s.quake.t) {
      const big = s.quake.big; s.quake = null;
      s.ev.push({ k: 'quake', big });
      for (let p = 0; p < 2; p++) {
        const h = s.h[p];
        for (const r of roomList(h)) {
          if (!ROOMS[r.k].mach || !isBuilt(r)) continue;
          r.used += (big ? 2 : 1) + Math.floor(rnd() * 3);
          if (r.used > r.str && rnd() < 0.25 * (r.used - r.str) * (hasObj(r, 'ext') ? 0.5 : 1)) explode(s, p, r);
        }
      }
    }
    while (s.ph === 'play' && s.t >= (s.month + 1) * MONTH) monthTick(s);
  }

  function stepEvents(s, p, dt) {
    const h = s.h[p];
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
          const v = { id: s.nextId++, k: 'insp', x: EXIT[0], y: EXIT[1], path: [], f: 3, mv: 0, t: 0 };
          route(h, v, RECEP[0] - 8, RECEP[1] + 14); h.vis.push(v); e.phase = 'insp'; s.ev.push({ k: 'inspector', p });
        }
      } else if (e.phase === 'declared' && s.t >= e.t) { for (const x of h.pats) x.inf = 0; h.epi = null; }
    }
    for (let i = h.vis.length - 1; i >= 0; i--) {
      const v = h.vis[i];
      const arrived = walk(v, 26, dt);
      if (!arrived) continue;
      if (v.k === 'insp') { if (v.done) { h.vis.splice(i, 1); continue; } endEpidemic(s, p); continue; }
      if (v.done) { h.vis.splice(i, 1); continue; }
      v.t += dt;
      if (v.t < 1.5) continue;
      v.t = 0; v.legs++;
      if (v.legs >= 6) { judgeVip(s, p, v); v.done = true; route(h, v, EXIT[0], EXIT[1]); continue; }
      const [x, y] = corridorSpot(h); route(h, v, x, y);
    }
    h.ratT = (h.ratT || 0) + dt;
    if (h.ratT >= 8) {
      h.ratT = 0;
      const litter = h.mess.filter(m => m.k === 'litter');
      if (litter.length >= 3 && h.rats.length < 4 && rnd() < 0.25) { const m = pick(litter); h.rats.push({ id: s.nextId++, x: m.x, y: m.y, path: [], f: 2, mv: 0 }); s.ev.push({ k: 'rat', p }); }
    }
    for (const rt of h.rats) { if (walk(rt, 34, dt)) { const [x, y] = corridorSpot(h); route(h, rt, x, y); } }
  }

  function stepStaff(s, p, dt) {
    const h = s.h[p], pol = h.pol, days = dt / DAY;
    for (let i = h.staff.length - 1; i >= 0; i--) { const st = h.staff[i]; if (walk(st, SSPEED, dt) && st.gone) h.staff.splice(i, 1); }
    const cold = h.warm < 0.6, hot = h.warm > 1.6, messy = h.mess.length > 6;
    h.leaveT = (h.leaveT || 0) + dt;
    let reassign = false;
    for (const st of h.staff) {
      if (st.gone) continue;
      const r = st.slot != null ? h.rooms[st.slot] : null;
      const fr = st.room != null ? h.rooms[st.room] : null;
      if (st.k !== 'r') {
        const busy = st.mode === 'rest' ? -dt / 14 : r && r.p != null ? dt / 80 : st.mode === 'train' ? dt / 150 : r && r.k === 'research' ? dt / 120 : st.k === 'h' && st.job != null ? dt / 100 : r ? dt / 400 : -dt / 200;
        st.tired = r2(clamp(st.tired + busy, 0, 1));
      }
      // the spec's daily happiness effects: the room's windows, size and nearby objects, rest, fatigue
      let dh = 0;
      if (r && r.sp && !st.path.length) { const i = r.sts.indexOf(st.id); dh += (r.sp.sh[i] || 0); }
      if (st.mode === 'rest' && fr && fr.sp && !st.path.length) dh += (fr.sp.seatRest[st.seat] || 0.05) + (fr.sp.seatHap[st.seat] || 0);
      if (st.tired >= 0.5 && st.mode !== 'rest') dh -= 0.01;
      if (cold || hot) dh -= 0.002;
      if (messy) dh -= 0.001;
      st.hap = clamp(st.hap + dh * days, 0, 1);
      if (st.hap < 0.3 && !st.fax && !st.quit) {
        st.fax = 1;
        const ask = Math.round(Math.max(st.sal, fairWage(st)) * 1.1);
        h.fax.push({ id: s.nextId++, k: 'raise', sid: st.id, nm: st.nm, ask, t: s.t + MONTH });
      }
      if (st.k !== 'r' && st.mode === 'idle' && st.job == null && st.tired * 100 >= pol.rest && !(r && r.p != null)) {
        const k = facilityRoom(h, 'staff');
        if (k) { unslot(h, st); st.mode = 'rest'; enterFacility(h, st, k); reassign = true; }
      }
      if (st.mode === 'rest' && st.tired <= 0.05 && !st.path.length) { leaveFacility(h, st); st.mode = 'idle'; st.idle = -1; reassign = true; }
      if ((st.mode === 'rest' || st.mode === 'train') && (!fr || !isBuilt(fr))) { leaveFacility(h, st); st.mode = 'idle'; reassign = true; }
      if (st.train && st.mode === 'idle' && st.k === 'd' && !isCon(st) && st.slot == null) {
        const k = facilityRoom(h, 'training');
        if (k && k.sts.length) { st.mode = 'train'; enterFacility(h, st, k); }
      }
      if (st.mode === 'train' && fr) {
        const teacher = fr.sts.map(id => staffById(h, id)).find(x => x && x.slot === fr.id && !x.path.length);
        if (teacher && !st.path.length) {
          const n = Math.max(1, fr.users.length);
          const speed = (0.4 + teacher.sk) * teachSpeed(fr) * (st.tired > 0.5 ? 0.5 : 1) * (st.sk < 0.25 ? 1.5 : st.sk < 0.8 ? 1 : 0.7) / n;
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
    if (pol.leave && h.leaveT > 3) {
      h.leaveT = 0;
      for (const r of roomList(h)) {
        if (!isBuilt(r) || r.sts.length >= (ROOMS[r.k].need || 1) || !r.q.length || ROOMS[r.k].cat === 'fac') continue;
        const donor = h.staff.find(st => !st.gone && st.slot != null && st.slot !== r.id && eligible(st, r.k) && h.rooms[st.slot] && !h.rooms[st.slot].q.length && h.rooms[st.slot].p == null && ROOMS[h.rooms[st.slot].k].cat !== 'fac' && !st.path.length && !st.pin);
        if (donor) { unslot(h, donor); placeIn(h, donor, r); }
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
        else if (j[0] === 'r') { const r = h.rooms[+j.slice(1)]; ok = r && isBuilt(r) && ROOMS[r.k].mach && r.used > 0; }
        else if (j[0] === 'o') { const [rid, oid] = j.slice(1).split(':').map(Number); ok = h.rooms[rid] && h.rooms[rid].objs.some(ob => ob.id === oid); }
        else if (j[0] === 'w') ok = h.decor[j.slice(1)] === 'plant';
        if (!ok) { st.job = null; st.work = 0; continue; }
        if (st.path.length) continue;
        const time = j[0] === 'm' ? CLEAN_TIME : j[0] === 'r' ? REPAIR_TIME : WATER_TIME;
        st.work += dt / (time * (1.4 - 0.6 * st.sk));
        if (st.work >= 1) {
          if (j[0] === 'm') { const m = h.mess.find(x => 'm' + x.id === j); if (m) { h.mess.splice(h.mess.indexOf(m), 1); s.ev.push({ k: 'cleaned', p, x: m.x, y: m.y, kind: m.k }); } }
          else if (j[0] === 'r') { const r = h.rooms[+j.slice(1)]; const late = r.used > r.str; if (rnd() < (late ? 0.6 : 0.25)) r.str = Math.max(3, r.str - 1); r.used = 0; s.ev.push({ k: 'repaired', p, room: r.id, str: r.str }); }
          else if (j[0] === 'o') { const [rid, oid] = j.slice(1).split(':').map(Number); const ob = h.rooms[rid].objs.find(x => x.id === oid); if (ob) { ob.w = 1; computeSpots(h, h.rooms[rid]); } }
          else if (j[0] === 'w') h.water[j.slice(1)] = 1;
          st.job = null; st.work = 0; st.wt = 0.4;
        }
        continue;
      }
      // choose a job: smoking machines first, then (by priority) mess, worn machines, thirsty plants
      const jobs = [];
      for (const r of roomList(h)) {
        if (!isBuilt(r)) continue;
        if (ROOMS[r.k].mach && !taken.has('r' + r.id) && r.used >= r.str - 2 && r.used > 0) jobs.push({ id: 'r' + r.id, kind: 'repair', urgent: r.used > r.str, x: r.sp.p[0], y: r.sp.p[1] });
        for (const ob of r.objs) if (ob.o === 'plant' && ob.w < 0.35 && !taken.has('o' + r.id + ':' + ob.id)) { const [x, y] = standBy(h, ob.x, ob.y); jobs.push({ id: 'o' + r.id + ':' + ob.id, kind: 'water', x, y }); }
      }
      for (const key in h.decor) if (h.decor[key] === 'plant' && (h.water[key] || 0) < 0.35 && !taken.has('w' + key)) { const [c, r] = key.split(',').map(Number); const [x, y] = standBy(h, c, r); jobs.push({ id: 'w' + key, kind: 'water', x, y }); }
      for (const m of h.mess) if (!taken.has('m' + m.id)) jobs.push({ id: 'm' + m.id, kind: 'clean', x: m.x, y: m.y });
      const pri = st.pri || 'all';
      const okJob = j => pri === 'all' || j.kind === pri || j.urgent;
      let best = null, bd = 1e9;
      for (const j of jobs) {
        if (!okJob(j)) continue;
        const d = Math.abs(j.x - st.x) + Math.abs(j.y - st.y) - (j.urgent ? 2000 : 0) - (j.kind === pri ? 300 : 0);
        if (d < bd) { bd = d; best = j; }
      }
      if (best) { st.job = best.id; st.work = 0; taken.add(best.id); route(h, st, best.x, best.y); }
      else if (!st.path.length) { st.wt -= dt; if (st.wt <= 0) { st.wt = 2 + rnd() * 4; const [x, y] = corridorSpot(h); route(h, st, x, y); } }
    }
    for (const key in h.decor) if (h.decor[key] === 'plant') h.water[key] = Math.max(0, (h.water[key] == null ? 1 : h.water[key]) - dt / 150);
    for (const r of roomList(h)) for (const ob of r.objs) if (ob.o === 'plant') { const w0 = ob.w; ob.w = Math.max(0, (ob.w == null ? 1 : ob.w) - dt / 150); if ((w0 > 0.35) !== (ob.w > 0.35) || (w0 > 0) !== (ob.w > 0)) computeSpots(h, r); }
  }

  // reception turns people away once every GP queue is full (max queue size 6 each)
  function gpQueue(h) { const g = roomsOf(h, 'gp'); if (!g.length) return 0; return Math.min(...g.map(r => r.q.length)) - QMAX + CROWD; }
  function stepPatients(s, p, dt) {
    const h = s.h[p];
    const crowd = h.pats.filter(x => x.st === 'queue' || x.st === 'recep').length;
    // the receptionist goes behind the desk (also after a save from before the desk moved) and faces the doors
    const desker = h.staff.find(x => x.desk && !x.gone && !x.path.length && x.mode !== 'rest' && x.mode !== 'train');
    if (desker) { if (Math.hypot(desker.x - DESK_STAFF[0], desker.y - DESK_STAFF[1]) > 3) route(h, desker, DESK_STAFF[0], DESK_STAFF[1]); else desker.f = 2; }
    const recep = h.staff.find(x => x.desk && !x.gone && !x.path.length);
    for (let i = h.pats.length - 1; i >= 0; i--) {
      const pt = h.pats[i];
      if (!h.pats.includes(pt)) continue;
      const d = DISEASES[pt.dis];
      const arrived = walk(pt, d.id === 'sleep' ? PSPEED * 0.6 : pt.em ? PSPEED * 1.3 : PSPEED, dt);
      if (pt.st === 'leave') { if (arrived) { if (pt.inf && !pt.vax && h.epi && h.epi.phase === 'cover') h.epi.t = s.t; /* an infected patient got outside: the inspector comes at once */ h.pats.splice(i, 1); } continue; }
      pt.hp -= dt / (d.fatal ? 300 : 520) * (pt.em ? 2.5 : 1);
      if (pt.hp <= 0) { kill(s, p, pt, -1); continue; }
      pt.th = clamp(pt.th + dt / 120 * (h.warm > 1.6 ? 2 : 1), 0, 1);
      pt.bl = clamp(pt.bl + dt / 140 * (hasTag(d, 'loo') ? 2.5 : 1), 0, 1.2);
      if (pt.st === 'enter') { if (arrived) { pt.st = 'recep'; pt.t = 1.4; } continue; }
      if (pt.st === 'recep') {
        if (!recep || pt.path.length) continue;
        pt.t -= dt / (1 + 0.1 * Math.max(0, crowd - 4)) * (0.6 + 0.8 * recep.sk);
        if (pt.t > 0) continue;
        if (!pt.cure && !pt.em && gpQueue(h) > CROWD) { h.angry++; addRep(h, -1); s.ev.push({ k: 'crowd', p, nm: pt.nm }); leave(s, p, pt, 'crowd'); continue; }
        if (pt.cure || pt.dx) goCure(s, p, pt);
        else if (!queueFor(s, p, pt, 'gp')) { h.angry++; addRep(h, -2); s.ev.push({ k: 'nogp', p, nm: pt.nm }); leave(s, p, pt, 'nogp'); }
        continue;
      }
      if (pt.st === 'wait') {
        pt.t -= dt; pt.pat -= dt * 0.5;
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
          if (pt.bl >= 1) {
            const k = facilityRoom(h, 'toilet');
            if (k) { pt.st = 'wc'; pt.t = 5 + rnd() * 3; enterFacility(h, pt, k); continue; }
            pt.bl = 0.2; pt.pat -= 25; spawnMess(s, p, pt.x + 3, pt.y + 2, 'puddle'); s.ev.push({ k: 'wet', p, nm: pt.nm, x: pt.x, y: pt.y }); continue;
          }
          if (pt.th >= 0.7 && h.drinks) {
            let best = null, bd = 1e9;
            for (const key in h.decor) if (h.decor[key] === 'drinks') { const [c, rr] = key.split(',').map(Number); const [x, y] = standBy(h, c, rr); const dd = Math.abs(x - pt.x) + Math.abs(y - pt.y); if (dd < bd) { bd = dd; best = [x, y]; } }
            if (best && bd < 260) { pt.st = 'trip'; pt.t = 1; route(h, pt, best[0], best[1]); continue; }
          }
        }
      }
      if (pt.st === 'trip' && arrived) {
        pt.t -= dt; if (pt.t > 0) continue;
        book(h, 'Drinks', 20); pt.th = 0; pt.bl = Math.min(1.2, pt.bl + 0.3);
        if (rnd() < 0.5 / (1 + 0.4 * binCount(h))) spawnMess(s, p, pt.x + (rnd() - 0.5) * 10, pt.y + 4, 'litter');
        pt.st = 'queue'; const r = h.rooms[pt.slot];
        if (r && isBuilt(r)) { const [qx, qy] = queuePos(h, r, r.q.indexOf(pt.id)); route(h, pt, qx, qy); } else { pt.st = 'recep'; pt.t = 0.2; }
        continue;
      }
      if (pt.st === 'wc' && arrived) {
        pt.t -= dt; if (pt.t > 0) continue;
        const tr = h.rooms[pt.room];
        // washing is optional, but skipping it (no sink) leaves patients less happy
        if (tr && !hasObj(tr, 'sink')) pt.pat -= 10;
        pt.bl = 0; leaveFacility(h, pt); pt.st = 'queue';
        const r = h.rooms[pt.slot];
        if (r && isBuilt(r)) { const [qx, qy] = queuePos(h, r, r.q.indexOf(pt.id)); route(h, pt, qx, qy); } else { pt.st = 'recep'; pt.t = 0.2; route(h, pt, RECEP[0] - 6, RECEP[1]); }
        continue;
      }
      if (inCorridor(h, pt) && h.mess.length < MAX_MESS) {
        const chance = 0.0009 * (hasTag(d, 'vomit') ? 6 : 1) * (pt.pat < 20 ? 3 : 1) * (messNear(h, pt.x, pt.y, 'vomit') ? 6 : 1) * (decorNear(h, pt.x, pt.y, 'plant', 50) ? 0.6 : 1);
        if (rnd() < chance * dt) { spawnMess(s, p, pt.x + 4, pt.y + 3, 'vomit'); s.ev.push({ k: 'vomit', p, nm: pt.nm, x: pt.x, y: pt.y }); }
      }
    }
  }

  function stepRooms(s, p, dt) {
    const h = s.h[p];
    // a queue stuck outside a room with nobody working in it moves to a staffed room of the same kind
    h.rebalT = (h.rebalT || 0) + dt;
    if (h.rebalT >= 2) {
      h.rebalT = 0;
      for (const r of roomList(h)) {
        if (!isBuilt(r) || !r.q.length || roomStaffReady(h, r) || r.sts.length >= (ROOMS[r.k].need || 1)) continue;
        if (!roomsOf(h, r.k).some(o => o !== r && o.sts.length >= (ROOMS[o.k].need || 1))) continue;
        for (const id of r.q.slice()) { const pt = patById(h, id); if (!pt || pt.st !== 'queue') continue; unqueue(h, pt); queueFor(s, p, pt, r.k); }
      }
    }
    for (const r of roomList(h)) {
      if (!isBuilt(r) || ROOMS[r.k].cat === 'fac') continue;
      const info = roomStaffReady(h, r);
      if (r.p != null) {
        const pt = patById(h, r.p);
        if (!pt) { r.p = null; r.prog = 0; continue; }
        if (!info || pt.path.length) continue;
        r.prog += dt / r.dur * (info.crazy ? 0.5 : 1);
        if (r.prog >= 1) finishRoom(s, p, r, info);
      } else if (info && r.q.length) {
        // the first patient standing in line is called in; if everyone is still walking up, the first of them
        const inLine = id2 => { const o = patById(h, id2); return o && o.st === 'queue'; };
        const id = r.q.find(id2 => inLine(id2) && !patById(h, id2).path.length) ?? r.q.find(inLine);
        r.q = r.q.filter(id2 => patById(h, id2));
        if (id == null) continue;
        const pt = patById(h, id);
        r.q.splice(r.q.indexOf(id), 1); reQueue(h, r);
        const Rm = ROOMS[r.k];
        const beds = countObj(r, 'bed');
        const base = r.k === 'gp' && pt.gp2 ? Rm.time * 0.5 : r.k === 'ward' ? Rm.time * 2 / (1 + beds / 2) : r.k === 'psych' ? Rm.time / (1 + 0.15 * countObj(r, 'bookcase')) : Rm.time;
        r.p = pt.id; r.dis = pt.dis; r.dur = base * (1.4 - 0.6 * info.sk); r.prog = 0;
        pt.st = 'in';
        route(h, pt, r.sp.p[0], r.sp.p[1]);
      }
    }
  }

  // ---------- single player: level setup, rivals, appraisal, checks ----------
  function setupSolo(s, lvl) {
    const L = LEVELS[lvl - 1], h = s.h[0];
    const names = RIVAL_NAMES.slice(); const rivals = [];
    for (let i = 0; i < 3; i++) rivals.push(newRival(names.splice(Math.floor(rnd() * names.length), 1)[0], lvl, L.start));
    s.solo = { lvl, rivals, declined: false, share: [0.25, 0.25, 0.25, 0.25] };
    h.cash = L.start; h.land = LAND_VALUE;
    h.tg = {}; for (const k of ['rep', 'cash', 'pct', 'cured', 'value']) if (L[k] != null) h.tg[k] = L[k];
    h.lrate = (1 + 8 * (lvl - 1) / 11) / 100 / 12;   // 1% a year on level 1 up to 9% on level 12, charged monthly
    h.ban = Object.keys(LVL_FROM).filter(k => ROOMS[k] && lvl < LVL_FROM[k]);
    yearStart(s);
  }
  // single player: what a promoted player takes to the next level. Built rooms (with their furniture and machine wear),
  // staff, decor, research, policy, prices and the bank balance; patients, rubbish, faxes and the year's counts stay behind.
  function carrySnapshot(s) {
    const h = JSON.parse(JSON.stringify(s.h[0], (k, v) => (k === '_L' ? undefined : v)));
    const keep = ['rooms', 'staff', 'decor', 'water', 'desk', 'res', 'pol', 'price', 'dprice', 'known', 'cb', 'specStr', 'built', 'cash', 'rep'];
    const out = { nextId: s.nextId }; for (const k of keep) if (h[k] !== undefined) out[k] = h[k];
    return out;
  }
  function carryOver(s, c) {
    const h = s.h[0];
    s.solo.carry = c;
    c = JSON.parse(JSON.stringify(c));   // the stored copy stays untouched so the level can be restarted with it
    s.nextId = Math.max(s.nextId, c.nextId || 0);
    s.pool = newPool(s, true);           // fresh ids above everything carried in
    h.rooms = {};
    for (const k in c.rooms) {
      const r = c.rooms[k]; if (r.phase !== 'built') continue;
      Object.assign(r, { sts: [], p: null, prog: 0, n: 0, q: [], qt: [], dis: -1, users: [] });
      h.rooms[r.id] = r;
    }
    h.staff = [];
    for (const st of c.staff || []) {
      if (st.gone) continue;
      Object.assign(st, { slot: null, desk: false, x: EXIT[0], y: EXIT[1], path: [], mv: 0, idle: -1, job: null, work: 0, mode: 'idle', room: null, train: false, fax: 0, quit: 0, tired: 0 });
      h.staff.push(st);
    }
    for (const k of ['decor', 'water', 'desk', 'res', 'pol', 'price', 'dprice', 'known', 'cb', 'specStr', 'built', 'rep']) if (c[k] !== undefined) h[k] = c[k];
    if (c.cash != null) h.cash = Math.max(c.cash, 0);
    for (const r of roomList(h)) computeSpots(h, r);
    recount(h); changed(h); assign(h); h.yMinRep = h.rep;
    // a head start raises the bar: the level's cash on top of what you brought, $20,000 more value, reputation +100
    const tg = h.tg;
    if (tg.cash != null) tg.cash += Math.round(Math.max(0, h.cash) / 1000) * 1000;
    if (tg.value != null) tg.value = Math.max(tg.value, Math.ceil((value(h) + 20000) / 5000) * 5000);
    if (tg.rep != null) tg.rep = Math.max(tg.rep, Math.min(950, Math.ceil((h.rep + 100) / 50) * 50));
  }
  // rivals are never drawn or simulated tile by tile: they're statistical competitors (spec: Rival hospitals)
  function newRival(nm, lvl, cash) {
    return { nm, rep: START_REP, cash, cured: 0, died: 0, home: 0, visits: 0, seen: 0, value: LAND_VALUE, staff: 2, pend: 0, open: false,
      openT: GRACE * (0.55 + rnd() * 0.7), hireT: MONTH * (0.2 + rnd() * 0.6), cr: r2(0.5 + rnd() * 0.15 + lvl * 0.01), dr: r2(0.03 + rnd() * 0.04), awards: [] };
  }
  // the town's patients a month, shared by all four hospitals; later levels are busier towns
  const townRate = s => arrivals(s.month) * 2 * (1 + 0.08 * (s.solo.lvl - 1));
  function stepRivals(s, dt, att0) {
    const S = s.solo;
    for (const rv of S.rivals) {
      if (!rv.open && s.t >= rv.openT) { rv.open = true; s.ev.push({ k: 'rivalOpen', nm: rv.nm }); }
      // rivals recruit from the same candidate pool, so good candidates can disappear
      rv.hireT -= dt;
      if (rv.hireT <= 0) {
        rv.hireT = MONTH * (0.45 + rnd() * 0.8);
        const want = rnd() < 0.55 ? 'd' : rnd() < 0.7 ? 'n' : 'h', list = s.pool.filter(c => c.k === want);
        if (list.length && rv.staff < 8 + s.month * 1.5) {
          const c = rnd() < 0.5 ? list.sort((a, b) => b.sk - a.sk)[0] : pick(list);
          s.pool.splice(s.pool.indexOf(c), 1); rv.staff++;
          s.ev.push({ k: 'poached', nm: rv.nm, who: c.nm, type: c.k });
        }
      }
    }
    // patient share: round-robin for the first 3 months, then weighted by reputation with a quarter left to chance
    const w = [att0].concat(S.rivals.map(rv => (rv.open ? rv.rep + 50 : 0)));
    const open = w.filter(x => x > 0).length, sum = w.reduce((a, b) => a + b, 0);
    S.share = w.map(x => (!x || !open ? 0 : s.month < 3 ? 1 / open : 0.25 / open + 0.75 * x / sum));
    S.rivals.forEach((rv, i) => { rv.pend += dt * townRate(s) * S.share[i + 1] / MONTH; });
  }
  // the spec's resistance near the extremes: gains below 500 and losses above 500 always land
  function rivalRep(rv, d) {
    const r = rv.rep, always = (d > 0 && r < 500) || (d < 0 && r > 500);
    if (always || rnd() < 1 - (0.000004008 * r * r - 0.004008 * r + 1)) rv.rep = clamp(rv.rep + d, 0, 1000);
  }
  function rivalMonth(s, rv) {
    const n = Math.floor(rv.pend); rv.pend -= n;
    const cured = Math.min(n, Math.round(n * rv.cr * (0.85 + rnd() * 0.3))), died = Math.min(n - cured, Math.round(n * rv.dr * (0.5 + rnd())));
    const home = Math.round((n - cured - died) * 0.4);
    rv.visits += n; rv.seen += cured + died + home; rv.cured += cured; rv.died += died; rv.home += home;
    for (let i = 0; i < cured; i++) rivalRep(rv, 1);
    for (let i = 0; i < died; i++) rivalRep(rv, -4);
    for (let i = 0; i < home; i++) rivalRep(rv, -3);
    rv.cash += Math.round(cured * 800 * priceFactor(rv) + n * 150) - rv.staff * 95;
    // money in the bank turns into rooms and better cures; value grows steadily
    const spend = rv.cash > 25000 ? Math.round(Math.min(rv.cash - 20000, 3000 + rnd() * 9000)) : 0;
    rv.cash -= spend; rv.value += Math.round(spend * 0.85) + 1500;
    rv.cr = Math.min(0.88, rv.cr + 0.003 + spend / 2e6);
  }
  function yearStart(s) {
    const h = s.h[0];
    h.y0 = { cured: h.cured, died: h.died, seen: h.seen, home: h.home, angry: h.angry, visits: h.visits, rv: s.solo.rivals.map(r => r.visits) };
    h.yMinRep = h.rep;
  }
  // year-end awards and trophies, measured against the spec's fixed thresholds rather than the rivals
  function soloAppraisal(s) {
    const h = s.h[0], y = h.y0, S = s.solo;
    const cured = h.cured - y.cured, died = h.died - y.died, seen = h.seen - y.seen, gone = (h.home - y.home) + (h.angry - y.angry);
    const mine = h.visits - y.visits, theirs = S.rivals.reduce((a, r, i) => a + r.visits - (y.rv[i] || 0), 0);
    const share = mine + theirs ? mine / (mine + theirs) : 0;
    const live = h.staff.filter(x => !x.gone), staffHap = live.length ? live.reduce((a, x) => a + x.hap, 0) / live.length : 0.5;
    const pats = h.pats.filter(q => q.st !== 'leave'), patHap = pats.length ? pats.reduce((a, q) => a + Math.min(1, q.pat / 150), 0) / pats.length : 0.5;
    const award = (name, cash, rep) => { h.awards.push(name); if (cash) book(h, 'Awards', cash); if (rep) addRep(h, rep); };
    const cite = (name, cash, rep) => award('Citation: ' + name, cash, rep);
    if (cured > 50) award('Most cures', 2000); else if (cured < 10) cite('too few cures', -3000);
    if (seen && died < 10) award('Fewest deaths', 3000); else if (died > 25) cite('too many deaths', -5000);
    if (share > 0.5) award('Biggest market share', 0, 4); else if (share < 0.15) cite('tiny market share', 0, -5);
    const ratio = died ? cured / died : 99;
    if (cured + died && ratio > 5) award('Cures beat deaths', 4000); else if (cured + died && ratio < 1) cite('more deaths than cures', -4000);
    if (h.rep > 500) award('Reputation', 2000); else if (h.rep < 200) cite('poor reputation', -3000);
    const v = value(h);
    if (v > 150000) award('Hospital value', 0, 3); else if (v < 50000) cite('run-down hospital', 0, -6);
    if (live.length && staffHap > 0.75) award('Happy staff', 0, 4); else if (live.length && staffHap < 0.25) cite('miserable staff', 0, -10);
    if (pats.length && patHap > 0.75) award('Happy patients', 0, 4); else if (pats.length && patHap < 0.25) cite('miserable patients', 0, -9);
    if (seen >= 5 && !died && !gone) award('Trophy: every patient cured', 20000);
    else if (seen >= 5 && !died) award('Trophy: no deaths', 10000);
    if (seen >= 10 && cured / seen > 0.9) award('Trophy: cure rate over 90%', 6000);
    if (h.yMinRep > 400) award('Trophy: reputation all year', 2000);
    s.ev.push({ k: 'awards', y: s.month / 12 });
    h.messMade = 0;
    yearStart(s);
  }
  function soloMonth(s) {
    const h = s.h[0], S = s.solo;
    for (const rv of S.rivals) rivalMonth(s, rv);
    if (s.month % 12 === 0) { soloAppraisal(s); const why = lost(h); if (why) return finish(s, 1, 'lost:' + why); }
    // a declined promotion comes back at the half-year checks only
    if (s.month % (S.declined ? 6 : 3) === 0 && !h.loan && metTargets(h)) return finish(s, 0, 'targets');
  }
  // turn down a promotion and keep running this hospital
  function stayOn(s) {
    if (!s.solo || s.ph !== 'over' || s.winner !== 0) return 'Not now';
    s.ph = 'play'; s.winner = -1; s.why = ''; s.solo.declined = true;
    s.ev.push({ k: 'stay' });
    return null;
  }

  // ---------- helpers for tests and the bot ----------
  // a free rectangle for a room of this kind (smallest legal size), scanning the floor
  function findSite(h, kind, extra) {
    const m = ROOMS[kind].min + (extra || 0);
    for (let y = 0; y + m <= H; y++) for (let x = 2; x + m <= W; x++) {
      const rc = { x, y, w: m, h: m };
      if (!bpCheck(h, kind, rc, -1).ok) continue;
      for (let d = 0; d < 4; d++) {
        const cx = d % 2 === 0 ? x + (m >> 1) : d === 1 ? x + m - 1 : x, cy = d % 2 === 1 ? y + (m >> 1) : d === 2 ? y + m - 1 : y;
        const r = { k: kind, rect: rc, objs: [], id: -5, door: null };
        if (doorCheck(h, r, cx, cy, d).ok) return { rc, door: [cx, cy, d] };
      }
    }
    return null;
  }
  // build a room start to finish (the bot uses this; the walls still wait for the site to clear)
  function quickBuild(s, p, kind) {
    const h = s.h[p], site = findSite(h, kind);
    if (!site) return 'No room on the floor';
    const err = bpPlace(s, p, null, kind, site.rc); if (err) return err;
    const r = editing(h);
    const e2 = doorPlace(s, p, r.id, site.door[0], site.door[1], site.door[2]); if (e2) { deleteRoom(s, p, r.id); return e2; }
    winsDone(s, p, r.id); r.auto = true;
    return null;
  }
  function stepAuto(s, p) {
    const h = s.h[p];
    for (const r of roomList(h)) if (r.auto && r.phase === 'furnish') { autoFurnish(h, r); const e = finishBuild(s, p, r.id); if (e) deleteRoom(s, p, r.id); else r.auto = false; }
  }

  const api = { VERSION, T, W, H, MONTH, MONTHS, GRACE, EXIT, RECEP, DESK_STAFF, TARGETS, LOSE, START_CASH, START_REP, DESK_COST, LOAN_STEP, LOAN_RATE, LOBBY, DESK_TILES, DIRS,
    LEVELS, LVL_FROM, LAND_VALUE, stayOn, carrySnapshot, carryOver, MP_RESEARCH,
    OBJ, STD4, ROOMS, ROOM_ORDER, CATS, inCat, DISEASES, DIS_IDX, MONTH_NAMES, DECOR, DECOR_ORDER, decorKey, MAX_COMFORT, RESEARCH, FIELDS, QUAL_PTS, QUAL_NAME,
    idx, inMap, indoor, inLobby, walkable, tileOf, layout, roomAtTile, findPath, objTiles, objDims, objCheck, bpCheck, doorCheck, winCheck, decorCheck, doorTiles, doorOut, perimeter, isDoorEdge,
    walled, isBuilt, editing, roomCenter, doorPoint, queuePos, idlePos, yearMonth, missingReq, objAvailable, objCost, roomCost, shellCost, replaceCost, wreckCost, teachSpeed,
    score, progress, metTargets, value, curePct, arrivals, unlocked, hasUpgrade, machStr, cureFee, diagFee, priceFactor, loanLimit, researchCost, cureType, hasTag,
    rank, isCon, hasQ, fairWage, typeName, eligible, capacity, seatsOf, countObj,
    newState, start, step, bpPlace, doorPlace, winToggle, winsDone, objPlace, objPick, objSell, objBuy, autoPlace, finishBuild, buildBack, deleteRoom, editRoom, clearWreck,
    replaceMachine, hire, fire, place, setTrain, setPri, pay, setPolicy, setPrice, setResearch, loan, openDoors,
    addExtra, placeDecor, removeDecor, buyDesk, shoot, vax, answerFax, setProfile, staffById, patById, findSite, quickBuild, stepAuto };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RH = api;
})(typeof window !== 'undefined' ? window : globalThis);
