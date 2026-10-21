#!/usr/bin/env node
// RobroTaxi MCP server: any MCP client (Claude, other models, scripts) plays dispatcher in the race to $1M.
//   node server.js                 stdio MCP server, plus the live viewer on http://localhost:8787
//   node server.js --http 8787     MCP over Streamable HTTP at http://localhost:8787/mcp, plus the viewer
// Options: --view-port N (stdio mode viewer port, 0 = off), --pace N (sim seconds per real second while someone watches, 0 = never wait)
const fs = require('fs');
const path = require('path');
const http = require('http');
const { randomUUID } = require('crypto');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { Game, RANKED_SEEDS, leaderboard } = require('./game');
const store = require('./store');

// In a container, hosted volumes mount as root. Started as root with ROBRO_RUN_AS_UID set, hand the data folders to that user and drop root.
if (process.env.ROBRO_RUN_AS_UID && process.getuid && process.getuid() === 0) {
  const uid = +process.env.ROBRO_RUN_AS_UID;
  const own = (p) => { fs.chownSync(p, uid, uid); if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) own(path.join(p, f)); };
  for (const d of [store.RUNS_DIR, store.NOTES_DIR]) { fs.mkdirSync(d, { recursive: true }); own(path.dirname(d)); }
  process.setgid(uid); process.setuid(uid);
}

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const HTTP_PORT = opt('http') ? +opt('http') : null;
const VIEW_PORT = HTTP_PORT || +opt('view-port', process.env.ROBRO_VIEW_PORT || 8787);
const PACE = +opt('pace', process.env.ROBRO_PACE || 60);
const HOST = opt('host', process.env.HOST || '127.0.0.1');
// limits for running in public; override with env vars
const LIM = {
  body: +(process.env.ROBRO_MAX_BODY || 64 * 1024),         // bytes per MCP request
  rate: +(process.env.ROBRO_RATE || 15),                     // requests per second per IP (burst 4x)
  games: +(process.env.ROBRO_MAX_GAMES || 40),               // games running at once
  sessions: +(process.env.ROBRO_MAX_SESSIONS || 100),        // open HTTP MCP sessions
  idleMin: +(process.env.ROBRO_IDLE_MIN || 30),              // idle sessions and games are closed after this
  calls: +(process.env.ROBRO_MAX_CALLS || 20000),            // tool calls per game
  watchers: +(process.env.ROBRO_MAX_WATCHERS || 300),        // live viewers across all games
  demos: +(process.env.ROBRO_MAX_DEMOS || 4),                // built-in demo games at once
  notesBytes: 16 * 1024, notesFiles: 2000,
};
const TRUST_PROXY = !!process.env.ROBRO_TRUST_PROXY;       // set behind Fly/Render/Railway so the client IP comes from x-forwarded-for
const PAGES = path.join(__dirname, '..');
const RULES = fs.readFileSync(path.join(__dirname, 'RULES.md'), 'utf8');
const say = (...a) => console.error('[robrotaxi]', ...a); // stdout belongs to the stdio transport

const games = new Map();
const liveGames = () => [...games.values()].filter((g) => !g.over()).length;
const clean = (x, n) => String(x).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const watchers = new Map(); // game id -> Set of SSE responses
// watch links: 3D by default; base is the public address the client used (or ROBRO_PUBLIC_URL), else localhost
const viewUrl = (g, base, view = '3d') => { const b = process.env.ROBRO_PUBLIC_URL || base || (VIEW_PORT ? `http://localhost:${VIEW_PORT}` : null); return b ? `${b.replace(/\/$/, '')}/view/${view}?game=${g.id}` : null; };
function baseFrom(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host; if (!host) return null;
  const local = /^(localhost|127\.|\[::1\])/.test(host);
  return `${req.headers['x-forwarded-proto'] || (local ? 'http' : 'https')}://${host}`;
}

