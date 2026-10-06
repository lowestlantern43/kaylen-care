export const attendanceLabels = {attended:'Attended',training:'Training / inset day',school_holiday:'School holiday',holiday:'Personal holiday',medical:'Medical appointment',sick:'Sick day',other:'Other absence'};
export function attendanceDates(start,end=start) {
 const valid=d=>typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d+'T12:00:00Z')) && new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
 if(!valid(start)||!valid(end)||end<start)throw new Error('Choose a valid date range.');
 const dates=[];for(let d=new Date(start+'T12:00:00Z');d.toISOString().slice(0,10)<=end;d.setUTCDate(d.getUTCDate()+1)){dates.push(d.toISOString().slice(0,10));if(dates.length>93)throw new Error('Choose up to 93 days at a time.');}return dates;
}
export function normaliseAttendance(data,category='general') {
 if(!data?.attendance)return data;
 if(category!=='general')throw new Error('Attendance must use the attendance log.');
 if(!Object.hasOwn(attendanceLabels,data.attendanceStatus))throw new Error('Choose an attendance status.');
 const status=data.attendanceStatus, partDay=status==='medical' && data.partDay===true;
 const arrival=status==='attended'||partDay?String(data.arrival||''):'';
 const collection=status==='attended'||partDay?String(data.collection||''):'';
 for(const t of [arrival,collection])if(t&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))throw new Error('Use a valid arrival or collection time.');
 if(arrival&&collection&&collection<arrival)throw new Error('Collection must be after arrival.');
 const schoolStartedAt=data.schoolStartedAt && Number.isFinite(Date.parse(data.schoolStartedAt))?new Date(data.schoolStartedAt).toISOString():null;
 const schoolEndedAt=data.schoolEndedAt && Number.isFinite(Date.parse(data.schoolEndedAt))?new Date(data.schoolEndedAt).toISOString():null;
 const schoolActive=!!(schoolStartedAt && !schoolEndedAt && !collection && status==='attended' && data.schoolActive===true);
 return {attendance:true,attendanceStatus:status,partDay,arrival,collection,schoolStartedAt,schoolEndedAt,schoolActive,setting:String(data.setting||'').trim().slice(0,150)};
}
export function attendanceDetails(d){return [d.schoolStartedAt?'Left for school: '+new Date(d.schoolStartedAt).toLocaleString('en-GB'):null,d.schoolEndedAt?'Back home: '+new Date(d.schoolEndedAt).toLocaleString('en-GB'):null,d.schoolActive?'At School / Away':null,d.setting?'Setting: '+d.setting:null,d.attendanceStatus==='medical'?(d.partDay?'Part-day appointment':'Whole-day appointment'):null,d.arrival?'Arrived: '+d.arrival:null,d.collection?'Collected: '+d.collection:null].filter(Boolean);}

// No scheduled-day inference: only an explicitly started, unresolved session is live.
export function activeSchoolRecord(records,now=Date.now()) {
 return records.filter(r=>r.data?.attendance && r.data.schoolActive===true && r.data.attendanceStatus==='attended' && !r.data.collection && !r.data.schoolEndedAt && Number.isFinite(Date.parse(r.data.schoolStartedAt)) && Date.parse(r.data.schoolStartedAt)<=now).sort((a,b)=>Date.parse(b.data.schoolStartedAt)-Date.parse(a.data.schoolStartedAt))[0]||null;
}
