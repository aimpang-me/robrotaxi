// Cuts downtown Toronto out of an OpenStreetMap .osm.pbf (BBBike Toronto or Geofabrik Ontario) and writes
// map/osm/{roads,buildings,land,poi}.json.gz in the same Overpass JSON shape fetch-osm.js writes, so build.js
// works from either. Use it when the Overpass servers are busy.
// Usage: cd map && npm install && node cut-pbf.js Toronto.osm.pbf
// Data © OpenStreetMap contributors, ODbL 1.0.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const parseOSM = require('osm-pbf-parser');

const SCENE = { s: 43.600, w: -79.412, n: 43.674, e: -79.343 };   // same box as fetch-osm.js
const KEEP = { s: 43.590, w: -79.425, n: 43.684, e: -79.330 };    // a margin so coastline and edge roads clip cleanly
const inBox = (b, lat, lon) => lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;

// the same selections as the Overpass queries in fetch-osm.js
const T = (t, k, re) => t[k] != null && re.test(t[k]);
const isRoad = (t) => t.highway != null;
const isBuilding = (t) => t.building != null || t['building:part'] != null;
const isLand = (t) => T(t, 'natural', /water|coastline|beach|wood|scrub|grassland|wetland/) || t.water != null || t.waterway != null
  || T(t, 'leisure', /park|garden|pitch|stadium|marina|golf_course|playground/) || t.landuse != null || T(t, 'place', /island|islet/)
  || t.railway != null || t.aeroway != null;
const isPoi = (t) => T(t, 'amenity', /charging_station|parking|fuel|hospital|university|college|townhall|theatre|ferry_terminal/) || t.tourism != null
  || T(t, 'man_made', /tower|pier|breakwater/) || t.public_transport === 'station' || t.railway === 'station'
  || T(t, 'building', /stadium|train_station|government|civic/) || t.leisure === 'stadium';
const groups = (t) => [isRoad(t) && 'roads', isBuilding(t) && 'buildings', isLand(t) && 'land', isPoi(t) && 'poi'].filter(Boolean);

async function main(file) {
  if (!file) throw new Error('usage: node cut-pbf.js <file.osm.pbf>');
  const coord = new Map(), ways = new Map(), out = { roads: [], buildings: [], land: [], poi: [] }, rels = [];
  let n = 0;
  const onItems = (items) => {
    for (const it of items) {
      if (++n % 2e6 === 0) process.stdout.write(`  ${(n / 1e6).toFixed(0)}M elements read\n`);
      const t = it.tags || {};
      if (it.type === 'node') {
        if (!inBox(KEEP, it.lat, it.lon)) continue;
        coord.set(it.id, [it.lat, it.lon]);
        if (Object.keys(t).length && inBox(SCENE, it.lat, it.lon)) for (const g of groups(t)) out[g].push({ type: 'node', id: it.id, lat: it.lat, lon: it.lon, tags: t });
      } else if (it.type === 'way') {
        const ids = [], geometry = [];
        for (const r of it.refs) { const c = coord.get(r); if (c) { ids.push(r); geometry.push({ lat: c[0], lon: c[1] }); } }
        if (ids.length < 2) continue;
        const w = { type: 'way', id: it.id, nodes: ids, geometry, tags: t };
        ways.set(it.id, w);
        const scene = geometry.some((g) => inBox(SCENE, g.lat, g.lon));
        const coast = t.natural === 'coastline';
        if (!scene && !coast) continue;
        for (const g of groups(t)) out[g].push(w);
      } else if (it.type === 'relation') {
        if (t.type !== 'multipolygon' && !t.building) continue;
        const gs = groups(t); if (!gs.length) continue;
        rels.push({ it, gs });
      }
    }
  };
  await new Promise((ok, fail) => { const s = fs.createReadStream(file).on('error', fail).pipe(parseOSM()); s.on('data', onItems); s.on('end', ok); s.on('error', fail); });
  for (const { it, gs } of rels) {
    const members = it.members.filter((m) => m.type === 'way' && ways.has(m.id)).map((m) => ({ type: 'way', ref: m.id, role: m.role, geometry: ways.get(m.id).geometry }));
    if (!members.some((m) => m.geometry.some((g) => inBox(SCENE, g.lat, g.lon)))) continue;
    const r = { type: 'relation', id: it.id, members, tags: it.tags };
    for (const g of gs) out[g].push(r);
  }
  const dir = path.join(__dirname, 'osm'); fs.mkdirSync(dir, { recursive: true });
  for (const [k, els] of Object.entries(out)) {
    els.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.id - b.id));
    const f = path.join(dir, k + '.json.gz');
    fs.writeFileSync(f, zlib.gzipSync(JSON.stringify({ version: 0.6, generator: 'robrotaxi cut-pbf.js from ' + path.basename(file), elements: els }), { level: 9 }));
    console.log(`${k}: ${els.length} elements, ${(fs.statSync(f).size / 1e6).toFixed(1)} MB gz`);
  }
}
main(process.argv[2]).catch((e) => { console.error(e.message); process.exit(1); });