/* ---------------- text formatting for models ---------------- */
const $n = (x) => '$' + Math.round(x).toLocaleString('en-US');
function fmtState(st) {
  const s = st.score, L = s.ledger;
  const out = [`${st.clock} · ${st.elapsedMin} min in · net revenue ${$n(s.revenue)} of $1,000,000 (${(s.progress * 100).toFixed(1)}%) · trips ${L.trips} · cancelled ${L.cancelled} · stranded ${L.stranded}${s.finished ? ` · FINISHED in ${s.finishMin} min` : s.outOfTime ? ' · OUT OF TIME' : ''}`];
  out.push('', 'CARS');
  for (const c of st.cars) {
    let l = `${c.id} ${c.state.padEnd(10)} ${String(c.battery).padStart(5)}%  at n${c.node} ${c.at}`;
    if (c.rider) l += ` · ${c.state === 'riding' ? 'carrying' : 'picking up'} ${c.rider}`;
    if (c.target != null && c.state !== 'idle') l += ` → n${c.target} eta ${c.etaMin} min`;
    if (c.next) l += ` · next ${c.next}`;
    if (c.depot) l += ` · ${c.depot} to ${c.chargeTo}%${c.state === 'charging' ? (c.plugged ? ' (plugged)' : ' (queued)') : ''}`;
    if (c.backInMin != null) l += ` · back in ${c.backInMin} min`;
    out.push(l);
  }
  const waiting = st.riders.filter((r) => r.status === 'waiting'), assigned = st.riders.filter((r) => r.status === 'assigned');
  out.push('', `RIDERS WAITING (${waiting.length})`);
  for (const r of waiting.sort((a, b) => b.waitedMin - a.waitedMin)) out.push(`${r.id} n${r.from}→n${r.to} ${r.route} · ${r.km} km · fare ${$n(r.fullFare)} (now ${$n(r.fareIfPickedNow)}) · waited ${r.waitedMin} min${r.cancelsInMin != null ? ` · cancels in ${r.cancelsInMin}` : ''}${r.rescue ? ' · RESCUE' : ''}`);
  if (assigned.length) { out.push('', `ASSIGNED (${assigned.length})`); for (const r of assigned) out.push(`${r.id} → ${r.car} · ${r.km} km · waited ${r.waitedMin} min`); }
  out.push('', 'KNOWN HAZARDS' + (st.knownHazards.length ? '' : ': none'));
  for (const h of st.knownHazards) out.push(`edge ${h.edge} ${h.road} (n${h.nodes[0]}-n${h.nodes[1]}): ${h.type}, spotted by ${h.spottedBy}`);
  out.push('', 'DEPOTS: ' + st.depots.map((d) => `${d.name} n${d.node} ${d.plugged}/${d.bays} plugged, ${d.queued} queued, ${d.enRoute} en route`).join(' · '));
  return out.join('\n');
}
function fmtAdvance(r) {
  if (r.over) return 'The game is over.\n' + fmtScore(r.score);
  const ev = r.events.filter((e) => e.tag !== 'Online');
  return [`Advanced ${r.advancedS} s.${r.stoppedFor.length ? ' Stopped for: ' + r.stoppedFor.join('; ') + '.' : ''}`,
    ev.length ? 'EVENTS\n' + ev.slice(-40).map((e) => `${e.clock} [${e.tag}] ${e.text}`).join('\n') : 'No events.'].join('\n');
}
function fmtScore(s) {
  const L = s.ledger;
  return [s.finished ? `FINISHED: $1,000,000 reached in ${s.finishMin} sim minutes (${(s.finishMin / 60).toFixed(2)} h).` : s.outOfTime ? `OUT OF TIME after ${s.elapsedMin} min with ${$n(s.revenue)}.` : `In progress: ${$n(s.revenue)} after ${s.elapsedMin} min (${(s.progress * 100).toFixed(1)}%).`,
    `Fares ${$n(L.fares)} (late-pickup cuts ${$n(L.lateDiscounts)}), energy −${$n(L.energy)}, tows −${$n(L.tows)}. Lost to cancellations ${$n(L.lostFares)}.`,
    `Trips ${L.trips}, cancelled ${L.cancelled}, stranded ${L.stranded}, avg wait ${L.avgWaitMin} min, empty driving ${L.emptyKmShare != null ? Math.round(L.emptyKmShare * 100) + '%' : '-'}.`,
    s.executorAloneSameCity ? `Same city with the Executor alone (no dispatcher): ${$n(s.executorAloneSameCity.revenue)}, ${s.executorAloneSameCity.trips} trips, ${s.executorAloneSameCity.cancelled} cancelled.` : ''].filter(Boolean).join('\n');
}
function fmtBoard(rows, n = 20) {
  if (!rows.length) return 'No finished games yet.';
  return rows.slice(0, n).map((r, i) => `${i + 1}. ${r.player} · ${r.model} · seed ${r.seed}${r.ranked ? ' (ranked)' : ''} · ${r.finished ? `${(r.finishMin / 60).toFixed(2)} h` : `DNF ${$n(r.revenue)}`} · ${r.trips} trips · ${r.decisions} decisions`).join('\n');
}

