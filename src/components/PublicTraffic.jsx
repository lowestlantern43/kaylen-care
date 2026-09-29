import { useEffect, useRef, useState } from 'react';

const key='familytrack-public-analytics-choice';
const visitorKey='familytrack-public-analytics-visitor';
function readChoice(){try{return localStorage.getItem(key) || '';}catch{return 'no';}}
function source(){
  try {const host=new URL(document.referrer).hostname;
    if(host===location.hostname)return 'direct';
    if(/(^|\.)google\./.test(host))return 'google';
    for(const name of ['bing','facebook','instagram'])if(host===`${name}.com`||host.endsWith(`.${name}.com`))return name;
    return 'other';
  }catch{return 'direct';}
}
export default function PublicTraffic({children,view='landing'}){
  const [choice,setChoice]=useState(readChoice);
  const [editing,setEditing]=useState(false);
  const last=useRef('');
  useEffect(()=>{
    if(choice!=='yes'||view==='login')return;
    const page=location.pathname.replace(/\/$/,'')||'/';
    const kind=view==='auth'?'signup_interest':'page_view';
    if(last.current===`${page}:${kind}`)return;
    try{
      let visitor=JSON.parse(localStorage.getItem(visitorKey)||'null');
      if(!visitor||Date.now()-visitor.created>90*86400000){visitor={id:crypto.randomUUID(),created:Date.now()};localStorage.setItem(visitorKey,JSON.stringify(visitor));}
      last.current=`${page}:${kind}`;
      const device=/iPad|Tablet/i.test(navigator.userAgent)?'tablet':/Mobile|Android/i.test(navigator.userAgent)?'mobile':'desktop';
      void fetch(`${import.meta.env.VITE_API_BASE_URL||'/api'}/public/traffic`,{method:'POST',credentials:'omit',keepalive:true,
        headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),visitorId:visitor.id,consent:true,page,kind,device,source:source()})}).catch(()=>{});
    }catch{/* Optional analytics never interrupts the public site. */}
  },[choice,view]);
  const choose=value=>{try{localStorage.setItem(key,value);if(value!=='yes')localStorage.removeItem(visitorKey);}catch{}setChoice(value);setEditing(false);last.current='';};
  return <>{children}<div className="mx-auto max-w-5xl px-5 py-4 text-xs text-slate-600">
    {(!choice||editing)?<div className="rounded-xl border border-slate-200 bg-white p-4">
      <p>Help improve FamilyTrack? Optional first-party analytics counts public page visits, broad device type and referral source. It uses a random browser ID for up to 90 days. No care records, form contents or full referral addresses are collected. You can change this choice here.</p>
      <div className="mt-3 flex gap-3"><button type="button" className="rounded-lg border px-4 py-2" onClick={()=>choose('yes')}>Allow analytics</button><button type="button" className="rounded-lg border px-4 py-2" onClick={()=>choose('no')}>No thanks</button></div>
    </div>:<button type="button" onClick={()=>setEditing(true)} className="underline">Website analytics preferences</button>}
  </div></>;
}
