import { pendingWidgetDoses } from './widgetMedication.js';
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
export function updateWidgets(scope, snapshot, profiles) {
  if (Capacitor.getPlatform() !== 'ios') return;
  if (owner !== scope) { snapshots.clear(); owner = scope; }
  const before = JSON.stringify([...snapshots.values()]);
  const allowedIds = profiles.map(profile => profile.id);
  for (const id of snapshots.keys()) if (!allowedIds.includes(id)) snapshots.delete(id);
  for (const profile of profiles) {
    const cached = snapshots.get(profile.id);
    // Publish the full picker catalogue, but never imply unsynced data is current.
    snapshots.set(profile.id, { ...(cached || { id: profile.id, updated: 0, day: '', fluid: 0, target: 0, medicines: [], care: {} }), name: String(profile.name || 'Care profile').slice(0, 80) });
  }
  const previous = snapshots.get(snapshot.id);
  const unchanged = previous && snapshot.updated - previous.updated < 300 &&
    JSON.stringify({ ...previous, updated: 0 }) === JSON.stringify({ ...snapshot, updated: 0 });
  if (allowedIds.includes(snapshot.id) && !unchanged) snapshots.set(snapshot.id, snapshot);
  if (before === JSON.stringify([...snapshots.values()])) return writes;
  const json = JSON.stringify({ scope, children: [...snapshots.values()] });
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
  const doses = pendingWidgetDoses({ medicines, entries, scheduled, entryDate, now });
  return {id,name:String(name).slice(0,80),updated:now.getTime()/1000,day:now.toDateString(),fluid:Number(fluid)||0,target:Number(target)||0,medicines:doses,care};
}

export async function consumeWidgetOpen() { return Capacitor.getPlatform() === "ios" ? (await bridge.consumeOpen()).url : ""; }
