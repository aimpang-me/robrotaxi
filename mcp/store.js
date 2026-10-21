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

// results are kept in memory and written through, so the leaderboard never waits on storage
let results = null, chain = Promise.resolve();
const parse = (t) => (t || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
async function loadResults() { const pending = results || []; results = parse(await get('results.jsonl')).concat(pending); return results.length; }
function allResults() {
  if (!results) results = BASE ? [] : parse(fs.existsSync(file('results.jsonl')) ? fs.readFileSync(file('results.jsonl'), 'utf8') : '');
  return results;
}
function addResult(sum, log) {
  allResults().push(sum);
  chain = chain.then(async () => {
    if (BASE) await put('results.jsonl', results.map((r) => JSON.stringify(r)).join('\n') + '\n');
    else { fs.mkdirSync(RUNS_DIR, { recursive: true }); fs.appendFileSync(file('results.jsonl'), JSON.stringify(sum) + '\n'); }
    await put(`logs/${sum.game}.json`, JSON.stringify(log, null, 1));
  }).catch((e) => console.error('[robrotaxi] saving run failed:', e.message));
  return chain;
}

module.exports = { get, put, list, loadResults, allResults, addResult, RUNS_DIR, NOTES_DIR, remote: !!BASE };
