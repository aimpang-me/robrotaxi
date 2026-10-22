process.env.ROBRO_NO_LOG = '1';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { Game } = require('./game');
const text = fs.readFileSync(__dirname + '/server.js', 'utf8');
const source = text.match(/async function pacedAdvance\(g, seconds, stop\) \{[\s\S]*?\n\}/)[0];
(async () => {
  let baseline;
  for (const [speed,paused,watched] of [[1,false,false],[.25,false,true],[.5,false,true],[1,false,true],[2,true,true],[4,false,true]]) {
    const g = new Game({player:'pacing-check',model:'fixture',seed:2207,shadow:true});
    g.dispatch('T-01','R-101','Identical action before each pacing replay.');
    g.ctl = {speed,paused};
    let waits = 0;
    const context = vm.createContext({PACE:60,Date:{now:()=>10000},watchers:new Map(watched?[[g.id,new Set([1])]]:[]),sleep:async()=>{waits++;g.ctl.paused=false}});
    vm.runInContext(source,context);
    const result = await context.pacedAdvance(g,121,false);
    assert.equal(result.advancedS,122,'all pacing settings round the total request to the same fixed tick');
    const snapshot = JSON.stringify(g.live());
    if (baseline) assert.equal(snapshot,baseline,'pacing and pause cannot change riders, hazards, traffic, fleet, or score'); else baseline=snapshot;
    if (watched) assert(waits>0,'the watched path really exercised pacing');
  }
  console.log('Unwatched, quarter/half/normal/double/quadruple playback and a paused replay have identical authoritative snapshots.');
})().catch(e=>{console.error(e);process.exitCode=1});
