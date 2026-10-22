# RobroTaxi map format (v1)

The city is downtown Toronto from OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0).
`map/build.js` turns the raw Overpass extract in `map/osm/` into two files, committed to the repo:

| file | who reads it | contents |
|---|---|---|
| `map/toronto.graph.json` | the sim (pages, `mcp/core/sim-core.js`, the Worker container) | road graph, chargers, HQ, demand districts |
| `map/toronto.scene.json` | renderers only (2D and 3D views) | water, islands, parks, rail, buildings, landmarks |

`map/toronto.js` is the same data as a script for the pages: it sets `window.ROBRO_MAP = { graph, scene }`.
Regenerate everything with `node map/build.js` (and `node map/fetch-osm.js` first, where OSM is reachable).

The mainland comes from the outer shoreline of [OpenStreetMap Lake Ontario relation 1206310](https://www.openstreetmap.org/relation/1206310), which is tagged `natural=water`, not `natural=coastline`.
`map/source/lake-ontario-shoreline.json` retains only the outer-member geometry returned around the scene bounds, split at missing coordinates, with attribution, retrieval time and the OSM data timestamp.
`map/mainland.js` clips these directed shores to the scene bounds and traces their faces with the bounding rectangle. The lake is on the right of each directed shore. Faces on the opposite side become land, preserving harbour slips and boundary inlets.
The first `scene.mainlandPolygons` entries in `land` are these generated mainland faces. The remaining entries retain the existing islands.

Run `node map/mainland.js` to repair the committed scene and browser data without the raw extract or any road-graph changes. The repair also removes the seven historical Lake Ontario member ways that were incorrectly drawn as closed water polygons. Their exact polygon fingerprints and OSM way IDs are recorded in the source snapshot, so unrelated water polygons are retained. The full builder now rejects open water rings.
Run `node map/mainland-test.js` to check mainland building coverage, dry landmarks, harbour water, slips, the Don, artifact consistency and repair idempotence.

## Coordinates

- Sim units, same as before: **1 unit = 10 m**. `x` grows east, `y` grows south (screen space), origin at the north-west corner of `bounds`.
- `graph.geo = { lat0, lon0, mPerUnit: 10 }`: `lon = lon0 + x*10 / (111320 cos(lat0))`, `lat = lat0 - y*10 / 110540`.
- Numbers are rounded to 0.1 unit (1 m).

## `toronto.graph.json`

```js
{
  version: 1, attribution: "© OpenStreetMap contributors, ODbL 1.0",
  geo: { lat0, lon0, mPerUnit: 10 }, bounds: { w, h },
  names: ["Queen St W", "Spadina Ave", ...],      // street names, referenced by index
  nodes: [[x, y], ...],                              // intersections and dead ends; node id = array index
  edges: [[a, b, flags, kmh, name, pts], ...],     // edge id = array index
  chargers: [{ name, node, bays, osm }],            // real charging sites used as depots
  hq: { name, node },                               // RobroTaxi HQ (the Executor), a real lot
  districts: [{ name, node, w }],                   // rider demand centres, w = relative weight
  landmarks: [{ name, node }]                       // named pickup spots (Union Station, CN Tower, ...)
}
```

Edge fields:
- `a`, `b`: node ids. Geometry runs a → b.
- `flags` bits: `1` one-way (a → b only), `2` motorway or ramp (no pickups, riders can't stand there), `4` bridge, `8` tunnel, `16` elevated expressway (Gardiner).
- `kmh`: speed limit (OSM `maxspeed`, else a default by road class).
- `name`: index into `names`, or -1 for unnamed links.
- `pts`: interior polyline points flattened `[x1, y1, x2, y2, ...]`, not including the end nodes; `[]` for a straight edge.

Derived at load time by `buildGraph()` in the page's city section (not stored): `len` (polyline length in units), `cum` (cumulative lengths for interpolation), `spd = kmh / 50` (speed relative to `BASE`), `adj` (outgoing) and `radj` (incoming) lists, `cls` names.

The graph is the largest strongly connected component, so every node can reach every other node.

## `toronto.scene.json`

```js
{
  version: 1, attribution, bounds,
  water:     [[x0, y0, x1, y1, ...], ...],           // Lake Ontario, harbour slips, the Don (polygons)
  land:      [[...], ...],                           // mainland followed by Toronto Islands and other land
  mainlandPolygons: 3,                              // number of generated mainland faces at the start of land
  parks:     [[...], ...],                           // parks, gardens, pitches
  rail:      [[...], ...],                           // rail corridor centrelines (polylines)
  buildings: [[h, type, x0, y0, dx1, dy1, ...], ...], // height in metres, style type, footprint (see below)
  landmarks: [{ name, kind, x, y, h, poly }],        // CN Tower, Union Station, Scotiabank Arena, Rogers Centre, City Hall, ...
  minor: [[kind, x0, y0, x1, y1, ...], ...]          // roads drawn but not driven: 0 service/pedestrian, 1-2 streets outside the play area
}
```

Polygons in `water`, `land`, `parks`, `rail`, `landmarks.poly` are flat `[x0, y0, x1, y1, ...]` in units.
Buildings are packed tighter: footprint points in **integer metres** (units x 10) from the map origin, the first point absolute and the rest as deltas
from the previous point. An optional trailing `"m", minHeightM` marks a part that floats (bridges between towers, the CN Tower pod).
`type`: 0 other, 1 house, 2 apartments, 3 office/retail/hotel, 4 civic/church/school, 5 industrial/parking, 6 glass facade.
Where OSM maps a tower as `building:part`s, the parts replace the outline.

Draw order that works: lake colour as background, `land` (mainland and the Toronto Islands), `water` (the Don, slips, ponds) on top, `parks`, `rail`, `minor`, graph edges, buildings.

Building heights come from OSM `height`, else `building:levels` x 3.2 m, else a default by building type.
