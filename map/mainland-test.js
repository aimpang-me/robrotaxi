'use strict';
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { applyMainland, ringInside } = require('./mainland');
const { isExtrudedBuilding } = require('./building-tags');
const graph = require('./toronto.graph.json'), scene = require('./toronto.scene.json');

function contains(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    if ((ring[i + 1] > y) !== (ring[j + 1] > y) && x < (ring[j] - ring[i]) * (y - ring[i + 1]) / (ring[j + 1] - ring[i + 1]) + ring[i]) inside = !inside;
  }
  return inside;
}
const inLayer = (layer, x, y) => layer.some((ring) => contains(x, y, ring));
function layersAt(lat, lon) {
  const x = (lon - graph.geo.lon0) * graph.geo.mPerLon / 10;
  const y = (graph.geo.lat0 - lat) * graph.geo.mPerLat / 10;
  return { land: inLayer(scene.land, x, y), water: scene.water.some((ring, i) => contains(x, y, ring) && !inLayer(scene.waterHoles?.[i] || [], x, y)) };
}
const dry = (lat, lon) => { const p = layersAt(lat, lon); return p.land && !p.water; };
for (const [name, lat, lon] of [
  ['City Hall', 43.6534, -79.3841], ['CN Tower', 43.6426, -79.3871],
  ['Union Station', 43.6453, -79.3806], ['Harbourfront', 43.639, -79.383],
  ['waterfront hotel', 43.6413, -79.373],
]) assert(dry(lat, lon), `${name} must have dry ground`);
for (const [name, lat, lon] of [
  ['open harbour', 43.634, -79.38], ['Rees slip', 43.638, -79.387],
  ['Spadina slip', 43.6372, -79.3915], ['western marina inlet', 43.6302, -79.411],
  ['Don River', 43.6578, -79.35425],
]) assert(!dry(lat, lon), `${name} must remain water`);
assert(layersAt(43.6578, -79.35425).water, 'Don River overlay must remain above mainland');
assert(dry(43.667776, -79.358631), 'Island House must sit on its mapped islet in Sanctuary Pond');
assert(layersAt(43.66772, -79.35895).water, 'Sanctuary Pond water beside the islet must remain visible');
assert(scene.waterHoles.some((holes) => holes.length), 'Mapped islets must cut holes in water overlays');
assert(!ringInside([1, 1, 5, 1, 5, 5, 1, 5], [0, 0, 6, 0, 6, 6, 4, 6, 4, 2, 2, 2, 2, 6, 0, 6]), 'Vertices inside a concave ring are insufficient when an edge crosses its boundary');

let covered = 0, inBounds = 0;
for (const building of scene.buildings) {
  let x = 0, y = 0, sx = 0, sy = 0, count = 0;
  for (let i = 2; i < building.length && typeof building[i] === 'number'; i += 2) {
    x += building[i] / 10; y += building[i + 1] / 10;
    sx += x; sy += y; count++;
  }
  x = sx / count; y = sy / count;
  if (x < 0 || y < 0 || x > scene.bounds.w || y > scene.bounds.h) continue;
  inBounds++;
  if (inLayer(scene.land, x, y)) covered++;
  assert(!scene.water.some((ring, i) => contains(x, y, ring) && !inLayer(scene.waterHoles?.[i] || [], x, y)), 'Building centroids must not be flooded by water overlays');
}
assert.equal(covered, inBounds, 'Every in-bounds building centroid must have land beneath it');
assert(!isExtrudedBuilding({ building: 'no', amenity: 'ferry_terminal' }), 'A ferry dock must not become a building');
assert(!isExtrudedBuilding({ building: 'roof', layer: '2' }), 'An elevated roof without a metric base must not become a ground-up box');
assert(isExtrudedBuilding({ building: 'roof', layer: '2', min_height: '10' }), 'Explicit metric base heights remain supported');
assert(isExtrudedBuilding({ 'building:part': 'yes' }), 'Building parts remain supported');
assert(isExtrudedBuilding({ building: 'yes', 'building:part': 'no' }), 'An outline is still a building when it is not a part');
assert.deepEqual(applyMainland(structuredClone(scene)), scene, 'Offline repair must be idempotent');
const browser = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'toronto.js'), 'utf8'), browser);
assert.equal(JSON.stringify(browser.window.ROBRO_MAP.graph), JSON.stringify(graph), 'Browser graph must match simulation graph');
assert.equal(JSON.stringify(browser.window.ROBRO_MAP.scene), JSON.stringify(scene), 'Browser scene must match scene artifact');
console.log(`Mainland regression passed. ${covered}/${inBounds} in-bounds building centroids have land; mainland, harbour, slips, marina, Don, repair idempotence and browser data agree.`);
