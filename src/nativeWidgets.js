import {activeSchoolRecord} from './attendance';
import { pendingWidgetDoses } from './widgetMedication.js';
import { api } from './api/client';
import { Capacitor, registerPlugin } from '@capacitor/core';
const bridge = registerPlugin('WidgetBridge');
let owner = '';
let sleepAccessRequested = false;
let snapshots = new Map();
let writes = Promise.resolve();
let generation = 0;
export function clearWidgets() {
  generation++;
  owner = ''; sleepAccessRequested = false; snapshots.clear();
  return Capacitor.getPlatform()==='ios' ? bridge.clear() : Promise.resolve();
}
export function updateWidgets(scope, snapshot, profiles) {
  if (Capacitor.getPlatform() !== 'ios') return;
  if (owner !== scope) { generation++; snapshots.clear(); owner = scope; sleepAccessRequested = false; }
  const expected = generation;
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
  const json = JSON.stringify({ scope, catalogueUpdated: Date.now()/1000, children: [...snapshots.values()] });
  writes = writes.catch(()=>{}).then(async()=>{
    if(expected !== generation) return;
    await bridge.write({json});
    try {
      const connection = await bridge.connection();
      if(expected !== generation) return;
      if(sleepAccessRequested && connection.scope === scope && connection.expires > Date.now()/1000 + 86400) return;
      const familyId = scope.split(':')[1];
      const access = await api.issueWidgetAccess(familyId, connection.installationId);
      if(expected !== generation) return;
      await bridge.connect({scope,token:access.token,expires:Date.parse(access.expiresAt)/1000});
      sleepAccessRequested = true;
    } catch { /* Old/disabled backends continue using the existing local snapshots. */ }
  });
  return writes;
}
export function makeWidgetSnapshot({id,name,entries,medicines,scheduled,target,fluid,usualBedtime,now=new Date(),entryDate}) {
  const care = {};
  const sorted = entries.map(e=>({e,date:entryDate(e)})).filter(v=>v.date && Number.isFinite(v.date.getTime()) && v.date<=now).sort((a,b)=>b.date-a.date);
  for (const [key,match] of Object.entries({latest:()=>true,toileting:e=>e.section==='Toileting',sleep:e=>e.section==='Sleep',food:e=>e.section==='Food Diary'&&!e.isMilk})) {
    const record=sorted.find(v=>match(v.e));
    // Only category and time: never copy free-text care notes to the Home Screen.
    if(record) care[key]={label:record.e.section==='Food Diary'?(record.e.isMilk?'Drink logged':'Food logged'):`${record.e.section} logged`,timestamp:record.date.getTime()/1000};
  }
  const doses = pendingWidgetDoses({ medicines, entries, scheduled, entryDate, now });
  const latestSleep = sorted.find(({e}) => e.section === 'Sleep');
  const sleepingSince = latestSleep?.e.rawCategory === 'sleep' &&
    !latestSleep.e.rawData?.wake_time && latestSleep.e.rawData?.bedtime
    ? latestSleep.date.getTime()/1000 : null;
  const school=activeSchoolRecord(entries.map(e=>({id:e.id,data:e.rawData})),now.getTime());
  return {schoolSince:school?Date.parse(school.data.schoolStartedAt)/1000:null,id,name:String(name).slice(0,80),updated:now.getTime()/1000,day:now.toDateString(),fluid:Number(fluid)||0,target:Number(target)||0,medicines:doses,care,sleepingSince,usualBedtime:usualBedtime || null,sleepLogId:String(latestSleep?.e.id || '').replace(/^care-/, '')};
}

// Store a tiny thumbnail, not a remote URL or a full-size profile photograph.
export function widgetPhoto(url) {
  if (Capacitor.getPlatform() !== 'ios' || !url) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => { img.onload = img.onerror = null; resolve(null); }, 4000);
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
        const size = Math.min(img.naturalWidth, img.naturalHeight);
        canvas.getContext('2d').drawImage(img, (img.naturalWidth-size)/2, (img.naturalHeight-size)/2, size, size, 0, 0, 80, 80);
        const encoded = canvas.toDataURL('image/jpeg', 0.65).split(',')[1];
        resolve(encoded.length < 12000 ? encoded : null);
      } catch { resolve(null); }
    };
    img.src = url;
  });
}

export async function consumeWidgetOpen() { return Capacitor.getPlatform() === "ios" ? (await bridge.consumeOpen()).url : ""; }
