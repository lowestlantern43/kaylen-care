import {schoolPlanForDay} from './schoolSettings.js';
export const localDay=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function attendanceState(entry,day,today=localDay()){
 if(!entry)return 'neutral';
 const d=entry.rawData||{};
 if(d.schoolActive&&!d.schoolEndedAt&&!d.collection&&d.attendanceStatus==='attended')return 'active';
 if(d.partDay||d.attendanceStatus==='part_day')return 'partial';
 if(d.attendanceStatus==='attended')return 'present';
 if(['holiday','school_holiday','training'].includes(d.attendanceStatus))return 'closed';
 return 'absent';
}
export function pickupConfirmationDue(active,settings,now=new Date()){
 if(!active)return false;
 const started=new Date(active.data.schoolStartedAt),day=localDay(started),plan=schoolPlanForDay(settings,day);
 if(!plan?.pickup||!Number.isFinite(started.getTime()))return false;
 const [h,m]=plan.pickup.split(':').map(Number);const due=new Date(started);due.setHours(h,m,0,0);
 return now>=due;
}

export const calendarOnlyAttendance = data => data?.attendance === true && ['school_holiday','holiday','training'].includes(data.attendanceStatus);
