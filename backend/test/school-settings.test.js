import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSchoolSettings,schoolPlanForDay} from '../src/services/schoolSettings.js';
test('school plans preserve weekday times without implying attendance',()=>{
 const settings=validateSchoolSettings({name:' Nursery ',days:{tue:{enabled:true,departure:'08:30',pickup:'15:15'}}});
 assert.equal(settings.name,'Nursery');assert.equal(schoolPlanForDay(settings,'2026-10-06').pickup,'15:15');assert.equal(schoolPlanForDay(settings,'2026-10-10'),null);
 assert.equal(schoolPlanForDay({},'2026-10-06'),null);
 for(const row of [{enabled:'yes'},{enabled:true,pickup:'25:00'},{departure:'15:00',pickup:'08:00'}])assert.throws(()=>validateSchoolSettings({days:{mon:row}}));
 assert.throws(()=>validateSchoolSettings({name:'x'.repeat(151)}));
});
