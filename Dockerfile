# RobroTaxi HQ: MCP game server, live viewer and leaderboard in one container.
# Build from this folder (robrotaxi/): docker build -t robrotaxi-hq . && docker run -p 8787:8787 -v robro-data:/data robrotaxi-hq
FROM node:22-alpine
WORKDIR /app
COPY mcp/package.json mcp/package-lock.json mcp/
RUN cd mcp && npm ci --omit=dev --no-audit --no-fund
COPY index.html index-3d.html cybercab.glb ./
COPY map/toronto.js map/
COPY vendor/ vendor/
COPY mcp/ mcp/
# Proxy trust is platform-specific: set ROBRO_TRUST_PROXY=cloudflare on Cloudflare Containers and
# ROBRO_TRUST_PROXY=fly on Fly. A plain Docker host must not trust client-supplied X-Forwarded-For.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 ROBRO_RUNS_DIR=/data/runs ROBRO_NOTES_DIR=/data/notes ROBRO_RUN_AS_UID=1000
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
# starts as root only to hand the mounted /data volume to the node user (uid 1000), then drops root
CMD ["sh", "-c", "exec node mcp/server.js --http ${PORT}"]
