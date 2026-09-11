import React from "react";

export default function CompanionAccessScreen({ error, busy, onRefresh, onLogout }) {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900">
      <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Your FamilyTrack account</h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          This account does not currently have access to a family workspace.
          If you belong to a family, check that you signed in with the email
          address your family uses. You can refresh to check for changes.
        </p>
        {error ? <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p> : null}
        <button type="button" onClick={onRefresh} disabled={busy}
          className="mt-6 w-full rounded-xl bg-slate-900 p-3 font-semibold text-white disabled:opacity-50">
          {busy ? "Checking access..." : "Refresh access"}
        </button>
        <button type="button" onClick={onLogout}
          className="mt-3 w-full rounded-xl border border-slate-300 p-3 font-semibold">
          Log out
        </button>
        <a href="mailto:hello@familytrack.care" className="mt-5 block text-center text-sm underline">
          Contact support
        </a>
      </section>
    </main>
  );
}
