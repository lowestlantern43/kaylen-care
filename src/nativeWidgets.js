import { Capacitor, registerPlugin } from '@capacitor/core';
const bridge = registerPlugin('WidgetBridge');
let owner = '';
let snapshots = new Map();
let writes = Promise.resolve();
export function clearWidgets() {
  owner = ''; snapshots.clear();
  writes = writes.catch(()=>{}).then(()=>Capacitor.getPlatform()==='ios' ? bridge.clear() : null);
  return writes;
}
export function updateWidgets(scope, snapshot, allowedIds) {
  if (Capacitor.getPlatform() !== 'ios') return;
  if (owner !== scope) { snapshots.clear(); owner = scope; }
  for (const id of snapshots.keys()) if (!allowedIds.includes(id)) snapshots.delete(id);
  snapshots.set(snapshot.id, snapshot);
  const json = JSON.stringify({ children: [...snapshots.values()] });
  writes = writes.catch(()=>{}).then(()=>bridge.write({json}));
  return writes;
}
export function makeWidgetSnapshot({id,name,entries,medicines,scheduled,target,fluid,now=new Date(),entryDate}) {
  const care = {};
  const sorted = entries.map(e=>({e,date:entryDate(e)})).filter(v=>v.date && Number.isFinite(v.date.getTime()) && v.date<=now).sort((a,b)=>b.date-a.date);
  for (const [key,match] of Object.entries({latest:()=>true,toileting:e=>e.section==='Toileting',sleep:e=>e.section==='Sleep',food:e=>e.section==='Food Diary'&&!e.isMilk})) {
    const record=sorted.find(v=>match(v.e));
    // Only category and time: never copy free-text care notes to the Home Screen.
    if(record) care[key]={label:record.e.section==='Food Diary'?(record.e.isMilk?'Drink logged':'Food logged'):`${record.e.section} logged`,timestamp:record.date.getTime()/1000};
  }
  const doses=[];
  for(let day=0;day<2;day++){
    const date=new Date(now); date.setDate(date.getDate()+day);
    for(const med of medicines.filter(m=>m.active!==false && !m.scheduleDays?.includes('prn') && scheduled(m,date))){
      for(const time of med.times||[]){
        if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))continue;
        const due=new Date(date);const [h,m]=time.split(':').map(Number);due.setHours(h,m,0,0);
        if(due>=now) doses.push({name:String(med.name).slice(0,80),dose:String(med.dose||'').slice(0,50),timestamp:due.getTime()/1000});
      }
    }
  }
  doses.sort((a,b)=>a.timestamp-b.timestamp);
  return {id,name:String(name).slice(0,80),updated:now.getTime()/1000,day:now.toDateString(),fluid:Number(fluid)||0,target:Number(target)||0,medicines:doses.slice(0,30),care};
}

export async function consumeWidgetOpen() { return Capacitor.getPlatform() === "ios" ? (await bridge.consumeOpen()).url : ""; }
