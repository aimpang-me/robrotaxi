// Balance check: how long each dispatcher takes to reach $1M on the ranked seeds.
// Usage: node bench.js [demand] [seeds,comma,separated] [policies]
process.env.ROBRO_NO_LOG = '1';
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { Game, RANKED_SEEDS } = require('./game');
const { lazyTurn, greedyTurn, play } = require('./bots');
const demand = workerData?.demand ?? +(process.argv[2] || 2);
const seeds = process.argv[3] ? process.argv[3].split(',').map(Number) : RANKED_SEEDS;
const pols = (process.argv[4] || 'executor,scripted,lazy,greedy').split(',');
const runners = {
  executor: (seed) => { const g = new Game({ player: 'bench', model: 'executor', seed, mode: 'executor', demand, shadow: false }); while (!g.over()) g.advance(1800, false); return g.summary(); },
  scripted: (seed) => { const g = new Game({ player: 'bench', model: 'scripted', seed, mode: 'scripted', demand, shadow: false }); while (!g.over()) g.advance(1800, false); return g.summary(); },
  lazy: (seed) => play(new Game({ player: 'bench', model: 'lazy', seed, demand, shadow: false }), lazyTurn),
  greedy: (seed) => play(new Game({ player: 'bench', model: 'greedy', seed, demand, shadow: false }), greedyTurn),
};
const fmt = (s) => s.finished ? `${(s.finishMin / 60).toFixed(2)}h` : `DNF $${Math.round(s.revenue / 1000)}k`;
if (!isMainThread) {
  parentPort.postMessage({ policy: workerData.policy, seed: workerData.seed, summary: runners[workerData.policy](workerData.seed) });
} else {
  const jobs = pols.flatMap((policy) => seeds.map((seed) => ({ policy, seed, demand })));
  const concurrency = Math.max(1, Math.min(jobs.length, +process.env.ROBRO_BENCH_JOBS || 8));
  const results = []; let next = 0;
  const run = (job) => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: job });
    let received;
    worker.once('message', (result) => { received = result; });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code || !received) reject(new Error(`Benchmark worker ${job.policy}/${job.seed} exited ${code}`));
      else resolve(received);
    });
  });
  Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < jobs.length) {
      const result = await run(jobs[next++]); results.push(result);
      console.error(`completed ${result.policy} seed ${result.seed}`);
    }
  })).then(() => {
    for (const p of pols) {
      const row = seeds.map((seed) => {
        const s = results.find((r) => r.policy === p && r.seed === seed).summary;
        return `${seed}:${fmt(s)} trips ${s.trips} canc ${s.cancelled} str ${s.stranded} calls ${s.toolCalls}`;
      });
      console.log(`${p} (demand ${demand})\n  ` + row.join('\n  '));
    }
    if (process.env.ROBRO_BENCH_OUTPUT) require('node:fs').writeFileSync(process.env.ROBRO_BENCH_OUTPUT, JSON.stringify({ demand, seeds, policies: pols, results }, null, 2));
  }).catch((err) => { console.error(err); process.exitCode = 1; });
}
