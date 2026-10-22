const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const graph = require('../map/toronto.graph.json');
const pages = ['index.html', 'index-3d.html'].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
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
console.log('Presentation syntax, boundary parity, road clearance, marker clearance, and pickup eligibility passed.');
