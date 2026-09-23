const dateLabel = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleDateString("en-GB") : "—";
export default function AdminFamilyList({ families, selected, onSelect, onOpen, relativeTime, renderBadges, issueCount }) {
  return <div className="mt-4">
    <div className="hidden grid-cols-[2rem_1.2fr_1.5fr_1fr_0.8fr_0.9fr] gap-3 border-b border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 lg:grid">
      <span /><span>Family</span><span>Owner</span><span>Subscription</span><span>Trial ends</span><span>Last login</span>
    </div>
    {families.map(family => <div key={family.id} className="my-2 grid min-w-0 grid-cols-[2rem_1fr] gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm lg:my-0 lg:grid-cols-[2rem_1.2fr_1.5fr_1fr_0.8fr_0.9fr] lg:items-center lg:rounded-none lg:border-x-0 lg:border-t-0">
      <input type="checkbox" className="h-5 w-5" aria-label={`Select ${family.name}`} checked={selected.includes(family.id)} onChange={() => onSelect(family.id)} />
      <button type="button" className="min-w-0 break-words text-left font-bold text-indigo-700 hover:underline" onClick={() => onOpen(family.id)}>{family.name}<span className="block text-xs font-normal text-slate-500">{family.memberCount || 0} members · {family.childCount || 0} children · {family.logCount || 0} logs</span>{issueCount(family.id) ? <span className="block text-xs text-rose-700">{issueCount(family.id)} open support issues</span> : null}</button>
      <div className="col-start-2 min-w-0 break-words lg:col-auto">{family.ownerName || "Unknown owner"}<span className="block break-all text-xs text-slate-500">{family.ownerEmail || "No email"}</span></div>
      <div className="col-start-2 capitalize lg:col-auto"><span className="mr-2 text-xs text-slate-500 lg:hidden">Subscription:</span>{String(family.subscriptionStatus || "inactive").replaceAll("_", " ")}<div className="mt-1 flex flex-wrap gap-1">{renderBadges(family)}</div></div>
      <div className="col-start-2 lg:col-auto"><span className="mr-2 text-xs text-slate-500 lg:hidden">Trial ends:</span>{dateLabel(family.trialEndsAt)}</div>
      <div className="col-start-2 text-xs text-slate-600 lg:col-auto"><span className="mr-2 lg:hidden">Last login:</span>{relativeTime(family.lastLoginAt)}</div>
    </div>)}
    {!families.length ? <p className="py-6 text-sm text-slate-500">No families match these filters. Try All families or clear the search.</p> : null}
  </div>;
}
