import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildRows,splitRows,metrics,fit,experiment} from '../dist/engine.mjs';
const data=JSON.parse(readFileSync(new URL('../dist/data/recorded.json',import.meta.url)));
const config={horizon:1,features:'all',deadband:.001,train:60,split:'chronological',leak:false};
test('fixed three-class macro F1 and confusion matrix match hand calculations',()=>{
 assert.equal(metrics([-1,0,1],[-1,0,1]).f1,1);
 assert.equal(metrics([0,0],[0,0]).f1,1/3);
 assert.deepEqual(metrics([-1,0,1],[-1,1,1]).matrix,[[1,0,0],[0,0,1],[0,0,1]]);
});
test('recorded capture reproduces label counts, censoring and time purging',()=>{
 const {rows}=buildRows(data,config);assert.equal(rows.length,1138);
 const s=splitRows(rows,config);assert.equal(s.test.length,228);
 assert.ok(Math.max(...s.train.map(r=>r.end))<Math.min(...s.validation.map(r=>r.t)));
 assert.ok(Math.max(...s.finalTrain.map(r=>r.end))<Math.min(...s.test.map(r=>r.t)));
 assert.ok(s.purged>0);
});
test('labels do not cross sessions and shorter horizons relabel actual observations',()=>{
 const toy={frames:Array.from({length:200},(_,i)=>({t:i*100,s:Math.floor(i/100),m:100+i*.01,x:[1,.2,.3,.4,1,2]}))};
 const {rows}=buildRows(toy,{...config,horizon:.5});
 assert.equal(rows.length,190);assert.ok(rows.every(r=>r.end-r.t===500));
 assert.ok(rows.every(r=>Math.floor(r.t/10000)===Math.floor(r.end/10000)));
 assert.ok(rows.every(r=>r.y===1));
});
test('standardization is fitted only on supplied training data',()=>{
 const rows=[{y:-1,x:[1,3]},{y:0,x:[2,4]},{y:1,x:[3,5]}];
 assert.deepEqual(fit(rows,1,1).mean,[2,4]);
});
test('repeated runs have identical selected model, predictions and uncertainty',()=>{
 assert.deepEqual(experiment(data,config),experiment(data,config));
});
test('changing held-out feature values does not alter validation selection or scaler',()=>{
 const base=experiment(data,config);const changed=structuredClone(data);
 for(const f of changed.frames)if(f.t>=base.split.testStart&&f.x)f.x=f.x.map(v=>v+1000);
 const after=experiment(changed,config);
 assert.deepEqual(after.candidates,base.candidates);assert.equal(after.selectedC,base.selectedC);
 assert.deepEqual(after.scalerMean,base.scalerMean);
});
test('future target mode is explicit and always marked invalid',()=>{
 const normal=buildRows(data,config).rows;
 const leaked=buildRows(data,{...config,leak:true}).rows;
 assert.equal(normal[0].x.length,6);assert.equal(leaked[0].x.length,7);
 assert.ok(leaked.every(r=>r.x.at(-1)===r.y));
 const result=experiment(data,{...config,leak:true});assert.equal(result.validProtocol,false);
 assert.ok(result.scores.logistic.f1>.8);
});
test('random split is seeded and explicitly invalid',()=>{
 const result=experiment(data,{...config,split:'random'});
 assert.equal(result.validProtocol,false);assert.match(result.split.mode,/invalid/);
 assert.equal(result.split.purged,0);
});
test('invalid parameter values fail clearly',()=>{
 assert.throws(()=>buildRows(data,{...config,horizon:0}),/positive horizon/);
 assert.throws(()=>buildRows(data,{...config,deadband:NaN}),/nonnegative/);
 assert.throws(()=>splitRows(buildRows(data,config).rows,{...config,train:80}),/40% and 75%/);
});
