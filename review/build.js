// Builds a headless, parameterised copy of the RobroTaxi sim from index.html.
// Usage: node build.js <index.html> > harness_sim.js
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
let core = html.split('/* ---------------- seeded random ---------------- */')[1].split('/* ---------------- map drawing ---------------- */')[0];
const rep = (a, b) => { if (!core.includes(a)) throw new Error('patch miss: ' + a.slice(0, 60)); core = core.split(a).join(b); };

// DOM-free logging
core = core.replace(/const feedEl = \$\('feed'\);[\s\S]*?\nlet toastTimer = 0;\nfunction toast\(msg\) \{[^\n]*\n/, 'function log(o) { if (S.shadow) return; if (CFG.logs) LOGS.push([S.t, o.tag, o.head]); }\nfunction toast() {}\n');
rep('car.drawT = performance.now();', 'car.drawT = 0;');
rep('if (S.agent) setTimeout(() => {', 'if (S.agent) (CFG.rerouteDelay ? (f) => PENDING.push([S.t + CFG.rerouteDelay, f]) : (f) => f())(() => {');
rep('}, reduceMotion ? 0 : 350);', '});');
// seed
rep('let seed = 20261021;', 'let seed = CFG.seed;');
// extra instrumentation: per-pickup waits and ride times, incident placement
rep('const w = S.t - r.t0, p = P(); p.pickups++; p.waitSum += w;', 'const w = S.t - r.t0, p = P(); p.pickups++; p.waitSum += w; (p.waits || (p.waits = [])).push(w); if (r.rescue) p.rescuePickups = (p.rescuePickups || 0) + 1;');
rep("const r = car.job; r.status = 'done'; car.job = null; P().trips++;", "const r = car.job; r.status = 'done'; car.job = null; P().trips++; { const p = P(); p.rideSum = (p.rideSum || 0) + (S.t - r.pickT); p.rideFree = (p.rideFree || 0) + (r.freeT || 0); }");
// free-flow trip time stored at request time for detour accounting
rep("const r = { id: 'R-' + S.nextReq++,", "const _ff = (() => { const d = dijkstra(from, to, (e) => e.len / BASE); return d ? d.cost : 0; })();\n  const r = { freeT: _ff, id: 'R-' + S.nextReq++,");
rep('const mean = S.rush ? 70 : 105;', 'const mean = CFG.spawnMean || (S.rush ? 70 : 105);');
// executor ablation hooks
rep("function execDispatch(r) {\n  const free = S.cars.filter((c) => isFree(c) && c.battery > 0);",
    "function execDispatch(r) {\n  if (CFG.execImpl) return CFG.execImpl(r, API);\n  const free = S.cars.filter((c) => isFree(c) && c.battery > 0);");
rep("function weightFor(car) {\n  if (S.agent) return timeW;", "function weightFor(car) {\n  if (S.agent || CFG.execFeed) return timeW;");
rep("car.state = 'hold'; car.holdUntil = S.t + (S.agent ? 10 : HOLD_BASELINE);", "car.state = 'hold'; car.holdUntil = S.t + (S.agent || CFG.execFeed ? 10 : HOLD_BASELINE);");
rep("if (S.agent) {\n        const plan = planFrom(car, targetOf(car), timeW);", "if (S.agent || CFG.execFeed) {\n        const plan = planFrom(car, targetOf(car), timeW);");
rep("for (const c of S.cars) if (c.state === 'idle' && c.battery < 10) {", "for (const c of S.cars) if (c.state === 'idle' && c.battery < (CFG.execChargeAt || 10)) {");
rep("if (!S.agent && car.battery < 15) {", "if (!S.agent && car.battery < (CFG.execChargeAfter || 15)) {");
// incident targeting: which world's cars attract incidents
rep("const used = new Set(); for (const c of S.cars)", "const used = new Set(); for (const c of (CFG.incTarget === 'shadow' && SHADOW ? SHADOW.cars : CFG.incTarget === 'none' ? [] : S.cars))");

const harness = `
const API = { get S() { return S; }, dijkstra, pathStats, timeW, assign, isFree, km, RESERVE, nodes, E, DEPOTS, nearestDepotByDist, bestDepotByTime, CONS, BASE };
function connect() {
  S.agent = true; S.agentSince = S.t; S.connectT = S.t;
  S.periods.agent = newPeriod(S.t);
  SHADOW = cloneWorld(MAIN);
  if (CFG.aa) { S.agent = false; S.periods.exec = newPeriod(S.t); }
  if (!CFG.aa) for (const c of S.cars) c.known.clear();
  S.timers.charge = S.t; S.timers.reroute = S.t; S.timers.repo = S.t + 30;
  if (S.agent) agentReroute();
}
function tick() {
  step(2); if (SHADOW) { S = SHADOW; step(2); S = MAIN; }
  if (PENDING.length) { const due = PENDING.filter((p) => p[0] <= S.t); PENDING = PENDING.filter((p) => p[0] > S.t); due.forEach((p) => p[1]()); }
}
function summary(p) {
  const w = (p.waits || []).slice().sort((a, b) => a - b);
  const q = (f) => w.length ? w[Math.min(w.length - 1, Math.floor(f * w.length))] / 60 : null;
  return {
    pickups: p.pickups, trips: p.trips, cancelled: p.cancelled, stranded: p.stranded, reroutes: p.reroutes,
    wait: p.pickups ? p.waitSum / p.pickups / 60 : null, p90: q(0.9),
    empty: p.totalPx ? p.emptyPx / p.totalPx * 100 : null,
    tpc: p.batUsed ? p.trips / (p.batUsed / 100) : null,
    lost: p.holdS / 60, km: p.totalPx / 100, bat: p.batUsed,
    rideMin: p.trips ? p.rideSum / p.trips / 60 : null, detourMin: p.trips ? (p.rideSum - p.rideFree) / p.trips / 60 : null,
    rescue: p.rescuePickups || 0,
    shown: metricVals(p),
  };
}
let PENDING = [];
module.exports = function run() {
  if (CFG.rush) { S.rush = true; recomputeTraffic(); }
  if (CFG.noInc) S.randomInc = false;
  spawnRequest(); spawnRequest(); spawnRequest();
  for (let i = 0; i < 540; i++) tick();
  const snaps = [];
  if (!CFG.noConnect) connect();
  const total = CFG.minutes * 30;
  for (let i = 1; i <= total; i++) {
    tick();
    if (CFG.snapEvery && i % (CFG.snapEvery * 30) === 0) snaps.push({ min: i / 30, A: summary(S.agent || CFG.aa ? S.periods.agent || S.periods.exec : S.periods.exec), B: SHADOW ? summary(SHADOW.periods.exec) : null });
  }
  const A = summary(CFG.aa ? S.periods.exec : (S.agent ? S.periods.agent : S.periods.exec));
  const B = SHADOW ? summary(SHADOW.periods.exec) : null;
  return { A, B, snaps, logs: LOGS, cars: MAIN.cars.map((c) => ({ id: c.id, st: c.state, b: c.battery })), shadowCars: SHADOW && SHADOW.cars.map((c) => ({ id: c.id, st: c.state, b: c.battery })) };
};
`;
process.stdout.write(`'use strict';\nconst CFG = global.__CFG; const LOGS = [];\nconst document = undefined; const $ = () => null;\n${core}\nfunction metricVals(p) {\n  if (!p) return null;\n  return { wait: p.pickups >= 4 ? p.waitSum / p.pickups / 60 : null, empty: p.totalPx > 3000 ? p.emptyPx / p.totalPx * 100 : null, tpc: p.trips >= 8 && p.batUsed > 3 ? p.trips / (p.batUsed / 100) : null };\n}\n${harness}`);
