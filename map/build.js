// Builds the RobroTaxi city from the raw OpenStreetMap extract in map/osm/ (see fetch-osm.js).
// Writes map/toronto.graph.json (the sim), map/toronto.scene.json (renderers) and map/toronto.js (pages).
// Format: map/FORMAT.md. Deterministic: the same extract always gives the same files.
// Data © OpenStreetMap contributors, ODbL 1.0.
// Usage: node map/build.js [osm-dir]
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { applyMainland } = require('./mainland');
const { isExtrudedBuilding } = require('./building-tags');
const OSM = process.argv[2] || path.join(__dirname, 'osm');
const OUT = __dirname;
const ATTRIBUTION = '© OpenStreetMap contributors, ODbL 1.0';

/* ---------------- projection: 1 unit = 10 m, x east, y south ---------------- */
const BBOX = { s: 43.600, w: -79.412, n: 43.674, e: -79.343 };   // scene extent (same as fetch-osm.js)
const LAT0 = BBOX.n, LON0 = BBOX.w, LATC = (BBOX.n + BBOX.s) / 2 * Math.PI / 180;
const M_LAT = 111132.92 - 559.82 * Math.cos(2 * LATC) + 1.175 * Math.cos(4 * LATC);
const M_LON = 111412.84 * Math.cos(LATC) - 93.5 * Math.cos(3 * LATC);
const U = 10;
const px = (lon) => (lon - LON0) * M_LON / U, py = (lat) => (LAT0 - lat) * M_LAT / U;
const P = (g) => [px(g.lon), py(g.lat)];
const r1 = (v) => Math.round(v * 10) / 10;
const BOUNDS = { w: r1(px(BBOX.e)), h: r1(py(BBOX.s)) };

// Drivable area: Bloor St to the waterfront, Bathurst St to the Don Valley Parkway, a little outside each boundary street.
const PLAY = [[43.6672, -79.4128], [43.6766, -79.3532], [43.6372, -79.3494], [43.6328, -79.4038]].map(([la, lo]) => [px(lo), py(la)]);

/* ---------------- load ---------------- */
function load(name) {
  const f = path.join(OSM, name + '.json.gz');
  if (!fs.existsSync(f)) throw new Error(`missing ${f}: run node map/fetch-osm.js where OSM is reachable`);
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')).elements;
}
const roadsRaw = load('roads'), buildingsRaw = load('buildings'), landRaw = load('land'), poiRaw = load('poi');

/* ---------------- geometry helpers ---------------- */
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function area(ring) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return a / 2; }
function centroid(ring) { let x = 0, y = 0; for (const p of ring) { x += p[0]; y += p[1]; } return [x / ring.length, y / ring.length]; }
function plen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); let best = -1, bd = eps;
    for (let k = i + 1; k < j; k++) { const d = segDist(pts[k], pts[i], pts[j]); if (d > bd) { bd = d; best = k; } }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
