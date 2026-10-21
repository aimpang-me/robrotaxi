# RobroTaxi design system

World: road marking and municipal pavement paint. The interface is the city's own road paint on warm asphalt. Single-theme dark by choice (HQ ops room, projector or laptop demo).

## Colour tokens
| Token | Value | Job |
|---|---|---|
| `--asphalt` | `#2a2927` | page ground, with fractal grain at 9% alpha |
| `--asphalt-2` | `#32312e` | rails, metric strip, buttons |
| `--asphalt-3` | `#3c3b37` | hover, selected row |
| `--road` | `#1c1c1c` | road surface, inputs, dark ink on paint |
| `--block` / `--lot` | `#393834` / `#403f3a` | city blocks and building lots |
| `--line` | `#4a4843` | borders, dashed stripe dividers |
| `--paint` / `--paint-2` / `--muted` | `#edebe3` / `#bdbab0` / `#a8a59b` | lane white text tiers (muted clears 4.5:1 on every surface) |
| `--yellow` | `#f2c230` | agent voice, connect action, rider-aboard routes, selection |
| `--blue` | `#5b98e6` | riders, routes to pickup |
| `--green` | `#4fb67a` | charging, depots, good deltas |
| `--orange` | `#f08c30` | traffic, mid battery, without-agent baseline |
| `--red` | `#e5574a` | crash closures, low battery, bad deltas (fills and marks) |
| `--red-text` | `#f48477` | red used as text; `--red` is only 3.6:1 on the panels |
| `--water` / `--park` | `#2c393b` / `#2f3b2c` | Mill River, Hill Park |

## Type
Overpass (highway-sign gothic) for all UI, 400 to 800. Overpass Mono for every figure (clock, battery, metrics, IDs). Fixed rem scale: 11, 12, 13, 15, 18, 24 px. 11px is only for uppercase tracked labels and feed tags; running secondary text is 12px minimum. Map labels scale with the map so they stay about 10px on screen. The middle dot separator renders from the system face (Overpass's own glyph hugs the next word). Section heads are 12px uppercase at .1em tracking. District names on the map are road-legend lettering: 15px caps stretched 1.7x vertically.

## Shape and components
4px corners. Dashed lane-stripe dividers under rail headers. No glass, glow or hard shadows; the one shadow is the toast. Battery bars are 10 dash segments. Buttons are 32px with 1px line border (44px on touch screens and below 560px); pressed state fills with paint, or the tool's state colour for incident tools. The connect button is the only solid yellow control.

## Signature move
Every planned route is painted onto the road as a lane stripe in the car's state colour and draws itself in over 700ms (ease-out cubic); a reroute repaints it. Crashes are red hatched closures, jams orange dashed overlays.

## Layout
Three columns at desktop (fleet 288 | map | agent 356; 256 | map | 328 below 1440). Two columns below 1100 (map on top, fleet and agent below). One column below 860 with the map at its own aspect ratio. Below 560 the 2D map is a 720px sideways-scrolling strip, centred on load; the 3D map is 5:4 with tighter framing.
