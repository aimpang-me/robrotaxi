// Compare complete ranked replays; finish time wins, then revenue for unfinished runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error('Usage: node check-bench.js before.json after.json');
const [before, after] = [beforePath, afterPath].map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
assert.equal(before.demand, after.demand, 'demand must match');
assert.deepEqual([...before.seeds].sort(), [...after.seeds].sort(), 'seeds must match');
assert.deepEqual([...before.policies].sort(), [...after.policies].sort(), 'dispatchers must match');
function ranking(report, seed) {
  const runs = report.results.filter((r) => r.seed === seed);
  assert.equal(runs.length, report.policies.length, `seed ${seed} must have a complete replay`);
  assert.equal(new Set(runs.map((r) => r.policy)).size, report.policies.length, 'each policy must appear once');
  for (const { policy, summary: s } of runs) {
    assert(report.policies.includes(policy));
    assert.equal(typeof s.finished, 'boolean');
    assert(Number.isFinite(s.finished ? s.finishMin : s.revenue), 'scores must be finite');
  }
  return runs.sort((a, b) => Number(b.summary.finished) - Number(a.summary.finished) || (a.summary.finished ? a.summary.finishMin - b.summary.finishMin : b.summary.revenue - a.summary.revenue)).map((r) => r.policy);
}
let changed = false;
for (const seed of before.seeds) {
  const a = ranking(before, seed), b = ranking(after, seed);
  const same = a.join() === b.join(); changed ||= !same;
  console.log(`${seed}: ${b.join(' < ')}${same ? ' (unchanged)' : ` (WAS ${a.join(' < ')})`}`);
}
assert(!changed, 'dispatcher ranking changed');
