const { runOnce, stats } = require('./runner4.js');
const N = +process.env.N || 200, MIN = +process.env.MIN || 180;
const seeds = Array.from({ length: N }, (_, i) => 1000 + i * 37);
const ffW = (X) => (e) => e.len / (X.BASE / (X.S.rush && e.rushy ? 1.6 : 1));
function execETA(withBattery) { return (r, X) => {
  const S = X.S; const free = S.cars.filter((c) => X.isFree(c) && c.battery > 0); if (!free.length) return;
  const w = ffW(X); const trip = X.dijkstra(r.from, r.to, w); let tp = 0; if (trip) for (let i = 0; i < trip.path.length - 1; i++) tp += X.E(trip.path[i], trip.path[i + 1]).len * X.CONS;
  let best = null; for (const c of free) { const n = c.prog > 0 ? c.path[c.seg + 1] : c.path[c.seg]; const d = X.dijkstra(n, r.from, w); if (!d) continue; let ap = 0; for (let i = 0; i < d.path.length - 1; i++) ap += X.E(d.path[i], d.path[i + 1]).len * X.CONS; if (withBattery && c.battery < ap + tp + 6 + X.RESERVE) continue; if (!best || d.cost < best.t) best = { c, t: d.cost }; }
  if (best) X.assign(r, best.c);
}; }
const F = { shadowPosFix: true };
const CONFIGS = { shipped: {}, aa: { aa: true }, aaFix: { aa: true, ...F }, fixed: { ...F }, rushFixed: { rush: true, ...F }, execETA: { execImpl: execETA(false), ...F }, execETAhold10: { execImpl: execETA(false), execHold10: true, ...F }, execFull: { execImpl: execETA(true), execHold10: true, execChargeAt: 25, execChargeAfter: 25, ...F } };
const which = (process.env.CFGS || Object.keys(CONFIGS).join(',')).split(',');
const out = {};
for (const k of which) {
  const rows = seeds.map((seed) => runOnce({ seed, minutes: MIN, ...CONFIGS[k] }));
  const a = (f) => stats(rows.map((r) => r.A[f])), b = (f) => stats(rows.map((r) => r.B[f])), d = (f) => stats(rows.map((r) => r.A[f] != null && r.B[f] != null ? r.A[f] - r.B[f] : null));
  const lose = (f, lb) => rows.filter((r) => r.A[f] != null && r.B[f] != null && (lb ? r.A[f] > r.B[f] : r.A[f] < r.B[f])).length / rows.length;
  out[k] = {}; for (const [f, lb] of [['wait', 1], ['p90', 1], ['empty', 1], ['tpc', 0], ['lost', 1], ['stranded', 1], ['cancelled', 1], ['trips', 0], ['pickups', 0], ['detourMin', 1], ['rideMin', 1], ['km', 1], ['rescue', 1], ['rph', 1]]) out[k][f] = { agent: a(f), exec: b(f), delta: d(f), agentWorseShare: +lose(f, lb).toFixed(3) };
  console.error('done', k);
}
console.log(JSON.stringify(out));
