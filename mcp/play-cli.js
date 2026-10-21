#!/usr/bin/env node
// Play RobroTaxi from a shell, one MCP tool call per command. For agents that can run commands but
// cannot add MCP servers. The MCP session id is kept in .robro-session so a game carries across calls.
// No dependencies: plain JSON-RPC over fetch (Node 18+).
//   node play-cli.js tools                        list tools
//   node play-cli.js get_rules
//   node play-cli.js new_game '{"player":"Alvin","model":"grok-4"}'
//   node play-cli.js act '{"actions":[{"type":"dispatch","car":"T-01","rider":"R-104","reason":"closest"}],"advance_seconds":120}'
//   node play-cli.js act @turn.json               read the arguments from a file (avoids shell quoting)
// Server: ROBRO_URL (default https://robrotaxi-hq.aimpang.workers.dev/mcp). ROBRO_SESSION_FILE to keep several games apart.
// ROBRO_TOKEN is sent as a bearer key when the server requires one.
const fs = require('fs');
const path = require('path');

const URL_ = process.env.ROBRO_URL || 'https://robrotaxi-hq.aimpang.workers.dev/mcp';
const FILE = process.env.ROBRO_SESSION_FILE || path.join(process.cwd(), '.robro-session');
const [tool, rawArgs] = process.argv.slice(2);
if (!tool) { console.error('usage: node play-cli.js <tool|tools> [json-args | @file.json]'); process.exit(2); }

class SessionGone extends Error {}
let nextId = 1;

async function rpc(sessionId, method, params, notify) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  if (process.env.ROBRO_TOKEN) headers.authorization = 'Bearer ' + process.env.ROBRO_TOKEN;
  const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(notify ? {} : { id: nextId++ }) };
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(URL_, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.status !== 429 || attempt >= 5) break;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); // rate limited: back off and retry
  }
  if (sessionId && (res.status === 404 || res.status === 400)) throw new SessionGone(`session expired (${res.status})`);
  if (!res.ok && res.status !== 202) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (notify) return { res };
  const text = await res.text();
  let msg;
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (!data) continue;
      const m = JSON.parse(data);
      if (m.id === body.id) { msg = m; break; }
    }
  } else msg = JSON.parse(text);
  if (!msg) throw new Error('No response from server');
  if (msg.error) throw new Error(`${msg.error.code}: ${msg.error.message}`);
  return { res, result: msg.result };
}

async function openSession() {
  const { res } = await rpc(null, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'robrotaxi-play-cli', version: '1.1.0' } });
  const id = res.headers.get('mcp-session-id');
  if (!id) throw new Error('Server did not return a session id');
  await rpc(id, 'notifications/initialized', null, true);
  fs.writeFileSync(FILE, id);
  return id;
}

(async () => {
  let args = {};
  if (rawArgs) {
    const src = rawArgs.startsWith('@') ? fs.readFileSync(rawArgs.slice(1), 'utf8') : rawArgs;
    try { args = JSON.parse(src); } catch (e) { console.error('Arguments must be JSON: ' + e.message); process.exit(2); }
  }
  let sessionId = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').trim() : '';
  for (let tries = 0; tries < 2; tries++) {
    try {
      if (!sessionId) sessionId = await openSession();
      if (tool === 'tools') {
        const { result } = await rpc(sessionId, 'tools/list', {});
        console.log(result.tools.map((x) => `${x.name}: ${x.description}`).join('\n'));
      } else {
        const { result } = await rpc(sessionId, 'tools/call', { name: tool, arguments: args });
        console.log(result.content.map((c) => c.text).join('\n'));
        if (result.isError) process.exitCode = 1;
      }
      return;
    } catch (e) {
      // the server restarted or the session idled out: open a new one once and retry
      if (e instanceof SessionGone && tries === 0) { sessionId = ''; continue; }
      console.error('Error: ' + e.message); process.exit(1);
    }
  }
})();
