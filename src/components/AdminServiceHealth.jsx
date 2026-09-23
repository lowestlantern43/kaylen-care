import { useEffect, useState } from "react";
import { api } from "../api/client";
const statusStyle = {
  working: ["Working", "border-emerald-200 bg-emerald-50 text-emerald-800"],
  attention: ["Needs attention", "border-amber-200 bg-amber-50 text-amber-900"],
  unknown: ["Not verified", "border-slate-200 bg-slate-50 text-slate-700"],
};
export default function AdminServiceHealth() {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true); setError("");
    try { setReport(await api.adminServiceHealth()); }
    catch { setError("Checks could not complete. Your session or the API may be unavailable. Try again; any previous results below are from the earlier check."); }
    finally { setBusy(false); }
  }
  useEffect(() => { run(); }, []);
  return <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-xl font-black text-slate-950">Service health</h3><p className="mt-1 max-w-2xl text-sm text-slate-600">Read-only checks and recorded service activity. Running checks does not send messages, charge customers or change accounts.</p></div>
      <button type="button" onClick={run} disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Checking…" : "Run checks now"}</button>
    </div>
    {error ? <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p> : null}
    {report ? <>
      <p className="mt-3 text-xs text-slate-500">Last checked: {new Date(report.checkedAt).toLocaleString("en-GB")} · Snapshot only; this screen does not monitor continuously.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {report.checks.map(check => {
          const [label, style] = statusStyle[check.status] || statusStyle.unknown;
          return <article key={check.id} className={`rounded-xl border p-4 ${style}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold">{check.label}</h4><span className="rounded-full bg-white px-2 py-1 text-xs font-bold">{label}</span></div>
            <p className="mt-2 text-sm leading-relaxed">{check.detail}</p>
            {check.lastSuccessAt || check.lastRecordedAt ? <p className="mt-2 text-xs">{check.lastSuccessAt ? "Last recorded success" : "Last recorded activity"}: {new Date(check.lastSuccessAt || check.lastRecordedAt).toLocaleString("en-GB")}</p> : null}
          </article>;
        })}
      </div>
    </> : busy ? <p className="mt-4 text-sm text-slate-500" role="status">Reading service evidence…</p> : null}
  </section>;
}
