const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'core/sim-core.js'), 'utf8');
const graph = {
  bounds: { w: 100, h: 100 }, names: ['Fixture road'],
  nodes: [[0, 0], [10, 0], [10.5, 0], [11, 0], [21, 0], [10, -10], [10, 10], [10.5, -10], [10.5, 10]],
  edges: [[0, 1], [1, 2], [2, 3], [3, 4], [5, 1], [1, 6], [7, 2], [2, 8]].map(([a, b]) => [a, b, 0, 50, 0, []]),
  districts: [{ name: 'Fixture', node: 1, w: 1 }], hq: { name: 'HQ', node: 0 }, chargers: [], landmarks: [],
};
function fixture(real = false, map = graph) {
  const fixtureSource = source.replace(/const ROBRO_MAP = \{ graph: [^\n]+/, 'const ROBRO_MAP = { graph: ' + JSON.stringify(map) + ' };');
  const context = vm.createContext({ console });
  new vm.Script(real ? source : fixtureSource).runInContext(context);
  vm.runInContext(`
    initCars(); S.cars = []; S.traffic.vehicles = []; G = { start: S.t, cap: 86400, finishT: null };
    this.F = {
      get world() { return S; }, get edges() { return edges; },
      add(id, path, prog = 0, extra = {}) {
        const car = { id, path, seg: 0, prog, state: 'reposition', battery: 80, known: new Set(),
          job: null, next: null, routeVer: 0, roadTrail: [], roadDistance: 0, waitSince: null, ...extra };
        Object.assign(car, carPos(car)); S.cars.push(car); return car;
      },
      move(dt = .5) { S.t += dt; advanceRoadTraffic(dt); },
      body: roadBody, clone: cloneWorld, setRoute, plan: planFrom,
      init(seed) { initTraffic(S, seed); },
      streams() { seedStreams(1234); const before = [rD(), rH(), rC()]; initTraffic(S, 1234); return [before, [rD(), rH(), rC()]]; },
      streamsOnly() { seedStreams(1234); return [[rD(), rH(), rC()], [rD(), rH(), rC()]]; },
      known() { return state().knownHazards; },
      snapshot: liveSnap,
      incident(edge) { S.incidents.push({ id: 1, edge: edges[edge], type: 'crash', seen: false, until: S.t + 500 }); edges[edge].blocked = true; },
    };
  `, context);
  return context.F;
}
const json = (x) => JSON.parse(JSON.stringify(x));
function assertBodies(f) {
  const lanes = new Map();
  for (const car of [...f.world.cars, ...f.world.traffic.vehicles]) {
    if (car.path.length < 2 || car.roadActive === false || ['idle', 'charging'].includes(car.state)) continue;
    for (const p of f.body(car)) {
      const key = p.a + '-' + p.b;
      for (const o of lanes.get(key) || []) if (o.id !== car.id) {
        assert(Math.min(o.end, p.end) - Math.max(o.start, p.start) < 1e-8, `${car.id} overlaps ${o.id} on ${key}`);
      }
      if (!lanes.has(key)) lanes.set(key, []);
      lanes.get(key).push({ ...p, id: car.id });
    }
  }
}
let checks = 0;
function test(name, run) { run(); checks++; console.log('ok', name); }

test('a stopped lead physically slows a taxi without charging for blocked distance', () => {
  const f = fixture(), lead = f.add('T-01', [0, 1], 7, { state: 'stranded', strandUntil: Infinity });
  const follower = f.add('T-02', [0, 1], 2);
  const before = follower.battery;
  for (let i = 0; i < 30; i++) { f.move(); assertBodies(f); }
  assert(Math.abs(follower.prog - (lead.prog - .48 - .2)) < 1e-8);
  assert(Math.abs(before - follower.battery - follower.roadDistance * .01) < 1e-8);
  assert.equal(follower.speed, 0);
});
test('a parked taxi waits for a safe gap before entering moving traffic', () => {
  const f = fixture(), lead = f.add('V-0001', [0, 1], .1);
  f.world.cars.splice(f.world.cars.indexOf(lead), 1);
  Object.assign(lead, { model: 'sedan', length: .48, turn: 1, index: 0 });
  f.world.traffic.vehicles.push(lead);
  const taxi = f.add('T-01', [0], 0, { state: 'idle', roadActive: false });
  f.setRoute(taxi, { path: [0, 1], seg: 0, prog: 0 }); taxi.state = 'reposition';
  f.move(); assertBodies(f);
  assert.equal(taxi.prog, 0); assert.equal(taxi.roadActive, false);
  assert(lead.prog > .1, 'the existing traffic can clear the entry');
  for (let i = 0; i < 20; i++) { f.move(); assertBodies(f); }
  assert(taxi.roadDistance > 2, 'the taxi joins after clearance');
});

test('a blocked departure discovers and reroutes before admission to the final lane', () => {
  const map = json(graph); map.edges.push([0, 5, 0, 50, 0, []]);
  const f = fixture(false, map);
  f.world.agent = true; f.world.periods.agent = { ...f.world.periods.exec };
  const lead = f.add('T-02', [0, 5, 1, 6], .4, { state: 'stranded', strandUntil: Infinity });
  const taxi = f.add('T-01', [0, 1, 6], 0, { roadActive: false });
  f.incident(0);
  for (let i = 0; i < 20; i++) { f.move(); assertBodies(f); }
  assert.equal(taxi.path[1], 5);
  assert.equal(taxi.roadActive, false); assert.equal(taxi.prog, 0);
  assert.equal(lead.prog, .4);
});

test('rerouting preserves the exit already occupied by a vehicle front', () => {
  const f = fixture(), car = f.add('T-01', [0, 1, 2, 3, 4], 9.99, { length: 1.1 });
  const plan = f.plan(car, 6);
  assert.deepEqual(json(plan.path.slice(0, 4)), [0, 1, 2, 3]);
});

test('opposing lanes pass independently', () => {
  const f = fixture(), a = f.add('T-01', [0, 1], 3), b = f.add('T-02', [1, 0], 3);
  for (let i = 0; i < 6; i++) { f.move(); assertBodies(f); }
  assert(a.prog > 5 && b.prog > 5);
});
test('crossing traffic yields and both approaches make progress', () => {
  const f = fixture(), a = f.add('T-01', [0, 1, 6], 9), b = f.add('T-02', [5, 1, 2, 3, 4], 9);
  let waits = 0;
  for (let i = 0; i < 45; i++) {
    f.move(); assertBodies(f);
    if (a.speed === 0 || b.speed === 0) waits++;
    const near = [a, b].filter((v) => {
      if (v.seg === 0) return 10 - v.prog < .36 - 1e-8;
      return v.seg === 1 && v.prog < .36 - 1e-8;
    });
    assert(near.length <= 1, 'junction contains only one crossing body');
  }
  assert(waits > 0); assert(a.roadDistance > 5 && b.roadDistance > 5);
});
test('a bus reserves an entire short connector chain atomically', () => {
  const f = fixture(), bus = f.add('T-01', [0, 1, 2, 3, 4], 9, { length: 1.1 });
  const cross = f.add('T-02', [7, 2, 8], 9.6, { waitSince: f.world.traffic.clock - 2 });
  f.move();
  assert(bus.prog <= 10 - .55 - .12 + 1e-8, 'bus waits before the chain while its second node is occupied');
  assert(!Object.values(f.world.traffic.locks).some((l) => l.id === bus.id), 'denied bus owns no partial chain');
  for (let i = 0; i < 35; i++) { f.move(); assertBodies(f); }
  assert(bus.roadDistance > 3 && cross.roadDistance > 3);
});
test('opposing vehicles clear their previous junction while yielding to the next one', () => {
  const map = json(graph); map.nodes[2][0] = 10.9; map.nodes[3][0] = 11.8;
  const f = fixture(false, map);
  const a = f.add('T-01', [0, 1, 2, 8], 9.8, { length: .58 });
  const b = f.add('T-02', [7, 2, 1, 6], 9.8);
  for (let i = 0; i < 30; i++) { f.move(); assertBodies(f); }
  assert(a.roadDistance > 3 && b.roadDistance > 3, 'neither vehicle keeps its previous node locked while it can clear its rear');
});
test('an eight-metre turnaround does not trap an entering and exiting vehicle', () => {
  const map = json(graph); map.nodes[2][0] = 10.824621125123526;
  map.edges = map.edges.filter(([a, b]) => a !== 2 && b !== 2 || a === 1 && b === 2);
  const f = fixture(false, map);
  const entering = f.add('T-01', [0, 1, 2, 1, 6], 9.905401859477133, { length: .5 });
  const exiting = f.add('T-02', [2, 1, 6], .4846211251235265, { length: .44 });
  f.world.traffic.locks[1] = { id: entering.id, clearAt: .46459814052286674, parkUntil: f.world.traffic.clock + 2 };
  for (let i = 0; i < 40; i++) { f.move(); assertBodies(f); }
  assert(entering.roadDistance > 2 && exiting.roadDistance > 2, 'both vehicles clear without releasing an occupied junction or teleporting');
});
test('route replacement retains the rear body on the previous edge', () => {
  const f = fixture(), car = f.add('T-01', [0, 1, 2, 3, 4], 9.7, { length: 1.1 });
  f.move();
  assert.equal(car.seg, 1);
  f.setRoute(car, { path: [1, 2, 8], seg: 0, prog: car.prog });
  assert(f.body(car).some((p) => p.a === 0 && p.b === 1 && p.end === 10), 'rear remains on approach after reroute');
  const follower = f.add('T-02', [0, 1, 6], 9);
  for (let i = 0; i < 15; i++) { f.move(); assertBodies(f); }
  assert(follower.roadDistance > 1);
});
test('arrival retains clearance until its body has parked', () => {
  const f = fixture(), first = f.add('T-01', [0, 1], 9.7), next = f.add('T-02', [5, 1, 6], 9);
  f.move(); assert.equal(first.state, 'idle');
  assert.equal(f.world.traffic.locks[1].id, first.id);
  assert(f.world.traffic.ghosts.some((g) => g.id === first.id));
  for (let i = 0; i < 12; i++) f.move();
  assert(next.roadDistance > 2);
});
test('movement cannot tunnel through a stopped vehicle on a later tiny edge', () => {
  const f = fixture(), first = f.add('T-01', [3, 4], .2, { state: 'stranded', strandUntil: Infinity });
  const next = f.add('T-02', [0, 1, 2, 3, 4], 8);
  f.move(30); assertBodies(f);
  assert(next.roadDistance <= 2 - .36 + 1e-8);
  assert.equal(first.prog, .2);
});
test('physical distance and stranding agree at battery exhaustion', () => {
  const f = fixture(), car = f.add('T-01', [0, 1], 2, { battery: .001 });
  f.move();
  assert.equal(car.state, 'stranded');
  assert(Math.abs(car.prog - 2.1) < 1e-8);
  assert(Math.abs(car.roadDistance - .1) < 1e-8);
});
test('fractional traffic consumption cannot leave an exhausted taxi stuck on a positive rounding residue', () => {
  const f = fixture(), battery = .000082715989;
  f.edges[0].traffic = 1.347;
  const car = f.add('T-01', [0, 1], 2, { battery });
  f.move();
  assert.equal(car.state, 'stranded'); assert.equal(car.battery, 0);
  assert(Math.abs(car.roadDistance - battery / (.01 * (1 + .25 * .347))) < 1e-12);
});

test('ambient initialization is legal, deterministic, isolated from demand and hazards', () => {
  const f = fixture(true);
  assert.deepEqual(json(f.streams()), json(f.streamsOnly()));
  f.init(1101); const a = json(f.world.traffic);
  f.init(1101); assert.deepEqual(json(f.world.traffic), a);
  assert.equal(a.vehicles.length, 240); assertBodies(f);
  for (const v of a.vehicles) for (let i = 0; i < v.path.length - 1; i++) {
    assert(f.edges.some((e) => e.a === v.path[i] && e.b === v.path[i + 1] || !e.oneway && e.b === v.path[i] && e.a === v.path[i + 1]));
  }
  const clone = f.clone(f.world);
  clone.traffic.vehicles[0].path.push(-1); clone.traffic.locks[1] = { id: 'other' };
  clone.traffic.vehicles[0].roadTrail[0].start = -50;
  assert.deepEqual(json(f.world.traffic), a);
});
test('deterministic replay does not depend on actor array order or tick batching', () => {
  const a = fixture(), b = fixture();
  for (const f of [a, b]) { f.add('T-01', [0, 1, 6], 8); f.add('T-02', [5, 1, 2, 3, 4], 8); }
  b.world.cars.reverse();
  a.move(10); for (let i = 0; i < 20; i++) b.move();
  const state = (f) => json(f.world.cars).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(state(a), state(b));
});
test('ambient occupancy does not publish an unseen incident', () => {
  const f = fixture(); f.incident(0);
  f.init(1101); f.move(10);
  assert.deepEqual(json(f.known()), []);
});
test('the real city keeps legal disjoint bodies through repeated edge transitions', () => {
  const f = fixture(true); f.init(2207);
  const identities = f.world.traffic.vehicles.map(({ id, model, color }) => ({ id, model, color }));
  for (let i = 0; i < 1200; i++) { f.move(); assertBodies(f); }
  assert.deepEqual(f.world.traffic.vehicles.map(({ id, model, color }) => ({ id, model, color })), identities);
  assert(f.world.traffic.vehicles.filter((v) => v.roadDistance > 100).length > 200);
  const snapshot = f.snapshot(0);
  snapshot.traffic.vehicles[0].path.push(-1);
  assert(!f.world.traffic.vehicles[0].path.includes(-1));
});
test('ambient circulation skips terminal courts while taxis can still serve them', () => {
  const map = json(graph);
  map.nodes = [[0, 0], [10, 0], [10, 10], [0, 10], [20, 0], [30, 0]];
  map.edges = [[0, 1], [1, 2], [2, 3], [3, 0], [1, 4], [4, 5]].map(([a, b]) => [a, b, 0, 50, 0, []]);
  const f = fixture(false, map); f.init(2207);
  assert.equal(f.world.traffic.vehicles.length, 8, 'both directions of the four through roads are populated');
  const taxi = f.add('T-01', [0, 1, 4, 5], 0, { roadActive: false });
  for (let i = 0; i < 240; i++) {
    f.move(); assertBodies(f);
    for (const v of f.world.traffic.vehicles) assert(v.path.every((n) => n < 4), 'ambient route extensions stay out of the whole terminal branch');
  }
  assert.equal(taxi.state, 'idle'); assert.equal(taxi.path[taxi.seg], 5, 'taxi destination routes still reach the terminal court');
});
test('a road network without a through circuit retains legal ambient traffic', () => {
  const f = fixture(); f.init(1101);
  assert(f.world.traffic.vehicles.length > 0, 'tree-only fixtures use the legal network fallback');
  for (let i = 0; i < 20; i++) { f.move(); assertBodies(f); }
});
test('dispatch, pickups, dropoffs and road traffic share disjoint road occupancy', () => {
  const context = vm.createContext({ console }); new vm.Script(source).runInContext(context);
  context.API.gameInit({ seed: 3313, mode: 'scripted', demand: 2, hours: 24, shadow: false });
  vm.runInContext('this.F = { get world() { return S; }, body: roadBody };', context);
  for (let i = 0; i < 600; i++) { context.API.tick(); assertBodies(context.F); }
  assert(context.API.score().ledger.trips > 0);
});
console.log(`${checks} physical traffic checks passed`);
