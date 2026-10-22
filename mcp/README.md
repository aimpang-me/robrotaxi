# RobroTaxi MCP server

Any model that speaks MCP can play dispatcher for the RobroTaxi fleet. The goal is $1,000,000 net revenue in the least sim time. The sim pauses while the model thinks, so the score measures decisions, not speed or tokens. Full rules: [RULES.md](RULES.md) (also served to the model by the `get_rules` tool and the `robrotaxi://rules` resource).

## Setup

Needs Node 18+.

```sh
cd robrotaxi/mcp
npm install
```

The simulation is extracted from `../index.html` into `core/sim-core.js`, so the game plays exactly like the demo page. After the page's sim code changes, run `npm run build` (it fails loudly if a patch no longer matches).

## Connect a model

### Claude Code
```sh
claude mcp add robrotaxi -- node /absolute/path/to/robrotaxi/mcp/server.js
```
Then ask: "Play RobroTaxi. My player name is Alvin." (or use the server's `play` prompt).

### Claude Desktop (or any client with an mcpServers config)
```json
{
  "mcpServers": {
    "robrotaxi": { "command": "node", "args": ["/absolute/path/to/robrotaxi/mcp/server.js"] }
  }
}
```

### Hosted server
See [DEPLOY.md](DEPLOY.md) to launch it publicly — it also lists the per-IP session/game caps and the
proxy setting (`ROBRO_TRUST_PROXY`) the rate limiter needs on each platform. Then: `claude mcp add --transport http robrotaxi https://<your-host>/mcp`, or add `https://<your-host>/mcp` as a custom connector in Claude.

### Over HTTP locally (remote models, agent frameworks, several players at once)
```sh
node server.js --http 8787
```
MCP endpoint: `http://localhost:8787/mcp` (Streamable HTTP). Each MCP session plays its own game. To reach it from a hosted client, put it behind a tunnel with HTTPS.

### From a shell (agents that can run commands but not add MCP servers)
```sh
node play-cli.js tools
node play-cli.js new_game '{"player":"Alvin","model":"my-model"}'
node play-cli.js act @turn.json
```
No dependencies. Talks to the live server unless `ROBRO_URL` is set (e.g. `http://localhost:8787/mcp`). The session is kept in `.robro-session` in the current folder. A ready-made agent prompt is in [../deploy/grok-play-prompt.md](../deploy/grok-play-prompt.md).

## Traffic
The simulation owns 240 seeded background vehicles: sedans, hatchbacks, SUVs, vans and buses. They circulate on through streets, follow legal road directions, keep physical following gaps and yield at unsignalized junctions. Destination-free background routes skip terminal street branches; taxis can still enter them to serve riders. Robotaxis share the same lane occupancy, so a queue can delay a pickup or drop-off. Parked taxis wait off the through lane and enter when there is room. There are no traffic lights.

Public road-load estimates still follow the time of day. Routing and `rider_options` include that load and sensed incidents; immediate vehicle queues can add delay beyond an ETA. Ambient vehicles never reveal hidden incidents to the dispatcher. The 2D and 3D views draw the authoritative vehicles with stable models and colours; playback interpolation does not move the simulation.

## Watch a game

The server also runs a viewer (stdio mode: port 8787, change with `--view-port`, `0` turns it off).

- `http://localhost:8787/` lists live games and the leaderboard.
- `new_game` returns a watch link: `/view/2d?game=<id>` or `/view/3d?game=<id>`. These are the normal demo pages, driven by the server's game. The header and decision feed show the player and model, and a card in the corner shows revenue, progress to $1M and sim time.
- While someone is watching, `advance` runs at 60 sim seconds per real second so the cars move smoothly (`--pace N` to change, `--pace 0` to never wait). Unwatched games run at full speed.
- `/demo?mode=scripted` or `/demo?mode=executor` (optionally `&seed=2207&view=3d`) plays the built-in scripted agent or the Executor alone for comparison.

The viewer patches the demo pages in memory when serving them; it does not edit `index.html` or `index-3d.html`.

Both views have a Sound button and volume control. Sound starts off. Enable it to hear city ambience and nearby moving vehicles; zoom in for a louder street mix. Pause and mute silence the mix. The [ElevenLabs sound pack](viewer/audio/README.md) records asset sources and its noncommercial Free-plan restriction.

Spectators share one snapshot serialization per game update. The server offers gzip streaming and bounds slow clients to one pending packet. Same-turn model actions share a packet while retaining every decision event. Reconnecting viewers receive a full snapshot.

## Tools

| Tool | What it does |
|---|---|
| `get_rules` | Rules, fares, costs, scoring |
| `new_game(player, model, seed?)` | Start a game. Player is required; model is self-reported. Default seed is ranked seed 1101 |
| `get_state(format?)` | Cars, waiting riders with fares and cancel timers, known hazards, depots, score. Text, or `json` |
| `get_map(near?, radius_km?)` | Intersections, roads (edge ids), depots, demand hotspots |
| `rider_options(rider)` | Best cars for a rider: pickup ETA, empty km, battery at drop-off, charger reachable |
| `dispatch(car, rider, reason)` | Assign; chains onto a riding car; unplugs a charging car; reassigns if needed |
| `charge(car, depot?, charge_to?, reason)` | Send to a named depot or the best one |
| `reposition(car, node, reason)` | Move a free car to wait somewhere |
| `reroute(car, avoid_edges?, reason)` | Re-plan a moving car on known traffic, optionally avoiding roads |
| `release(car, reason)` | Hand a car's riders back to the queue |
| `act(actions[], advance_seconds?)` | Several actions plus time in one call (cheapest way to play) |
| `advance(seconds?, stop_on_event?)` | Move time; stops early when there is something to act on |
| `get_score` | Revenue breakdown and the same city run by the Executor alone |
| `leaderboard` | Finished games, ranked seeds first |
| `notes_read`, `notes_write` | Per-player strategy notes kept between games. Writes need an active game and are scoped to its player; notes are shown to models as untrusted text |

Every action needs a `reason` (1-2 sentences, required). `act` and `advance` also take an optional `note`: a short summary of your thinking that turn. Reasons and notes show in the live "Why" panel and the decision feed, and are saved in the run log. Viewers can pause and change playback speed (¼× to 4×); that only changes pacing, never the sim result.

## Scoring and logs

- Ranked seeds: 1101, 2207, 3313, 4421, 5531 (standard settings). Every model gets the same riders and hazards on a seed.
- Every finished game appends a line to `runs/results.jsonl` (player, model, MCP client name, seed, finish time, revenue, trips, decisions, tool calls) and writes the full decision log and feed to `runs/logs/<game>.json`.
- `node bench.js` replays the four reference dispatchers on all ranked seeds in bounded independent workers. Set `ROBRO_BENCH_JOBS=1` for serial replay, or `ROBRO_BENCH_OUTPUT=results.json` to save machine-readable scores. Wall time is not the score.

Recorded before/after results and the dispatcher-order check are in [the physical traffic balance report](benchmarks/physical-traffic.md). Finishing runs rank by sim time; unfinished runs rank by revenue.

## Test

```sh
npm test                                     # spawns the server over stdio and plays seed 1101 to the finish
MCP_URL=http://localhost:8787/mcp npm test   # same, against a running HTTP server
CALL_DELAY_MS=80 MCP_URL=https://<your-host>/mcp npm test   # against a hosted server, under its rate limit
```

The test client is a scripted stub (no LLM) that uses only the MCP tools.

Additional checks, from the repository root:

```sh
node mcp/traffic-test.js         # physical gaps, yielding, route changes, parking, determinism
node mcp/traffic-view-test.js    # authoritative poses and live interpolation
node mcp/pacing-test.js          # pause and speed preserve the authoritative result
node mcp/route-cache-test.js     # cached and uncached routing agree
node mcp/presentation-test.js    # both page simulations agree; presentation invariants
node map/mainland-test.js       # mainland, harbour, river and generated map parity
```

## Files

- `server.js`: MCP server (stdio or HTTP), viewer, live stream, leaderboard API
- `game.js`: one game (isolated VM copy of the sim), run logging, leaderboard
- `core/harness.js`: economy, observations and actions, appended to the extracted sim
- `build-core.js`: extracts the sim from `../index.html` into `core/sim-core.js`
- `bots.js`, `bench.js`: reference dispatchers and the balance check
- `viewer/`: live overlay for the demo pages, and the HQ index page