function simplifyRing(ring, eps) {
  if (ring.length < 4) return ring;
  const open = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  // split at the farthest point from the first so RDP has two anchored halves
  let far = 0, fd = -1; for (let k = 1; k < open.length; k++) { const d = Math.hypot(open[k][0] - open[0][0], open[k][1] - open[0][1]); if (d > fd) { fd = d; far = k; } }
  const a = rdp(open.slice(0, far + 1), eps), b = rdp([...open.slice(far), open[0]], eps);
  return [...a, ...b.slice(1, -1)];
}
// chain way geometries that share end points into closed rings (multipolygon members)
function assembleRings(lines) {
  const key = (p) => p[0].toFixed(2) + ',' + p[1].toFixed(2);
  const pool = lines.filter((l) => l.length > 1).map((l) => l.slice()), rings = [];
  while (pool.length) {
    let cur = pool.shift();
    for (let guard = 0; guard < 10000 && key(cur[0]) !== key(cur[cur.length - 1]); guard++) {
      const end = key(cur[cur.length - 1]);
      const i = pool.findIndex((l) => key(l[0]) === end || key(l[l.length - 1]) === end);
      if (i < 0) break;
      const l = pool.splice(i, 1)[0];
      cur = cur.concat((key(l[0]) === end ? l : l.reverse()).slice(1));
    }
    if (cur.length > 3) rings.push(cur);
  }
  return rings;
}
function polysOf(el) {   // outer rings (with holes dropped) of a way or multipolygon relation
  if (el.type === 'way' && el.geometry) return [el.geometry.map(P)];
  if (el.type === 'relation' && el.members) {
    const outer = el.members.filter((m) => m.type === 'way' && m.geometry && m.role !== 'inner').map((m) => m.geometry.map(P));
    return assembleRings(outer);
  }
  return [];
}
// Liang-Barsky style clip of a polyline to an axis box; returns the inside pieces
function clipLine(pts, X0, Y0, X1, Y1) {
  const ins = (p) => p[0] >= X0 && p[0] <= X1 && p[1] >= Y0 && p[1] <= Y1;
  const cut = (a, b) => { // point where segment a(in) -> b(out) crosses the box
    let t = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx > 0) t = Math.min(t, (X1 - a[0]) / dx); if (dx < 0) t = Math.min(t, (X0 - a[0]) / dx);
    if (dy > 0) t = Math.min(t, (Y1 - a[1]) / dy); if (dy < 0) t = Math.min(t, (Y0 - a[1]) / dy);
    return [a[0] + dx * t, a[1] + dy * t];
  };
  const out = []; let cur = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], pin = ins(p);
    if (pin) { if (!cur) { cur = i > 0 ? [cut(p, pts[i - 1])] : []; } cur.push(p); }
    else if (cur) { cur.push(cut(pts[i - 1], p)); out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.length > 1);
}
const flat = (ring) => { const o = []; for (const p of ring) o.push(r1(p[0]), r1(p[1])); return o; };
// integer metres, first point absolute, rest as deltas: compact for big polygon sets
const packRing = (ring) => { const o = []; let lx = 0, ly = 0; for (const p of ring) { const x = Math.round(p[0] * U), y = Math.round(p[1] * U); o.push(x - lx, y - ly); lx = x; ly = y; } return o; };

/* ---------------- roads → graph ---------------- */
const DRIVE = { motorway: 90, trunk: 60, primary: 50, secondary: 40, tertiary: 40, unclassified: 30, residential: 30, living_street: 20,
  motorway_link: 50, trunk_link: 40, primary_link: 40, secondary_link: 40, tertiary_link: 30 };
const CLS = { motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary' };
function speedOf(t) {
  const m = /^(\d+)/.exec(t.maxspeed || '');
  if (m) { let v = +m[1]; if (/mph/.test(t.maxspeed)) v = Math.round(v * 1.609); if (v >= 10 && v <= 110) return v; }
  if (/urban/.test(t.maxspeed || '')) return 50;
  return DRIVE[t.highway];
}
function onewayOf(t) {
  const o = t.oneway;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'yes' || o === '1' || o === 'true') return 1;
  if (o === 'no') return 0;
  if (t.junction === 'roundabout' || t.junction === 'circular' || t.highway === 'motorway' || t.highway === 'motorway_link') return 1;
  return 0;
}
const ways = roadsRaw.filter((w) => w.type === 'way' && w.tags && DRIVE[w.tags.highway] && w.geometry && w.nodes &&
  !/^(private|no)$/.test(w.tags.access || '') && w.tags.area !== 'yes' && !/^(no|private)$/.test(w.tags.motor_vehicle || w.tags.motorcar || ''));
