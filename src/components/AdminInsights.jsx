import ActivationInsights from './ActivationInsights';
import { useEffect,useState } from 'react';
import { api } from '../api/client';

export default function AdminInsights(){
  const [days,setDays]=useState(7),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [recipient,setRecipient]=useState(''),[enabled,setEnabled]=useState(false),[preview,setPreview]=useState(null),[notice,setNotice]=useState('');
  useEffect(()=>{let active=true;setError('');api.adminInsights(days).then(value=>{if(active){setData(value);setRecipient(value.digest.recipient);setEnabled(value.digest.enabled);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[days]);
  async function save(){setBusy(true);setError('');setNotice('');try{const digest=await api.saveAdminDigest({recipient,enabled});setData(d=>({...d,digest}));setNotice('Email settings saved.');}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function showPreview(){setBusy(true);try{setPreview(await api.previewAdminDigest());}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function sendTest(){setBusy(true);setError('');setNotice('');try{const result=await api.testAdminDigest();setNotice(result.message);}catch(e){setError(e.message);}finally{setBusy(false);}}
  const box='rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';
  const t=data?.traffic;
  return <section className="mt-4 space-y-4" aria-label="Website traffic and admin updates">
    <div className={box}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Website traffic</h2><select aria-label="Reporting period" value={days} onChange={e=>setDays(Number(e.target.value))} className="rounded-lg border p-2"><option value={1}>Today</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></div>
      <p className="mt-2 text-sm text-slate-500">Public website visits from browsers that allow analytics. Figures start when tracking goes live; app activity is excluded. Dates use UK time.</p>
      {t?<><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Measured visitors',t.visitors],['Page views',t.views],['Signup clicks',t.interest],['New user accounts',t.registrations]].map(([label,value])=><div key={label} className="rounded-xl bg-slate-50 p-3"><div className="text-2xl font-bold">{value}</div><div className="text-xs text-slate-600">{label}</div></div>)}</div><p className="mt-2 text-xs text-slate-500">Visitors are distinct browser IDs. New accounts include all registration sources and are not attributed to measured visits.</p>
      <div className="mt-5 space-y-2" aria-label="Daily page views">{t.daily.length?t.daily.map(day=><div key={day.day} className="flex items-center gap-3 text-xs"><span className="w-24 shrink-0">{day.day}</span><div className="h-3 flex-1 rounded bg-slate-100"><div className="h-3 rounded bg-indigo-400" style={{width:`${Math.max(1,100*day.views/Math.max(...t.daily.map(d=>d.views))) }%`}}/></div><span>{day.views} views</span></div>):<p className="text-sm text-slate-500">No measured visits yet.</p>}</div></>:<p className="mt-4">Loading traffic…</p>}
    </div>
    {t?<div className="grid gap-4 md:grid-cols-3">{[['Popular pages',t.pages],['Referral sources',t.sources],['Devices',t.devices]].map(([title,rows])=><div className={box} key={title}><h3 className="font-bold">{title}</h3>{rows.length?rows.map(row=><div key={row.label} className="mt-3 flex justify-between gap-3 text-sm"><span className="break-all">{row.label}</span><strong>{row.views}</strong></div>):<p className="mt-3 text-sm text-slate-500">No data yet</p>}</div>)}</div>:null}
    <ActivationInsights/>
    <div className={box}><h2 className="font-bold">Nightly admin update</h2><p className="mt-2 text-sm text-slate-500">Every night at 22:30 UK time. Includes new users, measured traffic, upcoming trial endings and recorded email activity. Subject: FamilyTrack Admin Update — date.</p>
      <label className="mt-4 block text-sm">Recipient email<input type="email" value={recipient} onChange={e=>setRecipient(e.target.value)} className="mt-1 block w-full rounded-lg border p-2"/></label>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Send nightly admin update</label>
      <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy||!data} type="button" onClick={save} className="rounded-lg bg-indigo-600 px-4 py-2 text-white">Save email settings</button><button disabled={busy||!data} type="button" onClick={showPreview} className="rounded-lg border px-4 py-2">Preview last reporting period</button></div>
      <button disabled={busy||!data?.digest.recipient} type="button" onClick={sendTest} className="mt-3 rounded-lg border px-4 py-2">Send test email to saved recipient</button>
      {notice?<p role="status" className="mt-3 text-sm">{notice}</p>:null}
      {data?.digest.runs.map(run=><p key={run.period_end} className="mt-3 text-sm">{new Date(run.period_end).toLocaleString('en-GB',{timeZone:'Europe/London'})} — {run.status} ({run.attempts} attempts)</p>)}
      {preview?<><iframe title="Admin email preview" sandbox="" srcDoc={preview.html || ''} className="mt-4 h-[650px] w-full rounded-xl border"/><details className="mt-3"><summary className="cursor-pointer text-sm">Plain-text version</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-xs">{preview.body}</pre></details></>:null}
    </div>
    {error?<p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>:null}
  </section>;
}
