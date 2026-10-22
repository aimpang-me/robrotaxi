// Where results, run logs and notes live. Local disk by default; with ROBRO_STORE_URL set, an HTTP object
// store (GET/PUT /obj/<key>, GET /list?prefix=) such as the Cloudflare Worker in ../cloudflare backed by R2.
const fs = require('fs');
const path = require('path');

const RUNS_DIR = process.env.ROBRO_RUNS_DIR || path.join(__dirname, 'runs');
const NOTES_DIR = process.env.ROBRO_NOTES_DIR || path.join(__dirname, 'notes');
const BASE = process.env.ROBRO_STORE_URL ? process.env.ROBRO_STORE_URL.replace(/\/$/, '') : null;
const KEY = /^(results\.jsonl|logs\/[\w-]+\.json|notes\/[\w-]+\.md)$/;

function file(key) { const [top, ...rest] = key.split('/'); return top === 'notes' ? path.join(NOTES_DIR, ...rest) : path.join(RUNS_DIR, key); }
function check(key) { if (!KEY.test(key)) throw new Error('bad store key ' + key); return key; }

async function get(key) {
  check(key);
  if (BASE) {
    const r = await fetch(`${BASE}/obj/${key}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`store get ${key}: ${r.status}`);
    return r.text();
  }
  const f = file(key); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}
async function put(key, text) {
  check(key);
  if (BASE) { const r = await fetch(`${BASE}/obj/${key}`, { method: 'PUT', body: text }); if (!r.ok) throw new Error(`store put ${key}: ${r.status}`); return; }
  const f = file(key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text);
}
async function list(prefix) {
  if (BASE) { const r = await fetch(`${BASE}/list?prefix=${encodeURIComponent(prefix)}`); if (!r.ok) throw new Error(`store list: ${r.status}`); return r.json(); }
  const dir = path.dirname(file(prefix + 'x'));
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => prefix + f) : [];
}

// results are kept in memory and written through, so the leaderboard never waits on storage.
// With an HTTP store, saves fail closed: nothing is written until the stored leaderboard has loaded, so a
// failed or slow load can never replace it with a partial list. Results that finish before then are queued
// in memory and merged into the first write after the load succeeds.
let results = null, chain = Promise.resolve(), loading = null, queued = [];
const parse = (t) => (t || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const saveErr = (e) => console.error('[robrotaxi] saving run failed:', e.message);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const writeResults = () => put('results.jsonl', results.map((r) => JSON.stringify(r)).join('\n') + '\n');
const writeLog = (game, log) => put(`logs/${game}.json`, JSON.stringify(log, null, 1));
function loadResults() {
  if (loading) return loading;
  const run = (async () => {
    if (!BASE) { results = parse(fs.existsSync(file('results.jsonl')) ? fs.readFileSync(file('results.jsonl'), 'utf8') : '').concat(queued.map((q) => q.sum)); queued = []; return results.length; }
    for (let attempt = 0; ; attempt++) {
      try {
        const stored = parse(await get('results.jsonl')), pending = queued;
        queued = [];
        results = stored.concat(pending.map((q) => q.sum)); // merge: rows saved while loading are kept, not dropped
        if (pending.length) chain = writeResults().then(() => Promise.all(pending.map((q) => writeLog(q.sum.game, q.log)))).catch(saveErr);
        return results.length;
      } catch (e) {
        if (attempt % 12 === 0) console.error('[robrotaxi] could not load results, retrying:', e.message); // keep retrying: queued results wait for the load
        await sleep(5000);
      }
    }
  })();
  loading = run;
  run.then(() => {}, () => { if (loading === run) loading = null; });
  return run;
}
function allResults() {
  if (results) return results;
  if (BASE) return []; // the stored leaderboard is empty until loadResults() succeeds (never written from here)
  return (results = parse(fs.existsSync(file('results.jsonl')) ? fs.readFileSync(file('results.jsonl'), 'utf8') : ''));
}
function addResult(sum, log) {
  if (BASE && !results) { // boot load not done yet: queue in memory, retry the load, never write
    queued.push({ sum, log });
    loadResults().catch(saveErr);
    return chain;
  }
  allResults().push(sum);
  chain = chain.then(async () => {
    if (BASE) await writeResults();
    else { fs.mkdirSync(RUNS_DIR, { recursive: true }); fs.appendFileSync(file('results.jsonl'), JSON.stringify(sum) + '\n'); }
    await writeLog(sum.game, log);
  }).catch(saveErr);
  return chain;
}

module.exports = { get, put, list, loadResults, allResults, addResult, RUNS_DIR, NOTES_DIR, remote: !!BASE };
