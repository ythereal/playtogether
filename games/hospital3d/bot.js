// Rival Hospital 3D: the computer opponent for the 1-on-1 game. Pure (no DOM, no networking): it reads the state and
// calls the same rule functions a player's actions go through, so it can do nothing a person couldn't.
// Loads in the browser as window.RB and in Node (module.exports), so its play can be checked headless.
(function (root) {
  'use strict';
  const RH = root.RH || require('./rules.js');

  // think: seconds between decisions · reserve: cash it keeps back · plan: how far down the build list it goes
  // sloppy: chance of ignoring a chore on a given think · early: opens the doors before the timer runs out
  const LEVELS = {
    easy:   { think: 6,   reserve: 3000, plan: 99, sloppy: 0.6,  early: false, skill: 0,   save: 0, list: 'easy', pace: 60, furnish: 20 },
    normal: { think: 3.5, reserve: 2500, plan: 22, sloppy: 0.3,  early: false, skill: 0.4, save: 0.8, pace: 40, furnish: 14 },
    hard:   { think: 1,   reserve: 1500, plan: 99, sloppy: 0,    early: true,  skill: 0.8, save: 1, pace: 26, furnish: 9 },
  };
  // pace: game seconds it takes between rooms, like a person dragging out, dooring and windowing the next one;
  // furnish: seconds it spends placing a room's furniture once the walls are up
  // save: how hard it banks money for the cash target as the months go by (it stops building to keep it)
  // the order it builds in: a working core first, then cures and better diagnosis as research unlocks them.
  // The easy bot is a poor manager: it never builds toilets, a staff room or research, so it runs a grubbier hospital.
  const EASY_PLAN = ['gp', 'pharm', 'gendiag', 'ward', 'psych', 'gp', 'cardio', 'infl', 'tongue', 'fracture', 'pharm', 'blood', 'xray', 'gendiag', 'gp'];
  const PLAN = ['gp', 'pharm', 'gendiag', 'toilet', 'staff', 'ward', 'psych', 'gp', 'research', 'infl', 'tongue', 'fracture', 'hair',
    'cardio', 'blood', 'pharm', 'xray', 'op', 'elec', 'toilet', 'scanner', 'ultra', 'jelly', 'training', 'decon', 'gendiag', 'dna', 'gp', 'psych'];

  const rnd = () => Math.random();
  const liveStaff = h => h.staff.filter(x => !x.gone);
  const roomsOf = (h, k) => Object.values(h.rooms).filter(r => r.k === k && r.phase !== 'wreck');
  const built = r => r.phase === 'built';

  function newBrain(diff) { return { diff: LEVELS[diff] ? diff : 'normal', t: 0, skip: {}, next: 0, fur: {} }; }

  // called every simulation tick on the host; decides every few seconds of game time
  function tick(s, p, dt, brain) {
    if (s.ph !== 'play') return;
    furnish(s, p, brain);
    brain.t -= dt;
    if (brain.t > 0) return;
    const L = LEVELS[brain.diff];
    brain.t = L.think * (0.75 + rnd() * 0.5);
    const h = s.h[p];
    money(s, p, h);
    if (!h.desk) RH.buyDesk(s, p);
    if (rnd() >= L.sloppy / 2) staffUp(s, p, h, L);
    build(s, p, h, L, brain);
    if (rnd() >= L.sloppy) chores(s, p, h, L);
    faxes(s, p, h, L);
    if (!h.open && s.t > 20 && (L.early || s.t > RH.GRACE - 15) && roomsOf(h, 'gp').some(r => built(r) && r.sts.length)) RH.openDoors(s, p);
  }

  // the furniture goes in a while after the walls go up, at a person's pace
  function furnish(s, p, brain) {
    const h = s.h[p], L = LEVELS[brain.diff];
    for (const r of Object.values(h.rooms)) {
      if (!r.auto || r.phase !== 'furnish') continue;
      if (brain.fur[r.id] == null) brain.fur[r.id] = s.t + L.furnish * (0.8 + rnd() * 0.4);
      if (s.t < brain.fur[r.id]) continue;
      RH.autoPlace(s, p, r.id);
      if (RH.finishBuild(s, p, r.id)) RH.deleteRoom(s, p, r.id); else r.auto = false;
      delete brain.fur[r.id];
    }
  }
  function money(s, p, h) {
    if (h.cash < 0 && h.loan + RH.LOAN_STEP <= RH.loanLimit(h)) RH.loan(s, p, 1);
    else if (h.loan > 0 && h.cash > 30000) RH.loan(s, p, -1);
  }

  // the candidate it would hire for a kind of job: the best skill it can afford, weighed against the wage
  // (skill 0: simply the cheapest)
  function pickCand(s, h, test, L) {
    const can = s.pool.filter(c => test(c) && c.sal <= h.cash - 500);
    if (!can.length) return null;
    return can.sort((a, b) => (b.sk * L.skill * 3000 - b.sal) - (a.sk * L.skill * 3000 - a.sal))[0];
  }
  function staffUp(s, p, h, L) {
    const live = liveStaff(h);
    const hireOne = test => { const c = pickCand(s, h, test, L); return c ? !RH.hire(s, p, c.id) : false; };
    if (h.desk && !live.some(x => x.k === 'r')) { hireOne(c => c.k === 'r'); return; }
    // every built room that's short of staff, unless someone free who can do the job is already on their way
    for (const r of Object.values(h.rooms)) {
      if (!built(r) || !RH.ROOMS[r.k].staff) continue;
      const need = r.k === 'op' ? 2 : 1;
      if (r.sts.length >= need) continue;
      if (live.some(x => x.slot == null && !x.desk && x.mode !== 'rest' && RH.eligible(x, r.k))) continue;
      if (hireOne(c => RH.eligible(c, r.k))) return;
    }
    const nRooms = Object.values(h.rooms).filter(built).length;
    const handy = live.filter(x => x.k === 'h').length;
    if (nRooms >= 3 && handy < Math.min(4, 1 + Math.floor(nRooms / 5))) hireOne(c => c.k === 'h');
  }

  function build(s, p, h, L, brain) {
    if (RH.editing(h) || !h.desk || s.t < brain.next) return;
    const want = {};
    const plan = L.list === 'easy' ? EASY_PLAN : PLAN;
    for (let i = 0; i < Math.min(L.plan, plan.length); i++) {
      const k = plan[i]; want[k] = (want[k] || 0) + 1;
      if (brain.skip[k] || roomsOf(h, k).length >= want[k] || !RH.unlocked(h, k)) continue;
      // don't start a new room while an earlier one is still waiting for its staff
      if (Object.values(h.rooms).some(r => built(r) && RH.ROOMS[r.k].staff && !r.sts.length) && i > 2) return;
      const cost = RH.roomCost(h, k), bank = L.save * RH.TARGETS.cash * Math.max(0, s.month - 6) / (RH.MONTHS - 6);
      if (h.cash - cost < L.reserve * (i < 3 ? 0.2 : 1) + (i < 8 ? 0 : bank)) {
        if (i < 3 && h.loan + RH.LOAN_STEP <= RH.loanLimit(h)) RH.loan(s, p, 1);
        return;
      }
      const err = RH.quickBuild(s, p, k);
      if (err === 'No room on the floor') { brain.skip[k] = 1; continue; }
      if (!err) brain.next = s.t + L.pace * (0.75 + rnd() * 0.5) * (i < 3 ? 0.6 : 1);   // the first few rooms come a little quicker
      return;
    }
  }

  function chores(s, p, h, L) {
    // rats get shot, worn machines replaced before they blow
    for (const rt of h.rats.slice()) if (rnd() < 0.6) RH.shoot(s, p, rt.id);
    for (const r of Object.values(h.rooms)) if (built(r) && RH.ROOMS[r.k].mach && r.used >= r.str * 0.85 && h.cash > 8000) RH.replaceMachine(s, p, r.id);
    // heating
    if (h.warm < 0.7 && h.pol.heat < 5) RH.setPolicy(s, p, { heat: h.pol.heat + 1 });
    else if (h.warm > 1.5 && h.pol.heat > 1) RH.setPolicy(s, p, { heat: h.pol.heat - 1 });
    // corridor comforts once the core rooms are up: benches, then a drinks machine, plants and radiators
    const nRooms = Object.values(h.rooms).filter(built).length;
    if (nRooms < 2 || h.cash < L.reserve + 600) return;
    const count = k => Object.values(h.decor).filter(v => v === k).length;
    if (L.list === 'easy') return;   // and it never bothers with benches, drinks or radiators
    const wantD = [['bench', 2 + nRooms], ['drinks', nRooms >= 4 ? 1 + Math.floor(nRooms / 8) : 0], ['radiator', 2 + Math.floor(nRooms / 2)], ['plant', Math.floor(nRooms / 2)], ['ext', Math.floor(nRooms / 4)]];
    const next = wantD.find(([k, n]) => count(k) < n);
    if (next) placeNear(s, p, h, next[0]);
  }
  // a corridor tile beside a room wall, nearest the entrance first
  function placeNear(s, p, h, kind) {
    const Lr = RH.layout(h), spots = [];
    for (let y = 0; y < RH.H; y++) for (let x = 2; x < RH.W; x++) {
      if (Lr.room[RH.idx(x, y)]) continue;
      const byWall = RH.DIRS.some(([dx, dy]) => RH.inMap(x + dx, y + dy) && Lr.room[RH.idx(x + dx, y + dy)] > 0);
      if (byWall) spots.push([x, y, Math.abs(x - RH.DOOR.mid) + Math.abs(y - RH.DOOR.y) + rnd() * 6]);
    }
    spots.sort((a, b) => a[2] - b[2]);
    for (const [x, y] of spots.slice(0, 60)) if (!RH.placeDecor(s, p, x, y, kind)) return;
  }

  function faxes(s, p, h, L) {
    for (const f of h.fax.slice()) {
      let c;
      if (f.k === 'diag') c = L.early && rnd() < 0.5 ? 'guess' : rnd() < 0.5 ? 'wait' : 'home';
      else if (f.k === 'nocure') c = 'home';
      else if (f.k === 'raise') c = h.cash > 15000 ? 'pay' : 'ignore';
      else if (f.k === 'emerg') { const d = RH.DISEASES[f.dis]; c = roomsOf(h, d.room).some(r => built(r) && r.sts.length) && rnd() >= L.sloppy ? 'accept' : 'decline'; }
      else if (f.k === 'vip') c = h.rep >= 450 ? 'accept' : 'decline';
      else if (f.k === 'epi') c = 'declare';
      else continue;
      RH.answerFax(s, p, f.id, c);
    }
  }

  const api = { LEVELS, PLAN, newBrain, tick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RB = api;
})(typeof window !== 'undefined' ? window : globalThis);
