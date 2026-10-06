export const schoolDays=['mon','tue','wed','thu','fri','sat','sun'];
export function validateSchoolSettings(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid school settings.');
 const name=String(value.name||'').trim();if(name.length>150)throw new Error('School name must be 150 characters or fewer.');
 const days={};for(const day of schoolDays){const row=value.days?.[day]||{};if(row.enabled!==undefined&&typeof row.enabled!=='boolean')throw new Error('Choose valid attendance days.');
 const departure=row.departure||'',pickup=row.pickup||'';for(const time of [departure,pickup])if(typeof time!=='string'||(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))throw new Error('School times must be valid HH:mm times.');
 if(departure&&pickup&&pickup<departure)throw new Error('Usual pickup must be after departure.');days[day]={enabled:row.enabled===true,departure,pickup};}
 return {name,days};
}
export function schoolPlanForDay(settings,date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return null;
 const day=['sun','mon','tue','wed','thu','fri','sat'][new Date(date+'T12:00:00Z').getUTCDay()];
 const plan=settings?.days?.[day];return plan?.enabled===true?plan:null;
}

let schema;
export async function ensureSchoolSettingsSchema(){schema??=import('../db/pool.js').then(({query})=>query("ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS school_settings JSONB NOT NULL DEFAULT '{}'::jsonb")).catch(e=>{schema=null;throw e;});return schema;}
