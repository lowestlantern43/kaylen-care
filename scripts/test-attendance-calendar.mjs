import assert from 'node:assert/strict';
import {attendanceState,pickupConfirmationDue,calendarOnlyAttendance} from '../src/attendanceCalendar.js';
const day='2026-10-06',entry=(status,extra={})=>({rawData:{attendance:true,attendanceStatus:status,...extra}});
assert.equal(attendanceState(null,day,day),'neutral');
for(const [status,state] of [['attended','present'],['sick','absent'],['medical','absent'],['part_day','partial'],['holiday','closed'],['school_holiday','closed'],['training','closed']])assert.equal(attendanceState(entry(status),day,day),state);
assert.equal(attendanceState(entry('medical',{partDay:true}),day,day),'partial');
assert.equal(attendanceState(entry('holiday'),'2026-10-07',day),'closed');
assert.equal(attendanceState(entry('attended',{schoolActive:true}),day,day),'active');
assert.equal(attendanceState(entry('attended',{schoolActive:false,schoolEndedAt:'2026-10-06T15:00:00Z'}),day,day),'present');
const active={data:{schoolStartedAt:new Date(2026,9,6,8,30).toISOString()}},settings={days:{tue:{enabled:true,pickup:'15:15'}}};
assert.equal(pickupConfirmationDue(active,settings,new Date(2026,9,6,15,14)),false);
assert.equal(pickupConfirmationDue(active,settings,new Date(2026,9,6,15,15)),true);
assert.equal(pickupConfirmationDue(null,settings,new Date(2026,9,6,16)),false);
assert.equal(pickupConfirmationDue(active,{days:{}},new Date(2026,9,6,16)),false);
console.log('PASS calendar statuses, neutral future dates, active/completed sessions and pickup confirmation timing');

assert.equal(calendarOnlyAttendance({attendance:true,attendanceStatus:'school_holiday'}),true);
assert.equal(calendarOnlyAttendance({attendance:true,attendanceStatus:'attended'}),false);
assert.equal(calendarOnlyAttendance({attendance:true,attendanceStatus:'medical'}),false);
