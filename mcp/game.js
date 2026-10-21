// One RobroTaxi game: a fresh copy of the page's sim in its own VM context, plus the run log.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const store = require('./store');

const CORE_PATH = path.join(__dirname, 'core', 'sim-core.js');
let script = null;
function coreScript() { return script || (script = new vm.Script(fs.readFileSync(CORE_PATH, 'utf8'), { filename: 'sim-core.js' })); }

// Fixed days for ranked play: every model gets the same riders and hazards.
const RANKED_SEEDS = [1101, 2207, 3313, 4421, 5531];
const DEFAULTS = { demand: 2, hours: 24 };

let nextId = 1;
class Game {
  constructor({ player, model, seed, mode = 'external', demand = DEFAULTS.demand, hours = DEFAULTS.hours, shadow = true, client } = {}) {
    if (!player || !String(player).trim()) throw new Error('player is required');
    this.id = `g${Date.now().toString(36)}${(nextId++).toString(36)}`;
    this.player = String(player).trim().slice(0, 60);
    this.model = String(model || 'unknown').trim().slice(0, 80);
    this.client = client || null;
    this.seed = Number.isInteger(+seed) && seed !== '' && seed != null ? +seed : RANKED_SEEDS[0];
    this.ranked = RANKED_SEEDS.includes(this.seed) && demand === DEFAULTS.demand && hours === DEFAULTS.hours && mode === 'external';
    this.mode = mode;
    this.ctx = vm.createContext({ console });
    coreScript().runInContext(this.ctx);
    this.api = this.ctx.API;
    this.info = J(this.api.gameInit({ seed: this.seed, mode, demand, hours, shadow }));
    this.startedAt = new Date().toISOString();
    this.decisions = [];
    this.toolCalls = 0;
    this.listeners = new Set();
    this.ctl = { speed: 1, paused: false }; this.lastAdvEnd = Date.now(); // viewer playback settings: change pacing only, never the sim
    this.saved = false;
    this.api.events.push({ t: this.api.S.t, src: 'agent', kind: 'system', tag: 'Online',
      head: mode === 'external' ? `Player ${this.player}, ${this.model}, connected to HQ` : `${mode === 'scripted' ? 'Built-in scripted agent' : 'Executor alone'} dispatching (player ${this.player})`,
      body: `Seed ${this.seed}${this.ranked ? ' (ranked)' : ''}, about ${this.info.rph} riders/hr. Goal: $1,000,000 revenue as fast as possible.` });
  }
  // every model action goes through here so it is logged with the sim time it happened at
  act(name, args, fn) {
    this.toolCalls++;
    if (this.over()) throw new Error('The game is over. Call get_score for the result, or new_game to play again.');
    const t = this.api.S.t;
    try {
      const res = J(fn());
      this.decisions.push({ t, clock: clock(t), action: name, args, ok: true });
      this.emit();
      return res;
    } catch (e) {
      this.decisions.push({ t, clock: clock(t), action: name, args, ok: false, error: e.message });
      throw new Error(e.message);
    }
  }
  // a turn note is the model's own summary of its thinking; shown in the live reasoning panel and kept in the run log
  note(text) { text = String(text || '').trim(); if (!text) return; this.decisions.push({ t: this.api.S.t, clock: clock(this.api.S.t), action: 'note', args: { text }, ok: true }); this.api.actNote(text); this.emit(); }
  dispatch(car, rider, reason) { return this.act('dispatch', { car, rider, reason }, () => this.api.actDispatch(car, rider, reason)); }
  release(car, reason) { return this.act('release', { car, reason }, () => this.api.actRelease(car, reason)); }
  charge(car, depot, chargeTo, reason) { return this.act('charge', { car, depot, chargeTo, reason }, () => this.api.actCharge(car, depot, chargeTo, reason)); }
  reposition(car, node, reason) { return this.act('reposition', { car, node, reason }, () => this.api.actReposition(car, node, reason)); }
  reroute(car, avoid, reason) { return this.act('reroute', { car, avoid, reason }, () => this.api.actReroute(car, avoid || [], reason)); }
  // part: one slice of a paced advance ({ minS, why }); it is not counted as a tool call
  advance(seconds = 120, stopOnEvent = true, part = null) {
    if (!part) this.toolCalls++;
    if (this.over()) return { over: true, score: this.score() };
    const s = Math.max(2, Math.min(1800, +seconds || 120));
    const res = J(part ? this.api.advance(s, stopOnEvent, part.minS, part.why) : this.api.advance(s, stopOnEvent));
    this.emit();
    if (this.over()) this.finish();
    return res;
  }
  state(all) { this.toolCalls++; return J(this.api.state({ all })); }
  options(rider, limit) { this.toolCalls++; return J(this.api.options(rider, limit || 4)); }
  map(q) { return J(this.api.mapInfo(q || {})); }
  score() { return J(this.api.score()); }
  over() { return this.api.over(); }
  live(evFrom = 0) { return J(this.api.liveSnap(evFrom)); }
  emit() { for (const f of this.listeners) { try { f(this); } catch { /* viewer gone */ } } }
  summary() {
    const s = this.score();
    return { game: this.id, player: this.player, model: this.model, client: this.client, mode: this.mode, seed: this.seed, ranked: this.ranked, demand: this.info.demand, rph: this.info.rph,
      finished: s.finished, finishMin: s.finishMin, revenue: s.ledger.revenue, elapsedMin: s.elapsedMin, trips: s.ledger.trips, cancelled: s.ledger.cancelled, stranded: s.ledger.stranded,
      avgWaitMin: s.ledger.avgWaitMin, decisions: this.decisions.filter((d) => d.ok).length, rejected: this.decisions.filter((d) => !d.ok).length, toolCalls: this.toolCalls,
      executorAloneRevenue: s.executorAloneSameCity ? s.executorAloneSameCity.revenue : null, startedAt: this.startedAt, endedAt: new Date().toISOString() };
  }
  // write the result line and the full decision log once the game ends
  finish() {
    if (this.saved || process.env.ROBRO_NO_LOG) return;
    this.saved = true;
    const sum = this.summary();
    store.addResult(sum, { ...sum, decisionsLog: this.decisions, feed: J(this.api.events).filter((e) => e.kind !== 'fare') });
    return sum;
  }
}
// copy out of the VM realm into plain JSON
function J(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
function clock(t) { const m = Math.floor(t / 60); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }

function leaderboard() {
  return store.allResults().slice().sort((a, b) => (b.ranked - a.ranked) || (b.finished - a.finished) || (a.finished ? a.finishMin - b.finishMin : b.revenue - a.revenue));
}

module.exports = { Game, RANKED_SEEDS, DEFAULTS, leaderboard };
