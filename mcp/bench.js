// Balance check: how long each dispatcher takes to reach $1M on the ranked seeds.
// Usage: node bench.js [demand] [seeds,comma,separated] [policies]
process.env.ROBRO_NO_LOG = '1';
const { Game, RANKED_SEEDS } = require('./game');
const { lazyTurn, greedyTurn, play } = require('./bots');
const demand = +(process.argv[2] || 2);
const seeds = process.argv[3] ? process.argv[3].split(',').map(Number) : RANKED_SEEDS;
const pols = (process.argv[4] || 'executor,scripted,lazy,greedy').split(',');
const runners = {
  executor: (seed) => { const g = new Game({ player: 'bench', model: 'executor', seed, mode: 'executor', demand, shadow: false }); while (!g.over()) g.advance(1800, false); return g.summary(); },
  scripted: (seed) => { const g = new Game({ player: 'bench', model: 'scripted', seed, mode: 'scripted', demand, shadow: false }); while (!g.over()) g.advance(1800, false); return g.summary(); },
  lazy: (seed) => play(new Game({ player: 'bench', model: 'lazy', seed, demand, shadow: false }), lazyTurn),
  greedy: (seed) => play(new Game({ player: 'bench', model: 'greedy', seed, demand, shadow: false }), greedyTurn),
};
const fmt = (s) => s.finished ? `${(s.finishMin / 60).toFixed(2)}h` : `DNF $${Math.round(s.revenue / 1000)}k`;
for (const p of pols) {
  const row = []; const t0 = Date.now();
  for (const seed of seeds) { const s = runners[p](seed); row.push(`${seed}:${fmt(s)} trips ${s.trips} canc ${s.cancelled} str ${s.stranded} calls ${s.toolCalls}`); }
  console.log(`${p} (demand ${demand}, ${((Date.now() - t0) / 1000).toFixed(1)}s)\n  ` + row.join('\n  '));
}
