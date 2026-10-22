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
