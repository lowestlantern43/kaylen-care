import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';

export default function ActivationCoach({familyId,revision,onAdd,onReminders,onReports,onSettings}) {
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);
  const requestNumber=useRef(0),saving=useRef(false);
  useEffect(()=>{
    const token=++generation.current;
    setData(null);
    const refresh=(visit=false)=>{
      if(document.visibilityState==='hidden'||saving.current)return;
      const request=++requestNumber.current;
      api.activation(familyId,{visit,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone})
        .then(value=>{if(generation.current===token&&request===requestNumber.current)setData(value);}).catch(()=>{});
    };
    refresh(true);
    const foreground=()=>refresh(true), changed=()=>refresh(false);
    document.addEventListener('visibilitychange',foreground);
    window.addEventListener('familytrack:care-log-changed',changed);
    window.addEventListener('familytrack:activation-report',changed);
    return()=>{generation.current++;document.removeEventListener('visibilitychange',foreground);window.removeEventListener('familytrack:care-log-changed',changed);window.removeEventListener('familytrack:activation-report',changed);};
  },[familyId]);
  useEffect(()=>{
    if(saving.current)return;
    const token=generation.current;
    const request=++requestNumber.current;
    api.activation(familyId,{}).then(value=>{if(generation.current===token&&request===requestNumber.current)setData(value);}).catch(()=>{});
  },[familyId,revision]);
  async function change(values){
    const token=generation.current;
    ++requestNumber.current;saving.current=true;
    setBusy(true);setError('');
    try{const value=await api.activation(familyId,values);if(generation.current===token)setData(value);}
    catch{if(generation.current===token)setError('That preference could not be saved. Please try again.');}
    finally{saving.current=false;if(generation.current===token)setBusy(false);}
  }
  if(!data?.eligible)return null;
  const show=!data.dismissed&&!data.expired;
  const s=data.summary;
  const button='rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white';
  return <section className="mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4" aria-label="Your care history">
    {show?<>
      <div className="flex items-start justify-between gap-3"><h2 className="text-base font-bold text-slate-900">{!data.entries?'Start with today':!data.age?'Your care record has started':s?.days===7?'Your first week so far':s?.days===3?'Your first three days so far':'Your first day of care history'}</h2><button type="button" disabled={busy} className="text-sm text-slate-600 underline" onClick={()=>change({dismissed:true})}>Hide</button></div>
      <p role="status" className="mt-2 text-sm text-slate-700">{!data.entries?'Record a care moment from today — a drink, meal, medication or another care moment. Start wherever suits you.':!data.age?'Your first entry has started a record you can come back to. Each care moment adds to the picture.':'Welcome back — pick up wherever you left off.'}</p>
      {s?<><p className="mt-3 text-xs text-slate-600">Family records · {s.start} to {new Date(Date.parse(s.end+'T00:00:00Z')-86400000).toISOString().slice(0,10)}</p><p className="mt-1 font-semibold text-slate-800">{s.total} recorded care {s.total===1?'moment':'moments'}</p><p className="mt-1 text-sm text-slate-600">{s.drinks} drink entries · {s.meals} meal entries · {s.medication} medication entries · {s.toileting} toileting entries{s.feeds ? ` · ${s.feeds} feed/flush entries` : ""}</p></>:null}
      <div className="mt-3 flex flex-wrap gap-2"><button className={button} type="button" onClick={onAdd}>Log care</button>
      {data.entries>=3&&data.age<2?<button type="button" className="rounded-xl border bg-white px-3 py-2 text-sm" onClick={onReminders}>Explore reminders</button>:null}
      {data.age>=2&&s?.total>0?<button type="button" className="rounded-xl border bg-white px-3 py-2 text-sm" onClick={onReports}>See your history in a report</button>:null}
      {data.age>=6&&s?.total>0?<button type="button" className="rounded-xl border bg-white px-3 py-2 text-sm" onClick={onSettings}>Explore family sharing</button>:null}</div>
      {data.entries>0&&data.age===0&&!data.reminderAttempted?<label className="mt-4 flex items-start gap-2 text-sm text-slate-700"><input className="mt-0.5 h-4 w-4 shrink-0" type="checkbox" disabled={busy} checked={data.reminderOptIn} onChange={e=>change({reminderOptIn:e.target.checked})}/><span>One notification tomorrow morning when my first-day summary is ready. Notifications must be enabled in <button type="button" className="underline" onClick={onReminders}>notification settings</button>.</span></label>:null}
    </>:null}
    <details className={show?'mt-3 text-xs text-slate-600':'text-sm text-slate-600'}><summary className="cursor-pointer">Care history guidance preferences</summary>
      <label className="mt-3 flex items-start gap-2"><input className="mt-0.5 h-4 w-4 shrink-0" type="checkbox" disabled={busy} checked={!data.dismissed} onChange={e=>change({dismissed:!e.target.checked})}/>Show gentle guidance during my first two weeks of logging.</label>
      <label className="mt-3 flex items-start gap-2"><input className="mt-0.5 h-4 w-4 shrink-0" type="checkbox" disabled={busy} checked={data.analyticsOptIn} onChange={e=>change({analyticsOptIn:e.target.checked,visit:true})}/>Help improve FamilyTrack with aggregate activation statistics. No names or care details appear in these statistics. Progress is linked to your account to count return days; switching this off clears return/report tracking.</label>
      {data.reminderOptIn&&!data.reminderAttempted?<button type="button" disabled={busy} className="mt-3 underline" onClick={()=>change({reminderOptIn:false})}>Turn off the first-day notification</button>:null}
    </details>
    {error?<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>:null}
  </section>;
}
