const assert = require('node:assert/strict');
const Playback = require('./viewer/live');

const packet = (t, events = [], evTo = events.length, state = {}) => ({ meta: { player: 'Test' }, snap: { t, events, evTo, ...state } });
const advance = (p, start, seconds, controls = {}) => {
  const frames = [];
  for (let ms = start + 100; ms <= start + seconds * 1000; ms += 100) frames.push(p.step(ms, controls));
  return frames;
};
const p = new Playback();
p.push(packet(100));
assert.equal(p.step(0).base.snap.t, 100, 'joining starts at the accepted city time');
const future = packet(124, [{ t: 110, head: 'Spotted' }], 1, { revenue: 100, incidents: ['accepted hazard'] });
const original = JSON.stringify(future);
p.push(future);
let f = p.step(100);
assert(f.time > 100 && f.time < 124, 'accepted movement is spread over playback time');
assert.equal(f.base.snap.revenue, undefined, 'future revenue stays out of the visible world');
assert.equal(f.base.snap.incidents, undefined, 'future hazards stay out of the visible world');
const thinking = advance(p, 100, 3);
assert(thinking.every((x, i) => !i || x.time > thinking[i - 1].time), 'playback continues through a network thinking gap');
const tail = advance(p, 3100, 40);
assert.equal(tail.at(-1).time, 124, 'playback catches up without inventing simulation time');
assert.equal(tail.at(-1).buffered, 0, 'an exhausted buffer reports an honest pause');
assert.equal(thinking.concat(tail).flatMap(x => x.events).length, 1, 'accepted events appear once');
assert.equal(JSON.stringify(future), original, 'playback never edits authoritative snapshots');
p.push(future);
assert.equal(p.step(43200).events.length, 0, 'SSE reconnection does not repeat event IDs');

const paused = new Playback();
paused.push(packet(10)); paused.step(0); paused.push(packet(100));
assert.equal(paused.step(100, { paused: true }).time, 10);
assert.equal(paused.step(100000, { paused: true }).time, 10, 'a long viewer pause freezes display time');
assert(paused.step(100100).time < 11, 'resuming does not spend the paused wall time');
const a = new Playback(), b = new Playback();
for (const q of [a, b]) { q.push(packet(0)); q.step(0); q.push(packet(120)); }
assert(b.step(100, { speed: 4 }).time > a.step(100).time, 'speed changes consume accepted playback faster');
assert.equal(b.step(200, { hidden: true }).time, 120, 'hidden playback catches up instead of retaining unseen frames');
assert.equal(b.step(600000).time, 120, 'returning from a hidden tab cannot extrapolate');

const same = new Playback();
same.push(packet(0)); same.step(0);
same.push(packet(2, [{ t: 2, head: 'First' }], 1, { state: 'first' }));
same.push(packet(2, [{ t: 2, head: 'Second' }], 2, { state: 'second' }));
const due = advance(same, 0, 3);
assert.equal(due.flatMap(x => x.due).length, 1, 'same-time action states coalesce');
assert.deepEqual(due.flatMap(x => x.events).map(x => x.head), ['First', 'Second'], 'coalescing preserves ordered decisions');
assert.equal(due.at(-1).base.snap.state, 'second');

const bounded = new Playback({ maxPackets: 3, maxBytes: 100 });
bounded.push(packet(0), 10); bounded.step(0);
for (let i = 1; i <= 20; i++) bounded.push(packet(i, [{ t: i, head: String(i) }], i), 40);
assert.equal(bounded.step(100, { paused: true }).time, 0, 'overflow does not break a viewer pause');
const caught = bounded.step(200);
assert.equal(caught.time, 20, 'overflow explicitly resynchronizes to accepted state');
assert(caught.resynced, 'a skipped playback interval is disclosed');
assert.equal(caught.events.length, 20, 'a snapshot overflow preserves its decision history');

const { Game } = require('./game');
const g = new Game({ player: 'Playback check', model: 'fixture', seed: 1101, mode: 'scripted', shadow: false });
const live = new Playback(), source = [], shown = [];
let evFrom = 0;
for (let i = 0; i < 12; i++) {
  if (i) g.advance(2, false);
  const snap = g.live(evFrom); evFrom = snap.evTo;
  source.push(...snap.events);
  live.push({ meta: {}, snap });
  shown.push(...live.step(i * 100).events);
}
const score = JSON.stringify(g.score()), latest = g.live().t;
for (const frame of advance(live, 1100, 60)) shown.push(...frame.events);
assert.equal(live.step(61200).time, latest);
assert.deepEqual(shown, source, 'a real game retains all source events through delayed playback');
assert.equal(JSON.stringify(g.score()), score, 'viewing cannot change ranked results');
console.log('Playback checks passed for buffering, causal state, event identity, pause/speed, suspension, bounded resync, and ranked isolation.');
