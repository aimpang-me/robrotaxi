const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag) { this.tag=tag; this.attrs={}; this.children=[]; }
  setAttribute(k,v) { this.attrs[k]=String(v); }
  append(n) { this.children.push(n); n.parent=this; }
  before(n) { this.parent.children.splice(this.parent.children.indexOf(this),0,n); n.parent=this.parent; }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this),1); }
}
const fixture = () => {
  const parent=new Element('g'), routes=new Element('g'), frames=[];
  parent.append(routes);
  const world={t:0,traffic:{vehicles:[{id:'V1',model:'sedan',color:'#b23344',length:.44,path:[0,1],seg:0,prog:2},{id:'V2',model:'bus',color:'#ead7ac',length:1.1,path:[0,1],seg:0,prog:4}]}};
  const document={hidden:false,getElementById:()=>routes,createElementNS:(_,tag)=>new Element(tag)};
  vm.runInNewContext(fs.readFileSync(__dirname+'/viewer/traffic.js','utf8'),{window:{__robroTrafficHooks:{main:()=>world,E:()=>({oneway:false}),edgeAt:(e,a,d)=>({x:d,y:0,ang:0})}},document,requestAnimationFrame:f=>frames.push(f)});
  return {world,frames,layer:parent.children[0]};
};
const a=fixture(),before=JSON.stringify(a.world); a.frames.shift()();
assert.equal(JSON.stringify(a.world),before,'rendering cannot change authoritative traffic');
assert.equal(a.layer.children.length,2,'every authoritative vehicle is drawn');
const first=a.layer.children[0],pose=first.attrs.transform;
assert.equal(first.children[0].attrs.fill,'#b23344');
assert.equal(first.children[0].attrs.width,'.44'.replace(/^\./,'0.'));
a.world.t=10000; a.frames.shift()();
assert.equal(first.attrs.transform,pose,'clock changes alone cannot invent vehicle motion');
a.world.traffic.vehicles.reverse();a.frames.shift()();
assert.equal(first.children[0].attrs.fill,'#b23344','paint belongs to vehicle identity, not render order');
a.world.traffic.vehicles.find(v=>v.id==='V1').prog=3;a.frames.shift()();
assert.notEqual(first.attrs.transform,pose,'accepted road progress moves the rendered car');
const b=fixture();b.world.t=10000;b.frames.shift()();
assert.equal(b.layer.children[0].attrs.transform,pose,'joining later renders the same authoritative pose');
a.world.traffic.vehicles=[];a.frames.shift()();assert.equal(a.layer.children.length,0,'departed vehicles are removed');
console.log('Traffic view checks passed: authoritative movement, stable appearance, no local clock extrapolation, join-time parity.');
const live = fs.readFileSync(__dirname + '/viewer/live.js', 'utf8');
const motionContext = vm.createContext({
  gap: 120,
  sameArr: (a,b) => JSON.stringify(a) === JSON.stringify(b),
  cumOf: p => p.map((_,i) => i * 10),
  segAt: (cum,d) => Math.min(cum.length-2,Math.floor(d / 10)),
});
vm.runInContext(live.match(/  function retarget\(m, sc, now, duration\) \{[\s\S]*?\n  \}/)[0],motionContext);
for (const [path,seg,prog,expected] of [
  [[0,1,2,1,2,3,4],3,5,35],
  [[1,2,3,4],0,5,5],
]) {
  const m={path:[0,1,2,1,2,3],cum:[0,10,20,30,40,50],from:35,to:35,t0:100,dur:100};
  motionContext.retarget(m,{path,seg,prog},100,100);
  assert.equal(m.from,expected,'route extension/trimming retains the current occurrence of a repeated road');
  assert.equal(m.to,expected);
}
const lagged={path:[0,1,2,1,2,3],cum:[0,10,20,30,40,50],from:25,to:25,t0:100,dur:100};
motionContext.retarget(lagged,{path:[1,2,3,4],seg:0,prog:5},100,100);
assert.equal(lagged.from,25); assert.equal(lagged.to,35,'a trimmed route preserves its not-yet-rendered prefix');
console.log('Live route interpolation retains repeated road occurrences through extension and trimming.');
const nodes = Array.from({length:8},(_,i)=>({x:i*10,y:0}));
Object.assign(motionContext, {
  motion:new Map(), trafficMotion:new Map(),
  H:{nodes},
  poseOf:(m,d)=> {
    if(m.path.length<2) return null;
    let i=0;while(i<m.cum.length-2 && m.cum[i+1]<=d)i++;
    const a=nodes[m.path[i]],b=nodes[m.path[i+1]],u=(d-m.cum[i])/(m.cum[i+1]-m.cum[i]);
    return {x:a.x+(b.x-a.x)*u,y:0};
  },
});
vm.runInContext(live.match(/  function prepareMotion\(base, next\) \{[\s\S]*?\n  \}/)[0],motionContext);
const base={snap:{t:100,cars:[{id:'T1',path:[0,1],seg:0,prog:2}],traffic:{vehicles:[{id:'V1',path:[0,1],seg:0,prog:3}]}}};
const next={snap:{t:110,cars:[{id:'T1',path:[0,1],seg:0,prog:8}],traffic:{vehicles:[{id:'V1',path:[0,1],seg:0,prog:9}]}}};
motionContext.prepareMotion(base,next);
for(const m of [motionContext.motion.get('T1'),motionContext.trafficMotion.get('V1')]) {
  assert.equal(m.t0,100000);assert.equal(m.dur,10000,'taxi and ambient poses share the accepted simulation interval');
  const halfway=m.from+(m.to-m.from)*.5;
  assert.equal(halfway,m.from+3,'half the displayed interval draws half the accepted movement');
}
next.snap.cars[0]={id:'T1',path:[6],seg:0,prog:0};
motionContext.prepareMotion(base,next);
const tow=motionContext.motion.get('T1');
assert.equal(tow.from,2);assert.equal(tow.to,2,'a future tow holds position until its accepted boundary');
base.snap.cars[0].path=[0,1,2];next.snap.cars[0]={id:'T1',path:[0,1,3],seg:0,prog:4};
motionContext.prepareMotion(base,next);
assert.deepEqual(Array.from(motionContext.motion.get('T1').path),[0,1,2],'a future reroute cannot replace the due route ribbon');
assert.equal(motionContext.motion.get('T1').to,2,'a new plan waits for its accepted decision boundary');
next.snap.t=base.snap.t;
motionContext.prepareMotion(base,next);
assert(motionContext.motion.get('T1').dur>0,'same-time control updates cannot create a zero-duration pose');
console.log('Taxi and ambient playback share accepted sim time and hold disconnected moves until due.');
