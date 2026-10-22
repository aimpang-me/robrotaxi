const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/core/sim-core.js', 'utf8');
function probe(code, battery = 16) {
  const context = vm.createContext({ console }); new vm.Script(source).runInContext(context);
  return JSON.parse(JSON.stringify(vm.runInContext(`(() => {
    API.gameInit({ seed: 1101, mode: 'external', demand: 2, hours: 24, shadow: false });
    const c = S.cars[0];
    Object.assign(c, { path: [304, 1267, 345], seg: 0, prog: E(304, 1267).len - .1,
      state: 'reposition', roadActive: true, battery: ${battery}, job: null, next: null, roadTrail: [] });
    S.cars = [c]; S.reqs = []; const r = spawnRequest(1267, DEPOTS[0].node);
    ${code}
  })()`, context)));
}
for (const battery of [4, 16, 80]) {
  const { option, actual, dropoff } = probe(`
    const option = options(r.id, 10).cars[0]; actDispatch(c.id, r.id, 'fixture');
    const actual = remaining(c), trip = pathStats(dijkstra(r.from, r.to, timeW).path);
    return { option, actual, dropoff: c.battery - actual.pct - trip.pct };
  `, battery);
  assert(actual.px > 100, 'front already entered the outgoing road, requiring the real Broadview detour');
  assert(Math.abs(option.pickupMin - actual.t / 60) <= .05);
  assert(Math.abs(option.emptyKm - actual.px / 100) <= .05);
  assert(Math.abs(option.batteryAtDropoff - dropoff) <= .05);
  assert.equal(option.safe, battery === 80, 'reserve includes the committed road');
  assert.equal(option.canReachChargerAfter, battery !== 4);
}
const charging = probe(`const result = actCharge(c.id, 'best', 90, 'fixture'); return { result, actual: remaining(c), battery: c.battery };`, 15);
assert(Math.abs(charging.result.driveMin - charging.actual.t / 60) <= .05);
assert(Math.abs(charging.result.batteryOnArrival - (charging.battery - charging.actual.pct)) <= .05);
assert.equal(probe(`try { actCharge(c.id, 'best', 90, 'fixture'); return false; } catch (error) { return error.message.includes('cannot reach a depot'); }`, 3.3), true);
for (const action of ['release', 'cancel', 'strand']) {
  const result = probe(`
    c.state = 'pickup'; c.job = r; r.status = 'assigned'; r.car = c;
    const before = roadBody(c);
    ${action === 'release' ? "actRelease(c.id, 'fixture');" : action === 'strand' ? 'strand(c);' : 'r.t0 = S.t - 901; for (const key of Object.keys(S.timers)) S.timers[key] = Infinity; step(0);'}
    return { before, after: roadBody(c), path: c.path, state: c.state };
  `);
  assert.deepEqual(result.after, result.before, action + ' cannot erase a body already occupying the next road');
  assert.deepEqual(result.path, [304, 1267, 345]);
  assert.equal(result.state, action === 'strand' ? 'stranded' : 'reposition');
}
assert.equal(probe(`S.external = false; agentDispatchAll(); return r.status;`, 16), 'waiting', 'scripted dispatcher uses the same committed pickup and reserve');
const scripted = probe(`S.external = false; agentDispatchAll(); return { eta: r.etaT - S.t, actual: remaining(c).t, status: r.status };`, 80);
assert.equal(scripted.status, 'assigned'); assert(Math.abs(scripted.eta - scripted.actual) < 1e-8);
for (const margin of [.25, .75]) {
  const context = vm.createContext({ console }); new vm.Script(source).runInContext(context);
  const result = JSON.parse(JSON.stringify(vm.runInContext(`(() => {
    API.gameInit({ seed: 1101, mode: 'external', shadow: false });
    const to = 291, from = adj[to][0].to, after = bestDepotByTime(to), trip = pathStats(dijkstra(from, to, timeW).path);
    const c = S.cars[0]; Object.assign(c, { path: [from], seg: 0, prog: 0, state: 'idle', roadActive: false, battery: trip.pct + after.st.pct + ${margin}, job: null, next: null });
    S.cars = [c]; S.reqs = []; const r = spawnRequest(from, to), option = options(r.id, 10).cars[0];
    c.path = [to]; c.battery -= trip.pct;
    let accepted = true; try { actCharge(c.id, 'best', 90, 'fixture'); } catch { accepted = false; }
    return { option, accepted };
  })()`, context)));
  assert.equal(result.option.canReachChargerAfter, result.accepted, 'charger flag and automatic selection must use the same unrounded arrival margin');
  assert.equal(result.accepted, margin >= .5);
}
console.log('Committed route checks pass for MCP and scripted pickup estimates, reserve, automatic charging, release, cancellation and stranded occupancy.');