const names = [], nameIdx = new Map();
function nameOf(t) {
  const n = t.name || t.ref || '';
  if (!n) return -1;
  if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); }
  return nameIdx.get(n);
}
// OSM nodes shared by two ways (or way ends) become graph nodes
const use = new Map(), coord = new Map();
for (const w of ways) w.nodes.forEach((id, i) => {
  coord.set(id, P(w.geometry[i]));
  use.set(id, (use.get(id) || 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1));
});
const inside = (id) => { const c = coord.get(id); return inPoly(c[0], c[1], PLAY); };
const gid = new Map(), gnodes = [];
const nodeOf = (id) => { if (!gid.has(id)) { gid.set(id, gnodes.length); gnodes.push(coord.get(id)); } return gid.get(id); };
let raw = [];   // { a, b, ow, flags, kmh, name, pts: [[x,y]...] full polyline a..b }
for (const w of ways) {
  const t = w.tags, ow = onewayOf(t);
  const flags = (ow ? 1 : 0) | (/^motorway/.test(t.highway) ? 2 : 0) | (t.bridge && t.bridge !== 'no' ? 4 : 0) | (t.tunnel && t.tunnel !== 'no' ? 8 : 0)
    | (/Gardiner/.test(t.name || '') && t.highway === 'motorway' ? 16 : 0);
  const kmh = speedOf(t), name = nameOf(t);
  let cur = null;
  const flush = () => { if (cur && cur.ids.length > 1) {
    const ids = ow === -1 ? cur.ids.slice().reverse() : cur.ids;
    raw.push({ a: nodeOf(ids[0]), b: nodeOf(ids[ids.length - 1]), flags, kmh, name, pts: ids.map((id) => coord.get(id)), cls: t.highway });
  } cur = null; };
  for (let i = 0; i < w.nodes.length; i++) {
    const id = w.nodes[i];
    if (!inside(id)) { flush(); continue; }
    if (!cur) cur = { ids: [] };
    cur.ids.push(id);
    if (cur.ids.length > 1 && use.get(id) > 1) { flush(); cur = { ids: [id] }; }
  }
  flush();
}
raw = raw.filter((e) => e.a !== e.b || e.pts.length > 3);
// drop exact duplicates (same direction, same geometry ends) keeping the first
{ const seen = new Set(); raw = raw.filter((e) => { const k = `${e.a}-${e.b}-${e.flags & 1}-${Math.round(plen(e.pts))}`; if (seen.has(k)) return false; seen.add(k); return true; }); }

// largest strongly connected component (Kosaraju, iterative)
function sccKeep(N, E) {
  const out = Array.from({ length: N }, () => []), inn = Array.from({ length: N }, () => []);
  for (const e of E) { out[e.a].push(e.b); inn[e.b].push(e.a); if (!(e.flags & 1)) { out[e.b].push(e.a); inn[e.a].push(e.b); } }
  const seen = new Uint8Array(N), order = [];
  for (let s = 0; s < N; s++) {
    if (seen[s]) continue; const st = [[s, 0]]; seen[s] = 1;
    while (st.length) { const top = st[st.length - 1]; const nb = out[top[0]];
      if (top[1] < nb.length) { const v = nb[top[1]++]; if (!seen[v]) { seen[v] = 1; st.push([v, 0]); } } else { order.push(top[0]); st.pop(); } }
  }
  const comp = new Int32Array(N).fill(-1); let nc = 0; const size = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const s = order[k]; if (comp[s] >= 0) continue; let cnt = 0; const st = [s]; comp[s] = nc;
    while (st.length) { const u = st.pop(); cnt++; for (const v of inn[u]) if (comp[v] < 0) { comp[v] = nc; st.push(v); } }
    size.push(cnt); nc++;
  }
  const big = size.indexOf(Math.max(...size));
  return (n) => comp[n] === big;
}
{
  const ok = sccKeep(gnodes.length, raw);
  raw = raw.filter((e) => ok(e.a) && ok(e.b));
}

// contract pass-through nodes: two edges of the same street meeting at a node nothing else touches
function contract() {
  for (let pass = 0; pass < 20; pass++) {
    const at = new Map(); const push = (n, e) => { if (!at.has(n)) at.set(n, []); at.get(n).push(e); };
    raw.forEach((e) => { push(e.a, e); push(e.b, e); });
    const dead = new Set(); let merged = 0;
    for (const [n, list] of at) {
      if (list.length !== 2) continue;
      const [e1, e2] = list;
      if (dead.has(e1) || dead.has(e2) || e1 === e2) continue;
      if (e1.flags !== e2.flags || e1.kmh !== e2.kmh || e1.name !== e2.name || e1.cls !== e2.cls) continue;
      let A, B;
      if (e1.flags & 1) {
        if (e1.b === n && e2.a === n) { A = e1; B = e2; } else if (e2.b === n && e1.a === n) { A = e2; B = e1; } else continue;
      } else {
        A = e1.b === n ? e1 : { ...e1, a: e1.b, b: e1.a, pts: e1.pts.slice().reverse() };
        B = e2.a === n ? e2 : { ...e2, a: e2.b, b: e2.a, pts: e2.pts.slice().reverse() };
      }
      if (A.a === B.b) continue; // would make a loop
      const m = { ...A, b: B.b, pts: A.pts.concat(B.pts.slice(1)) };
      dead.add(e1); dead.add(e2); raw.push(m); merged++;
    }
    raw = raw.filter((e) => !dead.has(e));
    if (!merged) break;
  }
}
contract();
raw = raw.filter((e) => e.a !== e.b);
// two edges joining the same pair of nodes (a crescent and the street it leaves): the sim keys edges by node pair,
// so split the longer one at a middle vertex into a new node
{
  const seen = new Set(); const extra = [];
  raw.sort((p, q) => plen(p.pts) - plen(q.pts));
  for (const e of raw) {
    const dirs = e.flags & 1 ? [e.a + '-' + e.b] : [e.a + '-' + e.b, e.b + '-' + e.a];
    if (dirs.some((k) => seen.has(k))) {
      let pts = e.pts;
      if (pts.length < 3) pts = [pts[0], [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2], pts[1]];
      const m = Math.floor(pts.length / 2), n = gnodes.length; gnodes.push(pts[m]);
      extra.push({ ...e, b: n, pts: pts.slice(0, m + 1) }, { ...e, a: n, pts: pts.slice(m) });
      e.dead = true; continue;
    }
    dirs.forEach((k) => seen.add(k));
  }
  raw = raw.filter((e) => !e.dead).concat(extra);
}

