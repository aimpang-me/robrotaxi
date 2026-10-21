// Reference dispatchers that play through the same calls the MCP tools make.
// lazy: oldest rider gets any free car, charges only when nearly empty.
// greedy: picks rider/car pairs by fare per car-minute, checks battery, charges early, chains rides.
const ECON_WAIT = (econ, waitedMin) => Math.max(econ.floor, 1 - econ.latePerMin * Math.max(0, waitedMin - econ.freeWaitMin));

function lazyTurn(g) {
  const st = g.state();
  const free = st.cars.filter((c) => c.state === 'idle');
  for (const c of free) if (c.battery < 12) { try { g.charge(c.id, 'best', 100); } catch { /* unreachable */ } }
  const waiting = st.riders.filter((r) => r.status === 'waiting').sort((a, b) => b.waitedMin - a.waitedMin);
  const avail = g.state().cars.filter((c) => c.state === 'idle');
  for (const r of waiting) { const c = avail.shift(); if (!c) break; try { g.dispatch(c.id, r.id); } catch { /* skip */ } }
  return g.advance(120, false);
}

function greedyTurn(g, opt = {}) {
  const econ = g.info.econ;
  const lowAt = opt.lowAt ?? 25, chargeTo = opt.chargeTo ?? 80;
  let st = g.state();
  const waiting = st.riders.filter((r) => r.status === 'waiting');
  // charge idle cars that are low, unless they are the only answer to a waiting rider nearby
  for (const c of st.cars) if (c.state === 'idle' && c.battery < lowAt) { try { g.charge(c.id, 'best', waiting.length > 4 ? 70 : chargeTo, 'Low battery; charging while the queue is covered.'); } catch { /* ignore */ } }
  // global greedy matching on fare per car-minute
  const pairs = [];
  for (const r of waiting) {
    const o = g.options(r.id, 10);
    if (!o.cars) continue;
    for (const c of o.cars) {
      if (!c.safe) continue;
      if (c.state === 'charging' && c.batteryNow < 45) continue;
      if (c.state === 'riding' && c.pickupMin > 8) continue;
      if (r.cancelsInMin != null && c.pickupMin > r.cancelsInMin - 0.5) continue;
      const fare = r.rescue ? r.fullFare * econ.rescueShare : r.fullFare * ECON_WAIT(econ, r.waitedMin + c.pickupMin);
      const value = (fare - (c.emptyKm + o.tripKm) * econ.energyPerPct) / (c.pickupMin + o.tripMin + 1.5) + (r.rescue ? 400 : 0);
      pairs.push({ r: r.id, c: c.car, value });
    }
  }
  pairs.sort((a, b) => b.value - a.value);
  const usedR = new Set(), usedC = new Set();
  for (const p of pairs) {
    if (usedR.has(p.r) || usedC.has(p.c)) continue;
    try { g.dispatch(p.c, p.r, `Best fare per car-minute (${Math.round(p.value)} $/min).`); usedR.add(p.r); usedC.add(p.c); } catch { /* state moved */ }
  }
  // idle cars with nothing to do and under 60% top up
  st = g.state();
  if (!st.riders.some((r) => r.status === 'waiting')) for (const c of st.cars) if (c.state === 'idle' && c.battery < 60) { try { g.charge(c.id, 'best', 90, 'Quiet moment, topping up.'); } catch { /* ignore */ } }
  return g.advance(opt.step ?? 90, true);
}

function play(g, turn, opt) { let n = 0; while (!g.over() && n < 20000) { turn(g, opt); n++; } return g.summary(); }

module.exports = { lazyTurn, greedyTurn, play };
