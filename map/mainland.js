'use strict';
const fs = require('fs'), path = require('path');
const crypto = require('crypto');
const source = require('./source/lake-ontario-shoreline.json');
const { removeLegacyNonBuildings } = require('./building-tags');

function ringInside(inner, outer) {
  const points = (ring) => Array.from({ length: ring.length / 2 }, (_, i) => [ring[i * 2], ring[i * 2 + 1]]);
  const a = points(inner), b = points(outer);
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const touches = (p, q, r) => Math.abs(cross(p, q, r)) < 1e-8 && r[0] >= Math.min(p[0], q[0]) && r[0] <= Math.max(p[0], q[0]) && r[1] >= Math.min(p[1], q[1]) && r[1] <= Math.max(p[1], q[1]);
  for (const p of a) {
    let inside = false;
    for (let i = 0, j = b.length - 1; i < b.length; j = i++) {
      if (touches(b[j], b[i], p)) return false;
      if ((b[i][1] > p[1]) !== (b[j][1] > p[1]) && p[0] < (b[j][0] - b[i][0]) * (p[1] - b[i][1]) / (b[j][1] - b[i][1]) + b[i][0]) inside = !inside;
    }
    if (!inside) return false;
  }
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p = a[i], q = a[(i + 1) % a.length], r = b[j], s = b[(j + 1) % b.length];
    if (touches(p, q, r) || touches(p, q, s)) return false;
    if (cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0) return false;
  }
  return true;
}

function mainlandPolygons(bounds) {
  const { s, w, n } = source.bbox, lat = (n + s) / 2 * Math.PI / 180;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * lat) + 1.175 * Math.cos(4 * lat);
  const mLon = 111412.84 * Math.cos(lat) - 93.5 * Math.cos(3 * lat);
  const W = bounds.w, H = bounds.h, nodes = new Map(), edges = [];
  const key = (p) => p.map((v) => v.toFixed(7)).join(',');
  function node(p) {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { p, edges: [] });
    return nodes.get(k);
  }
  function edge(points, dry = null) {
    const a = node(points[0]), b = node(points.at(-1));
    if (a === b) throw new Error('Shoreline contains a closed or degenerate segment');
    const forward = { a, b, points, dry }, backward = { a: b, b: a, points: points.slice().reverse(), dry: dry === null ? null : !dry };
    forward.twin = backward; backward.twin = forward;
    a.edges.push(forward); b.edges.push(backward); edges.push(forward, backward);
  }
  function clip(a, b) {
    let lo = 0, hi = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    for (const [p, q] of [[-dx, a[0]], [dx, W - a[0]], [-dy, a[1]], [dy, H - a[1]]]) {
      if (!p) { if (q < 0) return null; continue; }
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      if (lo >= hi) return null;
    }
    const at = (t) => [Math.max(0, Math.min(W, a[0] + t * dx)), Math.max(0, Math.min(H, a[1] + t * dy))];
    return [at(lo), at(hi)];
  }
  for (const way of source.ways) for (const segment of way.segments) {
    const points = segment.map(([lon, la]) => [(lon - w) * mLon / 10, (n - la) * mLat / 10]);
    let chain = [];
    const flush = () => { if (chain.length > 1) edge(chain, false); chain = []; };
    for (let i = 1; i < points.length; i++) {
      const pair = clip(points[i - 1], points[i]);
      if (!pair) { flush(); continue; }
      if (chain.length && key(chain.at(-1)) !== key(pair[0])) flush();
      if (!chain.length) chain.push(pair[0]);
      chain.push(pair[1]);
    }
    flush();
  }
  for (const p of [[0, 0], [W, 0], [W, H], [0, H]]) node(p);
  const perimeter = ([x, y]) => y === 0 ? x : x === W ? W + y : y === H ? 2 * W + H - x : 2 * (W + H) - y;
  const boundary = [...nodes.values()].filter(({ p: [x, y] }) => x === 0 || x === W || y === 0 || y === H)
    .sort((a, b) => perimeter(a.p) - perimeter(b.p));
  for (let i = 0; i < boundary.length; i++) edge([boundary[i].p, boundary[(i + 1) % boundary.length].p]);
  for (const n of nodes.values()) {
    if (n.edges.length < 2) throw new Error(`Shoreline stops inside the scene at ${n.p}`);
    const angle = (e) => Math.atan2(e.points[1][1] - n.p[1], e.points[1][0] - n.p[0]);
    n.edges.sort((a, b) => angle(a) - angle(b));
  }
  const land = [], visited = new Set();
  for (const start of edges) {
    if (visited.has(start)) continue;
    const ring = [], sides = new Set();
    let current = start;
    do {
      if (visited.has(current)) throw new Error('Shoreline face does not close');
      visited.add(current); ring.push(...current.points.slice(0, -1));
      if (current.dry !== null) sides.add(current.dry);
      const outgoing = current.b.edges, reverse = outgoing.indexOf(current.twin);
      current = outgoing[(reverse + outgoing.length - 1) % outgoing.length];
    } while (current !== start);
    const area = ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
    if (area <= 0) continue;
    if (sides.size !== 1) throw new Error('Lake shoreline directions disagree around a face');
    if (sides.has(true)) land.push(ring.flatMap((p) => p.map((v) => Math.round(v * 10) / 10)));
  }
  if (!land.length) throw new Error('Lake shoreline produced no mainland');
  return land;
}

function applyMainland(scene) {
  removeLegacyNonBuildings(scene);
  const mainland = mainlandPolygons(scene.bounds);
  scene.land = mainland.concat(scene.land.slice(scene.mainlandPolygons || 0));
  scene.mainlandPolygons = mainland.length;
  const invalid = new Set(source.legacyOpenWaterPolygons.map((p) => p.sha256));
  scene.water = scene.water.filter((ring) => !invalid.has(crypto.createHash('sha256').update(JSON.stringify(ring)).digest('hex')));
  scene.waterHoles = scene.water.map((outer) => scene.land.slice(scene.mainlandPolygons).filter((inner) => ringInside(inner, outer)));
  return scene;
}

module.exports = { mainlandPolygons, applyMainland, ringInside };

if (require.main === module) {
  const scenePath = path.join(__dirname, 'toronto.scene.json');
  const scene = applyMainland(JSON.parse(fs.readFileSync(scenePath, 'utf8')));
  const graph = fs.readFileSync(path.join(__dirname, 'toronto.graph.json'), 'utf8');
  fs.writeFileSync(scenePath, JSON.stringify(scene));
  fs.writeFileSync(path.join(__dirname, 'toronto.js'), `// GENERATED by map/build.js from OpenStreetMap data (${scene.attribution}). Do not edit.\nwindow.ROBRO_MAP = { graph: ${graph}, scene: ${JSON.stringify(scene)} };\n`);
  console.log(`Rebuilt ${scene.mainlandPolygons} mainland polygons from OSM relation ${source.relation}; graph unchanged.`);
}
