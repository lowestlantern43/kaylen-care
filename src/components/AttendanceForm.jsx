import {useState,useRef} from 'react';
import {attendanceLabels,attendanceDates,normaliseAttendance} from '../attendance';
const field='mt-1 block w-full min-w-0 rounded-xl border border-slate-300 bg-white p-3';
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export default function AttendanceForm({entry,onSave}){
 const [start,setStart]=useState(entry?.rawLogDate||today()),[end,setEnd]=useState(''),[data,setData]=useState(entry?.rawData||{attendance:true,attendanceStatus:'attended',setting:'',arrival:'',collection:'',partDay:false}),[notes,setNotes]=useState(entry?.rawNotes||''),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 const set=(k,v)=>setData(d=>({...d,[k]:v}));
 const range=!entry&&['school_holiday','holiday','training','sick','other'].includes(data.attendanceStatus);
 return <div className="mt-4 space-y-4"><p className="text-sm text-slate-600">Record attendance or why they were away. Unlogged days stay not recorded; closures are not absences.</p>{error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-800">{error}</p>}<fieldset disabled={busy} className="min-w-0 space-y-4">
 <label className="block text-sm font-semibold">Day type<select className={field} value={data.attendanceStatus} onChange={e=>set('attendanceStatus',e.target.value)}>{Object.entries(attendanceLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 <div className="grid gap-3 sm:grid-cols-2"><label className="block min-w-0 text-sm font-semibold">Date<input type="date" className={field} value={start} onChange={e=>setStart(e.target.value)}/></label>{range&&<label className="block min-w-0 text-sm font-semibold">Through to (optional)<input type="date" min={start} className={field} value={end} onChange={e=>setEnd(e.target.value)}/></label>}</div>{range&&end&&<p className="text-xs text-slate-500">Includes every calendar day in the range. Each day can be edited separately.</p>}
 <label className="block text-sm font-semibold">School / nursery name (optional)<input className={field} value={data.setting||''} maxLength={150} onChange={e=>set('setting',e.target.value)}/></label>
 {data.attendanceStatus==='medical'&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={data.partDay===true} onChange={e=>set('partDay',e.target.checked)}/>Part-day appointment — also attended that day</label>}
 {(data.attendanceStatus==='attended'||(data.attendanceStatus==='medical'&&data.partDay))&&<div className="grid gap-3 sm:grid-cols-2">{[['arrival','Arrival (optional)'],['collection','Collection (optional)']].map(([k,l])=><label key={k} className="block min-w-0 text-sm font-semibold">{l}<input type="time" className={field} value={data[k]||''} onChange={e=>set(k,e.target.value)}/></label>)}</div>}
 <label className="block text-sm font-semibold">Notes / reason (optional)<textarea rows={3} className={field} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
 <button type="button" className="rounded-xl bg-indigo-700 px-4 py-3 font-bold text-white" onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const finish=range&&end?end:start;attendanceDates(start,finish);await onSave({startDate:start,endDate:finish,data:normaliseAttendance(data),notes});}catch(e){setError(e.message||'Could not save attendance.');}finally{lock.current=false;setBusy(false);}}}>{busy?'Saving…':entry?'Save attendance changes':'Save attendance'}</button>
 </fieldset></div>;
}
