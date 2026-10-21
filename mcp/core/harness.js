/* ---------------- MCP game harness (appended to the page's sim by build-core.js) ---------------- */
// Game-scaled economy: in-game dollars, tuned so a strong dispatcher reaches $1M in roughly one 8-hour sim day.
const ECON = { base: 600, perKm: 500, freeWaitMin: 5, latePerMin: 0.04, floor: 0.4, rescueShare: 0.5, energyPerPct: 15, tow: 8000, goal: 1e6 };
function tripKm(from, to) { const d = dijkstra(from, to, (e) => e.len); return d ? Math.round(d.cost) / 100 : 0; }
function fareOf(r) { return Math.round(ECON.base + ECON.perKm * r.km); }
function waitFactor(waitS) { return Math.max(ECON.floor, 1 - ECON.latePerMin * Math.max(0, waitS / 60 - ECON.freeWaitMin)); }
function payFare(p, r) {
  const full = fareOf(r), got = Math.round(full * (r.rescue ? ECON.rescueShare : waitFactor(r.pickT - r.t0)));
  p.fares = (p.fares || 0) + got; p.discounts = (p.discounts || 0) + full - got;
  if (!p.shadowless && !S.shadow) EVENTS.push({ t: S.t, src: 'exec', kind: 'fare', tag: 'Fare', head: `${r.id} ${r.name} dropped at ${corner(r.to)}: $${got.toLocaleString('en-US')}`, body: got < full ? `Full fare $${full.toLocaleString('en-US')}, ${r.rescue ? 'half refunded after the breakdown' : `cut for a ${((r.pickT - r.t0) / 60).toFixed(1)} min wait`}.` : undefined });
}
function ledger(p) {
  if (!p) return null;
  const fares = p.fares || 0, energy = Math.round(p.batUsed * ECON.energyPerPct), tows = (p.tows || 0) * ECON.tow;
  return { revenue: fares - energy - tows, fares, lateDiscounts: p.discounts || 0, energy, tows, lostFares: p.lostFares || 0, trips: p.trips, pickups: p.pickups, cancelled: p.cancelled, stranded: p.stranded,
    avgWaitMin: p.pickups ? +(p.waitSum / p.pickups / 60).toFixed(2) : null, emptyKmShare: p.totalPx ? +(p.emptyPx / p.totalPx).toFixed(3) : null, km: +(p.totalPx / 100).toFixed(1) };
}

let G = null;
function gameInit(cfg) {
  G = { mode: cfg.mode, start: 8 * 3600, cap: (cfg.hours || 24) * 3600, finishT: null, lastFreeIds: new Set(), seenInc: new Set(), seenReq: new Set() };
  HAZ_END = G.start + G.cap + 3600; DEMAND = cfg.demand || 1;
  SEED = cfg.seed; seedStreams(cfg.seed);
  S.rph = 18 + Math.floor(rD() * 38); S.phase = rD() * 6.28;
  S.hazards = makeHazards(); initCars(); recomputeTraffic();
  spawnRequest(); spawnRequest();
  if (cfg.mode !== 'executor') {
    S.agent = true; S.external = cfg.mode === 'external'; S.agentSince = S.t; S.connectT = S.t;
    S.periods.agent = newPeriod(S.t);
  }
  if (cfg.shadow) { SHADOW = cloneWorld(MAIN); SHADOW.external = false; }
  if (S.agent) { for (const c of S.cars) c.known.clear(); S.timers.charge = S.t; S.timers.reroute = S.t; S.timers.repo = S.t + 30; if (!S.external) agentReroute(); }
  for (const r of S.reqs) G.seenReq.add(r.id);
  return info();
}
function info() { return { seed: SEED, rph: Math.round(S.rph * DEMAND), baseRph: S.rph, demand: DEMAND, mode: G.mode, start: G.start, capS: G.cap, econ: ECON }; }
const P0 = () => (S.agent ? S.periods.agent : S.periods.exec);
function revenue() { return ledger(P0()).revenue; }
function tick() {
  step(2); if (SHADOW) { S = SHADOW; step(2); S = MAIN; }
  if (G.finishT == null && revenue() >= ECON.goal) G.finishT = S.t;
}
const elapsed = () => S.t - G.start;
const over = () => G.finishT != null || elapsed() >= G.cap;

