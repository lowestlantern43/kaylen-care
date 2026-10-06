import {schoolPlanForDay} from '../schoolSettings';
import {useState,useRef} from 'react';
import {activeSchoolRecord} from '../attendance';
export default function SchoolSessionControls({entries=[],settings={},canStart,canEnd,onAction}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 const records=entries.filter(e=>e.rawData?.attendance).map(e=>({id:e.id.replace(/^care-/,''),data:e.rawData,entry:e}));
 const active=activeSchoolRecord(records);const now=new Date(),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
 const plan=schoolPlanForDay(settings,day);
 const today=records.find(r=>r.entry.rawLogDate===day);const current=active||today;
 return <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4"><h3 className="font-bold">{active?'At School / Away':'School day'}</h3><p className="mt-1 text-sm text-slate-600">{active?'School session is running. Tap Back Home when they return.':'Only tap Left for School when they actually leave. Holidays and scheduled days never start this automatically.'}</p>{active&&<p className="mt-1 text-sm">Left {new Date(active.data.schoolStartedAt).toLocaleString('en-GB')}</p>}{settings.name&&<p className="mt-2 font-semibold">{settings.name}</p>}{plan&&<p className="mt-1 text-sm">{plan.departure?'Usual departure '+plan.departure:''}{plan.pickup?' · Planned pickup '+plan.pickup:''}</p>}{error&&<p role="alert" className="mt-2 text-sm text-rose-800">{error}</p>}<button type="button" disabled={busy||!(active?canEnd:canStart)} className="mt-3 rounded-xl bg-indigo-700 px-4 py-3 font-bold text-white disabled:opacity-50" onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await onAction({action:active?'end':'start',expectedLogId:current?.id||'',expectedUpdatedAt:current?.entry.rawUpdatedAt||null,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});}catch(e){setError(e.message||'Could not update school state.');}finally{lock.current=false;setBusy(false);}}}>{busy?'Saving…':active?'Back Home':'Left for School'}</button></section>;
}