// renumber nodes compactly
const used = [...new Set(raw.flatMap((e) => [e.a, e.b]))].sort((p, q) => p - q);
const remap = new Map(used.map((n, i) => [n, i]));
const nodes = used.map((n) => [r1(gnodes[n][0]), r1(gnodes[n][1])]);
const edges = raw.map((e) => {
  const pts = rdp(e.pts, 0.25).slice(1, -1);
  return [remap.get(e.a), remap.get(e.b), e.flags, e.kmh, e.name, flat(pts)];
}).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
const edgeCls = raw.map((e) => e.cls);

/* ---------------- snapping helpers ---------------- */
// adjacency, with motorway-only nodes marked (riders can't be picked up there)
const nodeEdges = nodes.map(() => []);
edges.forEach((e, i) => { nodeEdges[e[0]].push(i); nodeEdges[e[1]].push(i); });
const streetNode = nodes.map((_, n) => nodeEdges[n].some((i) => !(edges[i][2] & 2)));
function snap(x, y, street = true) {
  let best = -1, bd = Infinity;
  nodes.forEach((p, n) => { if (street && !streetNode[n]) return; const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = n; } });
  return { node: best, d: bd };
}
const LL = (lat, lon) => [px(lon), py(lat)];
const elCenter = (el) => el.center ? P(el.center) : el.lat != null ? P(el) : el.geometry ? centroid(el.geometry.map(P))
  : el.bounds ? LL((el.bounds.minlat + el.bounds.maxlat) / 2, (el.bounds.minlon + el.bounds.maxlon) / 2) : null;

/* ---------------- chargers and HQ ---------------- */
const chargersAll = poiRaw.filter((el) => el.tags && el.tags.amenity === 'charging_station').map((el) => {
  const c = elCenter(el); if (!c || !inPoly(c[0], c[1], PLAY)) return null;
  const t = el.tags, cap = Math.max(1, Math.min(8, parseInt(t.capacity || t['socket:type2'] || '2', 10) || 2));
  const nm = t.name || (t.operator ? `${t.operator}${t['addr:street'] ? ' ' + (t['addr:housenumber'] ? t['addr:housenumber'] + ' ' : '') + t['addr:street'] : ''}` : null) || t.network || 'EV charging';
  const s = snap(c[0], c[1]);
  return { name: nm, x: c[0], y: c[1], cap, node: s.node, d: s.d, osm: `${el.type}/${el.id}`, tesla: /tesla/i.test(JSON.stringify(t)) };
}).filter(Boolean).filter((c) => c.d < 15);
// pick depots: biggest sites first, spread at least 1.2 km apart, up to 4
const depots = [];
for (const c of [...chargersAll].sort((p, q) => q.cap - p.cap || (q.tesla - p.tesla) || p.osm.localeCompare(q.osm))) {
  if (depots.length >= 4) break;
  if (depots.some((d) => Math.hypot(d.x - c.x, d.y - c.y) < 120)) continue;
  depots.push(c);
}
// a charging site is named by who runs it and the street it is on
function streetAt(n) { const e = edges.find((e) => (e[0] === n || e[1] === n) && e[4] >= 0); return e ? names[e[4]] : null; }
const chargers = depots.map((c) => {
  const st = streetAt(c.node), who = /^EV charging$/.test(c.name) ? 'EV charging' : c.name.replace(/ Destination Charger$/, '');
  return { name: st && !c.name.includes(st) ? `${who} · ${st}` : who, node: c.node, bays: 3, osm: c.osm };
});