/* ---------- lookups ---------- */
const carById = (id) => { const c = S.cars.find((x) => x.id === String(id).toUpperCase() || x.num === String(id).padStart(2, '0')); if (!c) throw new Error(`No car ${id}. Cars are T-01 to T-10.`); return c; };
const reqById = (id) => { const k = String(id).toUpperCase().startsWith('R-') ? String(id).toUpperCase() : 'R-' + id; const r = S.reqs.find((x) => x.id === k); if (!r) throw new Error(`No open rider ${id}.`); return r; };
const depotBy = (d) => { if (d == null || d === 'best') return null; const x = DEPOTS.find((o, i) => String(i) === String(d) || o.name.toLowerCase().startsWith(String(d).toLowerCase()) || String(o.node) === String(d)); if (!x) throw new Error(`No depot ${d}. Depots: ${DEPOTS.map((o) => o.name).join(', ')}.`); return x; };
const r1 = (x) => Math.round(x * 10) / 10;
const usableCar = (c) => c.battery > 0 && (isFree(c) || c.state === 'charging' || c.state === 'tocharge' || (c.state === 'riding' && !c.next && c.job));

/* ---------- observations ---------- */
function carView(c) {
  const rem = c.seg < c.path.length - 1 ? remaining(c) : null;
  return {
    id: c.id, state: c.state, battery: r1(c.battery), node: carNode(c), at: corner(carNode(c)),
    target: c.path.length > 1 ? targetOf(c) : undefined, etaMin: rem ? (isFinite(rem.t) ? r1(rem.t / 60) : 'blocked') : undefined,
    rider: c.job ? c.job.id : undefined, next: c.next ? c.next.id : undefined,
    depot: c.depot && (c.state === 'charging' || c.state === 'tocharge') ? c.depot.name : undefined,
    chargeTo: c.state === 'charging' || c.state === 'tocharge' ? c.chargeTo : undefined,
    plugged: c.state === 'charging' ? !!c.plugged : undefined,
    backInMin: c.state === 'stranded' ? r1((c.strandUntil - S.t) / 60) : c.state === 'hold' ? r1((c.holdUntil - S.t) / 60) : undefined,
  };
}
function reqView(r) {
  const w = S.t - r.t0;
  return { id: r.id, name: r.name, status: r.status, from: r.from, to: r.to, route: `${corner(r.from)} → ${corner(r.to)}`, km: r.km, fullFare: fareOf(r),
    fareIfPickedNow: r.status === 'riding' ? undefined : Math.round(fareOf(r) * (r.rescue ? ECON.rescueShare : waitFactor(w))), waitedMin: r1(w / 60),
    cancelsInMin: r.rescue || r.vip || r.status === 'riding' ? undefined : r1((CANCEL_AFTER - w) / 60), rescue: r.rescue || undefined, car: r.car ? r.car.id : undefined };
}
function incView(i) { return { edge: i.edge.id, road: i.edge.name, type: i.type, spottedBy: i.seenBy, nodes: [i.edge.a, i.edge.b] }; }
function depotView(d) {
  const here = S.cars.filter((c) => c.depot === d && (c.state === 'charging' || c.state === 'tocharge'));
  return { name: d.name, node: d.node, at: corner(d.node), bays: BAYS, plugged: here.filter((c) => c.state === 'charging' && c.plugged).length, queued: here.filter((c) => c.state === 'charging' && !c.plugged).length, enRoute: here.filter((c) => c.state === 'tocharge').length };
}
function score() {
  const L = ledger(P0());
  return { revenue: L.revenue, goal: ECON.goal, progress: +(L.revenue / ECON.goal).toFixed(4), elapsedMin: r1(elapsed() / 60), finished: G.finishT != null, finishMin: G.finishT != null ? r1((G.finishT - G.start) / 60) : null,
    outOfTime: G.finishT == null && elapsed() >= G.cap, ledger: L, executorAloneSameCity: SHADOW ? ledger(SHADOW.periods.exec) : undefined };
}
function state(opts = {}) {
  const open = S.reqs.filter((r) => r.status === 'waiting' || r.status === 'assigned' || r.status === 'riding');
  return {
    clock: clockStr(S.t), elapsedMin: r1(elapsed() / 60), score: score(),
    cars: S.cars.map(carView),
    riders: open.filter((r) => opts.all || r.status !== 'riding').map(reqView),
    knownHazards: S.incidents.filter((i) => i.seen).map(incView),
    depots: DEPOTS.map(depotView),
  };
}
// Overview by default (the whole graph is ~300 KB, far too big for a model). Pass near (a node id, district, landmark or depot name)
// to list intersections and roads around it, nearest first.
function mapInfo(q = {}) {
  const num = (x) => (x == null ? NaN : +x);
  const out = {
    note: `Downtown Toronto from OpenStreetMap, 1 unit = 10 m (${r1(MAP_W / 100)} x ${r1(MAP_H / 100)} km). Intersections have node ids; roads have edge ids and may be one-way. Cars drive at the speed limit times about 0.7 (0.9 on expressways), slowed by known jams; crashes close a road. Pickups and drop-offs are never on expressways.`,
    hq: { name: DEPOTS[0].name, node: DEPOTS[0].node, at: corner(DEPOTS[0].node) },
    depots: DEPOTS.map((d) => ({ name: d.name, node: d.node, at: corner(d.node), bays: d.bays })),
    districts: DISTRICTS.map((d) => ({ name: d.name, node: d.node, at: corner(d.node), demandWeight: d.w })),
    landmarks: LANDMARK_NODES.map((l) => ({ name: l.name, node: l.node, at: corner(l.node) })),
    size: { intersections: nodes.filter((n) => adj[n.id].length).length, roads: edges.length },
  };
  if (q.near == null) { out.howToZoom = 'Call get_map with near (a node id, or a district, landmark or depot name) and optional radius_km (default 0.8, max 3) to list the intersections and roads around it.'; return out; }
  let c = null, id = num(q.near);
  if (Number.isInteger(id) && nodes[id]) c = nodes[id];
  else { const k = String(q.near).toLowerCase(); const hit = [...DISTRICTS, ...LANDMARK_NODES, ...DEPOTS].find((d) => d.name.toLowerCase().includes(k)); if (hit) c = nodes[hit.node]; }
  if (!c) throw new Error(`Unknown place "${q.near}". Use a node id, or a district, landmark or depot name from the overview.`);
  const rad = Math.max(0.1, Math.min(3, num(q.radius_km) || 0.8)) * 100;
  const near = nodes.filter((n) => adj[n.id].length && Math.hypot(n.x - c.x, n.y - c.y) <= rad).sort((p, q2) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q2.x - c.x, q2.y - c.y)).slice(0, 120);
  const set = new Set(near.map((n) => n.id));
  out.around = { node: c.id, at: corner(c.id), radiusKm: r1(rad / 100), shown: near.length };
  out.nodes = near.map((n) => `${n.id} ${corner(n.id)} (${r1(n.x / 100)}, ${r1(n.y / 100)} km)`);
  out.edges = edges.filter((e) => set.has(e.a) || set.has(e.b)).slice(0, 400).map((e) => `e${e.id} ${e.a}${e.oneway ? '->' : '<->'}${e.b} ${e.name} ${r1(e.len / 100)}km ${e.kmh}km/h${e.motorway ? ' expressway' : ''}${e.bridge ? ' bridge' : ''}`);
  delete out.howToZoom; delete out.depots; delete out.districts; delete out.landmarks; delete out.size;
  return out;
}
// candidate cars for a rider, using only what the fleet knows (seen hazards, known traffic)
function options(riderId, limit = 4) {
  const r = reqById(riderId);
  const tripR = dijkstra(r.from, r.to, timeW); if (!tripR) return { rider: r.id, error: 'No known route from pickup to destination right now.' };
  const trip = pathStats(tripR.path), after = bestDepotByTime(r.to), backPct = after ? after.st.pct : 6;
  const tree = dijkstraAll(r.from, timeW);
  const cands = [];
  for (const c of S.cars) {
    if (!usableCar(c) || c === r.car) continue;
    let path, lead = { t: 0, pct: 0 }; const chained = c.state === 'riding';
    if (chained) { lead = remaining(c); path = pathTo(tree, targetOf(c)); }
    else if (c.prog > 0) { const p = pathTo(tree, c.path[c.seg + 1]); path = p && [c.path[c.seg], ...p]; }
    else path = pathTo(tree, c.path[c.seg]);
    if (!path) continue;
    const a = pathStats(path, chained ? 0 : c.prog);
    const pickT = a.t + lead.t + (c.state === 'charging' || c.state === 'tocharge' ? 0 : 0);
    const startBat = c.battery - lead.pct, left = startBat - a.pct - trip.pct;
    cands.push({ car: c.id, state: c.state, pickupMin: r1(pickT / 60), emptyKm: r1(a.px / 100), batteryNow: r1(c.battery), batteryAtDropoff: r1(left), canReachChargerAfter: left - backPct >= 0, safe: left - backPct >= RESERVE });
  }
  cands.sort((x, y) => x.pickupMin - y.pickupMin);
  const wNow = S.t - r.t0;
  return { rider: r.id, route: `${corner(r.from)} → ${corner(r.to)}`, tripKm: r1(trip.px / 100), tripMin: r1(trip.t / 60), tripBattery: r1(trip.pct), fullFare: fareOf(r), waitedMin: r1(wNow / 60), cars: cands.slice(0, limit) };
}

