// End-to-end: spawn the server over stdio, play a full game as a scripted MCP client, print the result.
// Usage: node test/play-over-mcp.js [seed] [player] [model]
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
// MCP_URL=http://localhost:8787/mcp plays against a running HTTP server instead of spawning one; MAX_TURNS stops early
const seed = +(process.argv[2] || 1101), player = process.argv[3] || 'Test bot', model = process.argv[4] || 'greedy-stub (no LLM)';

(async () => {
  const transport = process.env.MCP_URL ? new StreamableHTTPClientTransport(new URL(process.env.MCP_URL)) : new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'server.js'), '--view-port', process.env.VIEW_PORT || '0'], stderr: 'inherit', env: { ...process.env } });
  const client = new Client({ name: 'robrotaxi-e2e', version: '1.0.0' });
  await client.connect(transport);
  // CALL_DELAY_MS spaces calls out so a hosted server's rate limit (15/s per IP by default) is respected
  const delay = +process.env.CALL_DELAY_MS || 0;
  const call = async (name, args = {}) => { if (delay) await new Promise((r) => setTimeout(r, delay)); const r = await client.callTool({ name, arguments: args }); const t = r.content.map((c) => c.text).join('\n'); if (r.isError) throw new Error(t); return t; };
  const tools = (await client.listTools()).tools.map((t) => t.name);
  console.log('tools:', tools.join(', '));
  const rules = await call('get_rules'); console.log('rules:', rules.split('\n')[0]);
  console.log((await call('new_game', { player, model, seed })).split('\n').slice(0, 2).join('\n'));
  const econ = { floor: 0.4, latePerMin: 0.04, freeWaitMin: 5, rescueShare: 0.5, energyPerPct: 15 };
  const wf = (w) => Math.max(econ.floor, 1 - econ.latePerMin * Math.max(0, w - econ.freeWaitMin));
  let turns = 0, calls = 4, last = '';
  for (;;) {
    const st = JSON.parse(await call('get_state', { format: 'json' })); calls++;
    if (st.score.finished || st.score.outOfTime || turns >= (+process.env.MAX_TURNS || Infinity)) break;
    const actions = []; const waiting = st.riders.filter((r) => r.status === 'waiting');
    for (const c of st.cars) if (c.state === 'idle' && c.battery < 25) actions.push({ type: 'charge', car: c.id, depot: 'best', charge_to: waiting.length > 4 ? 70 : 80, reason: 'Low battery, charging now.' });
    const charging = new Set(actions.map((a) => a.car));
    const pairs = [];
    for (const r of waiting) {
      const o = JSON.parse(await call('rider_options', { rider: r.id, limit: 10 })); calls++;
      for (const c of o.cars || []) {
        if (!c.safe || charging.has(c.car)) continue;
        if (c.state === 'charging' && c.batteryNow < 45) continue;
        if (c.state === 'riding' && c.pickupMin > 8) continue;
        if (r.cancelsInMin != null && c.pickupMin > r.cancelsInMin - 0.5) continue;
        const fare = r.rescue ? r.fullFare * econ.rescueShare : r.fullFare * wf(r.waitedMin + c.pickupMin);
        pairs.push({ r: r.id, c: c.car, v: (fare - (c.emptyKm + o.tripKm) * econ.energyPerPct) / (c.pickupMin + o.tripMin + 1.5) + (r.rescue ? 400 : 0) });
      }
    }
    pairs.sort((a, b) => b.v - a.v);
    const ur = new Set(), uc = new Set();
    for (const p of pairs) { if (ur.has(p.r) || uc.has(p.c)) continue; ur.add(p.r); uc.add(p.c); actions.push({ type: 'dispatch', car: p.c, rider: p.r, reason: `Best fare per car-minute, ${Math.round(p.v)} $/min.` }); }
    if (!waiting.length) for (const c of st.cars) if (c.state === 'idle' && c.battery < 60 && !charging.has(c.id)) actions.push({ type: 'charge', car: c.id, depot: 'best', charge_to: 90, reason: 'Quiet moment, topping up.' });
    last = await call('act', { actions, note: `Turn ${turns + 1}: ${waiting.length} riders waiting, ${actions.length} moves.`, advance_seconds: 300 }); calls++; turns++;
    if (turns % 25 === 0) console.log(`turn ${turns}: ${last.split('\n').find((l) => l.includes('net revenue')) || ''}`);
  }
  console.log(await call('get_score'));
  console.log('turns (act calls):', turns, 'total tool calls:', calls);
  console.log('leaderboard:\n' + await call('leaderboard', { limit: 5 }));
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
