const { runOnce, stats } = require('./runner.js');
const N = +process.env.N || 200;
const seeds = Array.from({ length: N }, (_, i) => 1000 + i * 7919);
// stronger executor policies (still no agent): pick by road ETA, optional battery check
function execETA(withBattery) {
  return (r, X) => {
    const S = X.S;
    const free = S.cars.filter((c) => X.isFree(c) && c.battery > 0);
    if (!free.length) return;
    const w = (e) => X.timeW(e);
    let best = null;
    const trip = X.dijkstra(r.from, r.to, w); const tripPct = trip ? X.pathStats(trip.path).pct : 0;
    for (const c of free) {
      const n = c.prog > 0 ? c.path[c.seg + 1] : c.path[c.seg];
      const d = X.dijkstra(n, r.from, w); if (!d) continue;
      const st = X.pathStats(d.path);
      if (withBattery && c.battery < st.pct + tripPct + 6 + X.RESERVE) continue;
      if (!best || st.t < best.t) best = { c, t: st.t };
    }
    if (best) X.assign(r, best.c);
  };
}
const CONFIGS = {
  shipped: {},
  aa: { aa: true },
  rush: { rush: true },
  incShadow: { incTarget: 'shadow' },
  incNone: { incTarget: 'none' },
  execETA: { execImpl: execETA(false) },
  execETAfeed: { execImpl: execETA(false), execFeed: true },
  execFull: { execImpl: execETA(true), execFeed: true, execChargeAt: 25, execChargeAfter: 25 },
  execFeedOnly: { execFeed: true },
};
const which = (process.env.CFGS || Object.keys(CONFIGS).join(',')).split(',');
const minutes = +process.env.MIN || 60;
const out = {};
for (const k of which) {
  const rows = seeds.map((seed) => { const r = runOnce({ seed, minutes, snapEvery: +process.env.SNAP || 0, ...CONFIGS[k] }); return r; });
  const d = (f) => stats(rows.map((r) => (r.A[f] != null && r.B[f] != null ? r.A[f] - r.B[f] : null)));
  const a = (f) => stats(rows.map((r) => r.A[f])), b = (f) => stats(rows.map((r) => r.B[f]));
  const lose = (f, lowerBetter) => rows.filter((r) => r.A[f] != null && r.B[f] != null && (lowerBetter ? r.A[f] > r.B[f] : r.A[f] < r.B[f])).length / rows.length;
  out[k] = {};
  for (const [f, lb] of [['wait', 1], ['p90', 1], ['empty', 1], ['tpc', 0], ['lost', 1], ['stranded', 1], ['cancelled', 1], ['trips', 0], ['pickups', 0], ['detourMin', 1], ['rideMin', 1], ['km', 1], ['rescue', 1]]) out[k][f] = { agent: a(f), exec: b(f), delta: d(f), agentWorseShare: +lose(f, lb).toFixed(3) };
  if (process.env.SNAP) {
    out[k].snaps = {};
    const nS = rows[0].snaps.length;
    for (let i = 0; i < nS; i++) {
      const m = rows[0].snaps[i].min; const o = {};
      for (const [f, lb] of [['wait', 1], ['empty', 1], ['tpc', 0]]) {
        const pairs = rows.map((r) => [r.snaps[i].A.shown[f], r.snaps[i].B.shown[f]]);
        const shown = pairs.filter((p) => p[0] != null && p[1] != null);
        o[f] = { shownShare: +(shown.length / rows.length).toFixed(3), agentWorse: +(shown.filter((p) => (lb ? p[0] > p[1] : p[0] < p[1])).length / Math.max(1, shown.length)).toFixed(3), delta: stats(shown.map((p) => p[0] - p[1])) };
      }
      o.pickupsA = stats(rows.map((r) => r.snaps[i].A.pickups));
      out[k].snaps[m] = o;
    }
  }
  console.error('done', k);
}
console.log(JSON.stringify(out, null, 1));
