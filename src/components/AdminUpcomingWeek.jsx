import { upcomingEvents } from "./adminPresentation";
export default function AdminUpcomingWeek({ families, onOpen }) {
  const events = upcomingEvents(families);
  return <section className="mt-4 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-black text-slate-950">Upcoming week</h3><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-indigo-700">{events.length} upcoming</span></div>
    <p className="mt-1 text-sm text-slate-600">The next seven days, based on recorded account dates. Reminder dates are estimates, not proof of sending. Renewal dates appear only when available.</p>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {events.map(event => <button type="button" key={`${event.familyId}-${event.label}`} onClick={() => onOpen(event.familyId)} className="min-w-0 rounded-xl border border-indigo-100 bg-white p-3 text-left shadow-sm hover:border-indigo-400">
        <span className="block text-xs font-bold text-indigo-700">{event.date.toLocaleDateString("en-GB", {weekday:"short", day:"numeric", month:"short"})}{event.estimated ? " · Estimated" : ""}</span>
        <span className="mt-1 block font-bold text-slate-950">{event.label}</span><span className="block break-words text-sm text-slate-600">{event.familyName}</span>
      </button>)}
    </div>
    {!events.length ? <p className="mt-3 text-sm text-slate-500">No upcoming dates recorded for the next seven days.</p> : null}
  </section>;
}
