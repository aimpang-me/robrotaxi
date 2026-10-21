// Downloads the raw OpenStreetMap data for downtown Toronto from Overpass.
// Run where OSM is reachable: node map/fetch-osm.js  → map/osm/*.json.gz
// Data © OpenStreetMap contributors, ODbL 1.0.
const fs = require('fs'), path = require('path'), zlib = require('zlib');

// south, west, north, east: Bloor to the Islands, west of Spadina to past the Don.
const BBOX = '43.600,-79.412,43.674,-79.343';
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const Q = {
  roads: `way["highway"](${BBOX});`,
  buildings: `way["building"](${BBOX});relation["building"](${BBOX});way["building:part"](${BBOX});`,
  land: `nwr["natural"~"water|coastline|beach|wood|scrub|grassland|wetland"](${BBOX});
         nwr["water"](${BBOX});nwr["waterway"](${BBOX});
         nwr["leisure"~"park|garden|pitch|stadium|marina|golf_course|playground"](${BBOX});
         nwr["landuse"](${BBOX});nwr["place"~"island|islet"](${BBOX});
         way["railway"](${BBOX});nwr["aeroway"](${BBOX});
         way["natural"="coastline"](43.55,-79.50,43.70,-79.25);`,
  poi: `nwr["amenity"~"charging_station|parking|fuel|hospital|university|college|townhall|theatre|ferry_terminal"](${BBOX});
        nwr["tourism"](${BBOX});nwr["man_made"~"tower|pier|breakwater"](${BBOX});
        nwr["public_transport"="station"](${BBOX});nwr["railway"="station"](${BBOX});
        nwr["building"~"stadium|train_station|government|civic"](${BBOX});nwr["leisure"="stadium"](${BBOX});`,
};

async function run(name, body) {
  const query = `[out:json][timeout:300][maxsize:1073741824];(${body});out body geom;`;
  for (const url of MIRRORS) {
    try {
      process.stdout.write(`${name}: ${url} ... `);
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'robrotaxi-map-build/1.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = await r.text();
      const j = JSON.parse(txt);
      if (!j.elements || !j.elements.length) throw new Error('no elements ' + (j.remark || ''));
      const out = path.join(__dirname, 'osm', name + '.json.gz');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, zlib.gzipSync(txt, { level: 9 }));
      console.log(`${j.elements.length} elements, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB gz`);
      return;
    } catch (e) { console.log('failed: ' + e.message); }
  }
  throw new Error('all mirrors failed for ' + name);
}

(async () => { for (const [k, v] of Object.entries(Q)) await run(k, v); })()
  .catch(e => { console.error(e.message); process.exit(1); });
