// Describes logged records only. No inferred diagnoses, prescribed targets or treatment advice.
const median = values => { const sorted=[...values].sort((a,b)=>a-b), mid=Math.floor(sorted.length/2); return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2; };
const minute = value => /^([01]\d|2[0-3]):[0-5]\d/.test(value||'') ? Number(value.slice(0,2))*60+Number(value.slice(3,5)) : null;
export function deriveSmartInsights({enabled,rows,today,time,nowEpoch,fluid,medicines=[],sleepingSince,historyStartDay=null}) {
  if(enabled!==true)return [];
  const result=[],cutoff=minute(time);
  const earliest=new Date(Date.parse(today+'T00:00:00Z')-14*86400000).toISOString().slice(0,10);
  const recent=rows.filter(r=>r.day>=earliest&&r.day<today&&(!historyStartDay||r.day>historyStartDay));
  const days=new Map();
  for(const row of recent){
    const when=minute(row.time),amount=Number(row.amount),unit=String(row.unit||'').toLowerCase();
    if(row.category!=='food'||!['drink','milk'].includes(row.type)||when===null||when>cutoff||!Number.isFinite(amount)||amount<=0||!['ml','oz'].includes(unit))continue;
    days.set(row.day,(days.get(row.day)||0)+amount*(unit==='ml'?1:29.5735));
  }
  if(cutoff>=600&&days.size>=5){
    const usual=median([...days.values()]);
    if(usual>=100&&Number.isFinite(fluid)&&fluid<usual*0.6)result.push({kind:'fluids',title:'Less fluid logged than usual',detail:`${Math.round(fluid)} ml is logged today. The typical amount logged by ${time} was ${Math.round(usual)} ml across ${days.size} recorded days in the last 14 days. Unlogged days are excluded; this does not measure actual intake.`});
  }
  if(medicines.some(m=>Number(m.windowEnd||m.timestamp)<nowEpoch))result.push({kind:'medication',title:'Scheduled dose not recorded',detail:'A scheduled time or time window has passed without a matching given or skipped entry. Check the medication log before making any decision; an absent entry does not mean the medicine was not taken.'});
  const lengths=recent.filter(r=>r.category==='sleep'&&minute(r.bedtime)!==null&&minute(r.wake_time)!==null).map(r=>{
    const start=Date.parse(`${r.day}T${r.bedtime.slice(0,5)}:00Z`);
    let end=Date.parse(`${r.wake_date||r.day}T${r.wake_time.slice(0,5)}:00Z`);
    if(!r.wake_date&&end<start)end+=86400000;
    return (end-start)/3600000;
  }).filter(hours=>hours>0&&hours<=24);
  const usualSleep=lengths.length>=5?median(lengths):null;
  if(sleepingSince&&nowEpoch-sleepingSince>Math.max(13,(usualSleep||0)+2)*3600){
    result.push({kind:'sleep',title:'Check the open sleep log',detail:`This sleep log has been open for ${Math.floor((nowEpoch-sleepingSince)/3600)} hours.${usualSleep?` Recent completed sleep logs typically lasted ${usualSleep.toFixed(1)} hours.`:''} If it was left open, enter the wake-up time or clear the mistaken log. This is about the log, not an assessment of sleep.`});
  }
  return result.map(item=>({...item,checkedAt:nowEpoch}));
}
let schema;
export async function ensureSmartInsightsSchema() {
  const {query}=await import('../db/pool.js');
  if(!schema)schema=query("ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS smart_insights_enabled BOOLEAN NOT NULL DEFAULT false").catch(error=>{schema=null;throw error;});
  return schema;
}