/* ---------- actions (the model's levers) ---------- */
function say(kind, tag, head, reason) { EVENTS.push({ t: S.t, src: 'agent', kind, tag, head, body: reason || undefined, model: true }); }
function freeUp(c) {
  // stop a car where it is: finish the current block if mid-road
  if (c.prog > 0) { c.path = [c.path[c.seg], c.path[c.seg + 1]]; c.seg = 0; c.state = 'reposition'; } else { c.path = [carNode(c)]; c.seg = 0; c.prog = 0; c.state = 'idle'; }
  c.routeVer++;
}
function unassign(r) {
  if (!r.car) return;
  const c = r.car;
  if (c.next === r) c.next = null; else if (c.job === r) { c.job = null; freeUp(c); }
  r.car = null; r.status = 'waiting';
}
function actNote(text) { say('note', 'Note', String(text).slice(0, 1000)); }
function actDispatch(carId, riderId, reason) {
  const c = carById(carId), r = reqById(riderId);
  if (r.status === 'riding') throw new Error(`${r.id} is already aboard ${r.car.id}.`);
  if (c.battery <= 0 || c.state === 'stranded') throw new Error(`${c.id} is stranded.`);
  if (c.state === 'pickup' || c.state === 'hold') throw new Error(`${c.id} is busy (${c.state}${c.job ? ' for ' + c.job.id : ''}). Use release first.`);
  if (c.state === 'riding' && c.next) throw new Error(`${c.id} already has ${c.next.id} queued next.`);
  if (r.car === c) return { ok: true, note: 'already assigned' };
  const est = options(r.id, 10).cars.find((x) => x.car === c.id);
  unassign(r);
  if (c.state === 'charging' || c.state === 'tocharge') { c.state = 'idle'; c.plugged = false; }
  if (c.state === 'riding') { r.status = 'assigned'; r.car = c; c.next = r; say('dispatch', 'Chain', `${r.id} ${r.name} → ${c.id} after its drop-off`, reason); }
  else { assign(r, c); say('dispatch', 'Dispatch', `${r.id} ${r.name} → ${c.id}`, reason); }
  r.etaT = S.t + (est ? est.pickupMin * 60 : 0);
  return { ok: true, car: c.id, rider: r.id, chained: c.state === 'riding', estimate: est };
}
function actRelease(carId, reason) {
  const c = carById(carId); const out = [];
  if (c.next) { out.push(c.next.id); unassign(c.next); }
  if (c.job && c.state !== 'riding') { out.push(c.job.id); unassign(c.job); }
  else if (c.state === 'charging' || c.state === 'tocharge' || c.state === 'reposition') freeUp(c);
  say('system', 'Release', `${c.id} released${out.length ? `, ${out.join(' and ')} back in the queue` : ''}`, reason);
  return { ok: true, car: c.id, ridersReturned: out, state: c.state };
}
function actCharge(carId, depot, chargeTo = 90, reason) {
  const c = carById(carId);
  if (c.state === 'riding') throw new Error(`${c.id} has ${c.job.id} aboard. Charge after the drop-off.`);
  if (c.state === 'stranded') throw new Error(`${c.id} is stranded; the tow truck takes it to a depot.`);
  if (c.next) unassign(c.next);
  if (c.job) unassign(c.job);
  let d = depotBy(depot), drive;
  if (!d) { const b = bestDepotByTime(carNode(c), c.battery); if (!b) throw new Error(`${c.id} cannot reach a depot on ${r1(c.battery)}% by any known route.`); d = b.d; drive = b.st; }
  c.depot = d; c.chargeTo = Math.max(10, Math.min(100, +chargeTo || 90));
  if (!sendTo(c, d.node, 'tocharge')) throw new Error(`No known route to ${d.name} right now; the car will retry in 30 s.`);
  if (c.path.length === 1) arrive(c);
  drive = drive || remaining(c);
  say('charge', 'Charge', `${c.id} to ${d.name} at ${Math.round(c.battery)}%, stopping at ${c.chargeTo}%`, reason);
  return { ok: true, car: c.id, depot: d.name, driveMin: r1(drive.t / 60), batteryOnArrival: r1(c.battery - drive.pct), depotNow: depotView(d) };
}
function actReposition(carId, node, reason) {
  const c = carById(carId); node = +node;
  if (!nodes[node] || !adj[node].length) throw new Error(`No intersection ${node}.`);
  if (!(isFree(c) || c.state === 'charging' || c.state === 'tocharge')) throw new Error(`${c.id} is ${c.state}; only free or charging cars can reposition.`);
  if (!sendTo(c, node, 'reposition')) throw new Error(`No known route to ${corner(node)}.`);
  if (c.path.length === 1) arrive(c);
  const st = c.path.length > 1 ? remaining(c) : { t: 0, px: 0, pct: 0 };
  say('reposition', 'Reposition', `${c.id} moves to ${corner(node)}`, reason);
  return { ok: true, car: c.id, to: corner(node), driveMin: r1(st.t / 60), km: r1(st.px / 100) };
}
function actReroute(carId, avoid = [], reason) {
  const c = carById(carId);
  if (c.seg >= c.path.length - 1) throw new Error(`${c.id} is not driving anywhere.`);
  const av = new Set(avoid.map(Number));
  const w = (e) => (av.has(e.id) ? Infinity : timeW(e));
  const before = remaining(c), plan = planFrom(c, targetOf(c), w);
  if (!plan) throw new Error('No known route that avoids those roads.');
  if (plan.path.join() === c.path.slice(c.seg).join()) return { ok: true, changed: false, etaMin: r1(before.t / 60) };
  setRoute(c, plan); P0().reroutes++;
  const after = remaining(c);
  say('reroute', 'Reroute', `${c.id} rerouted to ${corner(targetOf(c))}`, reason);
  return { ok: true, changed: true, etaBeforeMin: isFinite(before.t) ? r1(before.t / 60) : 'blocked', etaAfterMin: r1(after.t / 60), kmAfter: r1(after.px / 100) };
}

