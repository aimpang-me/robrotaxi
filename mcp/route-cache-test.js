const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const context = vm.createContext({ console });
new vm.Script(fs.readFileSync(__dirname + '/core/sim-core.js', 'utf8')).runInContext(context);
context.API.gameInit({ seed: 1101, mode: 'scripted', demand: 2, hours: 24, shadow: false });
const compare = () => vm.runInContext(`(() => {
  for (const from of [0, 100, 500, 1100]) for (const to of [-1, 300, 900]) for (const reverse of [false,true]) {
    const a = heapSearch(from,to,timeW,reverse), b = heapSearch(from,to,(e)=>timeW(e),reverse);
    if (JSON.stringify([Array.from(a.dist),Array.from(a.prev)]) !== JSON.stringify([Array.from(b.dist),Array.from(b.prev)])) throw new Error('Cached road search differs');
    if (a !== heapSearch(from,to,timeW,reverse)) throw new Error('Search did not exercise cache');
  }
  return true;
})()`, context);
assert(compare());
vm.runInContext('S.rush = true; recomputeTraffic();',context); assert(compare());
vm.runInContext("addIncident('crash',edges[20],'seed',600); S.incidents[0].seen=true; recomputeTraffic();",context); assert(compare());
vm.runInContext('S.incidents.length=0; S.t+=600; recomputeTraffic();',context); assert(compare());
vm.runInContext('for(let i=0;i<520;i++) heapSearch(i,0,timeW,false);',context); assert(compare());
console.log('Cached/uncached road trees match exactly through load, sensed closures, clearance, and bounded cache eviction.');