/* ---------------- pacing: real-time while someone is watching ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPEEDS = [0.25, 0.5, 1, 2, 4];
async function pacedAdvance(g, seconds, stop) {
  const watched = () => PACE > 0 && (watchers.get(g.id)?.size || 0) > 0;
  if (!watched()) { const r = g.advance(seconds, stop); g.lastAdvEnd = Date.now(); return r; }
  g.toolCalls++;
  const total = Math.max(2, Math.min(1800, +seconds || 120));
  // Keep the view moving while the model thinks: stretch this advance over about as long as the last think took
  // (3 to 20 s), but never slower than 1/8 of the base pace. Only the waiting changes; the sim result is identical.
  const thinkS = Math.max(3, Math.min(20, (Date.now() - g.lastAdvEnd) / 1000));
  const basePace = Math.max(Math.min(PACE, 8), Math.min(PACE, total / thinkS));
  let done = 0; const why = [], merged = { advancedS: 0, stoppedFor: [], events: [] };
  while (done < total && !g.over()) {
    let held = 0; while (g.ctl.paused && watched() && held < 300000) { await sleep(200); held += 200; } // viewer pause, at most 5 min
    if (held >= 300000) { g.ctl.paused = false; g.emit(); }
    const pace = basePace * g.ctl.speed, slice = Math.max(2, pace / 10), t0 = Date.now();
    const r = g.advance(Math.min(slice, total - done), stop, { minS: Math.max(0, 20 - done), why });
    if (r.over) return r;
    merged.advancedS += r.advancedS; merged.events.push(...r.events); done += r.advancedS;
    if (stop && why.length && done >= 20) { merged.stoppedFor = why.slice(0, 8); break; }
    if (watched()) await sleep(Math.max(0, 1000 * r.advancedS / pace - (Date.now() - t0)));
  }
  if (g.over()) g.finish();
  g.lastAdvEnd = Date.now();
  return merged;
}

/* ---------------- MCP server (one per client session) ---------------- */
function makeServer(base) {
  const server = new McpServer({ name: 'robrotaxi', version: '0.1.0' }, {
    instructions: 'RobroTaxi: you are the fleet dispatcher. Read get_rules, then call new_game with your player name and your model name. Loop: get_state → decide (dispatch/charge/reposition/reroute/release, or act for several) → advance. Goal: $1,000,000 net revenue in the least sim time.',
  });
  const sess = { game: null };
  const need = () => {
    if (!sess.game || sess.game.abandoned) throw new Error('No game yet. Call new_game with your player name and model name.');
    if (sess.game.toolCalls > LIM.calls) throw new Error('This game has used its tool-call budget. Call get_score or start a new game.');
    sess.game.lastActive = Date.now(); return sess.game;
  };
  const tool = (name, description, shape, fn) => server.registerTool(name, { description, inputSchema: shape }, async (args) => {
    try { return { content: [{ type: 'text', text: await fn(args || {}) }] }; } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  });
  const reason = z.string().trim().min(3).max(300).describe('Required. One or two sentences on why you chose this: what you compared and what you expect. Shown to everyone watching, next to your name.');
  const note = z.string().max(1000).optional().describe('Optional. A short summary of your thinking this turn (what you saw, your plan). Shown in the live reasoning panel.');
  const carId = z.string().describe('Car id, e.g. T-03');

  tool('get_rules', 'The rules, fares, costs and scoring. Read this first.', {}, () => RULES);
  tool('new_game', 'Start a game as dispatcher. Player name is required; model is your own model name (self-reported). Starts on a ranked seed unless you pass another seed.', {
    player: z.string().min(1).max(60).describe('Player (human) name shown in HQ and on the leaderboard'),
    model: z.string().min(1).max(80).describe('Your model name, e.g. claude-opus-5-5'),
    seed: z.number().int().min(0).max(999999).optional().describe(`Day to play. Ranked seeds: ${RANKED_SEEDS.join(', ')}. Default ${RANKED_SEEDS[0]}.`),
  }, ({ player, model, seed }) => {
    if (sess.game && !sess.game.over()) { sess.game.abandoned = true; games.delete(sess.game.id); }
    if (liveGames() >= LIM.games) throw new Error('HQ is full right now. Try again in a few minutes.');
    player = clean(player, 60); model = clean(model, 80);
    if (!player) throw new Error('player is required');
    const ci = server.server.getClientVersion();
    const g = new Game({ player, model, seed, client: ci ? clean(`${ci.name} ${ci.version || ''}`, 80) : null });
    games.set(g.id, g); sess.game = g;
    say(`game ${g.id}: player ${g.player}, model ${g.model}, seed ${g.seed}`);
    return [`Game ${g.id} started. Player ${g.player}, ${g.model}, connected to HQ. Seed ${g.seed}${g.ranked ? ' (ranked)' : ' (unranked)'}, about ${g.info.rph} riders/hr.`,
      viewUrl(g, base) ? `Watch live in 3D: ${viewUrl(g, base)} (2D: ${viewUrl(g, base, '2d')})` : '', '', fmtState(g.state())].filter((x) => x !== '').join('\n');
  });
  tool('get_state', 'Fleet, waiting riders, known hazards, depots and score. Compact text by default; format "json" for structured data.', { include_riding: z.boolean().optional(), format: z.enum(['text', 'json']).optional() },
    ({ include_riding, format }) => { const st = need().state(include_riding); return format === 'json' ? JSON.stringify(st) : fmtState(st); });
  tool('get_map', 'The city. With no arguments: size, HQ, depots, demand districts and landmarks with their node ids. With near (node id, or a district, landmark or depot name) and radius_km: the intersections and roads around it, nearest first. JSON.', {
    near: z.union([z.string(), z.number()]).optional(), radius_km: z.number().min(0.1).max(3).optional(),
  }, ({ near, radius_km }) => JSON.stringify(need().map({ near, radius_km })));
  tool('rider_options', 'For one waiting rider: the best cars ranked by pickup ETA, with empty km, battery at drop-off and whether a charger stays reachable. Uses only what the fleet knows.', {
    rider: z.string().describe('Rider id, e.g. R-142'), limit: z.number().int().min(1).max(10).optional(),
  }, ({ rider, limit }) => JSON.stringify(need().options(rider, limit)));
  tool('dispatch', 'Send a car to pick up a rider. A riding car takes the rider next, after its drop-off. A charging car is unplugged. Reassigns the rider if another car had it.', { car: carId, rider: z.string(), reason },
    ({ car, rider, reason }) => JSON.stringify(need().dispatch(car, rider, reason)));
  tool('charge', 'Send a car to charge. depot: a name from get_map (any unique start of it, e.g. "Tesla", "FLO", "RobroTaxi"), a node id, or "best" (fastest known, counting queues). Any rider it was heading to goes back to the queue.', {
    car: carId, depot: z.string().optional(), charge_to: z.number().min(10).max(100).optional().describe('Stop charging at this %, default 90'), reason,
  }, ({ car, depot, charge_to, reason }) => JSON.stringify(need().charge(car, depot || 'best', charge_to, reason)));
  tool('reposition', 'Move a free (or charging) car to an intersection to wait for demand.', { car: carId, node: z.number().int().describe('Intersection id from get_map'), reason },
    ({ car, node, reason }) => JSON.stringify(need().reposition(car, node, reason)));
  tool('reroute', 'Re-plan a moving car to its current target on the fastest known route, optionally avoiding roads by edge id.', { car: carId, avoid_edges: z.array(z.number().int()).optional(), reason },
    ({ car, avoid_edges, reason }) => JSON.stringify(need().reroute(car, avoid_edges, reason)));
  tool('release', 'Take a car off its pickup, queued next rider, charge trip or reposition. Riders go back to the queue. Cannot drop a rider who is aboard.', { car: carId, reason },
    ({ car, reason }) => JSON.stringify(need().release(car, reason)));
  const action = z.object({
    type: z.enum(['dispatch', 'charge', 'reposition', 'reroute', 'release']), car: z.string(), rider: z.string().optional(), depot: z.string().optional(),
    charge_to: z.number().optional(), node: z.number().int().optional(), avoid_edges: z.array(z.number().int()).optional(), reason: z.string().trim().min(3).max(300).describe('Required: why this action'),
  });
  tool('act', 'Do several actions in order, then optionally advance time, in one call. Returns each action\'s result, what happened, and the new state.', {
    actions: z.array(action).max(30), note, advance_seconds: z.number().min(0).max(1800).optional().describe('0 or omitted: do not advance'), stop_on_event: z.boolean().optional(),
  }, async ({ actions, note, advance_seconds, stop_on_event }) => {
    const g = need(); const res = [];
    if (note) g.note(clean(note, 1000));
    for (const a of actions) {
      try {
        const r = a.type === 'dispatch' ? g.dispatch(a.car, a.rider, a.reason) : a.type === 'charge' ? g.charge(a.car, a.depot || 'best', a.charge_to, a.reason)
          : a.type === 'reposition' ? g.reposition(a.car, a.node, a.reason) : a.type === 'reroute' ? g.reroute(a.car, a.avoid_edges, a.reason) : g.release(a.car, a.reason);
        res.push(`ok ${a.type} ${a.car}${a.rider ? ' ' + a.rider : ''}${r.estimate ? ` (pickup ${r.estimate.pickupMin} min, ${r.estimate.batteryAtDropoff}% at drop-off)` : ''}`);
      } catch (e) { res.push(`FAILED ${a.type} ${a.car}${a.rider ? ' ' + a.rider : ''}: ${e.message}`); }
    }
    const parts = [res.length ? 'ACTIONS\n' + res.join('\n') : 'No actions.'];
    if (advance_seconds) parts.push(fmtAdvance(await pacedAdvance(g, advance_seconds, stop_on_event !== false)));
    parts.push('', g.over() ? fmtScore(g.score()) : fmtState(g.state()));
    return parts.join('\n');
  });
  tool('advance', 'Run the sim forward. Stops early (by default) when something you can act on happens. Returns events and the new state.', {
    seconds: z.number().min(2).max(1800).optional().describe('Max sim seconds, default 120'), stop_on_event: z.boolean().optional(), note,
  }, async ({ seconds, stop_on_event, note }) => {
    const g = need(); if (note) g.note(clean(note, 1000)); const r = await pacedAdvance(g, seconds || 120, stop_on_event !== false);
    return fmtAdvance(r) + '\n\n' + (g.over() ? fmtScore(g.score()) : fmtState(g.state()));
  });
  tool('get_score', 'Revenue, progress to $1M, the cost breakdown, and the same city run by the Executor alone for comparison.', {}, () => fmtScore(need().score()));
  tool('leaderboard', 'Finished games, ranked seeds first, fastest to $1M first.', { limit: z.number().int().min(1).max(100).optional() }, ({ limit }) => fmtBoard(leaderboard(), limit || 20));
  const notesKey = (p) => 'notes/' + (String(p).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 60) || '_') + '.md';
  tool('notes_read', 'Read the strategy notes you saved in earlier games (per player).', { player: z.string().optional() }, async ({ player }) => {
    const p = player || sess.game?.player; if (!p) throw new Error('Pass player, or start a game first.');
    return (await store.get(notesKey(p))) || 'No notes yet.';
  });
  tool('notes_write', 'Save strategy notes for future games (per player). Appends by default.', { text: z.string().max(8000), replace: z.boolean().optional(), player: z.string().optional() }, async ({ text, replace, player }) => {
    const p = player || sess.game?.player; if (!p) throw new Error('Pass player, or start a game first.');
    const key = notesKey(p), old = await store.get(key);
    if (old == null && (await store.list('notes/')).length >= LIM.notesFiles) throw new Error('Notes storage is full on this server.');
    const add = replace ? text + '\n' : `\n## ${new Date().toISOString().slice(0, 16)}\n${text}\n`;
    const next = replace || old == null ? add : old + add;
    if (Buffer.byteLength(next) > LIM.notesBytes) throw new Error(`Notes are capped at ${LIM.notesBytes / 1024} KB per player. Use replace: true with a shorter summary.`);
    await store.put(key, next);
    return 'Saved.';
  });

  server.registerResource('rules', 'robrotaxi://rules', { title: 'RobroTaxi rules', mimeType: 'text/markdown' }, async (uri) => ({ contents: [{ uri: uri.href, text: RULES }] }));
  server.registerResource('leaderboard', 'robrotaxi://leaderboard', { title: 'Leaderboard', mimeType: 'text/plain' }, async (uri) => ({ contents: [{ uri: uri.href, text: fmtBoard(leaderboard(), 100) }] }));
  server.registerPrompt('play', { description: 'Play a game of RobroTaxi as dispatcher', argsSchema: { player: z.string(), model: z.string() } }, ({ player, model }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Play RobroTaxi as the dispatcher. Read get_rules and notes_read first, then call new_game with player "${player}" and model "${model}". Keep going (get_state, act, advance) until net revenue reaches $1,000,000 or time runs out. Give every action a one-line reason. When it ends, call get_score and save what you learned with notes_write.` } }],
  }));
  return server;
}

/* ---------------- HTTP: viewer, live stream, leaderboard, and (with --http) MCP ---------------- */
function patchPage(file) {
  let html = fs.readFileSync(path.join(PAGES, file), 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout may have CRLF
  const rep = (a, b) => { if (!html.includes(a)) throw new Error(`${file} changed: cannot find "${a.slice(0, 40)}"`); html = html.replace(a, b); };
  rep('function step(dt) {', 'function step(dt) {\n  if (window.__robroLive) return;');
  rep('window.__robro = {', 'window.__robroLiveHooks = { main: () => MAIN, shadow: () => SHADOW, setShadow: (w) => { SHADOW = w; }, cloneWorld, nodes, edges, E, edgeAt, BASE, DEPOTS, recomputeTraffic, log, setAgentUI,\n  // the 3D scene graph, for modules that add to it (null on the 2D page)\n  get scene() { return typeof scene === "undefined" ? null : scene; }, get W3() { return typeof W3 === "undefined" ? null : W3; } };\nwindow.__robro = {');
  // live.js eases each car between server updates and rounds corners; it hands the page a finished pose
  rep('function carPos(c) {', 'function carPos(c) {\n  if (c.livePos) return c.livePos;');
  return html + '\n<script src="/live.js"></script>\n<script src="/traffic.js"></script>\n';
}
const page = (res, code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function startDemo(mode, seed) {
  const running = [...games.values()].filter((x) => x.demo && !x.over());
  const same = running.find((x) => x.mode === mode && x.seed === seed); if (same) return same;
  if (running.length >= LIM.demos || liveGames() >= LIM.games) return running[0] || null;
  if (!RANKED_SEEDS.includes(seed)) seed = RANKED_SEEDS[0];
  const g = new Game({ player: 'HQ demo', model: mode === 'scripted' ? 'built-in scripted agent' : 'Executor alone', seed, mode });
  g.demo = true; games.set(g.id, g);
  let acc = 0;
  const iv = setInterval(() => {
    if (g.over() || !games.has(g.id)) { clearInterval(iv); if (g.over()) g.finish(); return; }
    if ((watchers.get(g.id)?.size || 0) > 0 && !g.ctl.paused) {
      g.lastActive = Date.now(); acc += PACE * g.ctl.speed / 10;
      if (acc >= 2) { const n = Math.floor(acc / 2) * 2; acc -= n; g.advance(n, false, { minS: 0 }); }
    }
  }, 100);
  return g;
}

function handleView(req, res, url) {
  const p = url.pathname;
  // the city data the demo pages load as map/toronto.js (relative to /view/2d and /view/3d)
  if (p === '/view/map/toronto.js' || p === '/map/toronto.js') return page(res, 200, 'text/javascript; charset=utf-8', fs.readFileSync(path.join(PAGES, 'map', 'toronto.js')));
  if (p === '/live.js' || p === '/traffic.js') return page(res, 200, 'text/javascript', fs.readFileSync(path.join(__dirname, 'viewer', p.slice(1))));
  if (p === '/view/2d' || p === '/view/3d') {
    try { return page(res, 200, 'text/html; charset=utf-8', patchPage(p === '/view/2d' ? 'index.html' : 'index-3d.html')); } catch (e) { return page(res, 500, 'text/plain', e.message); }
  }
  if (p === '/healthz') return page(res, 200, 'text/plain', 'ok');
  const m = /^\/live\/([\w-]+)\/stream$/.exec(p);
  if (m) {
    const g = games.get(m[1]); if (!g) return page(res, 404, 'text/plain', 'no such game');
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    let evFrom = 0;
    const meta = { id: g.id, player: g.player, model: g.model, seed: g.seed, ranked: g.ranked, mode: g.mode };
    const send = () => { const snap = g.live(evFrom); evFrom = snap.evTo; res.write(`data: ${JSON.stringify({ meta, snap, ctl: g.ctl })}\n\n`); };
    if (!watchers.has(g.id)) watchers.set(g.id, new Set());
    const total = [...watchers.values()].reduce((n, x) => n + x.size, 0);
    if (total >= LIM.watchers) { res.write('event: full\ndata: {}\n\n'); return res.end(); }
    const set = watchers.get(g.id); set.add(res); g.listeners.add(send); send();
    const ka = setInterval(() => res.write(': ka\n\n'), 15000);
    req.on('close', () => { set.delete(res); g.listeners.delete(send); clearInterval(ka); });
    return;
  }
  const c = /^\/live\/([\w-]+)\/ctl$/.exec(p);
  if (c) { // viewer playback: pacing only. The sim is stepped identically at any speed, so scores do not change.
    const g = games.get(c[1]); if (!g) return page(res, 404, 'text/plain', 'no such game');
    const sp = +url.searchParams.get('speed'), pz = url.searchParams.get('paused');
    if (SPEEDS.includes(sp)) g.ctl.speed = sp;
    if (pz === '1' || pz === '0') g.ctl.paused = pz === '1';
    g.emit(); return page(res, 200, 'application/json', JSON.stringify(g.ctl));
  }
  if (p === '/demo') {
    const g = startDemo(url.searchParams.get('mode') === 'executor' ? 'executor' : 'scripted', +(url.searchParams.get('seed') || RANKED_SEEDS[0]));
    if (!g) return page(res, 503, 'text/plain', 'HQ is full right now. Try again in a few minutes.');
    res.writeHead(302, { location: `/view/${url.searchParams.get('view') === '2d' ? '2d' : '3d'}?game=${g.id}` }); return res.end();
  }
  if (p === '/api/games') return page(res, 200, 'application/json', JSON.stringify([...games.values()].map((g) => ({ ...g.summary(), over: g.over(), watchers: watchers.get(g.id)?.size || 0 }))));
  if (p === '/api/leaderboard') return page(res, 200, 'application/json', JSON.stringify(leaderboard()));
  if (p === '/' || p === '/leaderboard') return page(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'viewer', 'index.html'), 'utf8'));
  page(res, 404, 'text/plain', 'not found');
}

async function readJson(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > LIM.body) { const e = new Error('Request too large'); e.status = 413; throw e; } chunks.push(c); }
  const s = Buffer.concat(chunks).toString();
  try { return s ? JSON.parse(s) : undefined; } catch { const e = new Error('Invalid JSON'); e.status = 400; throw e; }
}
// token bucket per client IP
const buckets = new Map();
function allow(req) {
  const ip = (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  const now = Date.now(), cap = LIM.rate * 4;
  const b = buckets.get(ip) || { tokens: cap, t: now };
  b.tokens = Math.min(cap, b.tokens + (now - b.t) / 1000 * LIM.rate); b.t = now;
  if (b.tokens < 1) { buckets.set(ip, b); return false; }
  b.tokens -= 1; buckets.set(ip, b); return true;
}
const transports = new Map();
async function handleMcp(req, res) {
  // optional shared key for private launches: set ROBRO_TOKEN and clients send "Authorization: Bearer <token>"
  if (process.env.ROBRO_TOKEN && req.headers.authorization !== `Bearer ${process.env.ROBRO_TOKEN}`) return page(res, 401, 'application/json', JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'This HQ needs an access key.' }, id: null }));
  const sid = req.headers['mcp-session-id'];
  const body = req.method === 'POST' ? await readJson(req) : undefined;
  let t = sid && transports.get(sid);
  if (!t) {
    const isInit = body && (Array.isArray(body) ? body : [body]).some((m) => m.method === 'initialize');
    if (!isInit) return page(res, 400, 'application/json', JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session. Send initialize first.' }, id: null }));
    if (transports.size >= LIM.sessions) return page(res, 503, 'application/json', JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'HQ is full right now. Try again in a few minutes.' }, id: null }));
    t = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => transports.set(id, t) });
    t.onclose = () => { if (t.sessionId) transports.delete(t.sessionId); };
    await makeServer(baseFrom(req)).connect(t);
  }
  t.lastActive = Date.now();
  await t.handleRequest(req, res, body);
}

function startHttp(port, withMcp) {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/healthz' && !allow(req)) return page(res, 429, 'text/plain', 'Too many requests, slow down.');
    if (url.pathname !== '/mcp' && req.method !== 'GET' && req.method !== 'HEAD') return page(res, 405, 'text/plain', 'Read-only.');
    try {
      if (url.pathname === '/mcp') { if (!withMcp) return page(res, 404, 'text/plain', 'MCP over HTTP is off; start with --http'); return await handleMcp(req, res); }
      handleView(req, res, url);
    } catch (e) { if (!e.status) say('http error', e.message); if (!res.headersSent) page(res, e.status || 500, 'text/plain', e.status ? e.message : 'Server error'); }
  });
  srv.on('error', (e) => say(`viewer not started on port ${port}: ${e.message}`));
  srv.listen(port, HOST, () => say(`viewer http://localhost:${port}/${withMcp ? `  MCP http://localhost:${port}/mcp` : ''}`));
  return srv;
}

// housekeeping: close idle sessions and games, drop finished games from memory, forget old rate buckets
setInterval(() => {
  const now = Date.now(), idle = LIM.idleMin * 60000;
  for (const [id, t] of transports) if (now - (t.lastActive || now) > idle) { transports.delete(id); t.close().catch(() => {}); }
  for (const [id, g] of games) {
    const last = g.lastActive || Date.parse(g.startedAt);
    if (!g.over() && !g.demo && now - last > idle) { g.abandoned = true; games.delete(id); }
    else if (g.over() && now - last > 60 * 60000) games.delete(id);
    else if (g.demo && !g.over() && !(watchers.get(id)?.size) && now - last > 10 * 60000) games.delete(id);
  }
  for (const [ip, b] of buckets) if (now - b.t > 60000) buckets.delete(ip);
}, 60000).unref();

// with a remote store, load the leaderboard before taking traffic
store.loadResults().then((n) => { if (store.remote) say(`loaded ${n} results from the store`); }).catch((e) => say('could not load results:', e.message));
if (HTTP_PORT) startHttp(HTTP_PORT, true);
else {
  if (VIEW_PORT) startHttp(VIEW_PORT, false);
  makeServer().connect(new StdioServerTransport()).then(() => say('MCP server on stdio'));
}
module.exports = { makeServer, fmtState };