// HQ: a real multi-storey car park near the rail corridor east of Union, else the largest parking lot in the play area
const lots = poiRaw.filter((el) => el.tags && el.tags.amenity === 'parking' && el.geometry).map((el) => {
  const ring = el.geometry.map(P), c = centroid(ring);
  return { el, c, a: Math.abs(area(ring)) * U * U, multi: /multi-storey|underground/.test(el.tags.parking || '') };
}).filter((l) => inPoly(l.c[0], l.c[1], PLAY));
const hqLot = lots.sort((p, q) => (q.multi - p.multi) || q.a - p.a)[0];
const hq = hqLot ? { name: `RobroTaxi HQ${hqLot.el.tags.name ? ' (' + hqLot.el.tags.name + ')' : ''}`, node: snap(hqLot.c[0], hqLot.c[1]).node, osm: `${hqLot.el.type}/${hqLot.el.id}` }
  : { name: 'RobroTaxi HQ', node: snap(...LL(43.6455, -79.3806)).node };

/* ---------------- demand districts and landmarks ---------------- */
// rider demand centres (lat, lon, relative weight); weights follow how busy each area is for ride-hailing
const DISTRICTS = [
  ['Financial District', 43.6484, -79.3810, 3.4], ['Union Station', 43.6453, -79.3806, 3.0], ['Entertainment District', 43.6464, -79.3911, 2.8],
  ['Yonge-Dundas', 43.6561, -79.3802, 2.6], ['Yorkville', 43.6710, -79.3900, 2.2], ['University of Toronto', 43.6629, -79.3957, 2.0],
  ['Kensington-Chinatown', 43.6535, -79.3990, 1.8], ['St. Lawrence', 43.6487, -79.3716, 1.6], ['Church-Wellesley', 43.6655, -79.3807, 1.5],
  ['Harbourfront', 43.6390, -79.3830, 1.4], ['CityPlace', 43.6410, -79.3955, 1.3], ['Distillery District', 43.6503, -79.3596, 1.1],
  ['Regent Park', 43.6597, -79.3630, 0.9], ['Queen West', 43.6485, -79.4040, 1.2],
];
const districts = DISTRICTS.map(([name, la, lo, w]) => { const s = snap(...LL(la, lo)); return { name, node: s.node, w }; });
const LANDMARKS = [
  ['CN Tower', 43.6426, -79.3871, 'tower', 553], ['Union Station', 43.6453, -79.3806, 'station'], ['Scotiabank Arena', 43.6435, -79.3791, 'arena'],
  ['Rogers Centre', 43.6414, -79.3894, 'stadium'], ['Toronto City Hall', 43.6534, -79.3841, 'civic'], ['Royal Ontario Museum', 43.6677, -79.3948, 'museum'],
  ['St. Lawrence Market', 43.6487, -79.3716, 'market'], ['Eaton Centre', 43.6544, -79.3807, 'mall'], ['Queen\'s Park', 43.6625, -79.3920, 'civic'],
  ['Jack Layton Ferry Terminal', 43.6404, -79.3755, 'ferry'], ['Ripley\'s Aquarium', 43.6424, -79.3860, 'museum'], ['Art Gallery of Ontario', 43.6536, -79.3925, 'museum'],
];
const landmarksG = LANDMARKS.map(([name, la, lo]) => ({ name, node: snap(...LL(la, lo)).node }));

