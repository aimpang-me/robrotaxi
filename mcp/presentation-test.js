const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const graph = require('../map/toronto.graph.json');
const pages = ['index.html', 'index-3d.html'].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
const simulation = (html) => {
  const start = html.indexOf('/* ---------------- seeded random'), step = html.indexOf('function step(dt) {'), end = html.indexOf('\n}\n', step);
  assert(start >= 0 && step > start && end > step, 'simulation boundaries exist');
  return html.slice(start, end + 3);
};
assert(simulation(pages[0]) === simulation(pages[1]), '2D and 3D share identical simulation rules');
const functionOf = (html, name) => html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
{
  const scene = require('../map/toronto.scene.json');
  const context = vm.createContext({ SCENE: { ...scene, buildings: [], parks: [] }, W3: (x, y) => [x * 10, y * 10] });
  vm.runInContext(pages[1].match(/^const flatPts =[^\n]+/m)[0] + '\n' + functionOf(pages[1], 'torontoLayout') + '\nthis.layout = torontoLayout();', context);
  assert(context.layout.rivers.every((w) => w.pts.every((p) => p.every(Number.isFinite)) && w.holes.every((ring) => ring.every((p) => p.every(Number.isFinite)))), 'water and islet holes project to finite 3D coordinates');
  assert.equal(context.layout.rivers.reduce((n, w) => n + w.holes.length, 0), scene.waterHoles.flat().length, '3D layout retains every mapped water hole');
}
const contexts = pages.map((html) => {
  for (const [, source] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(source);
  const context = vm.createContext({ MAPG: graph });
  const geometry = html.slice(html.indexOf('function serviceBoundary('), html.indexOf('const SERVICE ='));
  vm.runInContext(geometry + '\nthis.service = serviceBoundary(MAPG.play, 14);', context);
  return context;
});
assert.equal(JSON.stringify(contexts[0].service), JSON.stringify(contexts[1].service), 'both views use the same city edge');
for (const context of contexts) {
  const { service, insideService, serviceBoundary } = context;
  const roadWidth = (flags, kmh) => flags & 2 ? (flags & 1 ? 1.4 : 2.4) : kmh >= 50 ? 1.8 : kmh >= 40 ? 1.4 : 1;
  for (const [a, b, flags, kmh, , interior] of graph.edges) {
    const pts = [graph.nodes[a], graph.nodes[b]];
    for (let i = 0; i < interior.length; i += 2) pts.push(interior.slice(i, i + 2));
    for (const [x, y] of pts) {
      assert(insideService(x, y, service, roadWidth(flags, kmh) / 2 + 0.25), 'all graph roads and casings remain inside the edge');
      assert(insideService(x, y, service, 11.76), 'maximum 3D incident footprint remains inside the edge');
    }
  }
  const reversed = serviceBoundary([...graph.play].reverse(), 14).reverse();
  for (let i = 0; i < service.length; i++) assert(Math.hypot(service[i][0] - reversed[i][0], service[i][1] - reversed[i][1]) < 1e-6, 'offset is independent of polygon winding');
  assert(insideService(250, 250), 'a city pickup is eligible');
  assert(!insideService(-100, -100), 'an exterior pickup is refused');
}
for (const html of pages) {
  const context = vm.createContext({});
  vm.runInContext(functionOf(html, 'displayHeading'), context);
  const { displayHeading } = context;
  const after = (frames) => {
    const record = {};
    displayHeading(record, 179, 0, false);
    for (let frame = 1; frame <= frames; frame++) displayHeading(record, -179, frame * 1000 / frames, false);
    return record.heading;
  };
  assert(Math.abs(after(30) - after(60)) < 1e-9 && Math.abs(after(60) - after(144)) < 1e-9, 'heading damping depends on elapsed time, not frame count');
  assert(after(60) > 179 && after(60) < 181, 'a turn across the angle wrap takes the short path');
  const record = { heading: 20, headingAt: 0 };
  assert.equal(displayHeading(record, 90, 16, true), 90, 'reduced motion uses the current heading immediately');
  assert.equal(displayHeading(record, 120, 2000, false), 120, 'resuming after a long suspension snaps to the current heading');
}
const svgNode = () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, classList: { toggle() {} } });
for (const route of [[0], [0, 1]]) {
  const car = { i: 0, state: 'idle', path: route, seg: 0, prog: 0, ang: 0, x: 12, y: 34, battery: 60, job: null };
  const record = { heading: 170, headingAt: 0 };
  for (const key of ['grp', 'num', 'body', 'lamp', 'ring', 'face', 'route', 'under']) record[key] = svgNode();
  const context = vm.createContext({ S: { cars: [car], selected: null, hoverCar: null }, carEls: new Map([[car, record]]), nodes: [{ x: 100, y: 100 }], E: () => ({ oneway: false }), $: svgNode, UI: 1, LANE: 0.45, tagSize: 11, LAMP: {}, ROUTE_COL: {}, reduceMotion: false });
  vm.runInContext(['carPos', 'parkedPose', 'displayHeading', 'renderMap'].map((name) => functionOf(pages[0], name)).join('\n'), context);
  const before = JSON.stringify(car);
  context.renderMap(100);
  assert.equal(record.body.attrs.transform, 'rotate(170.0) scale(0.95)', 'stopped and zero-progress cars retain their last display heading');
  assert.equal(JSON.stringify(car), before, 'rendering a stopped car leaves authoritative car fields unchanged');
  if (route.length > 1) {
    record.heading = 180;
    car.state = 'hold';
    context.renderMap(116);
    const stoppedPose = record.grp.attrs.transform;
    assert.equal(stoppedPose, 'translate(100.00 99.55) scale(1.0000)', 'a westbound car holds in its right-hand lane');
    car.prog = 0.01;
    context.edgeAt = () => ({ x: 100, y: 100, ang: 180 });
    context.renderMap(132);
    assert.equal(record.grp.attrs.transform, stoppedPose, 'starting a held car does not jump across the road');
    assert.equal(car.ang, 0, 'lane placement does not write its heading into the simulation');
  }
}
const ribbonContext = vm.createContext({ MK: 1 });
vm.runInContext(functionOf(pages[1], 'writeRibbon'), ribbonContext);
const geometry = { attributes: { position: { array: new Float32Array(18) } }, setDrawRange(start, count) { this.count = count; } };
ribbonContext.writeRibbon({ ribbon: { geometry }, max: 1 }, [[0, 0, 9.9], [100, 0, 9.9]], 100);
for (let i = 1; i < 18; i += 3) assert(geometry.attributes.position.array[i] > 9.9, 'elevated route paint stays above the road deck');
ribbonContext.writeRibbon({ ribbon: { geometry }, max: 1 }, [[0, 0, 0], [100, 0, 10]], 50);
assert(Math.abs(geometry.attributes.position.array[4] - 5.35) < 1e-5, 'partially drawn route paint interpolates its endpoint height');
const atNear = Array.from(geometry.attributes.position.array);
ribbonContext.MK = 14;
ribbonContext.writeRibbon({ ribbon: { geometry }, max: 1 }, [[0, 0, 0], [100, 0, 10]], 50);
assert.deepEqual(Array.from(geometry.attributes.position.array), atNear, 'route paint width and road clearance stay in metres at every camera distance');
assert(Math.abs(Math.abs(geometry.attributes.position.array[2] - geometry.attributes.position.array[8]) - 0.7) < 1e-5, 'partially drawn route paint keeps its 0.7 metre width');
const roofContext = vm.createContext({});
vm.runInContext(['inPoly', 'roofBoxFits'].map((name) => functionOf(pages[1], name)).join('\n'), roofContext);
const roof = [[0, 0], [20, 0], [20, 20], [0, 20]];
assert(roofContext.roofBoxFits(10, 10, 4, 3, Math.PI / 4, roof), 'roof equipment fits inside a rotated footprint');
assert(!roofContext.roofBoxFits(19, 10, 4, 3, 0, roof), 'roof equipment cannot overhang an edge');
const courtyard = [[0, 0], [20, 0], [20, 20], [14, 20], [14, 7], [6, 7], [6, 20], [0, 20]];
assert(!roofContext.roofBoxFits(10, 14, 15, 3, 0, courtyard), 'roof equipment cannot bridge a concave courtyard even when all its corners fit');
assert(roofContext.roofBoxFits(3, 12, 3, 6, 0, courtyard), 'roof equipment can occupy an irregular building wing');
console.log('Presentation syntax, boundary clearance, heading timing, render isolation, camera-independent route paint, and roof footprint checks passed.');
