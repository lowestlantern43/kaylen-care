// Suggestions use names only: never copy an old amount, time or care note.
export function foodDrinkSuggestions({saved=[],entries=[],childId,isDrink=false,query=''}) {
 if(!query.trim())return [];
 const candidates=saved.map(label=>({label,source:'Saved'}));
 for(const entry of entries) {
  if(childId && entry.childId!==childId)continue;
  const data=entry.rawData||{};
  if(entry.rawCategory!=='food'||data.feeding||((data.type==='drink')!==isDrink))continue;
  candidates.push({label:data.item,source:'Previous entry'});
 }
 const seen=new Set(),search=query.trim().toLocaleLowerCase();
 return candidates.filter(item=>{
  if(typeof item.label!=='string')return false;
  item.label=item.label.trim();
  const key=item.label.toLocaleLowerCase();
  if(!key||seen.has(key))return false;
  seen.add(key);
  return !search||key.includes(search);
 }).sort((a,b)=>Number(b.label.toLocaleLowerCase().startsWith(search))-Number(a.label.toLocaleLowerCase().startsWith(search))).slice(0,8);
}