/* ---------------- scene: land, water, parks, rail ---------------- */
const SB = [0, 0, BOUNDS.w, BOUNDS.h];
const waterPolys = [], landPolys = [], parkPolys = [], railLines = [];
// mainland and islands from the coastline (land on the left of the way's direction)
{
  const coast = landRaw.filter((el) => el.type === 'way' && el.tags && el.tags.natural === 'coastline' && el.geometry).map((el) => el.geometry.map(P));
  const chains = assembleRings(coast).concat([]);
  // assembleRings returns closed rings and also open chains that couldn't close; split them
  const key = (p) => p[0].toFixed(2) + ',' + p[1].toFixed(2);
  for (const ch of chains) {
    if (key(ch[0]) === key(ch[ch.length - 1])) {           // closed ring: an island
      if (ch.some((p) => p[0] >= 0 && p[0] <= BOUNDS.w && p[1] >= 0 && p[1] <= BOUNDS.h)) landPolys.push(ch);
      continue;
    }
    // open chain crossing the box: clip and close each piece along the box edge, going round with land on the left
    for (const piece of clipLine(ch, ...SB)) {
      const per = (p) => { const [x, y] = p; const W = BOUNDS.w, H = BOUNDS.h; // perimeter position, clockwise from top-left (screen coords)
        if (Math.abs(y) < 1e-6) return x; if (Math.abs(x - W) < 1e-6) return W + y; if (Math.abs(y - H) < 1e-6) return 2 * W + H - x; return 2 * W + 2 * H - y; };
      const corners = [[0, 0, 0], [BOUNDS.w, 0, BOUNDS.w], [BOUNDS.w, BOUNDS.h, BOUNDS.w + BOUNDS.h], [0, BOUNDS.h, 2 * BOUNDS.w + BOUNDS.h]];
      const L = 2 * (BOUNDS.w + BOUNDS.h);
      const exit = per(piece[piece.length - 1]), entry = per(piece[0]);
      // land is on the left of travel; in screen coords (y down) that means we go counter-clockwise from exit back to entry
      const ring = piece.slice();
      let pos = exit; const target = entry;
      const dist = (from, to) => ((from - to) % L + L) % L; // ccw distance
      const cs = corners.map((c) => ({ p: [c[0], c[1]], d: dist(pos, c[2]) })).filter((c) => c.d > 1e-6 && c.d < dist(pos, target)).sort((p, q) => p.d - q.d);
      for (const c of cs) ring.push(c.p);
      landPolys.push(ring);
    }
  }
}
for (const el of landRaw) {
  const t = el.tags || {};
  if (t.natural === 'coastline') continue;
  if (el.type === 'way' && t.railway && /^(rail|light_rail|subway)$/.test(t.railway) && !t.tunnel && el.geometry) { railLines.push(el.geometry.map(P)); continue; }
  const isWater = t.natural === 'water' || t.water || t.waterway === 'riverbank' || t.waterway === 'dock' || t.leisure === 'marina' && false;
  const isLand = t.place === 'island' || t.place === 'islet';
  const isPark = /^(park|garden|pitch|golf_course|playground)$/.test(t.leisure || '') || /^(grass|recreation_ground|cemetery|village_green|forest|meadow)$/.test(t.landuse || '') || /^(wood|scrub|grassland|wetland|beach)$/.test(t.natural || '');
  if (!isWater && !isLand && !isPark) continue;
  for (const ring of polysOf(el)) {
    if (ring.length < 4) continue;
    if (isWater && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) continue;
    const a = Math.abs(area(ring)) * U * U; if (a < 150) continue;
    const c = centroid(ring); if (c[0] < -50 || c[1] < -50 || c[0] > BOUNDS.w + 50 || c[1] > BOUNDS.h + 50) continue;
    (isWater ? waterPolys : isLand ? landPolys : parkPolys).push(ring);
  }
}
const simp = (rings, eps) => rings.map((r) => simplifyRing(r, eps)).filter((r) => r.length >= 3);

