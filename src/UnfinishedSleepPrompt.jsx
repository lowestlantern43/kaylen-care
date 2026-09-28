import { useEffect, useState } from "react";

export default function UnfinishedSleepPrompt({ startedAt, busy, onClear }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  if (!Number.isFinite(startedAt) || now - startedAt <= 13 * 60 * 60 * 1000) return null;
  return <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-slate-900">
    <h4 className="font-bold">Is this sleep still running?</h4>
    <p className="mt-2 text-sm">This unfinished sleep started more than 13 hours ago. Enter the actual wake-up date and time below, or clear the unfinished record to start again.</p>
    <div className="mt-3 flex flex-wrap gap-3">
      <button type="button" disabled={busy} className="rounded-xl border bg-white px-4 py-3 font-semibold" onClick={() => document.getElementById("sleep-wake-details")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Enter wake-up time</button>
      <button type="button" disabled={busy} className="rounded-xl border border-amber-400 bg-white px-4 py-3 font-semibold" onClick={onClear}>Clear unfinished sleep</button>
    </div>
    <p className="mt-2 text-xs">Still asleep? Leave the record open. Nothing is cleared automatically.</p>
  </div>;
}
