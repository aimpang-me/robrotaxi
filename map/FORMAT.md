# RobroTaxi map format (v1)

The city is downtown Toronto from OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0).
`map/build.js` turns the raw Overpass extract in `map/osm/` into two files, committed to the repo:

| file | who reads it | contents |
|---|---|---|
| `map/toronto.graph.json` | the sim (pages, `mcp/core/sim-core.js`, the Worker container) | road graph, chargers, HQ, demand districts |
| `map/toronto.scene.json` | renderers only (2D and 3D views) | water, islands, parks, rail, buildings, landmarks |

`map/toronto.js` is the same data as a script for the pages: it sets `window.ROBRO_MAP = { graph, scene }`.
Regenerate everything with `node map/build.js` (and `node map/fetch-osm.js` first, where OSM is reachable).

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
  land:      [[...], ...],                           // Toronto Islands and other land drawn over the lake
  parks:     [[...], ...],                           // parks, gardens, pitches
  rail:      [[...], ...],                           // rail corridor centrelines (polylines)
  buildings: [[h, x0, y0, x1, y1, ...], ...],        // footprint polygon + height in metres
  landmarks: [{ name, kind, x, y, h, poly }]         // CN Tower, Union Station, Scotiabank Arena, Rogers Centre, City Hall, ...
}
```

Building heights come from OSM `height`, else `building:levels` x 3.2 m, else a default by building type.
