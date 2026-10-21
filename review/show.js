const o=require(process.argv[2]);
const f2=(v)=>v==null||isNaN(v)?'—':(+v).toFixed(2);
for (const k in o) { const x=o[k]; const s=(m)=>f2(m.agent.mean)+' vs '+f2(m.exec.mean)+' d='+f2(m.delta.mean)+' [p10 '+f2(m.delta.p10)+', p90 '+f2(m.delta.p90)+'] worse='+m.agentWorseShare;
console.log(k);
for (const f of ['wait','p90','empty','tpc','lost','stranded','cancelled','trips','pickups','detourMin','km','rescue']) console.log('   ',f.padEnd(10),s(x[f]));
if (x.snaps) for (const m in x.snaps) { const q=x.snaps[m]; console.log('    snap',m,'min: pickups', q.pickupsA.p10+'-'+q.pickupsA.p90, ['wait','empty','tpc'].map(f=>f+' shown '+q[f].shownShare+' worse '+q[f].agentWorse+' d '+f2(q[f].delta.mean)+' ['+f2(q[f].delta.p10)+','+f2(q[f].delta.p90)+']').join(' | ')); }
}
