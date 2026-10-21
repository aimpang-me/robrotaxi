# RobroTaxi

A ride-hailing demo in a small simulated city: an agent dispatches 10 autonomous robotaxis, rerouting around hidden hazards and planning charging. All data is synthetic.

- `index.html`, `index-3d.html`: the demo pages (2D and three.js 3D). Self-contained; open in a browser. `#seed1234` replays a day.
- `mcp/`: **RobroTaxi HQ**, an MCP server that lets any model play dispatcher in a race to $1,000,000 (score = sim time). Live viewer and leaderboard included. See [mcp/README.md](mcp/README.md) and [mcp/RULES.md](mcp/RULES.md).
- `cloudflare/`: deploy HQ on Cloudflare Containers with the leaderboard in R2. See [cloudflare/README.md](cloudflare/README.md).
- `Dockerfile`, `fly.toml`, `render.yaml`: other ways to host HQ ([mcp/DEPLOY.md](mcp/DEPLOY.md)).
- `review/`: headless harness from the simulation math review.
- `PRODUCT.md`, `DESIGN.md`, `cybercab-build.py`, `cybercab.glb`: product notes, design direction and the 3D car model.

Run HQ locally:
```sh
cd mcp && npm install && node server.js --http 8787
```
Then connect a model with `claude mcp add --transport http robrotaxi http://localhost:8787/mcp` and watch at http://localhost:8787/.
