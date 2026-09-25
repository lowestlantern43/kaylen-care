import { useEffect, useState } from "react";
import { api } from "./api/client";

export default function PrivacyGate({ children, onLogout }) {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (open) window.scrollTo({ top: 0, behavior: "instant" });
  }, [open]);
  async function load() {
    setError("");
    try { setStatus(await api.getPrivacy()); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => {
    load();
    const show = () => setOpen(true);
    window.addEventListener("familytrack:privacy", show);
    return () => window.removeEventListener("familytrack:privacy", show);
  }, []);
  async function choose(accepted) {
    setBusy(true); setError("");
    try {
      setStatus(await api.setPrivacy({ accepted, version: status.version }));
      setChecked(false); setOpen(false);
      setMessage(accepted ? "" : "Your choice has been withdrawn. Your workspace is closed and reminders are disabled. You can request deletion below; shared records require review.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function removeAccount(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api.requestAccountDeletion({ currentPassword: password, confirmText: confirmation });
      setPassword(""); setConfirmation("");
      if (result.status === "deleted") { await onLogout(); return; }
      setMessage("Your deletion request is awaiting review. We will respond within one calendar month. Your account has not yet been deleted and billing has not automatically been cancelled.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const button = "rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50";
  if (status?.accepted && !open) return <>
    {children}
    <footer className="px-3 pt-3 pb-[calc(7rem+env(safe-area-inset-bottom))] text-center text-sm text-slate-600 md:pb-3">
      <nav aria-label="Privacy" className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 font-semibold underline underline-offset-4">Privacy controls</button>
        <a href="https://familytrack.care/privacy.html" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 font-semibold underline underline-offset-4">Privacy notice</a>
      </nav>
    </footer>
  </>;
  return <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
    <section className="mx-auto max-w-xl space-y-5 rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Your care information</h1>
      <p>FamilyTrack stores sensitive care information so you and the carers you authorise can keep a diary, create reports and receive reminders.</p>
      <p>Only record another person’s information if they have agreed or you have legal authority to act for them. Being invited to a family does not by itself give you that authority. If you are unsure, contact us before continuing.</p>
      <a className="block underline" href="https://familytrack.care/privacy.html" target="_blank" rel="noreferrer">Read the privacy notice</a>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!status ? <button className={button} onClick={load}>Retry privacy check</button> : status.accepted ? <>
        <p>Your choice was recorded on {new Date(status.recordedAt).toLocaleDateString()}. Notice version: {status.version}.</p>
        <button className={button} onClick={() => setOpen(false)}>Return to FamilyTrack</button>
        <p>Withdrawing closes your workspace access and disables your reminders. It does not automatically delete shared family records or cancel a subscription. You can request deletion after withdrawing.</p>
        <button className="block underline" disabled={busy} onClick={() => choose(false)}>Withdraw my choice</button>
      </> : <>
        <label className="flex items-start gap-3"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-1" /><span>{status.statement}</span></label>
        <button className={button} disabled={!checked || busy} onClick={() => choose(true)}>{busy ? "Saving…" : "Record my choice and continue"}</button>
        <details><summary className="cursor-pointer underline">Request account deletion instead</summary>
          <p className="my-3">Eligible accounts and sole-user records are permanently deleted. Shared records, files and billing require review. Export anything you need before requesting deletion.</p>
          <form onSubmit={removeAccount} className="space-y-3">
            <label className="block">Current password<input className="block w-full rounded border p-2" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
            <label className="block">Type DELETE<input className="block w-full rounded border p-2" required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
            <button className={button} disabled={busy || confirmation !== "DELETE"}>Request permanent deletion</button>
          </form>
        </details>
      </>}
      <p className="text-sm">Questions or a request concerning someone else’s records: <a href="mailto:hello@familytrack.care" className="underline">hello@familytrack.care</a>.</p>
      <button className="underline" onClick={onLogout}>Log out</button>
    </section>
  </main>;
}
