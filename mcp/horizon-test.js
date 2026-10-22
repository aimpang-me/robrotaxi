const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index-3d.html'), 'utf8');
const SCENE = require('../map/toronto.scene.json');
const MAPG = require('../map/toronto.graph.json');
const functionOf = (name) => html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
const context = vm.createContext({ SCENE, MAPG, FLOOR: 2.6, artRand: () => 0.5 });
vm.runInContext(html.slice(html.indexOf('function serviceBoundary('), html.indexOf('const ROAD_W =')) + '\n' +
  html.match(/^const flatPts =[^\n]+/m)[0] + '\n' + html.match(/^function bldRing[^\n]+/m)[0] + '\n' +
  html.match(/^const polyArea =[^\n]+/m)[0] + '\n' + functionOf('torontoLayout') + '\nthis.layout = torontoLayout(); this.project = W3; this.decode = bldRing;', context);
const buildings = context.layout.buildings;
assert.equal(buildings.length, SCENE.buildings.length, 'every source building survives the service boundary');
for (let i = 0; i < buildings.length; i++) {
  const source = SCENE.buildings[i], building = buildings[i], min = source.indexOf('m');
  assert.equal(building.y0, min < 0 ? 0 : source[min + 1], 'raised source parts keep their base height');
  assert.equal(JSON.stringify(building.pts), JSON.stringify(context.decode(source).map(p => context.project(...p))), 'full source footprints survive unchanged');
}
assert.equal(JSON.stringify(context.layout.land.map(l => l.pts)), JSON.stringify(SCENE.land.map(f => Array.from({ length: f.length / 2 }, (_, i) => context.project(f[i * 2], f[i * 2 + 1])))), 'mapped mainland and islands keep their vertices');
console.log('Complete building footprints, source base heights, and mapped land checks passed.');
vm.runInContext(functionOf('landContinuation') + '\n' + html.match(/^function inPoly[^\n]+/m)[0], context);
const before = JSON.stringify(SCENE), apron = context.landContinuation(SCENE, 1000);
assert.equal(JSON.stringify(SCENE), before, 'terrain continuation leaves the source unchanged');
for (const ring of apron) {
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  assert(Math.max(...xs) <= 0.11 || Math.min(...xs) >= SCENE.bounds.w - 0.11 || Math.max(...ys) <= 0.11 || Math.min(...ys) >= SCENE.bounds.h - 0.11, 'apron lies outside the source rectangle');
}
const covered = (x, y) => apron.filter(ring => context.inPoly(x, y, ring)).length;
for (const x of [-999, -100, 100, 500, 656, 1555]) for (const y of [-999, -100, 100, 400, 900, 1821]) assert(covered(x, y) <= 1, 'apron strips and corners do not overlap');
assert.equal(covered(-10, -10), 1, 'northwest dry corner has continuous land');
assert.equal(covered(SCENE.bounds.w + 10, -10), 1, 'northeast dry corner has continuous land');
const mainland = SCENE.land.slice(0, SCENE.mainlandPolygons).map(f => Array.from({ length: f.length / 2 }, (_, i) => [f[i * 2], f[i * 2 + 1]]));
for (let y = 0.5; y < SCENE.bounds.h; y += 2) {
  assert.equal(covered(-1, y) > 0, mainland.some(ring => context.inPoly(0.001, y, ring)), 'western continuation preserves dry and wet boundary intervals');
  assert.equal(covered(SCENE.bounds.w + 1, y) > 0, mainland.some(ring => context.inPoly(SCENE.bounds.w - 0.001, y, ring)), 'eastern continuation preserves dry and wet boundary intervals');
}
for (const [name, lat, lon] of [['harbour', 43.634, -79.38], ['Rees slip', 43.638, -79.387], ['Spadina slip', 43.6372, -79.3915], ['Don', 43.6578, -79.35425], ['Sanctuary Pond', 43.66772, -79.35895]]) {
  const x = (lon - MAPG.geo.lon0) * MAPG.geo.mPerLon / 10, y = (MAPG.geo.lat0 - lat) * MAPG.geo.mPerLat / 10;
  assert.equal(covered(x, y), 0, `${name} receives no apron land`);
}
console.log('Exterior terrain, dry corners, wet boundary intervals, and mapped water checks passed.');
class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
class Vector3 extends Vector2 { constructor(x = 0, y = 0, z = 0) { super(x, y); this.z = z; } normalize() { const length = Math.hypot(this.x, this.y, this.z); this.x /= length; this.y /= length; this.z /= length; return this; } }
class ShaderMaterial { constructor(options) { Object.assign(this, options); this.isShaderMaterial = true; } }
class BufferGeometry { constructor() { this.attributes = {}; } setAttribute(name, attribute) { this.attributes[name] = attribute; } }
class Float32BufferAttribute { constructor(array, itemSize) { this.array = array; this.count = array.length / itemSize; } }
class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; } }
const ART = { sky: null, time: { value: 0 }, waterMats: [] };
const camera = { projectionMatrixInverse: {}, matrixWorld: {} };
Object.assign(context, { THREE: { Vector2, Vector3, ShaderMaterial, BufferGeometry, Float32BufferAttribute, Mesh }, ART, camera, lin: value => value, PAL: {}, WATER_K: 0.12 });
vm.runInContext(html.slice(html.indexOf('const SKY_GRADIENT ='), html.indexOf('function landContinuation(')) + '\n' + functionOf('waterMaterial'), context);
const sky = context.skyDome();
assert.equal(sky.geometry.attributes.position.count, 3, 'background uses one full-screen triangle');
assert(sky.renderOrder < 0 && !sky.material.depthWrite && !sky.material.depthTest && !sky.frustumCulled, 'background draws before depth-tested city geometry without clipping or writing depth');
assert.equal(sky.material.uniforms.skyProjectionInverse.value, camera.projectionMatrixInverse, 'sky uses the current camera projection');
assert.equal(sky.material.uniforms.skyCameraWorld.value, camera.matrixWorld, 'sky uses the current camera world matrix');
const city = { fog: true, onBeforeCompile(shader) { shader.uniforms.wind = ART.time; } };
const route = { fog: false, onBeforeCompile() {} }, routeCompile = route.onBeforeCompile;
context.hazeMaterial(route);
assert.equal(route.onBeforeCompile, routeCompile, 'operational overlays remain exempt from haze');
context.hazeMaterial(city);
const shader = { uniforms: {}, vertexShader: '#define STANDARD\n#include <project_vertex>\n', fragmentShader: '#define STANDARD\n#include <tonemapping_fragment>\n' };
city.onBeforeCompile(shader);
assert.equal(shader.uniforms.wind, ART.time, 'haze preserves existing material animation');
assert(!city.fog, 'world haze replaces camera-distance fog on city materials');
assert(!/[^\s]#[a-z]/i.test(shader.fragmentShader), 'shader preprocessor directives begin on their own line');
const water = context.waterMaterial();
for (const key of ['atmosphereTop', 'atmosphereBand', 'atmosphereHaze']) {
  assert.equal(shader.uniforms[key], sky.material.uniforms[key], 'city and sky use the same clock color');
  assert.equal(water.uniforms[key], sky.material.uniforms[key], 'water and sky use the same clock color');
}
for (const [a, b, , , , interior] of MAPG.edges) {
  const points = [MAPG.nodes[a], MAPG.nodes[b]];
  for (let i = 0; i < interior.length; i += 2) points.push(interior.slice(i, i + 2));
  for (const point of points) {
    const [x, z] = context.project(...point);
    assert(sky.material.uniforms.hazeService.value.every(edge => edge.x * x + edge.y * z <= edge.z), 'all operational streets remain inside the clear service region');
  }
}
console.log('Depth-safe background, camera uniforms, shared haze colors, shader composition, and clear operational streets passed.');
