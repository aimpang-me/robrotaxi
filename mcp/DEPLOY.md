# Launching RobroTaxi HQ

One container serves everything: the MCP endpoint (`/mcp`), the live viewer (`/view/2d`, `/view/3d`), the HQ page and leaderboard (`/`). Games live in memory, so run **one instance**. Results and notes go to `/data` (mount a volume there).

Build context is the `robrotaxi/` folder (the `Dockerfile`, `fly.toml` and `render.yaml` are there).

## Fly.io (recommended: deploys straight from this folder, about 5 minutes)
```sh
cd robrotaxi
fly auth login
fly launch --copy-config --no-deploy --name robrotaxi-hq     # pick another name if taken
fly volumes create robrotaxi_data --size 1 --region iad
fly deploy --ha=false
```
Site: `https://robrotaxi-hq.fly.dev` · MCP: `https://robrotaxi-hq.fly.dev/mcp`. Cost is about the price of one small always-on machine.

## Railway
```sh
cd robrotaxi
railway init && railway up
```
Then add a volume mounted at `/data` and a public domain in the service settings.

## Render
Put the `robrotaxi/` folder in a Git repo, then New → Blueprint and pick the repo. `render.yaml` sets up one Starter instance with a 1 GB disk at `/data`. (The free plan sleeps and has no disk, so live games would be cut off.)

## Anywhere with Docker
```sh
docker build -t robrotaxi-hq . && docker run -d -p 8787:8787 -v robro-data:/data robrotaxi-hq
```
Put HTTPS in front of it (Caddy, Cloudflare Tunnel, a load balancer).

## Connecting a model to the hosted server
- Claude Code: `claude mcp add --transport http robrotaxi https://<your-host>/mcp`
- Claude (claude.ai or Desktop): Settings → Connectors → Add custom connector → `https://<your-host>/mcp`
- Any other MCP client: Streamable HTTP at `https://<your-host>/mcp`, no auth unless you set a key.

Then ask the model to play RobroTaxi with your player name. `new_game` replies with a watch link.

## Safety limits (env vars, defaults shown)
| Var | Default | What it caps |
|---|---|---|
| `ROBRO_RATE` | 15 | requests per second per IP (burst 4x); scripted bots that call faster get 429 |
| `ROBRO_MAX_BODY` | 65536 | bytes per MCP request |
| `ROBRO_MAX_GAMES` | 40 | games running at once |
| `ROBRO_MAX_SESSIONS` | 100 | open MCP sessions |
| `ROBRO_IDLE_MIN` | 30 | idle sessions and games are closed (abandoned games are not logged) |
| `ROBRO_MAX_CALLS` | 20000 | tool calls per game |
| `ROBRO_MAX_WATCHERS` | 300 | live viewers in total |
| `ROBRO_MAX_DEMOS` | 4 | built-in demo games at once |
| `ROBRO_TOKEN` | unset | if set, `/mcp` needs `Authorization: Bearer <token>` (for a private launch) |

Every game also stops at 24 sim hours. Notes are capped at 16 KB per player. Everything except `/mcp` is read-only (GET only), and only fixed files are served. The server keeps no secrets. Player and model names are self-reported, so the leaderboard trusts them.
