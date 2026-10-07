import {test,mock} from 'node:test';import assert from 'node:assert/strict';
let writes=0,canEdit=true;
mock.module('../src/services/planAccess.js',{namedExports:{getFamilyPlanAccess:async()=>({canAddLogs:true,canEditLogs:canEdit})}});
mock.module('../src/services/schoolSession.js',{namedExports:{schoolSession:async(f,c,u,b,n,o)=>{assert.equal(f,'family');assert.equal(o.widget,true);writes++;return {saved:true};}}});
const {widgetSchoolAction}=await import('../src/services/widgetSchool.js');
test('school widget actions require explicit scope, membership role and plan permission',async()=>{
 const access={family_id:'family',user_id:'user',role:'parent',school_actions:true},body={childId:'11111111-1111-4111-8111-111111111111',action:'start'};
 await assert.rejects(()=>widgetSchoolAction({...access,school_actions:false},body));
 await assert.rejects(()=>widgetSchoolAction({...access,role:'viewer'},body));
 assert.equal(writes,0);await widgetSchoolAction(access,body);assert.equal(writes,1);
 canEdit=false;await assert.rejects(()=>widgetSchoolAction(access,{...body,action:'end'}));assert.equal(writes,1);
});