/* ---------- time ---------- */
// advance up to maxS sim seconds; with stopOnEvent, stop early when a decision is likely needed
// minS: never stop before this many sim seconds. why: pass an array to carry stop reasons across several calls (paced play).
function advance(maxS, stopOnEvent, minS = 20, why = []) {
  const evFrom = EVENTS.length, t0 = S.t;
  const freeIds = () => new Set(S.cars.filter((c) => c.state === 'idle' && c.battery > 0).map((c) => c.id));
  let prevFree = freeIds();
  const lowSeen = new Set(S.cars.filter((c) => c.state === 'idle' && c.battery < 20).map((c) => c.id));
  while (S.t - t0 < maxS && !over()) {
    tick();
    if (!stopOnEvent) continue;
    // only stop for things a dispatcher can act on
    const nowFree = freeIds();
    const waiting = S.reqs.filter((r) => r.status === 'waiting');
    if (waiting.length) for (const id of nowFree) if (!prevFree.has(id)) why.push(`${id} is free and ${waiting.length} rider${waiting.length === 1 ? ' is' : 's are'} waiting`);
    prevFree = nowFree;
    for (const r of S.reqs) if (!G.seenReq.has(r.id)) { G.seenReq.add(r.id); if (nowFree.size) why.push(`new rider ${r.id} and a free car`); }
    for (const i of S.incidents) if (i.seen && !G.seenInc.has(i.id)) { G.seenInc.add(i.id); why.push(`hazard spotted on ${i.edge.name}`); }
    for (const c of S.cars) {
      if (c.state === 'stranded' && !c._strandSeen) { c._strandSeen = true; why.push(`${c.id} stranded`); }
      if (c.state !== 'stranded') c._strandSeen = false;
      if (c.state === 'idle' && c.battery < 20 && !lowSeen.has(c.id)) { lowSeen.add(c.id); why.push(`${c.id} idle at ${Math.round(c.battery)}%`); }
    }
    if (why.length && S.t - t0 >= minS) break;
  }
  for (const r of S.reqs) G.seenReq.add(r.id);
  for (const i of S.incidents) if (i.seen) G.seenInc.add(i.id);
  return { advancedS: S.t - t0, stoppedFor: why.slice(0, 8), events: EVENTS.slice(evFrom).map((e) => ({ clock: clockStr(e.t), tag: e.tag, text: e.head + (e.body && !e.model ? ' ' + e.body : '') })) };
}

