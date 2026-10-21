// Runs one sim instance per config in a fresh module scope.
const path = require('path');
const SIM = path.join(__dirname, process.env.SIMFILE || 'harness_sim.js');
function runOnce(cfg) {
  global.__CFG = Object.assign({ seed: 20261021, minutes: 60, incTarget: 'main' }, cfg);
  delete require.cache[SIM];
  return require(SIM)();
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const pct = (a, f) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
function stats(arr) { const a = arr.filter((x) => x != null && isFinite(x)); if (!a.length) return { n: 0, mean: NaN, sd: NaN, p10: NaN, p50: NaN, p90: NaN }; if (a.length === 1) a.push(a[0]); return { n: a.length, mean: +mean(a).toFixed(3), sd: +sd(a).toFixed(3), p10: +pct(a, 0.1).toFixed(3), p50: +pct(a, 0.5).toFixed(3), p90: +pct(a, 0.9).toFixed(3) }; }
module.exports = { runOnce, stats, mean };
