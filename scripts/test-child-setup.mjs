import assert from 'node:assert/strict';
import { saveChildSetup } from '../src/childSetup.js';
let creates=0, writes=0;
const progress={};
const profile={diagnosisNeeds:'Fictional background',dailyFluidTargetMl:'900',currentMedications:'Test schedule'};
const api={
 createChild:async(family,data)=>{creates++;assert.equal(family,'family');assert.equal(data.firstName,'Demo');return {id:'child'};},
 updateChildProfile:async(family,id,data)=>{writes++;assert.equal(family,'family');assert.equal(id,'child');assert.deepEqual(data,profile);if(writes===1)throw new Error('temporary failure');return data;}
};
const args={api,familyId:'family',basics:{firstName:' Demo '},profile,progress};
await assert.rejects(saveChildSetup(args),/temporary failure/);
const result=await saveChildSetup(args);
assert.equal(creates,1);assert.equal(writes,2);assert.equal(result.child.id,'child');assert.deepEqual(result.profile,profile);
await assert.rejects(saveChildSetup({...args,progress:{},api:{createChild:async()=>{throw new Error('limit reached')},updateChildProfile:async()=>assert.fail('must not write profile')}}),/limit reached/);
console.log('PASS: child setup saves existing profile fields, retries without duplicate child, and respects create failure');
