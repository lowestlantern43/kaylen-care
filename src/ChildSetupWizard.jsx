import { saveChildSetup } from "./childSetup";
import { useRef, useState } from "react";

const steps = ["The basics", "Background", "Medicines", "Daily care", "Review"];
const days = [["mon","Mon"],["tue","Tue"],["wed","Wed"],["thu","Thu"],["fri","Fri"],["sat","Sat"],["sun","Sun"]];
const background = [["diagnosisNeeds","Any diagnoses or needs to know about?"],["communicationStyle","How do they communicate?"],["keyNeeds","What do carers need to know first?"],["allergies","Any known allergies?"],["emergencyNotes","What should carers do in an emergency?"],["triggers","What can upset or overwhelm them?"],["calmingStrategies","What helps them feel calm?"],["sensoryNeeds","Any sensory needs?"]];
const routines = [["eatingPreferences","Food preferences or feeding support"],["sleepPreferences","Sleep routine and support"],["toiletingNotes","Toileting support"],["schoolEhcpNotes","School, nursery or EHCP information"]];
const field = "mt-1 block w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900";
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold disabled:opacity-40";

export default function ChildSetupWizard({ api, familyId, allowed, initialProfile, serializeMedications, onComplete, first = false }) {
  const [open, setOpen] = useState(first);
  const [step, setStep] = useState(0);
  const [basics, setBasics] = useState({ firstName: "", dateOfBirth: "" });
  const [profile, setProfile] = useState(() => ({ ...initialProfile }));
  const [medicines, setMedicines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const created = useRef({ child: null });
  const saving = useRef(false);
  const setMed = (index, key, value) => setMedicines(rows => rows.map((row,i) => i === index ? { ...row, [key]: value } : row));
  const textFields = fields => fields.map(([key,label]) => <label key={key} className="block text-sm font-semibold text-slate-700">{label}<textarea rows={2} className={field} value={profile[key] || ""} placeholder="Optional — you can add this later" onChange={e=>setProfile(p=>({...p,[key]:e.target.value}))}/></label>);
  const validate = () => {
    if (!basics.firstName.trim()) return "Please add the child's name.";
    if (basics.dateOfBirth && basics.dateOfBirth > new Date().toLocaleDateString('en-CA')) return "Date of birth cannot be in the future.";
    for (const med of medicines) {
      if (med.doseAmount.trim() && !med.doseUnit.trim()) return "Add the dose unit for each medicine with a dose.";
      if (!med.name.trim()) return "Give each medicine a name, or remove the empty medicine.";
      if ([med.name,med.doseAmount,med.instructions].some(v=>/[|\r\n]/.test(v))) return "Please keep medicine details on one line without the | character.";
      if (med.scheduleDays[0] !== "prn" && (!med.scheduleDays.length || !med.times.length || med.times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))) return "Choose days and a time for each scheduled medicine, or select As needed.";
    }
    if (profile.dailyFluidTargetMl && (!/^\d+$/.test(String(profile.dailyFluidTargetMl)) || Number(profile.dailyFluidTargetMl) <= 0)) return "Enter a positive whole number for the fluid target, or leave it blank.";
    return "";
  };
  const save = async () => {
    if (saving.current || !allowed) return;
    const problem = validate(); if (problem) { setError(problem); return; }
    saving.current = true; setBusy(true); setError("");
    try {
      // Keep the created ID on profile failure so Retry cannot create a second child.
      const result = await saveChildSetup({ api, familyId, basics, progress: created.current,
        profile: { ...profile, currentMedications: serializeMedications(medicines.map(m => m.scheduleDays.includes("prn") ? { ...m, times: [] } : m)) } });
      onComplete(result.child, result.profile);
      created.current = { child: null }; setBasics({firstName:"",dateOfBirth:""}); setProfile({...initialProfile}); setMedicines([]); setStep(0); setOpen(first);
    } catch (e) { setError(`${created.current.child ? "Child created, but their care profile has not saved. Keep this screen open and retry. " : ""}${e.message || "Please try again."}`); }
    finally { saving.current = false; setBusy(false); }
  };
  if (!open) return <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><h4 className="font-bold">Add another child</h4><p className="my-2 text-sm text-slate-600">Set up their profile, medicines and daily routines step by step.</p><button type="button" className={button} disabled={!allowed} onClick={()=>setOpen(true)}>Start child setup</button>{!allowed && <p className="mt-2 text-sm">Your account cannot add another child right now.</p>}</section>;
  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
    <p className="text-xs font-bold uppercase tracking-wide text-teal-700">Child setup · Step {step+1} of {steps.length}</p>
    <h2 className="mt-2 text-xl font-bold">{steps[step]}</h2>
    <p className="mt-2 text-sm text-slate-600">Only their name is required. Skip anything you don't know; you can edit their care profile later.</p>
    <div className="my-4 flex gap-1" aria-hidden="true">{steps.map((s,i)=><span key={s} className={`h-1.5 flex-1 rounded ${i<=step?'bg-teal-600':'bg-slate-200'}`}/>)}</div>
    <fieldset disabled={busy || !!created.current.child} className="min-w-0 space-y-4">
    {step===0 && <><label className="block text-sm font-semibold">Child's name<input autoComplete="off" className={field} value={basics.firstName} onChange={e=>setBasics(b=>({...b,firstName:e.target.value}))}/></label><label className="block text-sm font-semibold">Date of birth (optional)<input type="date" className={field} value={basics.dateOfBirth} onChange={e=>setBasics(b=>({...b,dateOfBirth:e.target.value}))}/></label></>}
    {step===1 && textFields(background)}
    {step===2 && <><p className="text-sm text-slate-600">Copy their current care plan or prescription. Leave this empty if they have no medicines to record. Notification permission is managed separately.</p>{medicines.map((med,i)=><div key={i} className="space-y-3 rounded-xl border bg-slate-50 p-3"><h3 className="font-bold">Medicine {i+1}</h3>{[["name","Medicine name"],["doseAmount","Prescribed dose"],["doseUnit","Unit (for example ml or tablet)"]].map(([key,label])=><label className="block text-sm" key={key}>{label}<input className={field} value={med[key]} onChange={e=>setMed(i,key,e.target.value)}/></label>)}<label className="block text-sm">When is it taken?<select className={field} value={med.scheduleDays.includes('prn')?'prn':med.scheduleDays.includes('every_day')?'every_day':'specific'} onChange={e=>{setMed(i,'scheduleDays',e.target.value==='specific'?['mon']:[e.target.value]);setMed(i,'requiredDaily',e.target.value!=='prn');}}><option value="every_day">Every day</option><option value="specific">Specific days</option><option value="prn">As needed (PRN)</option></select></label>{!med.scheduleDays.includes('prn') && <>{!med.scheduleDays.includes('every_day') && <div className="flex flex-wrap gap-2">{days.map(([key,label])=><label className="rounded-lg border bg-white p-2 text-sm" key={key}><input type="checkbox" checked={med.scheduleDays.includes(key)} onChange={e=>setMed(i,'scheduleDays',e.target.checked?[...med.scheduleDays,key]:med.scheduleDays.filter(d=>d!==key))}/> {label}</label>)}</div>}{med.times.map((time,j)=><div key={j} className="flex items-end gap-2"><label className="min-w-0 flex-1 text-sm">Time {j+1}<input type="time" className={field} value={time} onChange={e=>setMed(i,'times',med.times.map((t,n)=>n===j?e.target.value:t))}/></label>{med.times.length>1 && <button className={button} type="button" onClick={()=>setMed(i,'times',med.times.filter((_,n)=>n!==j))}>Remove time</button>}</div>)}<button type="button" className={button} onClick={()=>setMed(i,'times',[...med.times,''])}>Add another time</button></>}<label className="block text-sm">Instructions (optional)<input className={field} value={med.instructions} onChange={e=>setMed(i,'instructions',e.target.value)}/></label><button type="button" className={button} onClick={()=>setMedicines(rows=>rows.filter((_,n)=>n!==i))}>Remove medicine</button></div>)}<button type="button" className={button} onClick={()=>setMedicines(rows=>[...rows,{name:'',doseAmount:'',doseUnit:'',times:[''],active:true,requiredDaily:true,scheduleDays:['every_day'],instructions:''}])}>Add a medicine</button></>}
    {step===3 && <><label className="block text-sm font-semibold">Daily fluid target (ml)<input type="number" min="1" step="1" inputMode="numeric" className={field} value={profile.dailyFluidTargetMl || ''} onChange={e=>setProfile(p=>({...p,dailyFluidTargetMl:e.target.value}))}/><span className="mt-1 block text-xs font-normal text-slate-500">Use their agreed target if they have one; otherwise leave blank.</span></label>{textFields(routines)}</>}
    {step===4 && <div className="space-y-3 text-sm"><p><strong>{basics.firstName}</strong>{basics.dateOfBirth ? ` · Born ${basics.dateOfBirth}` : ''}</p>{[...background,...routines].filter(([key])=>profile[key]).map(([key,label])=><div key={key}><strong>{label}</strong><p className="whitespace-pre-wrap break-words">{profile[key]}</p></div>)}<p><strong>Fluid target:</strong> {profile.dailyFluidTargetMl ? `${profile.dailyFluidTargetMl} ml/day` : 'Not set'}</p><h3 className="font-bold">Medicines</h3>{!medicines.length && <p>None added</p>}{medicines.map((m,i)=><p key={i} className="break-words">{m.name} · {m.doseAmount} {m.doseUnit} · {m.scheduleDays.join(', ')}{!m.scheduleDays.includes('prn') ? ` at ${m.times.join(', ')}` : ''}{m.instructions ? ` · ${m.instructions}` : ''}</p>)}<p className="text-slate-600">Check medicine doses and times before saving. These will fill the existing care profile and medication schedule.</p></div>}
    </fieldset>
    {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {!allowed && <p role="alert" className="mt-4 text-sm text-amber-800">Your account cannot add a child right now.</p>}
    <div className="mt-5 flex flex-wrap justify-between gap-2"><button type="button" className={button} disabled={busy || step===0 || !!created.current.child} onClick={()=>{setError('');setStep(s=>s-1);}}>Back</button>{step<4 ? <button type="button" className={button+' bg-teal-50'} disabled={!basics.firstName.trim()} onClick={()=>{setError('');setStep(s=>s+1);}}>Continue</button> : <button type="button" className={button+' bg-teal-50'} disabled={busy || !allowed} onClick={save}>{busy?'Saving...':created.current.child?'Retry profile save':'Create child & save profile'}</button>}</div>
    {!first && !created.current.child && <button type="button" className="mt-4 text-sm text-slate-600 underline" disabled={busy} onClick={()=>setOpen(false)}>Close setup — keep my draft</button>}
  </section>;
}
