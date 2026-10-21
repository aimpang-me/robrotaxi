Deploy RobroTaxi HQ (an MCP game server with a live viewer) to my Cloudflare account using Cloudflare Containers. I'm on the Workers Paid plan. Everything is already written and tested; your job is to deploy it, not to change it.

Code: https://github.com/aimpang-me/robrotaxi (branch main). The deploy lives in the `cloudflare/` folder and builds the container from the repo's root `Dockerfile`.

Steps:
1. Check that git, Node 18+ and Docker are installed and the Docker daemon is running (`docker info`). If Docker is missing, stop and tell me how to install it for my OS.
2. `git clone https://github.com/aimpang-me/robrotaxi && cd robrotaxi/cloudflare && npm install`
3. `npx wrangler login` (I'll approve it in the browser), then `npx wrangler whoami` to confirm the account.
4. `npx wrangler r2 bucket create robrotaxi-data` (fine if it says it already exists).
5. `npx wrangler deploy`. This builds the Docker image from ../Dockerfile and pushes it. If the Worker name robrotaxi-hq is taken in my account, change only "name" in wrangler.jsonc.
6. Wait for the container to provision (it can take a few minutes after the first deploy), then check:
   - `curl https://<worker-url>/healthz` returns `ok`
   - `https://<worker-url>/` loads the HQ page
   - `curl -X POST https://<worker-url>/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}'` returns a result whose serverInfo name is robrotaxi
7. Report back: the public URL, the MCP URL (<worker-url>/mcp), and the exact output of each check.

Rules:
- Don't edit code other than the Worker name, and don't push to the repo. If a step fails, show me the full error and what you think it means before changing anything.
- Don't create or print API tokens or secrets. Use wrangler login only.
- Don't delete anything in my Cloudflare account.

To redeploy later after code changes: `git pull && cd cloudflare && npx wrangler deploy`.
