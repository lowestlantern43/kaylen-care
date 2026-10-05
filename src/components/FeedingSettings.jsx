import { feedingRoutes, routeLabels, feedingEnabled } from '../feeding';
const field='mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-3';
export default function FeedingSettings({value={},onChange}) {
 const update=patch=>onChange({...value,...patch});
 return <section className="space-y-4 rounded-2xl border border-teal-100 bg-teal-50/50 p-4">
 <h4 className="font-bold text-slate-900">Feeding support</h4>
 <label className="block text-sm font-semibold">Usual feeding route<select className={field} value={value.route||'oral'} onChange={e=>update({route:e.target.value})}>{feedingRoutes.map(r=><option key={r} value={r}>{routeLabels[r]}</option>)}</select></label>
 {value.route==='combination'&&<fieldset><legend className="text-sm font-semibold">Select the routes used (at least two)</legend><div className="mt-2 flex flex-wrap gap-2">{feedingRoutes.filter(r=>r!=='combination').map(r=><label className="rounded-xl border bg-white p-3 text-sm" key={r}><input type="checkbox" checked={(value.routes||[]).includes(r)} onChange={e=>update({routes:e.target.checked?[...(value.routes||[]),r]:(value.routes||[]).filter(v=>v!==r)})}/> {routeLabels[r]}</label>)}</div></fieldset>}
 {value.route==='other'&&<label className="block text-sm"><input type="checkbox" checked={value.enabled===true} onChange={e=>update({enabled:e.target.checked})}/> Show the Feeds tile for this profile</label>}
 {feedingEnabled(value)&&<><label className="block text-sm font-semibold">Formula in the daily fluid total<select className={field} value={value.fluidMode||'unsure'} onChange={e=>update({fluidMode:e.target.value})}><option value="unsure">Not sure yet — keep formula separate</option><option value="include">Include actual formula volume given</option><option value="exclude">Keep formula separate from fluids</option></select></label><p className="text-sm text-slate-600">Follow their existing care plan. Water flushes count towards fluids. Planned feed volume never counts. This setting applies to new feed logs; saved entries retain their recorded setting.</p><p className="text-sm text-teal-800">The Feeds tile will appear alongside Food and Drink. Hiding it later does not delete records.</p></>}
 </section>;
}
