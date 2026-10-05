import {useEffect,useRef,useState,useId} from 'react';
import {createPortal} from 'react-dom';
import {api} from '../api/client';
const EMPTY_INSIGHTS=Object.freeze([]);

export function useSmartInsights(familyId,childId,enabled,revision){
  const [data,setData]=useState(null);
  const scope=`${familyId}:${childId}:${revision}`;
  useEffect(()=>{
    if(!enabled||!familyId||!childId)return;
    let active=true,sequence=0;
    const refresh=async()=>{
      if(document.visibilityState==='hidden')return;
      const request=++sequence;
      try{const result=await api.smartInsights(familyId,childId,Intl.DateTimeFormat().resolvedOptions().timeZone);if(active&&request===sequence)setData({...result,scope});}
      catch{if(active&&request===sequence)setData(null);}
    };
    refresh();const timer=setInterval(refresh,5*60*1000);
    document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[familyId,childId,enabled,revision]);
  return enabled&&data?.scope===scope&&Date.now()-data.checkedAt<30*60*1000?data.indicators:EMPTY_INSIGHTS;
}

export default function SmartInsightBadge({insight,className=''}){
  const [open,setOpen]=useState(false),closeButton=useRef(null),labelId=useId();
  useEffect(()=>{
    if(!open||!insight)return;
    const previous=document.activeElement;closeButton.current?.focus();
    const keys=e=>{if(e.key==='Escape'){e.preventDefault();setOpen(false);}if(e.key==='Tab'){e.preventDefault();closeButton.current?.focus();}};
    document.addEventListener('keydown',keys);
    return()=>{document.removeEventListener('keydown',keys);previous?.focus?.();};
  },[open,insight]);
  if(!insight)return null;
  return <><button type="button" aria-label={`Smart insight: ${insight.title}`} title={insight.title} onClick={()=>setOpen(true)} className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-xs font-bold normal-case text-amber-800 ${className}`}>i</button>
    {open?createPortal(<div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-900/30 p-4" onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}><div role="dialog" aria-modal="true" aria-labelledby={labelId} className="w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-5 text-slate-800 shadow-xl"><h2 id={labelId} className="text-lg font-bold">{insight.title}</h2><p className="mt-3 text-sm leading-6">{insight.detail}</p><p className="mt-3 text-xs text-slate-500">Based on recorded entries. You can turn Smart Insights off in this care profile.</p><button ref={closeButton} type="button" className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white" onClick={()=>setOpen(false)}>Close</button></div></div>,document.body):null}
  </>;
}