/* ---------- live view snapshot (for the browser pages) ---------- */
function liveSnap(evFrom) {
  const reqOut = (r) => ({ ...r, car: r.car ? r.car.id : null });
  const carOut = (c) => ({ id: c.id, path: c.path, seg: c.seg, prog: c.prog, x: c.x, y: c.y, state: c.state, battery: c.battery, job: c.job ? c.job.id : null, next: c.next ? c.next.id : null, depot: c.depot ? c.depot.name : null, chargeTo: c.chargeTo, plugged: !!c.plugged, queueT: c.queueT, holdUntil: c.holdUntil, strandUntil: c.strandUntil, routeVer: c.routeVer, known: [...c.known] });
  return {
    t: S.t, seed: SEED, rph: Math.round(S.rph * DEMAND), agent: S.agent, agentSince: S.agentSince, connectT: S.connectT, hazIdx: S.hazIdx, rush: S.rush,
    cars: S.cars.map(carOut), reqs: S.reqs.map(reqOut), incidents: S.incidents.map((i) => ({ id: i.id, type: i.type, edge: i.edge.id, until: i.until, seen: i.seen, seenBy: i.seenBy, src: i.src })),
    periods: S.periods, waitSeries: S.waitSeries.slice(-120),
    shadow: SHADOW ? { periods: SHADOW.periods, cars: SHADOW.cars.map(carOut), reqs: SHADOW.reqs.map(reqOut), waitSeries: SHADOW.waitSeries.slice(-120) } : null,
    events: EVENTS.slice(evFrom), evTo: EVENTS.length, score: score(),
  };
}
this.API = { gameInit, info, tick, advance, state, score, mapInfo, options, actNote, actDispatch, actRelease, actCharge, actReposition, actReroute, liveSnap, over, elapsed, ECON, get events() { return EVENTS; }, get S() { return S; } };