/* ---------------- scene: buildings ---------------- */
const levels = (t) => parseFloat(t['building:levels'] || '');
function heightOf(t) {
  const h = parseFloat((t.height || '').replace(',', '.'));
  if (h > 0 && h < 700) return h;
  const l = levels(t); if (l > 0) return l * 3.2 + (parseFloat(t['roof:levels'] || '') || 0) * 2;
  const b = t.building || t['building:part'] || '';
  return /^(house|detached|semidetached_house|terrace|garage|garages|shed|roof|kiosk|hut)$/.test(b) ? 8 : /^(apartments|residential)$/.test(b) ? 14 : /^(commercial|office|retail|hotel)$/.test(b) ? 18 : 10;
}
const minH = (t) => parseFloat(t.min_height || '') || (parseFloat(t['building:min_level'] || '') || 0) * 3.2;
const outlines = [], parts = [];
for (const el of buildingsRaw) {
  const t = el.tags || {};
  if (!isExtrudedBuilding(t)) continue;
  if (t.building === 'construction' && !t.height) continue;
  if (t.location === 'underground' || t.layer && +t.layer < 0) continue;
  const isPart = !!t['building:part'] && !t.building;
  for (const ring of polysOf(el)) {
    if (ring.length < 4) continue;
    const a = Math.abs(area(ring)) * U * U; if (a < (isPart ? 8 : 30)) continue;
    const c = centroid(ring); if (c[0] < 0 || c[1] < 0 || c[0] > BOUNDS.w || c[1] > BOUNDS.h) continue;
    const b = { ring, c, a, h: heightOf(t), mh: minH(t), name: t.name || null, id: `${el.type}/${el.id}`, tags: t };
    (isPart ? parts : outlines).push(b);
  }
}
// an outline that has parts inside it is drawn by its parts instead
{
  const G = 20, grid = new Map(), k = (x, y) => Math.floor(x / G) + ',' + Math.floor(y / G);
  parts.forEach((p) => { const kk = k(p.c[0], p.c[1]); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(p); });
  for (const o of outlines) {
    let xs = o.ring.map((p) => p[0]), ys = o.ring.map((p) => p[1]);
    const x0 = Math.floor(Math.min(...xs) / G), x1 = Math.floor(Math.max(...xs) / G), y0 = Math.floor(Math.min(...ys) / G), y1 = Math.floor(Math.max(...ys) / G);
    let has = false;
    for (let gx = x0; gx <= x1 && !has; gx++) for (let gy = y0; gy <= y1 && !has; gy++) for (const p of grid.get(gx + ',' + gy) || []) if (inPoly(p.c[0], p.c[1], o.ring)) { has = true; break; }
    o.hasParts = has;
  }
}
const blds = outlines.filter((o) => !o.hasParts).concat(parts)
  .sort((p, q) => p.c[1] - q.c[1] || p.c[0] - q.c[0])
  .map((b) => { const ring = simplifyRing(b.ring, 0.12); return ring.length >= 3 ? { ...b, ring } : null; }).filter(Boolean);
// style hint for renderers: 0 other, 1 house, 2 apartments, 3 office/retail/hotel, 4 civic/church/school, 5 industrial/parking, 6 glass facade
function typeOf(t) {
  const b = t.building || t['building:part'] || '', m = (t['building:material'] || t['building:facade:material'] || '') + (t['building:colour'] || '');
  if (/glass/.test(m)) return 6;
  if (/^(house|detached|semidetached_house|terrace|bungalow)$/.test(b)) return 1;
  if (/^(apartments|residential|dormitory)$/.test(b)) return 2;
  if (/^(commercial|office|retail|hotel|supermarket)$/.test(b)) return 3;
  if (/^(civic|government|public|church|cathedral|chapel|school|university|college|hospital|museum|train_station|transportation|stadium)$/.test(b) || t.historic) return 4;
  if (/^(industrial|warehouse|garage|garages|parking|service|shed|roof)$/.test(b)) return 5;
  return 0;
}
const buildings = blds.map((b) => b.mh > 0.5 ? [Math.round(b.h), typeOf(b.tags), ...packRing(b.ring), 'm', Math.round(b.mh)] : [Math.round(b.h), typeOf(b.tags), ...packRing(b.ring)]);

