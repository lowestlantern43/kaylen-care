export const feedingRoutes = ['oral','ng','peg','gj','combination','other'];
export const routeLabels = {oral:'Oral',ng:'NG',peg:'PEG / G-tube',gj:'GJ / J-tube',combination:'Combination',other:'Other'};
export function feedingEnabled(settings = {}) { return ['ng','peg','gj','combination'].includes(settings.route) || (settings.route === 'other' && settings.enabled === true); }
export function validateFeedingSettings(value = {}) {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid feeding settings.');
 const route=value.route || 'oral', fluidMode=value.fluidMode || 'unsure';
 if (!feedingRoutes.includes(route) || !['include','exclude','unsure'].includes(fluidMode)) throw new Error('Choose a valid feeding route and fluid setting.');
 const routes=Array.isArray(value.routes)?[...new Set(value.routes)]:[];
 if (routes.some(r=>!['oral','ng','peg','gj','other'].includes(r))) throw new Error('Invalid combination feeding route.');
 if(route==='combination' && routes.length<2) throw new Error('Choose at least two routes for combination feeding.');
 return {route, routes:[...new Set(routes)], enabled:value.enabled===true, fluidMode};
}
export function normaliseFeed(data, category='food') {
 if (!data?.feeding) return data;
 if(category!=='food') throw new Error('Feeds must be recorded in the feeding log.');
 const d={...data};
 if(!['ng','peg','gj','oral','other'].includes(d.feed_route)) throw new Error('Choose the route used for this feed.');
 if(!['bolus','pump','gravity','flush'].includes(d.feed_method)) throw new Error('Choose a feeding method.');
 if(!['include','exclude','unsure'].includes(d.feed_fluid_mode)) throw new Error('Choose how formula counts towards fluids.');
 if(!['active','completed','stopped'].includes(d.feed_status)) throw new Error('Choose a valid feed status.');
 if(!String(d.item||'').trim()) throw new Error('Enter the feed or formula name.');
 for(const key of ['feed_planned_ml','feed_given_ml','feed_rate','flush_before_ml','flush_after_ml']) {
  const value=d[key];
  if(value==='' || value===null || value===undefined) {d[key]=null;continue;}
  const n=Number(value); if(!Number.isFinite(n)||n<0||n>100000) throw new Error('Volumes and rate must be non-negative numbers.');d[key]=n;
 }
 if(d.feed_method==='flush') d.feed_given_ml=0;
 if(d.feed_status!=='active' && d.feed_given_ml===null) throw new Error('Enter the actual volume given, including zero if none.');
 for(const key of ['feed_start','feed_end']) if(d[key] && !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(d[key])) throw new Error('Use a valid feed date and time.');
 if(d.feed_start && !Number.isFinite(Date.parse(d.feed_start))) throw new Error('Use a valid feed start date.');
 if(d.feed_end && !Number.isFinite(Date.parse(d.feed_end))) throw new Error('Use a valid feed end date.');
 if(!d.feed_start) throw new Error('Enter the feed start time.');
 if(d.feed_end && d.feed_end<d.feed_start) throw new Error('Feed end must be after its start.');
 if(d.feed_status==='active') {d.feed_given_ml=0;d.flush_after_ml=0;d.feed_end='';}
 if(d.feed_method==='flush') d.feed_given_ml=0;
 d.type='drink';d.unit='ml';
 d.amount=(d.feed_fluid_mode==='include'?d.feed_given_ml||0:0)+(d.flush_before_ml||0)+(d.flush_after_ml||0);
 // Old clients must not infer excluded formula volume from a name containing ml.
 d.type=d.amount>0?'drink':'food';
 d.feeding=true;
 return d;
}
export function feedDetails(d) { return [
 `Route: ${routeLabels[d.feed_route]||d.feed_route}`, `Method: ${d.feed_method}`, `Status: ${d.feed_status}`,
 `Planned: ${d.feed_planned_ml ?? 'Not set'} ml; given: ${d.feed_given_ml ?? 0} ml`,
 `Started: ${d.feed_start}${d.feed_end?' · Ended: '+d.feed_end:''}`,
 d.feed_rate!=null?`Rate: ${d.feed_rate} ml/hour`:null,
 `Water flushes: ${d.flush_before_ml||0} ml before / ${d.flush_after_ml||0} ml after`,
 `Fluid total contribution: ${d.amount||0} ml (formula ${d.feed_fluid_mode==='include'?'included':d.feed_fluid_mode==='unsure'?'not included — setting not decided':'excluded'})`,
 d.feed_tolerance?`Tolerance: ${d.feed_tolerance}`:null
 ].filter(Boolean); }
