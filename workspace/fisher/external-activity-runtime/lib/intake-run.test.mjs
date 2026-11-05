import test from 'node:test';
import assert from 'node:assert/strict';
import { IntakeRun } from './intake-run.mjs';
import { execFileSync } from 'node:child_process';
const run = () => new IntakeRun({ after:'2026-09-07', before:'2026-09-17', required:['drive'] });
test('no calls cannot certify a run', () => assert.equal(run().finish().complete, false));
test('connector error is retained and never becomes empty success', async () => {
 const r=run(); await assert.rejects(r.collect('drive',async()=>({isError:true,content:[]}),{}, {kind:'rows'}));
 assert.equal(r.finish().complete,false);
});
test('opaque pagination is traversed; unread tail blocks classification', async () => {
 const r=run(), tokens=[];
 await r.collect('drive',async a=>{tokens.push(a.page_token); return {structuredContent:{results:[{id:String(tokens.length)}],next_page_token:tokens.length===1?'opaque-token':null}};},{},{kind:'rows',cursorKey:'page_token'});
 assert.deepEqual(tokens,[undefined,'opaque-token']);
 assert.equal(r.finish().complete,false);
 r.dismiss('1','unrelated metadata');r.dismiss('2','duplicate language version');
 r.select('doc','a'.repeat(7001)); const first=r.next('doc');r.acknowledge(first);
 assert.throws(()=>r.classify('doc',{status:'pending',evidence:'source'}),/tail/);
 assert.throws(()=>r.acknowledge(first),/Out-of-order/);
 assert.equal(r.finish().complete,false);
 r.acknowledge(r.next('doc'));r.classify('doc',{status:'pending',evidence:'source'});
 assert.equal(r.finish().complete,true); assert.equal(r.finish().pending.length,1);
});
test('changed source invalidates receipts and disposition',()=>{
 const r=run();r.select('x','first');r.acknowledge(r.next('x'));r.classify('x',{status:'excluded',evidence:'user choice'});
 r.select('x','changed');assert.throws(()=>r.classify('x',{status:'excluded',evidence:'user choice'}),/tail/);
});
test('exact prior source disposition survives a new run without requeueing it', async()=>{
 const r=new IntakeRun({
  after:'2026-09-17T00:00:00Z', before:'2026-09-17T01:00:00Z', required:['gmail'],
  priorDispositions:{'gmail:old-message':{status:'irrelevant',evidence:'previously reviewed service notice'}},
 });
 await r.collect('gmail',async()=>({structuredContent:{results:[{id:'old-message'}],next_page_token:null}}),{}, {kind:'rows'});
 assert.equal(r.finish().complete,true);
});
test('checkpoint preserves only classified source metadata for the next run', async()=>{
 const r=run();
 await r.collect('drive',async()=>({structuredContent:{results:[{id:'doc-1'}],next_page_token:null}}),{}, {kind:'rows'});
 r.dismiss('doc-1','already reconciled');
 assert.deepEqual(r.checkpoint(),{priorDispositions:{'drive:doc-1':{status:'irrelevant',evidence:'already reconciled'}}});
});
test('a changed Drive version is requeued even when its file id was previously reviewed', async()=>{
 const r=new IntakeRun({
  after:'2026-09-17T00:00:00Z', before:'2026-09-17T01:00:00Z', required:['drive'],
  priorDispositions:{'drive:doc-1:2026-09-16T00:00:00Z':{status:'irrelevant',evidence:'old version'}},
 });
 await r.collect('drive',async()=>({structuredContent:{results:[{id:'doc-1',modifiedTime:'2026-09-17T00:00:00Z'}],next_page_token:null}}),{}, {kind:'rows'});
 assert.equal(r.finish().complete,false);
 assert.match(r.finish().errors.join('\n'),/Untriaged discovery: doc-1/);
});
test('actual connector bundle compiles and exposes the same gate',()=>{
 const source=execFileSync(process.execPath,[new URL('../intake-bundle.mjs',import.meta.url).pathname],{encoding:'utf8'});
 const {IntakeRun: Bundled}=new Function(source)();
 assert.equal(new Bundled({after:'2026-09-07',before:'2026-09-17',required:['gmail']}).finish().complete,false);
});
test('parent discovered by search does not require synthetic reply evidence',async()=>{
 const {collectThreadWindow}=await import('./intake-coverage.mjs');
 const r=await collectThreadWindow(async()=>({structuredContent:{messages:'=== THREAD PARENT MESSAGE ===\nMessage TS: 2.0\nreal root\nNo thread messsages',pagination_info:'There are no more messages in this thread.'}}),async()=>{throw Error('unnecessary recovery');},{channelId:'C1',threadTs:'2.0',after:'1',before:'3',expectedIds:['C1:2.0']});
 assert.equal(r.method,'thread');assert.match(r.rows[0].body,/real root/);
});