/* ---------------- scene: landmarks with footprints ---------------- */
const landmarks = LANDMARKS.map(([name, la, lo, kind, hFix]) => {
  const [x, y] = LL(la, lo);
  const near = blds.filter((b) => Math.hypot(b.c[0] - x, b.c[1] - y) < 25);
  const byName = near.filter((b) => b.name && b.name.toLowerCase().includes(name.toLowerCase().split(' ')[0].replace(/'s$/, '')));
  const hit = (byName.length ? byName : near.filter((b) => inPoly(x, y, b.ring))).sort((p, q) => q.a - p.a)[0];
  return { name, kind, x: r1(hit ? hit.c[0] : x), y: r1(hit ? hit.c[1] : y), h: hFix || (hit ? Math.round(Math.max(...near.filter((b) => b === hit || (hit && inPoly(b.c[0], b.c[1], hit.ring))).map((b) => b.h))) : 20), poly: hit ? flat(hit.ring) : [] };
});

/* ---------------- scene: roads outside the play area, and minor roads, drawn but not driven ---------------- */
const minor = [];
for (const w of roadsRaw) {
  if (w.type !== 'way' || !w.tags || !w.geometry) continue;
  const h = w.tags.highway;
  const drive = DRIVE[h] && !/^(private|no)$/.test(w.tags.access || '');
  if (!drive && !/^(service|pedestrian)$/.test(h)) continue;
  const pts = w.geometry.map(P);
  if (drive) {   // only the parts outside the play area
    let cur = []; const pieces = [];
    for (const p of pts) { if (!inPoly(p[0], p[1], PLAY)) cur.push(p); else { if (cur.length > 1) pieces.push(cur); cur = []; } }
    if (cur.length > 1) pieces.push(cur);
    for (const pc of pieces) for (const c of clipLine(pc, ...SB)) minor.push([/^(motorway|trunk|primary|secondary)/.test(h) ? 2 : 1, ...flat(rdp(c, 0.4))]);
  } else if (w.tags.service !== 'parking_aisle' && w.tags.access !== 'private') {
    for (const c of clipLine(pts, ...SB)) minor.push([0, ...flat(rdp(c, 0.4))]);
  }
}

/* ---------------- write ---------------- */
const graph = {
  version: 1, attribution: ATTRIBUTION, source: 'OpenStreetMap via Overpass, downtown Toronto',
  geo: { lat0: LAT0, lon0: LON0, mPerLat: r1(M_LAT), mPerLon: r1(M_LON), mPerUnit: U }, bounds: BOUNDS,
  play: PLAY.map((p) => [r1(p[0]), r1(p[1])]),
  names, nodes, edges, chargers, hq, districts, landmarks: landmarksG,
};
const scene = {
  version: 1, attribution: ATTRIBUTION, bounds: BOUNDS,
  land: simp(landPolys, 0.3).map(flat), water: simp(waterPolys, 0.3).map(flat), parks: simp(parkPolys, 0.3).map(flat),
  rail: railLines.flatMap((l) => clipLine(l, ...SB)).map((l) => flat(rdp(l, 0.4))), minor,
  buildingsEncoding: 'each building: [heightM, type, x0, y0, dx1, dy1, ...]: footprint in integer metres from the map origin, first point absolute then deltas; optional trailing "m", minHeightM. type: 0 other, 1 house, 2 apartments, 3 office/retail/hotel, 4 civic/church/school, 5 industrial/parking, 6 glass',
  buildings, landmarks,
};
applyMainland(scene);
const j = (o) => JSON.stringify(o);
fs.writeFileSync(path.join(OUT, 'toronto.graph.json'), j(graph));
fs.writeFileSync(path.join(OUT, 'toronto.scene.json'), j(scene));
fs.writeFileSync(path.join(OUT, 'toronto.js'), `// GENERATED by map/build.js from OpenStreetMap data (${ATTRIBUTION}). Do not edit.\nwindow.ROBRO_MAP = { graph: ${j(graph)}, scene: ${j(scene)} };\n`);
const kb = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB';
const roadKm = edges.reduce((s, e) => { const pts = [nodes[e[0]], ...Array.from({ length: e[5].length / 2 }, (_, i) => [e[5][2 * i], e[5][2 * i + 1]]), nodes[e[1]]]; return s + plen(pts); }, 0) * U / 1000;
console.log(`graph: ${nodes.length} nodes, ${edges.length} edges (${edges.filter((e) => e[2] & 1).length} one-way, ${edges.filter((e) => e[2] & 2).length} motorway), ${roadKm.toFixed(1)} km of road, ${names.length} names → ${kb('toronto.graph.json')}`);
console.log(`chargers: ${chargersAll.length} in area, depots: ${chargers.map((c) => c.name + ' x' + c.bays).join('; ')}`);
console.log(`hq: ${hq.name} (${hq.osm || 'fallback'})`);
console.log(`scene: ${buildings.length} buildings, ${scene.land.length} land, ${scene.water.length} water, ${scene.parks.length} parks, ${scene.rail.length} rail, ${minor.length} minor → ${kb('toronto.scene.json')}; toronto.js ${kb('toronto.js')}`);
console.log('landmarks:', landmarks.map((l) => `${l.name} ${l.h}m${l.poly.length ? '' : ' (no footprint)'}`).join(', '));
