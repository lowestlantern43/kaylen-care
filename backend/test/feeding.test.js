import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {normaliseFeed,validateFeedingSettings,feedingEnabled} from '../src/services/feeding.js';
mock.module('../src/db/pool.js',{namedExports:{query:async()=>({rows:[]})}});
const {projectWidget}=await import('../src/services/widgetSnapshot.js');
const base={feeding:true,item:'Demo formula',feed_route:'peg',feed_method:'pump',feed_start:'2026-10-05T08:00',feed_end:'2026-10-05T09:00',feed_status:'completed',feed_fluid_mode:'unsure',feed_planned_ml:300,feed_given_ml:240,flush_before_ml:20,flush_after_ml:30,feed_rate:100};
test('only recorded fluids count; unsure/exclude formula stay separate',()=>{
 for(const mode of ['unsure','exclude','include']){const d=normaliseFeed({...base,feed_fluid_mode:mode,amount:9999});assert.equal(d.amount,mode==='include'?290:50);assert.equal(d.feed_given_ml,240);assert.equal(d.type,'drink');assert.equal(d.unit,'ml');
 const result=projectWidget({id:'demo'},[{...d,day:'2026-10-05',time:'08:00',category:'food'}],'family','Europe/London',new Date('2026-10-05T10:00:00Z'));assert.equal(result.fluid,d.amount);}
});
test('starting counts only pre-flush; finishing and editing replace, not add to, the contribution',()=>{
 const active=normaliseFeed({...base,feed_status:'active',feed_fluid_mode:'include'});assert.equal(active.amount,20);assert.equal(active.feed_given_ml,0);assert.equal(active.flush_after_ml,0);assert.equal(active.feed_end,'');
 const finished=normaliseFeed({...active,feed_status:'completed',feed_given_ml:120,flush_after_ml:10});assert.equal(finished.amount,150);
 assert.equal(normaliseFeed({...finished,feed_given_ml:60}).amount,90);
});
test('flush-only, zero volume and invalid input handling',()=>{
 assert.equal(normaliseFeed({...base,feed_method:'flush',feed_given_ml:null,feed_fluid_mode:'include'}).amount,50);
 const zero=normaliseFeed({...base,item:'Formula 250ml',feed_given_ml:240,flush_before_ml:0,flush_after_ml:0});assert.equal(zero.amount,0);assert.equal(zero.type,'food');
 for(const change of [{feed_given_ml:-1},{feed_given_ml:'bad'},{feed_given_ml:''},{feed_end:'2026-10-04T09:00'},{feed_route:'invalid'},{feed_fluid_mode:'auto'}])assert.throws(()=>normaliseFeed({...base,...change}));
 assert.throws(()=>normaliseFeed(base,'medication'));
 const legacy={type:'drink',amount:100,unit:'ml'};assert.deepEqual(normaliseFeed(legacy),legacy);
});
test('profile opt-in and combination route validation',()=>{
 assert.equal(feedingEnabled({}),false);assert.equal(feedingEnabled({route:'oral'}),false);assert.equal(feedingEnabled({route:'ng'}),true);assert.equal(feedingEnabled({route:'other'}),false);assert.equal(feedingEnabled({route:'other',enabled:true}),true);
 assert.equal(validateFeedingSettings().fluidMode,'unsure');assert.throws(()=>validateFeedingSettings({route:'combination',routes:['oral']}));assert.equal(validateFeedingSettings({route:'combination',routes:['oral','ng']}).routes.length,2);
});
