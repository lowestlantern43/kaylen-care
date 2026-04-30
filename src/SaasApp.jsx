import html2canvas from "html2canvas";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import KaylenCareMonitorDashboard from "./KaylenCareMonitorDashboard";

const inputClass =
  "mt-2 block box-border w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

const buttonClass =
  "flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-4 text-base font-semibold text-white shadow-md transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClass =
  "flex w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

const avatarUrlForChild = (child) => child?.avatarUrl || child?.avatar_url || "";

const cleanFormText = (value) => {
  const text = String(value ?? "").trim();
  return ["null", "undefined"].includes(text.toLowerCase()) ? "" : text;
};

const issueStatusLabels = {
  new: "New",
  in_progress: "In Progress",
  resolved: "Resolved",
};

const issueSeverityLabels = {
  small: "Small issue",
  annoying: "Annoying",
  blocking: "Blocking",
};

const parseCareMedicationRows = (value = "") => {
  if (value === null || value === undefined) return [];

  return String(value)
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter((line) => line && line.toLowerCase() !== "null")
    .map((line) => {
      if (line.includes("|")) {
        const [
          name = "",
          doseAmount = "",
          doseUnit = "ml",
          times = "",
          active = "active",
          notes = "",
        ] = line
          .split("|")
          .map((part) => cleanFormText(part));
        return {
          name,
          doseAmount,
          doseUnit: doseUnit || "ml",
          times: times
            .split(",")
            .map((time) => time.trim())
            .filter(Boolean),
          active: active !== "inactive",
          notes,
        };
      }

      const separator = [" - ", " – ", " — ", ":"].find((item) =>
        line.includes(item),
      );
      if (!separator) {
        return {
        name: cleanFormText(line),
          doseAmount: "",
          doseUnit: "ml",
          times: [""],
          active: true,
          notes: "",
        };
      }

      const [name, ...doseParts] = line.split(separator);
      return {
      name: cleanFormText(name),
      doseAmount: cleanFormText(doseParts.join(separator)),
        doseUnit: "ml",
        times: [""],
        active: true,
        notes: "",
      };
    })
    .filter((item) => item.name || item.doseAmount || item.notes);
};

const serializeCareMedicationRows = (rows) =>
  rows
    .map((row) => ({
      name: cleanFormText(row.name),
      doseAmount: cleanFormText(row.doseAmount || row.dose),
      doseUnit: cleanFormText(row.doseUnit) || "ml",
      times: (row.times || [])
        .map((time) => String(time || "").trim())
        .filter(Boolean),
      active: row.active === false ? "inactive" : "active",
      notes: cleanFormText(row.notes),
    }))
    .filter((row) => row.name || row.doseAmount || row.notes)
    .map((row) =>
      [
        row.name,
        row.doseAmount,
        row.doseUnit,
        row.times.join(", "),
        row.active,
        row.notes,
      ].join(" | "),
    )
    .join("\n");

const emptyCareMedicationRow = () => ({
  name: "",
  doseAmount: "",
  doseUnit: "ml",
  times: [""],
  active: true,
  notes: "",
});

const careMedicationRowsFromProfile = (value = "") => {
  const rows = parseCareMedicationRows(value);
  return rows.length ? rows : [emptyCareMedicationRow()];
};

const savedCareMedicationRows = (rows) =>
  rows.filter((row) => row.name || row.doseAmount || row.notes);

function ChildAvatar({ child, active = false, size = "sm" }) {
  const avatarUrl = avatarUrlForChild(child);
  const [failedUrl, setFailedUrl] = useState("");
  const sizeClass = size === "lg" ? "h-14 w-14" : "h-8 w-8";
  const iconSizeClass = size === "lg" ? "h-7 w-7" : "h-4 w-4";

  if (avatarUrl && avatarUrl !== failedUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`${sizeClass} rounded-full object-cover ring-2 ${
          active ? "ring-indigo-200" : "ring-white"
        }`}
        onError={() => setFailedUrl(avatarUrl)}
      />
    );
  }

  return (
    <span
      className={`${sizeClass} inline-flex items-center justify-center rounded-full ${
        active ? "bg-white/20 text-white" : "bg-indigo-50 text-indigo-700"
      }`}
      aria-hidden="true"
    >
      <svg
        className={iconSizeClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="8" r="4" />
      </svg>
    </span>
  );
}

const emptyChildProfile = {
  diagnosisNeeds: "",
  communicationStyle: "",
  keyNeeds: "",
  currentMedications: "",
  allergies: "",
  emergencyNotes: "",
  likes: "",
  dislikes: "",
  triggers: "",
  calmingStrategies: "",
  eatingPreferences: "",
  sleepPreferences: "",
  toiletingNotes: "",
  sensoryNeeds: "",
  schoolEhcpNotes: "",
  medicalNotes: "",
};

const emptyImportantEvent = {
  eventDate: "",
  eventTime: "",
  eventType: "seizure",
  notes: "",
  actionTaken: "",
  outcome: "",
};

function LandingPage({ onStartFree, onLogin }) {
  const features = [
    [
      "Daily care logging",
      "Record food, drink, toileting, health notes and important changes quickly from your phone.",
    ],
    [
      "Medication and routines",
      "Keep everyday care tasks clear without mixing routines into medication records.",
    ],
    [
      "Reports and PDF export",
      "Create readable summaries for EHCP reviews, school meetings, hospital visits and carers.",
    ],
    [
      "Care Snapshot",
      "Prepare a compact view of key information for professionals when time matters.",
    ],
    [
      "Calendar and trends",
      "Look back over days and weeks to spot patterns in sleep, health, food and care activity.",
    ],
  ];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-sky-50 px-5 py-5">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div>
            <p className="text-xl font-black tracking-tight text-slate-950">
              FamilyTrack
            </p>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">
              Tracking what matters
            </p>
          </div>
          <button
            type="button"
            onClick={onLogin}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm"
          >
            Log in
          </button>
        </nav>

        <div className="mx-auto grid max-w-6xl gap-8 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-indigo-600">
              Parent-led care diary
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl">
              Track your child&apos;s care, health, and routines in one place
            </h1>
            <p className="mt-5 max-w-2xl text-base font-medium leading-7 text-slate-600 sm:text-lg">
              FamilyTrack helps families record food, sleep, medication,
              toileting, health, routines and reports, then share clear updates
              with schools, hospitals, carers and professionals.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={onStartFree} className={buttonClass}>
                Start free
              </button>
              <button
                type="button"
                onClick={onLogin}
                className={secondaryButtonClass}
              >
                Log in
              </button>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-xl">
            <div className="rounded-[1.5rem] bg-slate-950 p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-black">FamilyTrack</p>
                  <p className="text-xs text-slate-300">Today at a glance</p>
                </div>
                <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-bold text-emerald-200">
                  Synced
                </span>
              </div>
              <div className="mt-4 grid gap-3">
                {[
                  ["Food", "Lunch logged - reduced appetite"],
                  ["Medication", "Keppra 5ml at 08:00"],
                  ["Sleep", "9h 15m - good quality"],
                  ["Health", "No new health notes today"],
                ].map(([title, copy]) => (
                  <div
                    key={title}
                    className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3"
                  >
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-sky-200">
                      {title}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">{copy}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 py-10">
        <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map(([title, copy]) => (
            <article
              key={title}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 className="text-lg font-black text-slate-950">{title}</h2>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                {copy}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-white px-5 py-12">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-indigo-600">
            Built from real family life
          </p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            Created by Martin, Kaylen&apos;s dad
          </h2>
          <p className="mt-4 text-base font-medium leading-8 text-slate-600">
            Kaylen is autistic and non-verbal. Managing his care involves
            tracking many daily things including food, drink, medication, sleep,
            toileting, routines, health notes and important changes.
            FamilyTrack was built from real family need, to make it easier to
            record important information, spot patterns and share clear updates
            with schools, hospitals, carers and professionals.
          </p>
        </div>
      </section>

      <section className="px-5 py-12">
        <div className="mx-auto max-w-6xl rounded-[2rem] border border-indigo-100 bg-indigo-50 p-6 shadow-sm md:p-8">
          <h2 className="text-2xl font-black text-slate-950">Simple pricing</h2>
          <p className="mt-3 max-w-3xl text-sm font-medium leading-7 text-slate-700">
            Start free with basic logging. Pro unlocks reports, PDFs, Care
            Snapshot, sharing, multiple children and advanced features as the
            platform grows.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={onStartFree} className={buttonClass}>
              Start free
            </button>
            <button type="button" onClick={onLogin} className={secondaryButtonClass}>
              Log in
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function AuthScreen({ onAuthenticated, initialMode = "signup", onBack }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    familyName: "",
    childFirstName: "",
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSignup = mode === "signup";

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (error) setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const data = isSignup
        ? await api.signup(form)
        : await api.login({
            email: form.email,
            password: form.password,
          });

      onAuthenticated(data);
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-slate-100 px-6 py-10 text-slate-900 md:py-16">
      <div className="mx-auto max-w-md">
        <div className="rounded-[2rem] border border-slate-300 bg-white p-8 shadow-xl md:p-10">
          <div className="text-center">
            <div className="w-full rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-white px-6 py-4 shadow-sm">
              <h1 className="text-center text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
                FamilyTrack
              </h1>
              <p className="mt-1 text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">
                Tracking what matters
              </p>
            </div>
            <p className="mt-3 text-sm font-medium leading-6 text-slate-600">
              {isSignup
                ? "Create your family workspace and add your first child."
                : "Log in to your family workspace."}
            </p>
          </div>

          <form className="mt-8 space-y-4" onSubmit={submit}>
            {isSignup ? (
              <>
                <div>
                  <label className="text-sm font-semibold text-slate-700">
                    Your name
                  </label>
                  <input
                    className={inputClass}
                    value={form.fullName}
                    onChange={(event) => update("fullName", event.target.value)}
                    placeholder="Martin"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">
                    Family name
                  </label>
                  <input
                    className={inputClass}
                    value={form.familyName}
                    onChange={(event) => update("familyName", event.target.value)}
                    placeholder="Bellamy Family"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">
                    First child
                  </label>
                  <input
                    className={inputClass}
                    value={form.childFirstName}
                    onChange={(event) =>
                      update("childFirstName", event.target.value)
                    }
                    placeholder="Child name"
                  />
                </div>
              </>
            ) : null}

            <div>
              <label className="text-sm font-semibold text-slate-700">
                Email
              </label>
              <input
                className={inputClass}
                type="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">
                Password
              </label>
              <input
                className={inputClass}
                type="password"
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
                placeholder="At least 10 characters"
              />
            </div>

            {error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {error}
              </p>
            ) : null}

            <button className={buttonClass} disabled={isSubmitting}>
              {isSubmitting
                ? "Please wait..."
                : isSignup
                  ? "Create family workspace"
                  : "Log in"}
            </button>
          </form>

          <button
            type="button"
            className="mt-4 text-sm font-semibold text-slate-600 underline decoration-slate-300 underline-offset-4"
            onClick={() => {
              setMode(isSignup ? "login" : "signup");
              setError("");
            }}
          >
            {isSignup
              ? "Already have an account? Log in"
              : "Need a family workspace? Sign up"}
          </button>
          {onBack ? (
            <button
              type="button"
              className="ml-4 mt-4 text-sm font-semibold text-slate-500 underline decoration-slate-300 underline-offset-4"
              onClick={onBack}
            >
              Back to website
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ReportIssueWidget({
  enabled,
  selectedChild,
  selectedFamily,
  selectedChildId,
  selectedFamilyId,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState("small");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  if (!enabled) return null;

  const childName =
    selectedChild?.firstName ||
    selectedChild?.first_name ||
    selectedChild?.name ||
    "selected child";

  const getDeviceType = () => {
    const userAgent = navigator.userAgent || "";
    if (/iphone/i.test(userAgent)) return "iPhone";
    if (/ipad/i.test(userAgent)) return "iPad";
    if (/android/i.test(userAgent)) return "Android";
    return window.innerWidth < 768 ? "Mobile" : "Desktop";
  };

  const getVisibleSection = () => {
    const modalHeading = document.querySelector(
      "[role='dialog'] h2, [role='dialog'] h3, .fixed h2, .fixed h3",
    )?.textContent;
    if (modalHeading?.trim()) return modalHeading.trim();
    const activeHeading = document.querySelector("h1, h2")?.textContent;
    return activeHeading?.trim() || "Current page";
  };

  const captureScreenshot = async () => {
    try {
      const canvas = await html2canvas(document.body, {
        backgroundColor: "#ffffff",
        logging: false,
        scale: Math.min(window.devicePixelRatio || 1, 1.25),
        useCORS: true,
        ignoreElements: (element) =>
          element?.dataset?.feedbackUi === "true" ||
          element?.closest?.("[data-feedback-ui='true']"),
      });

      const maxWidth = 1000;
      const ratio = Math.min(1, maxWidth / canvas.width);
      const output = document.createElement("canvas");
      output.width = Math.max(1, Math.round(canvas.width * ratio));
      output.height = Math.max(1, Math.round(canvas.height * ratio));
      const context = output.getContext("2d");
      context.drawImage(canvas, 0, 0, output.width, output.height);

      const dataUrl = output.toDataURL("image/jpeg", 0.55);
      return dataUrl.length <= 1_100_000 ? dataUrl : "";
    } catch {
      return "";
    }
  };

  const submitIssue = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!message.trim()) {
      setError("Please tell us what went wrong.");
      return;
    }

    setIsSubmitting(true);

    try {
      const screenshotUrl = await captureScreenshot();
      await api.submitIssue({
        familyId: selectedFamilyId || null,
        childId: selectedChildId || null,
        route:
          window.location.pathname +
          window.location.search +
          window.location.hash,
        contextSection: getVisibleSection(),
        deviceType: getDeviceType(),
        message,
        severity,
        browserInfo: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          platform: navigator.platform,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          deviceType: getDeviceType(),
          section: getVisibleSection(),
          timestamp: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          familyName: selectedFamily?.familyName || selectedFamily?.name || "",
          childName,
        },
        appVersion:
          import.meta.env.VITE_APP_VERSION ||
          import.meta.env.VITE_APP_BUILD ||
          import.meta.env.MODE ||
          "",
        screenshotUrl,
      });

      setMessage("");
      setSeverity("small");
      setIsOpen(false);
      setNotice("Thanks — your issue has been sent.");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div data-feedback-ui="true">
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
          setError("");
        }}
        className="fixed bottom-5 left-4 z-[9999] rounded-full border border-slate-200 bg-white/95 px-3 py-2 text-xs font-bold text-slate-700 shadow-lg backdrop-blur transition hover:bg-indigo-50 hover:text-indigo-700"
      >
        Report issue
      </button>

      {notice ? (
        <div className="fixed bottom-16 left-4 z-40 max-w-[18rem] rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-lg">
          {notice}
        </div>
      ) : null}

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 p-4 sm:items-center sm:justify-center">
          <form
            className="w-full rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:max-w-md"
            onSubmit={submitIssue}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Report an issue
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  We will include the current page and device details.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm font-bold text-slate-600"
              >
                Close
              </button>
            </div>

            <label className="mt-4 block text-sm font-bold text-slate-700">
              What went wrong?
            </label>
            <textarea
              className={inputClass}
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Tell us what happened"
              required
            />

            <label className="mt-4 block text-sm font-bold text-slate-700">
              Severity
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {Object.entries(issueSeverityLabels).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSeverity(value)}
                  className={`rounded-xl border px-2 py-2 text-xs font-bold transition ${
                    severity === value
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600">
              Adding for {childName}. Route:{" "}
              {window.location.pathname || "/"}
            </div>

            {error ? (
              <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                {error}
              </p>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
              >
                {isSubmitting ? "Sending..." : "Submit"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function IssueAdminPanel({
  issues,
  settings,
  isSaving,
  onRefresh,
  onToggleEnabled,
  onStatusChange,
}) {
  const [expanded, setExpanded] = useState({});
  const [notes, setNotes] = useState({});

  const noteForIssue = (issue) =>
    notes[issue.id] ?? issue.internalNote ?? "";

  const updateStatus = (issue, status) =>
    onStatusChange(issue.id, {
      status,
      internalNote: noteForIssue(issue),
    });

  const deviceLabel = (issue) =>
    issue.deviceType ||
    issue.browserInfo?.deviceType ||
    issue.browserInfo?.platform ||
    "Unknown device";

  const sectionLabel = (issue) =>
    issue.contextSection || issue.browserInfo?.section || "Current page";

  return (
    <section className="mt-4 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="font-bold text-slate-900">Issue reports inbox</h3>
          <p className="mt-1 text-sm text-slate-600">
            A simple support inbox for tester reports, screenshots and device context.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => onToggleEnabled(event.target.checked)}
              disabled={isSaving}
            />
            Report button enabled
          </label>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-700"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {issues.length ? (
          issues.map((issue) => (
            <article
              key={issue.id}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-600">
                      {issueSeverityLabels[issue.severity] || issue.severity}
                    </span>
                    <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-bold uppercase tracking-[0.12em] text-indigo-700">
                      {issueStatusLabels[issue.status] || issue.status}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      {issue.createdAt
                        ? new Date(issue.createdAt).toLocaleString()
                        : "Unknown time"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-slate-800">
                    Reported from: {sectionLabel(issue)} ({deviceLabel(issue)})
                  </p>
                  <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-900">
                    {issue.message}
                  </p>
                  <p className="mt-2 break-all text-xs font-semibold text-slate-500">
                    Page/location: {issue.route || "No route captured"}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    Account: {issue.userName || issue.userEmail || "Unknown user"} -{" "}
                    {issue.familyName || "No family"} -{" "}
                    {[
                      issue.childFirstName,
                      issue.childLastName,
                    ]
                      .filter(Boolean)
                      .join(" ") || "No child"}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Device: {deviceLabel(issue)} -{" "}
                    {issue.browserInfo?.viewport || "unknown viewport"} -{" "}
                    {issue.browserInfo?.timezone || "unknown timezone"}
                  </p>
                  {issue.internalNote ? (
                    <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      Internal note: {issue.internalNote}
                    </p>
                  ) : null}
                </div>

                <div className="flex w-full flex-col gap-2 lg:w-48">
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => updateStatus(issue, "in_progress")}
                      className="rounded-xl border border-indigo-200 bg-indigo-50 px-2 py-2 text-xs font-bold text-indigo-700 disabled:opacity-50"
                    >
                      In Progress
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => updateStatus(issue, "resolved")}
                      className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2 text-xs font-bold text-emerald-700 disabled:opacity-50"
                    >
                      Resolved
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((current) => ({
                        ...current,
                        [issue.id]: !current[issue.id],
                      }))
                    }
                    className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700"
                  >
                    {expanded[issue.id] ? "Hide note" : "Internal note"}
                  </button>
                  {expanded[issue.id] ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-2">
                      <textarea
                        className={`${inputClass} mt-0 px-3 py-2 text-xs`}
                        rows={3}
                        value={noteForIssue(issue)}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [issue.id]: event.target.value,
                          }))
                        }
                        placeholder="Private owner note"
                      />
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => updateStatus(issue, issue.status)}
                        className="mt-2 w-full rounded-xl bg-slate-900 px-2 py-2 text-xs font-bold text-white disabled:opacity-50"
                      >
                        Save note
                      </button>
                    </div>
                  ) : null}
                  {issue.screenshotUrl ? (
                    <a
                      href={issue.screenshotUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded-xl border border-slate-200 bg-white"
                    >
                      <img
                        src={issue.screenshotUrl}
                        alt="Issue screenshot"
                        className="h-28 w-full object-cover"
                      />
                    </a>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-xs font-semibold text-slate-500">
                      No screenshot
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-600">
            No issue reports yet.
          </div>
        )}
      </div>
    </section>
  );
}

function WorkspaceGate({ session, onLogout }) {
  const normalizeFamily = (family) => ({
    familyId: family.familyId || family.id,
    familyName: family.familyName || family.name,
    address: family.address || "",
    emergencyContacts: Array.isArray(family.emergencyContacts)
      ? family.emergencyContacts
      : family.emergency_contacts || [],
    role: family.role,
  });
  const childDisplayName = (child) =>
    child?.firstName || child?.first_name || "Child";
  const childInitials = (child) =>
    childDisplayName(child)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "C";
  const selectedChildStorageKey = (familyId) =>
    `familytrack:selected-child:${familyId}`;

  const memberships = session?.memberships || [];
  const initialFamily = session?.family
    ? normalizeFamily({
        ...session.family,
        role: "owner",
      })
    : memberships[0]
      ? normalizeFamily(memberships[0])
      : null;

  const [families, setFamilies] = useState(initialFamily ? [initialFamily] : []);
  const [selectedFamilyId, setSelectedFamilyId] = useState(
    initialFamily?.familyId || "",
  );
  const [children, setChildren] = useState(session?.child ? [session.child] : []);
  const [selectedChildId, setSelectedChildId] = useState(session?.child?.id || "");
  const [childName, setChildName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [familyEditName, setFamilyEditName] = useState("");
  const [familyAddress, setFamilyAddress] = useState("");
  const [familyEmergencyContacts, setFamilyEmergencyContacts] = useState([
    { name: "", relationship: "", phone: "", notes: "" },
    { name: "", relationship: "", phone: "", notes: "" },
  ]);
  const [childEditForm, setChildEditForm] = useState({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    nhsNumber: "",
    avatarUrl: "",
    avatarObjectKey: "",
    notes: "",
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingFamily, setIsSavingFamily] = useState(false);
  const [isSavingChild, setIsSavingChild] = useState(false);
  const [isSavingChildProfile, setIsSavingChildProfile] = useState(false);
  const [isUploadingChildPhoto, setIsUploadingChildPhoto] = useState(false);
  const [newRegularFood, setNewRegularFood] = useState("");
  const [newSavedLocation, setNewSavedLocation] = useState("");
  const [isSavingCareOption, setIsSavingCareOption] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showPlatformAdmin, setShowPlatformAdmin] = useState(false);
  const [settingsTab, setSettingsTab] = useState("account");
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "parent" });
  const [inviteResult, setInviteResult] = useState("");
  const [subscription, setSubscription] = useState(null);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [isBillingPortalLoading, setIsBillingPortalLoading] = useState(false);
  const [childCareOptions, setChildCareOptions] = useState([]);
  const [childProfile, setChildProfile] = useState(emptyChildProfile);
  const [careMedicationRows, setCareMedicationRows] = useState([
    emptyCareMedicationRow(),
  ]);
  const [regularMedicationDraft, setRegularMedicationDraft] = useState(
    emptyCareMedicationRow(),
  );
  const [editingCareMedicationIndex, setEditingCareMedicationIndex] =
    useState(null);
  const [importantEvents, setImportantEvents] = useState([]);
  const [importantEventForm, setImportantEventForm] =
    useState(emptyImportantEvent);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingImportantEvent, setIsSavingImportantEvent] = useState(false);
  const [accountPasswordForm, setAccountPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    showPasswords: false,
  });
  const [accountMessage, setAccountMessage] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [timeZonePreference, setTimeZonePreference] = useState(() => {
    try {
      return localStorage.getItem("familytrack:timezone") || "auto";
    } catch {
      return "auto";
    }
  });
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isAdminLoading, setIsAdminLoading] = useState(false);
  const [platformData, setPlatformData] = useState({
    overview: null,
    families: [],
    users: [],
  });
  const [platformIssues, setPlatformIssues] = useState([]);
  const [feedbackSettings, setFeedbackSettings] = useState({ enabled: true });
  const [isFeedbackEnabled, setIsFeedbackEnabled] = useState(true);
  const [isIssueAdminLoading, setIsIssueAdminLoading] = useState(false);
  const [platformSearch, setPlatformSearch] = useState("");
  const [selectedPlatformFamily, setSelectedPlatformFamily] = useState(null);
  const [selectedPlatformUser, setSelectedPlatformUser] = useState(null);
  const [isPlatformLoading, setIsPlatformLoading] = useState(false);
  const [isFamilyDetailLoading, setIsFamilyDetailLoading] = useState(false);
  const [isUserDetailLoading, setIsUserDetailLoading] = useState(false);
  const [isPlatformSnapshotLoading, setIsPlatformSnapshotLoading] =
    useState(false);
  const [isPlatformSaving, setIsPlatformSaving] = useState(false);
  const [platformActionMessage, setPlatformActionMessage] = useState("");
  const [platformAccountFilter, setPlatformAccountFilter] = useState("all");
  const [platformSnapshot, setPlatformSnapshot] = useState(null);
  const [platformViewAsUser, setPlatformViewAsUser] = useState(null);
  const [platformViewAsFamily, setPlatformViewAsFamily] = useState(null);
  const [resolvedIssueNotice, setResolvedIssueNotice] = useState("");
  const [showSystemStatus, setShowSystemStatus] = useState(false);
  const [isPlatformQuickJumpOpen, setIsPlatformQuickJumpOpen] = useState(false);
  const [platformMemberForm, setPlatformMemberForm] = useState({
    email: "",
    role: "parent",
  });
  const [platformPasswordForm, setPlatformPasswordForm] = useState({
    password: "",
  });
  const [platformAdminTab, setPlatformAdminTab] = useState("overview");
  const platformQuickJumpRef = useRef(null);
  const platformSearchInputRef = useRef(null);

  const selectedFamily = useMemo(
    () => families.find((family) => family.familyId === selectedFamilyId),
    [families, selectedFamilyId],
  );

  const selectedChild = useMemo(
    () => children.find((child) => child.id === selectedChildId),
    [children, selectedChildId],
  );

  const groupedCareOptions = useMemo(
    () => ({
      food: childCareOptions.filter((option) => option.category === "food"),
      medication: childCareOptions.filter(
        (option) => option.category === "medication",
      ),
      givenBy: childCareOptions.filter((option) => option.category === "given_by"),
      locations: childCareOptions.filter((option) => option.category === "location"),
    }),
    [childCareOptions],
  );
  const detectedTimeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
  const activeTimeZone =
    timeZonePreference === "auto" ? detectedTimeZone : timeZonePreference;
  const lastLoginValue =
    session?.user?.lastLoginAt ||
    session?.user?.last_login_at ||
    session?.user?.updatedAt ||
    session?.user?.updated_at ||
    "";
  const lastLoginText = lastLoginValue
    ? new Date(lastLoginValue).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: activeTimeZone,
      })
    : "Not available yet";

  useEffect(() => {
    try {
      localStorage.setItem("familytrack:timezone", timeZonePreference);
    } catch {
      // Local display preference only.
    }
  }, [timeZonePreference]);

  useEffect(() => {
    let ignore = false;

    async function loadFeedbackConfig() {
      try {
        const config = await api.feedbackConfig();
        if (!ignore) {
          setFeedbackSettings({ enabled: config.enabled });
          setIsFeedbackEnabled(config.enabled);
        }
      } catch {
        if (!ignore) {
          setIsFeedbackEnabled(false);
        }
      }
    }

    loadFeedbackConfig();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!showPlatformAdmin || platformAdminTab !== "issues") return;
    refreshPlatformIssues();
  }, [showPlatformAdmin, platformAdminTab]);

  useEffect(() => {
    if (!platformSearch.trim()) {
      setIsPlatformQuickJumpOpen(false);
    }
  }, [platformSearch]);

  useEffect(() => {
    setIsPlatformQuickJumpOpen(false);
  }, [platformAdminTab, showPlatformAdmin]);

  useEffect(() => {
    if (!isPlatformQuickJumpOpen) return undefined;

    const closeOnOutsidePress = (event) => {
      if (
        platformQuickJumpRef.current?.contains(event.target) ||
        platformSearchInputRef.current?.contains(event.target)
      ) {
        return;
      }
      setIsPlatformQuickJumpOpen(false);
    };

    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setIsPlatformQuickJumpOpen(false);
        platformSearchInputRef.current?.blur();
      }
    };

    window.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("hashchange", closeOnEscape);
    window.addEventListener("popstate", closeOnEscape);

    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("hashchange", closeOnEscape);
      window.removeEventListener("popstate", closeOnEscape);
    };
  }, [isPlatformQuickJumpOpen]);

  useEffect(() => {
    let ignore = false;

    async function loadResolvedIssueNotifications() {
      try {
        const notifications = await api.resolvedIssueNotifications();
        if (ignore || !notifications.length) return;

        setResolvedIssueNotice(
          notifications.length === 1
            ? "Your reported issue has been resolved ✅"
            : `${notifications.length} of your reported issues have been resolved ✅`,
        );
        await api.markResolvedIssueNotificationsSeen();
      } catch {
        // A support notification should never block the diary.
      }
    }

    loadResolvedIssueNotifications();
    return () => {
      ignore = true;
    };
  }, []);

  const selectChild = (childIdToSelect) => {
    setSelectedChildId(childIdToSelect);
    if (selectedFamilyId && childIdToSelect) {
      localStorage.setItem(
        selectedChildStorageKey(selectedFamilyId),
        childIdToSelect,
      );
    }
  };

  useEffect(() => {
    setFamilyEditName(selectedFamily?.familyName || "");
    setFamilyAddress(selectedFamily?.address || "");
    const contacts = selectedFamily?.emergencyContacts || [];
    setFamilyEmergencyContacts([
      contacts[0] || { name: "", relationship: "", phone: "", notes: "" },
      contacts[1] || { name: "", relationship: "", phone: "", notes: "" },
    ]);
  }, [
    selectedFamily?.familyName,
    selectedFamily?.address,
    selectedFamily?.emergencyContacts,
  ]);

  useEffect(() => {
    setChildEditForm({
      firstName: selectedChild?.firstName || selectedChild?.first_name || "",
      lastName: selectedChild?.lastName || selectedChild?.last_name || "",
      dateOfBirth:
        selectedChild?.dateOfBirth || selectedChild?.date_of_birth || "",
      nhsNumber: selectedChild?.nhsNumber || selectedChild?.nhs_number || "",
      avatarUrl: selectedChild?.avatarUrl || selectedChild?.avatar_url || "",
      avatarObjectKey:
        selectedChild?.avatarObjectKey || selectedChild?.avatar_object_key || "",
      notes: selectedChild?.notes || "",
    });
  }, [selectedChild]);

  useEffect(() => {
    let ignore = false;

    async function loadWorkspace() {
      try {
        const loadedFamilies = (await api.listFamilies()).map(normalizeFamily);
        if (ignore) return;

        setFamilies(loadedFamilies);
        const nextFamilyId = selectedFamilyId || loadedFamilies[0]?.familyId || "";
        setSelectedFamilyId(nextFamilyId);

        if (nextFamilyId) {
          const loadedChildren = await api.listChildren(nextFamilyId);
          if (ignore) return;
          setChildren(loadedChildren);
          const storedChildId = localStorage.getItem(
            selectedChildStorageKey(nextFamilyId),
          );
          const storedChildStillExists = loadedChildren.some(
            (child) => child.id === storedChildId,
          );
          setSelectedChildId((current) =>
            loadedChildren.some((child) => child.id === current)
              ? current
              : storedChildStillExists
                ? storedChildId
                : loadedChildren[0]?.id || "",
          );
        }
      } catch (caughtError) {
        if (!ignore) setError(caughtError.message);
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }

    loadWorkspace();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadCareOptions() {
      if (!selectedFamilyId || !selectedChildId) {
        setChildCareOptions([]);
        setChildProfile(emptyChildProfile);
        setCareMedicationRows([emptyCareMedicationRow()]);
        resetRegularMedicationDraft();
        setImportantEvents([]);
        return;
      }

      try {
        const [options, profile, events] = await Promise.all([
          api.listChildCareOptions(selectedFamilyId, selectedChildId),
          api.getChildProfile(selectedFamilyId, selectedChildId),
          api.listImportantEvents(selectedFamilyId, selectedChildId),
        ]);
        if (!ignore) setChildCareOptions(options);
        if (!ignore) {
          setChildProfile({ ...emptyChildProfile, ...profile });
          setCareMedicationRows(
            careMedicationRowsFromProfile(profile?.currentMedications),
          );
          resetRegularMedicationDraft();
        }
        if (!ignore) setImportantEvents(events);
      } catch (caughtError) {
        if (!ignore) setError(caughtError.message);
      }
    }

    loadCareOptions();
    return () => {
      ignore = true;
    };
  }, [selectedFamilyId, selectedChildId]);

  const addChild = async (event) => {
    event.preventDefault();
    if (!selectedFamilyId || !childName.trim()) return;

    setIsSavingChild(true);
    setError("");

    try {
      const child = await api.createChild(selectedFamilyId, {
        firstName: childName,
      });
      setChildren((current) => [...current, child]);
      setSelectedChildId(child.id);
      localStorage.setItem(selectedChildStorageKey(selectedFamilyId), child.id);
      setChildName("");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSavingChild(false);
    }
  };

  const addFamily = async (event) => {
    event.preventDefault();
    if (!familyName.trim()) return;

    setIsSavingFamily(true);
    setError("");

    try {
      const createdFamily = normalizeFamily(await api.createFamily({ name: familyName }));
      setFamilies([createdFamily]);
      setSelectedFamilyId(createdFamily.familyId);
      setFamilyName("");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSavingFamily(false);
    }
  };

  const saveFamilyProfile = async (event) => {
    event.preventDefault();
    if (!selectedFamilyId || !familyEditName.trim()) return;

    setIsSavingFamily(true);
    setError("");

    try {
      const updated = await api.updateFamily(selectedFamilyId, {
        name: familyEditName,
        address: familyAddress,
        emergencyContacts: familyEmergencyContacts,
      });
      setFamilies((current) =>
        current.map((family) =>
          family.familyId === selectedFamilyId
            ? {
                ...family,
                familyName: updated.name,
                address: updated.address || "",
                emergencyContacts: updated.emergencyContacts || [],
              }
            : family,
        ),
      );
      setAccountMessage("Family details updated.");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSavingFamily(false);
    }
  };

  const saveSelectedChildProfile = async (event) => {
    event.preventDefault();
    if (!selectedFamilyId || !selectedChildId || !childEditForm.firstName.trim()) {
      return;
    }

    setIsSavingChildProfile(true);
    setError("");

    try {
      const updated = await api.updateChild(selectedFamilyId, selectedChildId, {
        firstName: childEditForm.firstName,
        lastName: childEditForm.lastName,
        dateOfBirth: childEditForm.dateOfBirth,
        nhsNumber: childEditForm.nhsNumber,
        avatarUrl: childEditForm.avatarUrl,
        notes: childEditForm.notes,
      });
      setChildren((current) =>
        current.map((child) => (child.id === updated.id ? updated : child)),
      );
      setAccountMessage("Child details updated.");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSavingChildProfile(false);
    }
  };

  const uploadSelectedChildPhoto = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !selectedFamilyId || !selectedChildId) return;

    setIsUploadingChildPhoto(true);
    setError("");

    try {
      const upload = await api.uploadProfilePhoto({
        familyId: selectedFamilyId,
        childId: selectedChildId,
        file,
      });
      const updated = upload.child;

      setChildEditForm((current) => ({
        ...current,
        avatarUrl: upload.publicUrl,
        avatarObjectKey: upload.objectKey,
      }));
      setChildren((current) =>
        current.map((child) => (child.id === updated.id ? updated : child)),
      );
      setAccountMessage("Child photo updated.");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsUploadingChildPhoto(false);
      event.target.value = "";
    }
  };

  const loadAdmin = async () => {
    if (!selectedFamilyId) return;
    setIsAdminLoading(true);
    setError("");

    try {
      const [loadedMembers, loadedInvitations, loadedSubscription] = await Promise.all([
        api.listMembers(selectedFamilyId),
        api.listInvitations(selectedFamilyId),
        api.getSubscription(selectedFamilyId),
      ]);
      setMembers(loadedMembers);
      setInvitations(loadedInvitations);
      setSubscription(loadedSubscription);
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsAdminLoading(false);
    }
  };

  const openAdmin = async () => {
    setShowAdmin(true);
    await loadAdmin();
  };

  const sendInvite = async (event) => {
    event.preventDefault();
    setInviteResult("");
    setError("");

    try {
      const invitation = await api.createInvitation(selectedFamilyId, inviteForm);
      setInviteResult(invitation.acceptUrl);
      setInviteForm({ email: "", role: "parent" });
      await loadAdmin();
    } catch (caughtError) {
      setError(caughtError.message);
    }
  };

  const changeRole = async (memberId, role) => {
    await api.updateMemberRole(selectedFamilyId, memberId, role);
    await loadAdmin();
  };

  const removeMember = async (member) => {
    const confirmed = window.confirm(
      `Remove ${member.fullName} from ${selectedFamily.familyName}?`,
    );
    if (!confirmed) return;

    setError("");
    try {
      await api.removeMember(selectedFamilyId, member.id);
      await loadAdmin();
    } catch (caughtError) {
      setError(caughtError.message);
    }
  };

  const exportFamilyBackup = async () => {
    if (!selectedFamilyId) return;
    setError("");

    try {
      const logs = await api.listCareLogs(selectedFamilyId, {
        childId: selectedChildId,
      });
      const backup = {
        exportedAt: new Date().toISOString(),
        family: selectedFamily,
        children,
        selectedChild,
        childProfile,
        routines: childCareOptions,
        logs,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `familytrack-backup-${selectedFamily.familyName
        .toLowerCase()
        .replace(/\s+/g, "-")}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caughtError) {
      setError(caughtError.message);
    }
  };

  const addAdminChild = async (event) => {
    event.preventDefault();
    if (!selectedFamilyId || !childName.trim()) return;

    setIsSavingChild(true);
    setError("");

    try {
      const child = await api.createChild(selectedFamilyId, {
        firstName: childName,
      });
      setChildren((current) => [...current, child]);
      setSelectedChildId((current) => current || child.id);
      if (!selectedChildId) {
        localStorage.setItem(selectedChildStorageKey(selectedFamilyId), child.id);
      }
      setChildName("");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSavingChild(false);
    }
  };

  const saveChildProfile = async (event) => {
    event.preventDefault();
    if (!selectedFamilyId || !selectedChildId) return;

    setIsSavingProfile(true);
    setError("");

    try {
      const profileToSave = {
        ...childProfile,
        currentMedications: serializeCareMedicationRows(careMedicationRows),
      };
      const profile = await api.updateChildProfile(
        selectedFamilyId,
        selectedChildId,
        profileToSave,
      );
      setChildProfile({ ...emptyChildProfile, ...profile });
      setCareMedicationRows(
        careMedicationRowsFromProfile(profile?.currentMedications),
      );
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const updateCareMedicationRow = (index, field, value) => {
    const rows = [...careMedicationRows];
    rows[index] = { ...rows[index], [field]: value };
    setCareMedicationRows(rows);
  };

  const updateRegularMedicationDraft = (field, value) => {
    setRegularMedicationDraft((current) => ({ ...current, [field]: value }));
  };

  const addRegularMedicationDraftTime = () => {
    setRegularMedicationDraft((current) => ({
      ...current,
      times: [...(current.times || []), ""],
    }));
  };

  const removeRegularMedicationDraftTime = (timeIndex) => {
    setRegularMedicationDraft((current) => {
      const times = (current.times || []).filter(
        (_, indexToRemove) => indexToRemove !== timeIndex,
      );
      return { ...current, times: times.length ? times : [""] };
    });
  };

  const resetRegularMedicationDraft = () => {
    setRegularMedicationDraft(emptyCareMedicationRow());
    setEditingCareMedicationIndex(null);
  };

  const persistRegularMedicationRows = async (rows) => {
    if (!selectedFamilyId || !selectedChildId) return null;

    setIsSavingProfile(true);
    setError("");

    try {
      const nextProfile = {
        ...childProfile,
        currentMedications: serializeCareMedicationRows(rows),
      };
      const profile = await api.updateChildProfile(
        selectedFamilyId,
        selectedChildId,
        nextProfile,
      );
      const nextRows = careMedicationRowsFromProfile(profile?.currentMedications);
      setChildProfile({ ...emptyChildProfile, ...profile });
      setCareMedicationRows(nextRows);
      return profile;
    } catch (caughtError) {
      setError(caughtError.message);
      return null;
    } finally {
      setIsSavingProfile(false);
    }
  };

  const saveRegularMedication = async () => {
    const medicineName = cleanFormText(regularMedicationDraft.name);
    if (!medicineName) {
      setError("Add a medication name before saving.");
      return;
    }

    const draft = {
      ...regularMedicationDraft,
      name: medicineName,
      doseAmount: cleanFormText(regularMedicationDraft.doseAmount),
      doseUnit: cleanFormText(regularMedicationDraft.doseUnit) || "ml",
      times: (regularMedicationDraft.times || [])
        .map((time) => cleanFormText(time))
        .filter(Boolean),
      active: regularMedicationDraft.active !== false,
      notes: cleanFormText(regularMedicationDraft.notes),
    };
    const rows = savedCareMedicationRows(careMedicationRows);
    const nextRows =
      editingCareMedicationIndex === null
        ? [...rows, draft]
        : rows.map((row, index) =>
            index === editingCareMedicationIndex ? draft : row,
          );

    const profile = await persistRegularMedicationRows(nextRows);
    if (profile) resetRegularMedicationDraft();
  };

  const editRegularMedication = (index) => {
    const row = savedCareMedicationRows(careMedicationRows)[index];
    if (!row) return;
    setRegularMedicationDraft({
      ...emptyCareMedicationRow(),
      ...row,
      times: row.times?.length ? row.times : [""],
    });
    setEditingCareMedicationIndex(index);
  };

  const removeCareMedicationRow = async (index) => {
    const rows = savedCareMedicationRows(careMedicationRows).filter(
      (_, rowIndex) => rowIndex !== index,
    );
    const profile = await persistRegularMedicationRows(rows);
    if (profile && editingCareMedicationIndex === index) {
      resetRegularMedicationDraft();
    }
  };

  const toggleRegularMedicationActive = async (index) => {
    const rows = savedCareMedicationRows(careMedicationRows).map((row, rowIndex) =>
      rowIndex === index ? { ...row, active: row.active === false } : row,
    );
    await persistRegularMedicationRows(rows);
  };

  const addRegularMedicationFromDiary = async ({ name, dose }) => {
    if (!selectedFamilyId || !selectedChildId || !name?.trim()) return null;

    const rows = [
      ...savedCareMedicationRows(careMedicationRows),
      {
        name: name.trim(),
        doseAmount: dose || "",
        doseUnit: "other",
        times: [""],
        active: true,
        notes: "",
      },
    ];
    const nextProfile = {
      ...childProfile,
      currentMedications: serializeCareMedicationRows(rows),
    };
    const profile = await api.updateChildProfile(
      selectedFamilyId,
      selectedChildId,
      nextProfile,
    );
    setChildProfile({ ...emptyChildProfile, ...profile });
    setCareMedicationRows(careMedicationRowsFromProfile(profile?.currentMedications));
    return profile;
  };

  const addImportantEvent = async (event) => {
    event.preventDefault();
    if (!selectedFamilyId || !selectedChildId || !importantEventForm.eventDate) {
      return;
    }

    setIsSavingImportantEvent(true);
    setError("");

    try {
      const importantEvent = await api.createImportantEvent(
        selectedFamilyId,
        selectedChildId,
        importantEventForm,
      );
      setImportantEvents((current) => [importantEvent, ...current]);
      setImportantEventForm(emptyImportantEvent);
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSavingImportantEvent(false);
    }
  };

  const removeImportantEvent = async (importantEvent) => {
    setError("");

    try {
      await api.deleteImportantEvent(
        selectedFamilyId,
        selectedChildId,
        importantEvent.id,
      );
      setImportantEvents((current) =>
        current.filter((item) => item.id !== importantEvent.id),
      );
    } catch (caughtError) {
      setError(caughtError.message);
    }
  };

  const addCareOptionFromDiary = async ({ category, label, defaultValue }) => {
    if (!selectedFamilyId || !selectedChildId || !label?.trim()) return null;

    const option = await api.createChildCareOption(
      selectedFamilyId,
      selectedChildId,
      {
        category,
        label,
        defaultValue,
      },
    );

    setChildCareOptions((current) => [
      ...current.filter((item) => item.id !== option.id),
      option,
    ]);

    return option;
  };

  const addSavedCareOption = async (event, category) => {
    event.preventDefault();
    const label = category === "food" ? newRegularFood : newSavedLocation;
    if (!label.trim()) return;

    setIsSavingCareOption(true);
    setError("");

    try {
      await addCareOptionFromDiary({
        category,
        label,
        defaultValue: "",
      });
      if (category === "food") {
        setNewRegularFood("");
        setAccountMessage("Regular food saved.");
      } else {
        setNewSavedLocation("");
        setAccountMessage("Location saved.");
      }
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSavingCareOption(false);
    }
  };

  const startCheckout = async () => {
    if (!selectedFamilyId) return;

    setIsCheckoutLoading(true);
    setError("");

    try {
      const checkout = await api.createCheckoutSession(selectedFamilyId);
      window.location.assign(checkout.checkoutUrl);
    } catch (caughtError) {
      setError(caughtError.message);
      setIsCheckoutLoading(false);
    }
  };

  const openBillingPortal = async () => {
    if (!selectedFamilyId) return;

    setIsBillingPortalLoading(true);
    setError("");

    try {
      const portal = await api.createBillingPortalSession(selectedFamilyId);
      window.location.assign(portal.portalUrl);
    } catch (caughtError) {
      setError(caughtError.message);
      setIsBillingPortalLoading(false);
    }
  };

  const changeOwnPassword = async (event) => {
    event.preventDefault();
    setError("");
    setAccountMessage("");

    if (accountPasswordForm.newPassword !== accountPasswordForm.confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    setIsChangingPassword(true);

    try {
      await api.changePassword({
        currentPassword: accountPasswordForm.currentPassword,
        newPassword: accountPasswordForm.newPassword,
      });
      setAccountPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
        showPasswords: false,
      });
      setAccountMessage("Password updated.");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const openPlatformAdmin = async () => {
    setShowPlatformAdmin(true);
    setShowAdmin(false);
    setIsPlatformLoading(true);
    setError("");
    setPlatformActionMessage("");

    try {
      const [overview, families, users] = await Promise.all([
        api.adminOverview(),
        api.adminFamilies(),
        api.adminUsers(),
      ]);
      setPlatformData({ overview, families, users });
      setSelectedPlatformFamily(null);
      setSelectedPlatformUser(null);
      api
        .adminIssues()
        .then((issues) => setPlatformIssues(issues))
        .catch(() => setPlatformIssues([]));
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformLoading(false);
    }
  };

  const refreshPlatformIssues = async () => {
    setIsIssueAdminLoading(true);
    setError("");

    try {
      const [issues, settings] = await Promise.all([
        api.adminIssues(),
        api.adminFeedbackSettings(),
      ]);
      setPlatformIssues(issues);
      setFeedbackSettings(settings);
      setIsFeedbackEnabled(settings.enabled);
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsIssueAdminLoading(false);
    }
  };

  const updateFeedbackEnabled = async (enabled) => {
    setIsPlatformSaving(true);
    setError("");
    setPlatformActionMessage("");

    try {
      const settings = await api.adminUpdateFeedbackSettings({ enabled });
      setFeedbackSettings(settings);
      setIsFeedbackEnabled(settings.enabled);
      setPlatformActionMessage(
        settings.enabled
          ? "Report Issue button enabled."
          : "Report Issue button disabled for normal users.",
      );
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSaving(false);
    }
  };

  const updateIssueStatus = async (issueId, payload) => {
    setIsPlatformSaving(true);
    setError("");
    setPlatformActionMessage("");

    try {
      const updated = await api.adminUpdateIssueStatus(issueId, payload);
      setPlatformIssues((current) =>
        current.map((issue) =>
          issue.id === issueId
            ? {
                ...issue,
                status: updated.status,
                internalNote: updated.internalNote,
                resolved: updated.resolved,
                notified: updated.notified,
                updatedAt: updated.updatedAt,
              }
            : issue,
        ),
      );
      setPlatformActionMessage(
        updated.status === "resolved"
          ? "Issue marked resolved. The user will see a one-time notification."
          : "Issue updated.",
      );
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSaving(false);
    }
  };

  const openPlatformFamily = async (familyId) => {
    setIsFamilyDetailLoading(true);
    setSelectedPlatformUser(null);
    setError("");
    setPlatformActionMessage("");

    try {
      setSelectedPlatformFamily(await api.adminFamilyDetail(familyId));
      setPlatformAdminTab("families");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsFamilyDetailLoading(false);
    }
  };

  const openPlatformUser = async (userId) => {
    setIsUserDetailLoading(true);
    setSelectedPlatformFamily(null);
    setError("");
    setPlatformActionMessage("");

    try {
      setSelectedPlatformUser(await api.adminUserDetail(userId));
      setPlatformAdminTab("accounts");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsUserDetailLoading(false);
    }
  };

  const openPlatformSnapshotForFamily = async (familyId) => {
    if (!familyId) return;

    setIsPlatformSnapshotLoading(true);
    setError("");

    try {
      const detail = await api.adminFamilyDetail(familyId);
      setPlatformSnapshot({
        source: "family",
        family: detail.family,
        members: detail.members || [],
        children: detail.children || [],
        recentLogs: detail.recentLogs || [],
      });
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSnapshotLoading(false);
    }
  };

  const openPlatformSnapshotForUser = async (userId) => {
    if (!userId) return;

    setIsPlatformSnapshotLoading(true);
    setError("");

    try {
      const detail = await api.adminUserDetail(userId);
      const primaryFamilyId = detail.memberships?.[0]?.familyId;

      if (!primaryFamilyId) {
        setPlatformSnapshot({
          source: "user",
          user: detail.user,
          memberships: [],
          children: [],
          recentLogs: detail.recentLogs || [],
        });
        return;
      }

      const familyDetail = await api.adminFamilyDetail(primaryFamilyId);
      setPlatformSnapshot({
        source: "user",
        user: detail.user,
        memberships: detail.memberships || [],
        family: familyDetail.family,
        members: familyDetail.members || [],
        children: familyDetail.children || [],
        recentLogs: familyDetail.recentLogs || detail.recentLogs || [],
      });
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSnapshotLoading(false);
    }
  };

  const startPlatformViewAsUser = async (userId) => {
    if (!userId) return;

    setIsUserDetailLoading(true);
    setError("");

    try {
      const detail = await api.adminUserDetail(userId);
      const firstFamilyId = detail.memberships?.[0]?.familyId;
      const firstFamily = firstFamilyId
        ? await api.adminFamilyDetail(firstFamilyId)
        : null;
      setPlatformViewAsUser(detail);
      setPlatformViewAsFamily(firstFamily);
      setShowPlatformAdmin(true);
      setPlatformAdminTab("accounts");
      setIsPlatformQuickJumpOpen(false);
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsUserDetailLoading(false);
    }
  };

  const openPlatformViewAsFamily = async (familyId) => {
    if (!familyId) return;

    setIsFamilyDetailLoading(true);
    setError("");

    try {
      setPlatformViewAsFamily(await api.adminFamilyDetail(familyId));
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsFamilyDetailLoading(false);
    }
  };

  const exitPlatformViewAsUser = () => {
    setPlatformViewAsUser(null);
    setPlatformViewAsFamily(null);
    setPlatformActionMessage("Returned to Owner Platform.");
  };

  const updatePlatformFamilyField = (field, value) => {
    setSelectedPlatformFamily((current) =>
      current
        ? {
            ...current,
            family: {
              ...current.family,
              [field]: value,
            },
          }
        : current,
    );
  };

  const updatePlatformUserField = (field, value) => {
    setSelectedPlatformUser((current) =>
      current
        ? {
            ...current,
            user: {
              ...current.user,
              [field]: value,
            },
          }
        : current,
    );
  };

  const savePlatformFamilyControls = async () => {
    if (!selectedPlatformFamily?.family?.id) return;

    setIsPlatformSaving(true);
    setError("");

    try {
      const updated = await api.adminUpdateFamily(selectedPlatformFamily.family.id, {
        platformStatus: selectedPlatformFamily.family.platformStatus || "active",
        platformAdminNotes: selectedPlatformFamily.family.platformAdminNotes || "",
      });

      setPlatformData((current) => ({
        ...current,
        families: current.families.map((family) =>
          family.id === updated.id ? { ...family, ...updated } : family,
        ),
      }));
      await openPlatformFamily(selectedPlatformFamily.family.id);
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSaving(false);
    }
  };

  const syncPlatformFamilyStripe = async () => {
    if (!selectedPlatformFamily?.family?.id) return;

    setIsPlatformSaving(true);
    setError("");

    try {
      await api.adminSyncFamilyStripe(selectedPlatformFamily.family.id);
      const [overview, families] = await Promise.all([
        api.adminOverview(),
        api.adminFamilies(),
      ]);
      setPlatformData((current) => ({ ...current, overview, families }));
      await openPlatformFamily(selectedPlatformFamily.family.id);
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSaving(false);
    }
  };

  const savePlatformUserControls = async () => {
    if (!selectedPlatformUser?.user?.id) return;

    setIsPlatformSaving(true);
    setError("");
    setPlatformActionMessage("");

    try {
      const updated = await api.adminUpdateUser(selectedPlatformUser.user.id, {
        fullName: selectedPlatformUser.user.fullName || "",
        email: selectedPlatformUser.user.email || "",
        platformStatus: selectedPlatformUser.user.platformStatus || "active",
        platformAdminNotes: selectedPlatformUser.user.platformAdminNotes || "",
        isPlatformAdmin: Boolean(selectedPlatformUser.user.isPlatformAdmin),
      });

      setPlatformData((current) => ({
        ...current,
        users: current.users.map((user) =>
          user.id === updated.id ? { ...user, ...updated } : user,
        ),
      }));
      await openPlatformUser(selectedPlatformUser.user.id);
      setPlatformActionMessage("Account details saved.");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSaving(false);
    }
  };

  const addPlatformFamilyMember = async (event) => {
    event.preventDefault();
    if (!selectedPlatformFamily?.family?.id) return;

    setIsPlatformSaving(true);
    setError("");
    setPlatformActionMessage("");

    try {
      const result = await api.adminAddFamilyMember(
        selectedPlatformFamily.family.id,
        platformMemberForm,
      );
      await openPlatformFamily(selectedPlatformFamily.family.id);
      setPlatformMemberForm({ email: "", role: "parent" });
      setPlatformActionMessage(
        result.type === "invitation"
          ? `Invitation created. Link: ${result.invitation.acceptUrl}`
          : "User added to this family.",
      );
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSaving(false);
    }
  };

  const updatePlatformFamilyMemberRole = async (memberId, role) => {
    if (!selectedPlatformFamily?.family?.id) return;

    setIsPlatformSaving(true);
    setError("");
    setPlatformActionMessage("");

    try {
      await api.adminUpdateFamilyMember(selectedPlatformFamily.family.id, memberId, {
        role,
      });
      await openPlatformFamily(selectedPlatformFamily.family.id);
      setPlatformActionMessage("Family member role updated.");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSaving(false);
    }
  };

  const removePlatformFamilyMember = async (memberId) => {
    if (!selectedPlatformFamily?.family?.id) return;

    setIsPlatformSaving(true);
    setError("");
    setPlatformActionMessage("");

    try {
      await api.adminRemoveFamilyMember(selectedPlatformFamily.family.id, memberId);
      await openPlatformFamily(selectedPlatformFamily.family.id);
      setPlatformActionMessage("Family member removed.");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSaving(false);
    }
  };

  const resetPlatformUserPassword = async (event) => {
    event.preventDefault();
    if (!selectedPlatformUser?.user?.id) return;

    setIsPlatformSaving(true);
    setError("");
    setPlatformActionMessage("");

    try {
      await api.adminResetUserPassword(selectedPlatformUser.user.id, {
        password: platformPasswordForm.password,
      });
      setPlatformPasswordForm({ password: "" });
      await openPlatformUser(selectedPlatformUser.user.id);
      setPlatformActionMessage("Temporary password set for this account.");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSaving(false);
    }
  };

  const createPlatformPasswordReset = async (userId) => {
    if (!userId) return;

    setIsPlatformSaving(true);
    setError("");
    setPlatformActionMessage("");

    try {
      const reset = await api.adminCreatePasswordReset(userId);
      setPlatformActionMessage(
        `Password reset link created for ${reset.email}: ${reset.resetUrl}`,
      );
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSaving(false);
    }
  };

  const setPlatformUserStatus = async (user, status) => {
    if (!user?.id) return;

    setIsPlatformSaving(true);
    setError("");
    setPlatformActionMessage("");

    try {
      const updated = await api.adminUpdateUser(user.id, {
        fullName: user.fullName || "",
        email: user.email || "",
        platformStatus: status,
        platformAdminNotes: user.platformAdminNotes || "",
        isPlatformAdmin: Boolean(user.isPlatformAdmin),
      });

      setPlatformData((current) => ({
        ...current,
        users: current.users.map((item) =>
          item.id === updated.id ? { ...item, ...updated } : item,
        ),
      }));
      if (selectedPlatformUser?.user?.id === user.id) {
        await openPlatformUser(user.id);
      }
      setPlatformActionMessage(
        status === "active" ? "Account activated." : "Account deactivated.",
      );
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSaving(false);
    }
  };

  const setPlatformFamilyStatus = async (family, status) => {
    if (!family?.id) return;

    setIsPlatformSaving(true);
    setError("");
    setPlatformActionMessage("");

    try {
      const updated = await api.adminUpdateFamily(family.id, {
        platformStatus: status,
        platformAdminNotes: family.platformAdminNotes || "",
      });
      setPlatformData((current) => ({
        ...current,
        families: current.families.map((item) =>
          item.id === updated.id ? { ...item, ...updated } : item,
        ),
      }));
      if (selectedPlatformFamily?.family?.id === family.id) {
        await openPlatformFamily(family.id);
      }
      setPlatformActionMessage(
        status === "active" ? "Family activated." : "Family deactivated.",
      );
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformSaving(false);
    }
  };

  const platformSearchTerm = platformSearch.trim().toLowerCase();
  const now = new Date();
  const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;

  const safeDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const isSameDay = (date, comparison = now) =>
    date &&
    date.getFullYear() === comparison.getFullYear() &&
    date.getMonth() === comparison.getMonth() &&
    date.getDate() === comparison.getDate();

  const lastSeenLabel = (value) => {
    const date = safeDate(value);
    if (!date) return "Never logged in";
    if (isSameDay(date)) {
      return `Today ${date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameDay(date, yesterday)) {
      return `Yesterday ${date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }

    return date.toLocaleDateString([], {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatPlatformDateTime = (value) => {
    const date = safeDate(value);
    if (!date) return "Not available";
    return date.toLocaleString([], {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const accountHealthForUser = (user) => {
    const lastLoginAt = safeDate(user?.lastLoginAt);
    if (!lastLoginAt) {
      return {
        label: "Inactive",
        tone: "red",
        dotClass: "bg-rose-500",
        badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
      };
    }

    const age = now.getTime() - lastLoginAt.getTime();
    if (age <= sevenDaysInMs) {
      return {
        label: "Active",
        tone: "green",
        dotClass: "bg-emerald-500",
        badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    }

    if (age <= thirtyDaysInMs) {
      return {
        label: "Low activity",
        tone: "yellow",
        dotClass: "bg-amber-500",
        badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
      };
    }

    return {
      label: "Inactive",
      tone: "red",
      dotClass: "bg-rose-500",
      badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
    };
  };

  const matchesAccountFilter = (user) => {
    const lastLoginAt = safeDate(user.lastLoginAt);
    const age = lastLoginAt ? now.getTime() - lastLoginAt.getTime() : null;

    if (platformAccountFilter === "active-today") {
      return Boolean(lastLoginAt && isSameDay(lastLoginAt));
    }
    if (platformAccountFilter === "last-7-days") {
      return Boolean(lastLoginAt && age <= sevenDaysInMs);
    }
    if (platformAccountFilter === "inactive") {
      return !lastLoginAt || age > thirtyDaysInMs;
    }
    if (platformAccountFilter === "never") {
      return !lastLoginAt;
    }
    return true;
  };

  const recentlyCreatedAccounts = platformData.users.filter((user) => {
    const createdAt = safeDate(user.createdAt);
    return createdAt && now.getTime() - createdAt.getTime() <= sevenDaysInMs;
  }).length;

  const inactiveUsersCount = platformData.users.filter(
    (user) => accountHealthForUser(user).tone === "red",
  ).length;

  const openIssueCount = platformIssues.filter(
    (issue) => issue.status === "open",
  ).length;

  const filteredPlatformFamilies = platformData.families.filter((family) => {
    const haystack = [
      family.name,
      family.ownerName,
      family.ownerEmail,
      family.subscriptionStatus,
      family.platformStatus,
      ...(Array.isArray(family.childNames) ? family.childNames : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(platformSearchTerm);
  });

  const filteredPlatformUsers = platformData.users.filter((user) => {
    const haystack = [user.fullName, user.email, user.platformStatus]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(platformSearchTerm) && matchesAccountFilter(user);
  });

  const platformSearchResults =
    platformSearchTerm.length < 2
      ? []
      : [
          ...platformData.users.map((user) => ({
            id: user.id,
            type: "Account",
            title: user.fullName || user.email,
            subtitle: user.email,
            health: accountHealthForUser(user),
            onSelect: () => openPlatformUser(user.id),
            onSnapshot: () => openPlatformSnapshotForUser(user.id),
            onViewAs: () => startPlatformViewAsUser(user.id),
            haystack: [user.fullName, user.email, user.platformStatus]
              .filter(Boolean)
              .join(" ")
              .toLowerCase(),
          })),
          ...platformData.families.map((family) => ({
            id: family.id,
            type: "Family",
            title: family.name,
            subtitle: family.ownerEmail || family.ownerName || "Family account",
            onSelect: () => openPlatformFamily(family.id),
            onSnapshot: () => openPlatformSnapshotForFamily(family.id),
            haystack: [
              family.name,
              family.ownerName,
              family.ownerEmail,
              family.subscriptionStatus,
              family.platformStatus,
              ...(Array.isArray(family.childNames) ? family.childNames : []),
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase(),
          })),
          ...platformData.families.flatMap((family) =>
            (Array.isArray(family.childNames) ? family.childNames : []).map(
              (childName) => ({
                id: `${family.id}-${childName}`,
                type: "Child",
                title: childName,
                subtitle: family.name,
                onSelect: () => openPlatformFamily(family.id),
                onSnapshot: () => openPlatformSnapshotForFamily(family.id),
                haystack: [childName, family.name, family.ownerEmail]
                  .filter(Boolean)
                  .join(" ")
                  .toLowerCase(),
              }),
            ),
          ),
        ]
          .filter((item) => item.haystack.includes(platformSearchTerm))
          .slice(0, 8);

  const selectPlatformSearchResult = (result, action = "select") => {
    if (!result) return;
    setIsPlatformQuickJumpOpen(false);
    if (action === "snapshot" && result.onSnapshot) {
      result.onSnapshot();
    } else if (action === "viewAs" && result.onViewAs) {
      result.onViewAs();
    } else {
      result.onSelect();
    }
    platformSearchInputRef.current?.blur();
  };

  const filteredPlatformIssues = platformIssues.filter((issue) => {
    const haystack = [
      issue.message,
      issue.route,
      issue.severity,
      issue.status,
      issue.userName,
      issue.userEmail,
      issue.familyName,
      issue.childFirstName,
      issue.childLastName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(platformSearchTerm);
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-700">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          Loading your workspace...
        </div>
      </div>
    );
  }

  if (!selectedFamily) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white to-slate-100 px-6 py-10">
        <div className="mx-auto max-w-md rounded-[2rem] border border-slate-300 bg-white p-8 shadow-xl">
          <h1 className="text-xl font-bold text-slate-900">
            Create family workspace
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Your account is ready. Add your family workspace to continue.
          </p>

          <form className="mt-6 space-y-4" onSubmit={addFamily}>
            <div>
              <label className="text-sm font-semibold text-slate-700">
                Family name
              </label>
              <input
                className={inputClass}
                value={familyName}
                onChange={(event) => setFamilyName(event.target.value)}
                placeholder="Bellamy Family"
              />
            </div>

            {error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {error}
              </p>
            ) : null}

            <button className={buttonClass} disabled={isSavingFamily}>
              {isSavingFamily ? "Creating..." : "Create workspace"}
            </button>
          </form>

          <button className={`${secondaryButtonClass} mt-4`} onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>
    );
  }

  if (!selectedChild) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white to-slate-100 px-6 py-10 text-slate-900">
        <div className="mx-auto max-w-md rounded-[2rem] border border-slate-300 bg-white p-8 shadow-xl">
          <h1 className="text-xl font-bold text-slate-900">Add first child</h1>
          <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
            {selectedFamily.familyName} is ready. Add the first child to start
            logging care notes.
          </p>

          <form className="mt-6 space-y-4" onSubmit={addChild}>
            <div>
              <label className="text-sm font-semibold text-slate-700">
                Child name
              </label>
              <input
                className={inputClass}
                value={childName}
                onChange={(event) => setChildName(event.target.value)}
                placeholder="Child name"
              />
            </div>

            {error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {error}
              </p>
            ) : null}

            <button className={buttonClass} disabled={isSavingChild}>
              {isSavingChild ? "Adding..." : "Add child"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {!showAdmin && !showPlatformAdmin ? (
      <div className="border-b border-slate-200 bg-white/80 px-3 py-3 shadow-sm backdrop-blur">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-100 via-purple-50 to-white px-4 py-3 shadow-md">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-600">
                    {selectedFamily.familyName}
                  </p>
                  <h1 className="truncate text-xl font-extrabold text-slate-950">
                    FamilyTrack
                  </h1>
                  <p className="truncate text-sm font-semibold text-slate-600">
                    {selectedChild ? childDisplayName(selectedChild) : "Choose child"}
                  </p>
                </div>
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
                <div className="min-w-0 flex-1 lg:max-w-xl">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                  {children.map((child) => {
                    const childName = childDisplayName(child);
                    const isSelected = selectedChildId === child.id;
                    return (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => selectChild(child.id)}
                        className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-sm font-bold transition ${
                          isSelected
                            ? "border-indigo-300 bg-indigo-600 text-white shadow-sm"
                            : "border-slate-200 bg-white text-slate-700 shadow-sm"
                        }`}
                      >
                        <ChildAvatar child={child} active={isSelected} />
                        {childName}
                      </button>
                    );
                  })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                <button
                  type="button"
                  onClick={openAdmin}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
                >
                  Settings
                </button>
                {session?.user?.isPlatformAdmin ? (
                  <button
                    type="button"
                    onClick={openPlatformAdmin}
                    className="rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 shadow-sm"
                  >
                    Platform
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onLogout}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
                >
                  Log out
                </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      ) : null}

      {showAdmin ? (
        <div className="min-h-screen bg-slate-50 px-4 py-5">
          <div className="mx-auto max-w-6xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Account settings
                </p>
                <h2 className="text-lg font-bold text-slate-900">
                  Manage {selectedFamily.familyName}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAdmin(false)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
              >
                Back to diary
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadAdmin}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
              >
                Refresh
              </button>
              <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600">
                Family role: {selectedFamily.role || "owner"}
              </span>
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
              <div className="flex min-w-max gap-2">
                {[
                  ["account", "Account"],
                  ["family", "Family"],
                  ["children", "Children"],
                  ["preferences", "App Preferences"],
                  ["data", "Data & Export"],
                  ["privacy", "Security / Privacy"],
                ].map(([tabId, label]) => (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => setSettingsTab(tabId)}
                    className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition ${
                      settingsTab === tabId
                        ? "bg-slate-900 text-white shadow-sm"
                        : "bg-slate-50 text-slate-700 hover:bg-indigo-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {error ? (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {error}
              </p>
            ) : null}

            {platformActionMessage ? (
              <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                {platformActionMessage}
              </p>
            ) : null}

            {showPlatformAdmin ? (
              <section className="mt-3 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => setShowSystemStatus((current) => !current)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span>
                    <span className="block text-sm font-black text-slate-900">
                      System status
                    </span>
                    <span className="block text-xs font-semibold text-slate-500">
                      Collapsed owner-only health check
                    </span>
                  </span>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                    API online
                  </span>
                </button>
                {showSystemStatus ? (
                  <div className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-4">
                    {[
                      ["API status", "Online"],
                      ["Last sync", new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })],
                      [
                        "App version",
                        import.meta.env.VITE_APP_VERSION ||
                          import.meta.env.VITE_APP_BUILD ||
                          import.meta.env.MODE ||
                          "local",
                      ],
                      ["Errors", error ? "Check alert" : "None shown"],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          {label}
                        </p>
                        <p className="mt-0.5 text-sm font-black text-slate-900">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {platformActionMessage ? (
              <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                {platformActionMessage}
              </p>
            ) : null}

            {accountMessage ? (
              <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                {accountMessage}
              </p>
            ) : null}

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              {settingsTab === "account" ? (
              <>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900">Your account</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {session.user.fullName || session.user.email}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      Last login: {lastLoginText}
                    </p>
                  </div>
                  <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">
                    Current session
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <h4 className="font-bold text-slate-900">Login sessions</h4>
                    <p className="mt-1 text-sm text-slate-600">
                      This device is signed in now. Other-device management will
                      connect to the full session system later.
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setAccountMessage(
                          "Other-device logout is ready in the UI and needs backend session tracking before it can be enabled.",
                        )
                      }
                      className="mt-3 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm"
                    >
                      Log out of other devices
                    </button>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <h4 className="font-bold text-slate-900">Change email</h4>
                    <p className="mt-1 text-sm text-slate-600">
                      Current email:{" "}
                      <span className="font-semibold text-slate-900">
                        {session.user.email}
                      </span>
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                      <input
                        className={`${inputClass} mt-0`}
                        type="email"
                        value={pendingEmail}
                        onChange={(event) => setPendingEmail(event.target.value)}
                        placeholder="New email address"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setAccountMessage(
                            "Email changes will require re-authentication and verification before the address is switched.",
                          )
                        }
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm"
                      >
                        Request change
                      </button>
                    </div>
                  </div>
                </div>

                <form
                  className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  onSubmit={changeOwnPassword}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900">Password</h4>
                      <p className="text-sm text-slate-600">
                        Use at least 10 characters for a safer password.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAccountPasswordForm({
                          ...accountPasswordForm,
                          showPasswords: !accountPasswordForm.showPasswords,
                        })
                      }
                      className="w-fit rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm"
                    >
                      {accountPasswordForm.showPasswords ? "Hide" : "Show"}
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <input
                      className={`${inputClass} mt-0`}
                      type={accountPasswordForm.showPasswords ? "text" : "password"}
                      value={accountPasswordForm.currentPassword}
                      onChange={(event) =>
                        setAccountPasswordForm({
                          ...accountPasswordForm,
                          currentPassword: event.target.value,
                        })
                      }
                      placeholder="Current password"
                      required
                    />
                    <input
                      className={`${inputClass} mt-0`}
                      type={accountPasswordForm.showPasswords ? "text" : "password"}
                      value={accountPasswordForm.newPassword}
                      onChange={(event) =>
                        setAccountPasswordForm({
                          ...accountPasswordForm,
                          newPassword: event.target.value,
                        })
                      }
                      placeholder="New password"
                      minLength={10}
                      required
                    />
                    <input
                      className={`${inputClass} mt-0`}
                      type={accountPasswordForm.showPasswords ? "text" : "password"}
                      value={accountPasswordForm.confirmPassword}
                      onChange={(event) =>
                        setAccountPasswordForm({
                          ...accountPasswordForm,
                          confirmPassword: event.target.value,
                        })
                      }
                      placeholder="Confirm new password"
                      minLength={10}
                      required
                    />
                  </div>
                  <button
                    className="mt-3 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isChangingPassword}
                  >
                    {isChangingPassword ? "Saving..." : "Change password"}
                  </button>
                </form>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900">Subscription / Plan</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Plan:{" "}
                      <span className="font-bold text-slate-900">
                        {subscription?.plan || "free"}
                      </span>
                      {" "}- Status:{" "}
                      <span className="font-bold text-slate-900">
                        {subscription?.status || "inactive"}
                      </span>
                    </p>
                    {subscription?.currentPeriodEnd ? (
                      <p className="mt-1 text-sm text-slate-600">
                        Renewal date:{" "}
                        {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-slate-600">
                        Renewal date: not set yet.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={startCheckout}
                      disabled={isCheckoutLoading}
                      className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isCheckoutLoading ? "Opening Stripe..." : "Start subscription"}
                    </button>
                    <button
                      type="button"
                      onClick={openBillingPortal}
                      disabled={
                        isBillingPortalLoading ||
                        !subscription?.stripeCustomerId
                      }
                      className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isBillingPortalLoading
                        ? "Opening billing..."
                        : "Manage billing"}
                    </button>
                  </div>
                </div>
              </section>
              </>
              ) : null}

              {settingsTab === "family" ? (
              <>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
                <h3 className="font-bold text-slate-900">Family</h3>
                <p className="mt-1 text-sm text-slate-600">
                  This is the shared workspace name shown to parents and carers.
                </p>
                <form
                  className="mt-4 space-y-4"
                  onSubmit={saveFamilyProfile}
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-sm font-semibold text-slate-700">
                        Family name
                      </label>
                      <input
                        className={inputClass}
                        value={familyEditName}
                        onChange={(event) => setFamilyEditName(event.target.value)}
                        placeholder="Family name"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700">
                        Family address
                      </label>
                      <input
                        className={inputClass}
                        value={familyAddress}
                        onChange={(event) => setFamilyAddress(event.target.value)}
                        placeholder="Address, optional"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {familyEmergencyContacts.map((contact, index) => (
                      <div
                        key={index}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <h4 className="text-sm font-bold text-slate-900">
                          Emergency contact {index + 1}
                        </h4>
                        <div className="mt-3 grid gap-3">
                          <input
                            className={`${inputClass} mt-0`}
                            value={contact.name || ""}
                            onChange={(event) =>
                              setFamilyEmergencyContacts((current) =>
                                current.map((item, contactIndex) =>
                                  contactIndex === index
                                    ? { ...item, name: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            placeholder="Name"
                          />
                          <input
                            className={`${inputClass} mt-0`}
                            value={contact.relationship || ""}
                            onChange={(event) =>
                              setFamilyEmergencyContacts((current) =>
                                current.map((item, contactIndex) =>
                                  contactIndex === index
                                    ? {
                                        ...item,
                                        relationship: event.target.value,
                                      }
                                    : item,
                                ),
                              )
                            }
                            placeholder="Relationship"
                          />
                          <input
                            className={`${inputClass} mt-0`}
                            value={contact.phone || ""}
                            onChange={(event) =>
                              setFamilyEmergencyContacts((current) =>
                                current.map((item, contactIndex) =>
                                  contactIndex === index
                                    ? { ...item, phone: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            placeholder="Phone number"
                          />
                          <input
                            className={`${inputClass} mt-0`}
                            value={contact.notes || ""}
                            onChange={(event) =>
                              setFamilyEmergencyContacts((current) =>
                                current.map((item, contactIndex) =>
                                  contactIndex === index
                                    ? { ...item, notes: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            placeholder="Notes, optional"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isSavingFamily || !familyEditName.trim()}
                  >
                    {isSavingFamily ? "Saving..." : "Save family details"}
                  </button>
                </form>
              </section>


              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
                <h3 className="font-bold text-slate-900">Members</h3>
                <div className="mt-3 space-y-2">
                  {isAdminLoading ? (
                    <p className="text-sm text-slate-600">Loading members...</p>
                  ) : members.length ? (
                    members.map((member) => (
                      <div
                        key={member.id}
                        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="font-semibold text-slate-900">
                            {member.fullName}
                          </p>
                          <p className="text-sm text-slate-600">{member.email}</p>
                        </div>
                        <select
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                          value={member.role}
                          onChange={(event) =>
                            changeRole(member.id, event.target.value)
                          }
                        >
                          <option value="owner">Owner</option>
                          <option value="parent">Parent</option>
                          <option value="carer">Carer</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => removeMember(member)}
                          disabled={member.userId === session.user.id}
                          className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-600">No members found.</p>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="font-bold text-slate-900">Invite someone</h3>
                <form className="mt-3 space-y-3" onSubmit={sendInvite}>
                  <input
                    className={inputClass}
                    type="email"
                    value={inviteForm.email}
                    onChange={(event) =>
                      setInviteForm({ ...inviteForm, email: event.target.value })
                    }
                    placeholder="rachel@example.com"
                  />
                  <select
                    className={inputClass}
                    value={inviteForm.role}
                    onChange={(event) =>
                      setInviteForm({ ...inviteForm, role: event.target.value })
                    }
                  >
                    <option value="parent">Parent</option>
                    <option value="carer">Carer</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button className={buttonClass}>Create invite</button>
                </form>

                {inviteResult ? (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-medium text-emerald-800">
                    Invite link: {inviteResult}
                  </div>
                ) : null}

                <div className="mt-4">
                  <h4 className="text-sm font-bold text-slate-900">
                    Recent invites
                  </h4>
                  <div className="mt-2 space-y-2">
                    {invitations.slice(0, 5).map((invite) => (
                      <div
                        key={invite.id}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                      >
                        <p className="font-semibold text-slate-800">
                          {invite.email}
                        </p>
                        <p className="text-slate-600">
                          {invite.role} · {invite.acceptedAt ? "accepted" : "pending"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
              </>
              ) : null}

              {settingsTab === "children" ? (
              <>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <h3 className="font-bold text-slate-900">Children</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Select a child to edit their basic details.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {children.map((child) => (
                        <button
                          type="button"
                          key={child.id}
                          onClick={() => selectChild(child.id)}
                          className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                            selectedChildId === child.id
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                              : "border-slate-200 bg-slate-50 text-slate-700"
                          }`}
                        >
                          {child.firstName || child.first_name}
                        </button>
                      ))}
                    </div>

                    <form
                      className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      onSubmit={saveSelectedChildProfile}
                    >
                      <h4 className="font-bold text-slate-900">
                        Edit {childDisplayName(selectedChild)}
                      </h4>
                      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          <ChildAvatar child={{ ...selectedChild, avatarUrl: childEditForm.avatarUrl }} size="lg" />
                          <div>
                            <p className="text-sm font-bold text-slate-900">
                              Child photo
                            </p>
                            <p className="text-xs font-medium text-slate-500">
                              Optional profile image for the child selector.
                            </p>
                          </div>
                        </div>
                        <label className="cursor-pointer rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm">
                          {isUploadingChildPhoto ? "Uploading..." : "Upload photo"}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={uploadSelectedChildPhoto}
                            disabled={isUploadingChildPhoto}
                          />
                        </label>
                      </div>
                      {childEditForm.avatarUrl ? (
                        <p className="break-all rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500">
                          Photo URL: {childEditForm.avatarUrl}
                        </p>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <input
                          className={`${inputClass} mt-0`}
                          value={childEditForm.firstName}
                          onChange={(event) =>
                            setChildEditForm({
                              ...childEditForm,
                              firstName: event.target.value,
                            })
                          }
                          placeholder="First name"
                        />
                        <input
                          className={`${inputClass} mt-0`}
                          value={childEditForm.lastName}
                          onChange={(event) =>
                            setChildEditForm({
                              ...childEditForm,
                              lastName: event.target.value,
                            })
                          }
                          placeholder="Last name, optional"
                        />
                        <input
                          className={`${inputClass} mt-0`}
                          type="date"
                          value={childEditForm.dateOfBirth}
                          onChange={(event) =>
                            setChildEditForm({
                              ...childEditForm,
                              dateOfBirth: event.target.value,
                            })
                          }
                        />
                        <input
                          className={`${inputClass} mt-0`}
                          value={childEditForm.nhsNumber}
                          onChange={(event) =>
                            setChildEditForm({
                              ...childEditForm,
                              nhsNumber: event.target.value,
                            })
                          }
                          placeholder="NHS number, optional"
                          inputMode="numeric"
                        />
                      </div>
                      <textarea
                        rows={3}
                        className={inputClass}
                        value={childEditForm.notes}
                        onChange={(event) =>
                          setChildEditForm({
                            ...childEditForm,
                            notes: event.target.value,
                          })
                        }
                        placeholder="Optional private notes"
                      />
                      <p className="text-xs font-medium text-slate-500">
                        NHS number is optional and should only be added when the
                        family wants it stored.
                      </p>
                      <button
                        className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={
                          isSavingChildProfile ||
                          !childEditForm.firstName.trim()
                        }
                      >
                        {isSavingChildProfile ? "Saving..." : "Save child"}
                      </button>
                    </form>
                  </div>

                  <form className="rounded-2xl border border-slate-200 bg-slate-50 p-4" onSubmit={addAdminChild}>
                    <h4 className="font-bold text-slate-900">Add another child</h4>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                      <input
                        className={`${inputClass} mt-0`}
                        value={childName}
                        onChange={(event) => setChildName(event.target.value)}
                        placeholder="Child name"
                      />
                      <button
                        className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isSavingChild || !childName.trim()}
                      >
                        {isSavingChild ? "Adding..." : "Add child"}
                      </button>
                    </div>
                  </form>
                </div>
              </section>


              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
                <h3 className="font-bold text-slate-900">
                  Care profile for {childDisplayName(selectedChild)}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  This is included near the top of shareable reports for
                  hospital, school, EHCP and carer handovers.
                </p>

                <form className="mt-4 space-y-4" onSubmit={saveChildProfile}>
                  <section className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="font-bold text-slate-900">
                          Regular medication setup
                        </h4>
                        <p className="mt-1 text-sm text-slate-600">
                          These medicines appear in the Medication card and in
                          the Care Snapshot. Doses prefill but can still be
                          changed when logging.
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-rose-100 bg-white p-3">
                      <div className="grid min-w-0 gap-2 md:grid-cols-[1fr_0.65fr_0.75fr_auto]">
                        <input
                          className={`${inputClass} mt-0`}
                          value={regularMedicationDraft.name || ""}
                          onChange={(event) =>
                            updateRegularMedicationDraft(
                              "name",
                              event.target.value,
                            )
                          }
                          placeholder="e.g. Vitamin D"
                        />
                        <input
                          className={`${inputClass} mt-0`}
                          value={regularMedicationDraft.doseAmount || ""}
                          onChange={(event) =>
                            updateRegularMedicationDraft(
                              "doseAmount",
                              event.target.value,
                            )
                          }
                          placeholder="Dose amount"
                        />
                        <select
                          className={`${inputClass} mt-0`}
                          value={regularMedicationDraft.doseUnit || "ml"}
                          onChange={(event) =>
                            updateRegularMedicationDraft(
                              "doseUnit",
                              event.target.value,
                            )
                          }
                        >
                          <option value="ml">ml</option>
                          <option value="tablet">tablet</option>
                          <option value="drops">drops</option>
                          <option value="syringe">syringe</option>
                          <option value="injection">injection</option>
                          <option value="other">other</option>
                        </select>
                        <select
                          className={`${inputClass} mt-0`}
                          value={
                            regularMedicationDraft.active === false
                              ? "inactive"
                              : "active"
                          }
                          onChange={(event) =>
                            updateRegularMedicationDraft(
                              "active",
                              event.target.value === "active",
                            )
                          }
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                        <div className="min-w-0 md:col-span-3">
                          <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                            Rough scheduled times
                          </p>
                          <div className="space-y-2">
                            {(regularMedicationDraft.times?.length
                              ? regularMedicationDraft.times
                              : [""]
                            ).map((time, timeIndex) => (
                              <div
                                key={timeIndex}
                                className="flex min-w-0 flex-col gap-2 sm:flex-row"
                              >
                                <input
                                  type="time"
                                  className={`${inputClass} mt-0`}
                                  value={time || ""}
                                  onChange={(event) => {
                                    const times = [
                                      ...(regularMedicationDraft.times || []),
                                    ];
                                    times[timeIndex] = event.target.value;
                                    updateRegularMedicationDraft("times", times);
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeRegularMedicationDraftTime(timeIndex)
                                  }
                                  className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={addRegularMedicationDraftTime}
                              className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700"
                            >
                              + Add time
                            </button>
                          </div>
                        </div>
                        <input
                          className={`${inputClass} mt-0 md:col-span-3`}
                          value={regularMedicationDraft.notes || ""}
                          onChange={(event) =>
                            updateRegularMedicationDraft(
                              "notes",
                              event.target.value,
                            )
                          }
                          placeholder="When / notes, optional"
                        />
                        <div className="flex min-w-0 flex-col gap-2 sm:flex-row md:col-span-4">
                          <button
                            type="button"
                            onClick={saveRegularMedication}
                            className="rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={
                              isSavingProfile ||
                              !cleanFormText(regularMedicationDraft.name)
                            }
                          >
                            {isSavingProfile
                              ? "Saving..."
                              : editingCareMedicationIndex === null
                                ? "Save medication"
                                : "Update medication"}
                          </button>
                          {editingCareMedicationIndex !== null ? (
                            <button
                              type="button"
                              onClick={resetRegularMedicationDraft}
                              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600"
                            >
                              Cancel edit
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <h5 className="text-sm font-bold text-slate-900">
                        Saved regular medication
                      </h5>
                      {savedCareMedicationRows(careMedicationRows).length ? (
                        <div className="mt-3 space-y-2">
                          {savedCareMedicationRows(careMedicationRows).map(
                            (row, index) => (
                              <div
                                key={`${row.name}-${index}`}
                                className="rounded-2xl border border-rose-100 bg-white px-3 py-3"
                              >
                                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <p className="break-words text-sm font-bold text-slate-900">
                                      {row.name}
                                      {row.active === false ? (
                                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">
                                          Inactive
                                        </span>
                                      ) : null}
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-slate-600">
                                      {[row.doseAmount, row.doseUnit]
                                        .filter(Boolean)
                                        .join(" ") || "Dose not set"}
                                    </p>
                                    <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-rose-700">
                                      {row.times?.length
                                        ? row.times.join(", ")
                                        : "No times set"}
                                    </p>
                                  </div>
                                  <div className="grid grid-cols-3 gap-2 sm:flex sm:shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => editRegularMedication(index)}
                                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleRegularMedicationActive(index)
                                      }
                                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
                                    >
                                      {row.active === false ? "Active" : "Pause"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeCareMedicationRow(index)}
                                      className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 rounded-xl border border-dashed border-rose-200 bg-white/70 px-3 py-3 text-sm font-medium text-slate-600">
                          No regular medication saved yet.
                        </p>
                      )}
                    </div>
                  </section>

                  <div className="grid gap-3 md:grid-cols-2">
                    {[
                      ["diagnosisNeeds", "Diagnosis / needs"],
                      ["communicationStyle", "Communication style"],
                      ["keyNeeds", "Key needs"],
                      ["allergies", "Known allergies"],
                      ["emergencyNotes", "Emergency notes"],
                      ["sensoryNeeds", "Sensory needs / calming strategies"],
                      ["likes", "Likes"],
                      ["dislikes", "Dislikes"],
                      ["triggers", "Triggers"],
                      ["calmingStrategies", "Calming strategies"],
                      ["eatingPreferences", "Eating preferences"],
                      ["sleepPreferences", "Sleep preferences"],
                      ["toiletingNotes", "Toileting notes"],
                      ["schoolEhcpNotes", "School / EHCP notes"],
                      ["medicalNotes", "Medical notes"],
                    ].map(([field, label]) => (
                      <label key={field} className="text-sm font-semibold text-slate-700">
                        {label}
                        <textarea
                          rows={3}
                          className={inputClass}
                          value={childProfile[field] || ""}
                          onChange={(event) =>
                            setChildProfile({
                              ...childProfile,
                              [field]: event.target.value,
                            })
                          }
                          placeholder="Optional"
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isSavingProfile}
                  >
                    {isSavingProfile ? "Saving..." : "Save care profile"}
                  </button>
                </form>
              </section>
              </>
              ) : null}

              {settingsTab === "data" ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
                <h3 className="font-bold text-slate-900">Data & Export</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Download a backup of this family&apos;s data. This is not a
                  shareable report.
                </p>
                <button
                  type="button"
                  onClick={exportFamilyBackup}
                  className="mt-4 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
                >
                  Export backup JSON
                </button>
              </section>
              ) : null}

              {settingsTab === "preferences" ? (
                <>
                  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
                    <h3 className="font-bold text-slate-900">App Preferences</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Dashboard card order is saved automatically when you drag
                      cards on the main diary screen.
                    </p>
                    <label className="mt-4 block text-sm font-semibold text-slate-700">
                      Time zone
                      <select
                        className={inputClass}
                        value={timeZonePreference}
                        onChange={(event) => setTimeZonePreference(event.target.value)}
                      >
                        <option value="auto">Auto-detect ({detectedTimeZone})</option>
                        <option value="Europe/London">Europe/London</option>
                        <option value="Europe/Dublin">Europe/Dublin</option>
                        <option value="UTC">UTC</option>
                      </select>
                    </label>
                    <p className="mt-2 text-xs font-medium text-slate-500">
                      Dates shown in account settings use {activeTimeZone}. Diary
                      entries keep their saved date and time values.
                    </p>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
                    <h3 className="font-bold text-slate-900">
                      Saved foods and locations
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      These appear in the food and drink form for the selected child.
                    </p>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <form
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                        onSubmit={(event) => addSavedCareOption(event, "food")}
                      >
                        <label className="text-sm font-semibold text-slate-700">
                          Regular food or drink
                        </label>
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                          <input
                            className={`${inputClass} mt-0`}
                            value={newRegularFood}
                            onChange={(event) => setNewRegularFood(event.target.value)}
                            placeholder="e.g. pasta, toast, apple juice"
                          />
                          <button
                            className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isSavingCareOption || !newRegularFood.trim()}
                          >
                            Save
                          </button>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {groupedCareOptions.food.length ? (
                            groupedCareOptions.food.map((option) => (
                              <span
                                key={option.id}
                                className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm"
                              >
                                {option.label}
                              </span>
                            ))
                          ) : (
                            <p className="text-sm text-slate-500">
                              No regular foods saved yet.
                            </p>
                          )}
                        </div>
                      </form>

                      <form
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                        onSubmit={(event) => addSavedCareOption(event, "location")}
                      >
                        <label className="text-sm font-semibold text-slate-700">
                          Saved location
                        </label>
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                          <input
                            className={`${inputClass} mt-0`}
                            value={newSavedLocation}
                            onChange={(event) => setNewSavedLocation(event.target.value)}
                            placeholder="e.g. Nan's house, respite, nursery"
                          />
                          <button
                            className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isSavingCareOption || !newSavedLocation.trim()}
                          >
                            Save
                          </button>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {groupedCareOptions.locations.length ? (
                            groupedCareOptions.locations.map((option) => (
                              <span
                                key={option.id}
                                className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm"
                              >
                                {option.label}
                              </span>
                            ))
                          ) : (
                            <p className="text-sm text-slate-500">
                              No extra locations saved yet. Home, School and Other
                              are always available.
                            </p>
                          )}
                        </div>
                      </form>
                    </div>
                  </section>
                </>
              ) : null}

              {settingsTab === "privacy" ? (
                <>
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
                  <h3 className="font-bold text-slate-900">Security / Privacy</h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    {[
                      [
                        "Private family data",
                        "Care logs, child profiles, routines and reports are only shown to users who belong to this family workspace.",
                      ],
                      [
                        "Sensitive fields",
                        "NHS numbers, child photos, allergies, medications and emergency notes are optional and should only be stored when the family wants them included.",
                      ],
                      [
                        "Storage",
                        "Diary data is stored in the app database. Child photo uploads are prepared for DigitalOcean Spaces using a secure backend signed-upload flow.",
                      ],
                    ].map(([title, copy]) => (
                      <div
                        key={title}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <h4 className="font-bold text-slate-900">{title}</h4>
                        <p className="mt-1 text-sm leading-6 text-slate-600">
                          {copy}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm lg:col-span-3">
                  <h3 className="font-bold text-rose-900">Delete account</h3>
                  <p className="mt-1 text-sm leading-6 text-rose-800">
                    Account deletion is permanent and can remove access to family
                    data. This control is intentionally not connected until the
                    full deletion policy and backups are agreed.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                    <input
                      className={`${inputClass} mt-0 border-rose-200`}
                      value={deleteConfirmText}
                      onChange={(event) => setDeleteConfirmText(event.target.value)}
                      placeholder="Type DELETE to confirm"
                    />
                    <button
                      type="button"
                      disabled={deleteConfirmText !== "DELETE"}
                      onClick={() =>
                        setAccountMessage(
                          "Account deletion needs backend deletion rules before it can be enabled safely.",
                        )
                      }
                      className="rounded-xl bg-rose-700 px-4 py-3 text-sm font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Delete account
                    </button>
                  </div>
                </section>
                </>
              ) : null}

            </div>
          </div>
        </div>
      ) : null}

      {showPlatformAdmin ? (
        <div className="min-h-screen bg-indigo-50 px-3 py-3 sm:px-4 sm:py-5">
          <div className="mx-auto max-w-5xl">
            <div className="flex items-start justify-between gap-3 rounded-2xl border border-indigo-100 bg-white/90 px-3 py-3 shadow-sm backdrop-blur sm:px-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-600">
                  Platform admin
                </p>
                <h2 className="truncate text-base font-bold text-slate-900 sm:text-lg">
                  FamilyTrack SaaS
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowPlatformAdmin(false)}
                className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-white"
              >
                Back
              </button>
            </div>

            {error ? (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {error}
              </p>
            ) : null}

            {platformActionMessage ? (
              <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                {platformActionMessage}
              </p>
            ) : null}

            {platformViewAsUser ? (
              <section className="mt-3 overflow-hidden rounded-[1.5rem] border border-indigo-200 bg-white shadow-sm">
                <div className="flex flex-col gap-2 bg-indigo-600 px-4 py-3 text-white sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-100">
                      Owner read-only mode
                    </p>
                    <h3 className="text-lg font-black">
                      Viewing as {platformViewAsUser.user.fullName}
                    </h3>
                    <p className="text-xs font-semibold text-indigo-100">
                      Your owner session is still active. Editing, saving and deleting are disabled in this view.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={exitPlatformViewAsUser}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-indigo-700 shadow-sm"
                  >
                    Exit view as user
                  </button>
                </div>
                <div className="border-b border-indigo-100 bg-indigo-50/70 p-3">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {(platformViewAsUser.memberships || []).map((membership) => (
                      <button
                        type="button"
                        key={membership.id}
                        onClick={() => openPlatformViewAsFamily(membership.familyId)}
                        disabled={isFamilyDetailLoading}
                        className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold shadow-sm disabled:opacity-50 ${
                          platformViewAsFamily?.family?.id === membership.familyId
                            ? "border-indigo-500 bg-indigo-600 text-white"
                            : "border-indigo-100 bg-white text-indigo-700"
                        }`}
                      >
                        {membership.familyName} - {membership.role}
                      </button>
                    ))}
                    {!platformViewAsUser.memberships?.length ? (
                      <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-600">
                        No family memberships
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-3 bg-slate-50 p-3">
                  <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                          FamilyTrack read-only preview
                        </p>
                        <h3 className="truncate text-2xl font-black text-slate-950">
                          {platformViewAsFamily?.family?.name ||
                            platformViewAsUser.user.fullName}
                        </h3>
                        <p className="mt-1 text-sm font-semibold text-slate-600">
                          Account: {platformViewAsUser.user.email}
                        </p>
                      </div>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-amber-800">
                        Read only
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ["Last login", formatPlatformDateTime(platformViewAsUser.user.lastLoginAt)],
                      ["Account created", formatPlatformDateTime(platformViewAsUser.user.createdAt)],
                      ["Families", platformViewAsUser.activity?.familyCount ?? 0],
                      ["User logs", platformViewAsUser.activity?.logCount ?? 0],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          {label}
                        </p>
                        <p className="mt-1 text-sm font-black text-slate-900">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
                    <div className="rounded-[1.25rem] border border-slate-200 bg-white p-3 shadow-sm">
                      <h4 className="text-sm font-black text-slate-900">
                        Children in this family
                      </h4>
                      <div className="mt-2 space-y-2">
                        {(platformViewAsFamily?.children || []).map((child) => (
                          <div
                            key={child.id}
                            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                          >
                            <p className="font-bold text-slate-900">
                              {child.firstName} {child.lastName || ""}
                            </p>
                            <p className="text-xs font-semibold text-slate-500">
                              DOB: {child.dateOfBirth || "Not set"}
                            </p>
                          </div>
                        ))}
                        {!platformViewAsFamily?.children?.length ? (
                          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-500">
                            No children visible in this family.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-[1.25rem] border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-black text-slate-900">
                          Recent diary activity
                        </h4>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
                          Read-only
                        </span>
                      </div>
                      <div className="mt-2 space-y-2">
                        {(platformViewAsFamily?.recentLogs ||
                          platformViewAsUser.recentLogs ||
                          [])
                          .slice(0, 10)
                          .map((log) => (
                            <div
                              key={log.id}
                              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                            >
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <p className="font-bold capitalize text-slate-900">
                                  {log.category} - {log.childFirstName || "Child"}
                                </p>
                                <p className="text-xs font-semibold text-slate-500">
                                  {log.logDate} {log.logTime || ""}
                                </p>
                              </div>
                              {log.notes ? (
                                <p className="mt-1 text-slate-700">{log.notes}</p>
                              ) : null}
                            </div>
                          ))}
                        {!(platformViewAsFamily?.recentLogs ||
                          platformViewAsUser.recentLogs ||
                          []).length ? (
                          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-500">
                            No recent diary entries visible.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                    Add, edit, save, delete and export controls are hidden in view-as
                    mode. Use Exit view as user to return to the Owner Platform.
                  </div>
                </div>
              </section>
            ) : null}

            {isPlatformLoading ? (
              <div className="mt-3 rounded-2xl border border-indigo-100 bg-white p-3 text-sm font-semibold text-slate-600">
                Loading platform dashboard...
              </div>
            ) : platformViewAsUser ? null : (
              <>
                <div className="relative mt-3 rounded-2xl border border-indigo-100 bg-white px-3 py-2.5 shadow-sm">
                  <label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                    Quick search and jump
                  </label>
                  <input
                    ref={platformSearchInputRef}
                    className="mt-1.5 block box-border w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                    value={platformSearch}
                    onFocus={() =>
                      setIsPlatformQuickJumpOpen(platformSearchTerm.length >= 2)
                    }
                    onBlur={() =>
                      window.setTimeout(
                        () => setIsPlatformQuickJumpOpen(false),
                        120,
                      )
                    }
                    onChange={(event) => {
                      setPlatformSearch(event.target.value);
                      setIsPlatformQuickJumpOpen(
                        event.target.value.trim().length >= 2,
                      );
                    }}
                    placeholder="Search families, users or children"
                  />
                  {isPlatformQuickJumpOpen && platformSearchResults.length > 0 ? (
                    <div
                      ref={platformQuickJumpRef}
                      className="absolute left-3 right-3 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-indigo-100 bg-white shadow-xl"
                    >
                      {platformSearchResults.map((result) => (
                        <button
                          type="button"
                          key={`${result.type}-${result.id}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => selectPlatformSearchResult(result)}
                          className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-indigo-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold text-slate-900">
                              {result.title}
                            </span>
                            <span className="block truncate text-xs font-semibold text-slate-500">
                              {result.type} - {result.subtitle}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {result.health ? (
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${result.health.badgeClass}`}
                              >
                                <span
                                  className={`h-2 w-2 rounded-full ${result.health.dotClass}`}
                                />
                                {result.health.label}
                              </span>
                            ) : null}
                            {result.onSnapshot ? (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectPlatformSearchResult(result, "snapshot");
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    selectPlatformSearchResult(result, "snapshot");
                                  }
                                }}
                                className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700"
                              >
                                Snapshot
                              </span>
                            ) : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    [
                      "New issues",
                      openIssueCount,
                      "Open tester reports",
                      "border-rose-100 bg-rose-50 text-rose-700",
                      () => setPlatformAdminTab("issues"),
                    ],
                    [
                      "New accounts",
                      recentlyCreatedAccounts,
                      "Created this week",
                      "border-sky-100 bg-sky-50 text-sky-700",
                      () => {
                        setPlatformAccountFilter("all");
                        setPlatformAdminTab("accounts");
                      },
                    ],
                    [
                      "Inactive users",
                      inactiveUsersCount,
                      "Needs a look",
                      "border-amber-100 bg-amber-50 text-amber-700",
                      () => {
                        setPlatformAccountFilter("inactive");
                        setPlatformAdminTab("accounts");
                      },
                    ],
                  ].map(([label, value, detail, className, onClick]) => (
                    <button
                      type="button"
                      key={label}
                      onClick={onClick}
                      className={`rounded-2xl border px-2 py-2 text-left shadow-sm ${className}`}
                    >
                      <p className="truncate text-[10px] font-black uppercase tracking-[0.12em]">
                        {label}
                      </p>
                      <p className="mt-0.5 text-xl font-black leading-tight">
                        {value}
                      </p>
                      <p className="truncate text-[10px] font-bold opacity-80">
                        {detail}
                      </p>
                    </button>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {[
                    ["Logs today", platformData.overview?.logsToday],
                    ["Logs this week", platformData.overview?.logsThisWeek],
                    [
                      "Active users 7d",
                      platformData.overview?.activeUsersLast7Days,
                    ],
                    [
                      "New accounts 7d",
                      platformData.overview?.newAccountsThisWeek,
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-indigo-100 bg-white px-3 py-2 shadow-sm"
                    >
                      <p className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        {label}
                      </p>
                      <p className="mt-0.5 text-lg font-black text-slate-900">
                        {value ?? 0}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ["Families", platformData.overview?.families, "bg-indigo-500"],
                    ["Users", platformData.overview?.users, "bg-sky-500"],
                    ["Children", platformData.overview?.children, "bg-violet-500"],
                    ["Logs", platformData.overview?.careLogs, "bg-emerald-500"],
                    [
                      "Active subs",
                      platformData.overview?.activeSubscriptions,
                      "bg-teal-500",
                    ],
                    [
                      "Inactive subs",
                      platformData.overview?.inactiveSubscriptions,
                      "bg-amber-500",
                    ],
                  ].map(([label, value, accentClass]) => (
                    <div
                      key={label}
                      className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-white px-3 py-2.5 shadow-sm"
                    >
                      <span
                        className={`absolute left-0 top-0 h-full w-1 ${accentClass}`}
                      />
                      <p className="pl-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        {label}
                      </p>
                      <p className="mt-0.5 pl-1 text-xl font-black leading-tight text-slate-900 sm:text-2xl">
                        {value ?? 0}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 overflow-x-auto rounded-2xl border border-indigo-100 bg-white p-1.5 shadow-sm">
                  <div className="flex min-w-max gap-1.5">
                  {[
                    ["overview", "Overview"],
                    ["accounts", "Accounts"],
                    ["families", "Families"],
                    ["issues", "Issues"],
                    ["billing", "Billing"],
                  ].map(([tabId, label]) => (
                    <button
                      type="button"
                      key={tabId}
                      onClick={() => setPlatformAdminTab(tabId)}
                      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition sm:px-4 sm:text-sm ${
                        platformAdminTab === tabId
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "bg-slate-50 text-slate-700 hover:bg-indigo-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  </div>
                </div>

                {platformAdminTab === "overview" ? (
                  <section className="mt-3 rounded-2xl border border-indigo-100 bg-white p-3 shadow-sm sm:p-4">
                    <h3 className="font-bold text-slate-900">Platform overview</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Use the tabs above to manage accounts, families and billing
                      separately.
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => setPlatformAdminTab("accounts")}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50"
                      >
                        <p className="font-bold text-slate-900">Manage accounts</p>
                        <p className="mt-1 text-sm text-slate-600">
                          Edit users, reset passwords, change admin access and
                          review account activity.
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlatformAdminTab("families")}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50"
                      >
                        <p className="font-bold text-slate-900">Manage families</p>
                        <p className="mt-1 text-sm text-slate-600">
                          Add members, change family roles, review children and
                          inspect family activity.
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlatformAdminTab("issues")}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50"
                      >
                        <p className="font-bold text-slate-900">Review tester issues</p>
                        <p className="mt-1 text-sm text-slate-600">
                          See reports from families, check screenshots and update
                          support status.
                        </p>
                      </button>
                    </div>
                  </section>
                ) : null}

                {platformAdminTab === "issues" ? (
                  <IssueAdminPanel
                    issues={filteredPlatformIssues}
                    settings={feedbackSettings}
                    isSaving={isPlatformSaving || isIssueAdminLoading}
                    onRefresh={refreshPlatformIssues}
                    onToggleEnabled={updateFeedbackEnabled}
                    onStatusChange={updateIssueStatus}
                  />
                ) : null}

                {platformAdminTab === "billing" ? (
                <section className="mt-4 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900">
                        Billing and Stripe setup
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Platform settings for FamilyTrack subscriptions. Update these in{" "}
                        <span className="font-semibold text-slate-900">
                          {platformData.overview?.stripeSetup?.configFile || "backend/.env"}
                        </span>
                        .
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openPlatformAdmin}
                      className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 shadow-sm"
                    >
                      Refresh setup
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {[
                      [
                        "Stripe secret key",
                        platformData.overview?.stripeSetup?.hasSecretKey,
                      ],
                      [
                        "Recurring price ID",
                        platformData.overview?.stripeSetup?.hasPriceId,
                      ],
                      [
                        "Webhook secret",
                        platformData.overview?.stripeSetup?.hasWebhookSecret,
                      ],
                    ].map(([label, isReady]) => (
                      <div
                        key={label}
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                          isReady
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-amber-200 bg-amber-50 text-amber-800"
                        }`}
                      >
                        {label}: {isReady ? "set" : "needed"}
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                        Price ID
                      </p>
                      <p className="mt-1 break-all text-sm font-semibold text-slate-800">
                        {platformData.overview?.stripeSetup?.priceId ||
                          "Add STRIPE_PRICE_ID=price_..."}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                        Checkout route
                      </p>
                      <p className="mt-1 break-all text-sm font-semibold text-slate-800">
                        {platformData.overview?.stripeSetup?.checkoutRoute}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                        Webhook route
                      </p>
                      <p className="mt-1 break-all text-sm font-semibold text-slate-800">
                        {platformData.overview?.stripeSetup?.webhookRoute}
                      </p>
                    </div>
                  </div>
                </section>
                ) : null}

                {platformAdminTab === "families" || platformAdminTab === "accounts" ? (
                <div className="mt-4 grid gap-4">
                  {platformAdminTab === "families" ? (
                  <section className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
                    <h3 className="font-bold text-slate-900">Families</h3>
                    <div className="mt-3 space-y-2">
                      {filteredPlatformFamilies.map((family) => (
                        <div
                          key={family.id}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50"
                        >
                          <button
                            type="button"
                            onClick={() => openPlatformFamily(family.id)}
                            className="w-full text-left"
                          >
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <p className="font-semibold text-slate-900">
                              {family.name}
                            </p>
                            <span className="rounded-full bg-white px-2 py-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-600">
                              {family.subscriptionStatus}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-slate-600">
                            Owner: {family.ownerName || "Unknown"} ·{" "}
                            {family.ownerEmail || "No email"}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {family.memberCount} members · {family.childCount} children ·{" "}
                            {family.logCount} logs - Platform:{" "}
                            {family.platformStatus || "active"}
                          </p>
                          </button>
                          <div className="mt-2 flex flex-wrap gap-1.5 sm:justify-end">
                            {[
                              ["View", () => openPlatformFamily(family.id)],
                              ["Edit", () => openPlatformFamily(family.id)],
                              [
                                family.platformStatus === "suspended"
                                  ? "Activate"
                                  : "Deactivate",
                                () =>
                                  setPlatformFamilyStatus(
                                    family,
                                    family.platformStatus === "suspended"
                                      ? "active"
                                      : "suspended",
                                  ),
                              ],
                              [
                                "Snapshot",
                                () => openPlatformSnapshotForFamily(family.id),
                              ],
                            ].map(([label, onClick]) => (
                              <button
                                type="button"
                                key={label}
                                onClick={onClick}
                                disabled={isPlatformSaving}
                                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-sm disabled:opacity-50"
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                  ) : null}

                  {platformAdminTab === "accounts" ? (
                  <section className="grid gap-4 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm lg:grid-cols-[minmax(260px,360px)_1fr]">
                    <div>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-bold text-slate-900">Accounts</h3>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                        {filteredPlatformUsers.length}
                      </span>
                    </div>
                    <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                      {[
                        ["all", "All"],
                        ["active-today", "Active today"],
                        ["last-7-days", "Last 7 days"],
                        ["inactive", "Inactive"],
                        ["never", "Never logged in"],
                      ].map(([filterId, label]) => (
                        <button
                          type="button"
                          key={filterId}
                          onClick={() => setPlatformAccountFilter(filterId)}
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                            platformAccountFilter === filterId
                              ? "bg-indigo-600 text-white shadow-sm"
                              : "bg-slate-100 text-slate-600 hover:bg-indigo-50"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 max-h-[640px] space-y-2 overflow-y-auto pr-1">
                      {filteredPlatformUsers.map((user) => {
                        const health = accountHealthForUser(user);
                        return (
                        <div
                          key={user.id}
                          className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                            selectedPlatformUser?.user?.id === user.id
                              ? "border-indigo-300 bg-indigo-50"
                              : "border-slate-200 bg-slate-50 hover:border-indigo-200 hover:bg-indigo-50"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => openPlatformUser(user.id)}
                            className="w-full text-left"
                          >
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <p className="font-semibold text-slate-900">
                              {user.fullName}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold ${health.badgeClass}`}
                              >
                                <span
                                  className={`h-2 w-2 rounded-full ${health.dotClass}`}
                                />
                                {health.label}
                              </span>
                              <span className="rounded-full bg-white px-2 py-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-600">
                                {user.platformStatus || "active"}
                              </span>
                              {user.isPlatformAdmin ? (
                                <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-bold uppercase tracking-[0.12em] text-indigo-700">
                                  Admin
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <p className="mt-1 text-sm text-slate-600">{user.email}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {user.familyCount} families - {user.logCount || 0} logs
                            {" - "}Last seen: {lastSeenLabel(user.lastLoginAt)}
                          </p>
                          </button>
                          <div className="mt-2 flex flex-wrap gap-1.5 sm:justify-end">
                            {[
                              ["View", () => openPlatformUser(user.id)],
                              ["Edit", () => openPlatformUser(user.id)],
                              [
                                user.platformStatus === "suspended"
                                  ? "Activate"
                                  : "Deactivate",
                                () =>
                                  setPlatformUserStatus(
                                    user,
                                    user.platformStatus === "suspended"
                                      ? "active"
                                      : "suspended",
                                  ),
                              ],
                              [
                                "Reset",
                                () => createPlatformPasswordReset(user.id),
                              ],
                              [
                                "Snapshot",
                                () => openPlatformSnapshotForUser(user.id),
                              ],
                              [
                                "View as",
                                () => startPlatformViewAsUser(user.id),
                              ],
                            ].map(([label, onClick]) => (
                              <button
                                type="button"
                                key={label}
                                onClick={onClick}
                                disabled={isPlatformSaving || isUserDetailLoading}
                                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-sm disabled:opacity-50"
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    </div>

                    {selectedPlatformUser ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                              Account details
                            </p>
                            <h4 className="text-lg font-bold text-slate-900">
                              {selectedPlatformUser.user.fullName}
                            </h4>
                          </div>
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-600">
                            {selectedPlatformUser.user.platformStatus || "active"}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                              Last login
                            </p>
                            <p className="mt-0.5 text-sm font-bold text-slate-900">
                              {formatPlatformDateTime(
                                selectedPlatformUser.user.lastLoginAt,
                              )}
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                              Account created
                            </p>
                            <p className="mt-0.5 text-sm font-bold text-slate-900">
                              {formatPlatformDateTime(
                                selectedPlatformUser.user.createdAt,
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setPlatformUserStatus(
                                selectedPlatformUser.user,
                                selectedPlatformUser.user.platformStatus ===
                                  "suspended"
                                  ? "active"
                                  : "suspended",
                              )
                            }
                            disabled={isPlatformSaving}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm disabled:opacity-50"
                          >
                            {selectedPlatformUser.user.platformStatus === "suspended"
                              ? "Activate"
                              : "Deactivate"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              createPlatformPasswordReset(
                                selectedPlatformUser.user.id,
                              )
                            }
                            disabled={isPlatformSaving}
                            className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 shadow-sm disabled:opacity-50"
                          >
                            Send password reset
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openPlatformSnapshotForUser(
                                selectedPlatformUser.user.id,
                              )
                            }
                            disabled={isPlatformSnapshotLoading}
                            className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800 shadow-sm disabled:opacity-50"
                          >
                            View Snapshot
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              startPlatformViewAsUser(
                                selectedPlatformUser.user.id,
                              )
                            }
                            disabled={isUserDetailLoading}
                            className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-800 shadow-sm disabled:opacity-50"
                          >
                            View as user
                          </button>
                        </div>

                        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <label className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                              Full name
                            </label>
                            <input
                              className={inputClass}
                              value={selectedPlatformUser.user.fullName || ""}
                              onChange={(event) =>
                                updatePlatformUserField(
                                  "fullName",
                                  event.target.value,
                                )
                              }
                              placeholder="Full name"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                              Email
                            </label>
                            <input
                              className={inputClass}
                              type="email"
                              value={selectedPlatformUser.user.email || ""}
                              onChange={(event) =>
                                updatePlatformUserField(
                                  "email",
                                  event.target.value,
                                )
                              }
                              placeholder="email@example.com"
                            />
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div>
                            <label className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                              Account status
                            </label>
                            <select
                              className={inputClass}
                              value={
                                selectedPlatformUser.user.platformStatus ||
                                "active"
                              }
                              onChange={(event) =>
                                updatePlatformUserField(
                                  "platformStatus",
                                  event.target.value,
                                )
                              }
                            >
                              <option value="active">Active</option>
                              <option value="watch">Watch</option>
                              <option value="suspended">Suspended</option>
                            </select>
                          </div>
                          <label className="mt-7 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">
                            <input
                              type="checkbox"
                              checked={Boolean(
                                selectedPlatformUser.user.isPlatformAdmin,
                              )}
                              onChange={(event) =>
                                updatePlatformUserField(
                                  "isPlatformAdmin",
                                  event.target.checked,
                                )
                              }
                            />
                            Platform admin access
                          </label>
                        </div>

                        <label className="mt-3 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                          Internal notes
                        </label>
                        <textarea
                          className={inputClass}
                          rows={3}
                          value={
                            selectedPlatformUser.user.platformAdminNotes || ""
                          }
                          onChange={(event) =>
                            updatePlatformUserField(
                              "platformAdminNotes",
                              event.target.value,
                            )
                          }
                          placeholder="Private account notes"
                        />

                        <button
                          type="button"
                          onClick={savePlatformUserControls}
                          disabled={isPlatformSaving}
                          className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                        >
                          {isPlatformSaving ? "Saving..." : "Save account details"}
                        </button>
                        </div>

                        <form
                          className="mt-4 rounded-xl border border-amber-200 bg-white p-4"
                          onSubmit={resetPlatformUserPassword}
                        >
                          <h5 className="font-bold text-slate-900">
                            Reset password
                          </h5>
                          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                            <input
                              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                              type="password"
                              value={platformPasswordForm.password}
                              onChange={(event) =>
                                setPlatformPasswordForm({
                                  password: event.target.value,
                                })
                              }
                              placeholder="Temporary password"
                              minLength={10}
                              required
                            />
                            <button
                              type="submit"
                              disabled={isPlatformSaving}
                              className="rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                            >
                              Set password
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50 p-6 text-sm font-semibold text-indigo-700">
                        Select an account to edit details, reset a password, or
                        change admin access.
                      </div>
                    )}
                  </section>
                  ) : null}
                </div>
                ) : null}

                {platformAdminTab === "families" ? (
                <section className="mt-4 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-bold text-slate-900">Family detail</h3>
                    {isFamilyDetailLoading ? (
                      <span className="text-sm font-semibold text-slate-500">
                        Loading...
                      </span>
                    ) : null}
                  </div>

                  {!selectedPlatformFamily ? (
                    <p className="mt-3 text-sm text-slate-600">
                      Select a family above to inspect support details.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setPlatformFamilyStatus(
                              selectedPlatformFamily.family,
                              selectedPlatformFamily.family.platformStatus ===
                                "suspended"
                                ? "active"
                                : "suspended",
                            )
                          }
                          disabled={isPlatformSaving}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm disabled:opacity-50"
                        >
                          {selectedPlatformFamily.family.platformStatus ===
                          "suspended"
                            ? "Activate family"
                            : "Deactivate family"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            openPlatformSnapshotForFamily(
                              selectedPlatformFamily.family.id,
                            )
                          }
                          disabled={isPlatformSnapshotLoading}
                          className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800 shadow-sm disabled:opacity-50"
                        >
                          View Snapshot
                        </button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            Family
                          </p>
                          <p className="mt-1 font-bold text-slate-900">
                            {selectedPlatformFamily.family.name}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            Owner
                          </p>
                          <p className="mt-1 font-bold text-slate-900">
                            {selectedPlatformFamily.family.ownerName || "Unknown"}
                          </p>
                          <p className="text-sm text-slate-600">
                            {selectedPlatformFamily.family.ownerEmail}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            Subscription
                          </p>
                          <p className="mt-1 font-bold text-slate-900">
                            {selectedPlatformFamily.family.subscriptionStatus}
                          </p>
                          <p className="text-sm text-slate-600">
                            {selectedPlatformFamily.family.plan}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            Stripe
                          </p>
                          <p className="mt-1 break-all text-sm font-semibold text-slate-700">
                            {selectedPlatformFamily.family.stripeCustomerId ||
                              "Not connected"}
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-3">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <h4 className="font-bold text-slate-900">Members</h4>
                          <div className="mt-2 space-y-2">
                            {selectedPlatformFamily.members.map((member) => (
                              <div key={member.id} className="text-sm">
                                <p className="font-semibold text-slate-800">
                                  {member.fullName}
                                </p>
                                <p className="text-slate-600">
                                  {member.email} · {member.role}
                                </p>
                              </div>
                            ))}
                          </div>
                          <div className="mt-4 space-y-2">
                            {selectedPlatformFamily.members.map((member) => (
                              <div
                                key={`controls-${member.id}`}
                                className="rounded-xl border border-slate-200 bg-white p-3 text-sm"
                              >
                                <p className="font-bold text-slate-900">
                                  Manage {member.fullName}
                                </p>
                                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                                  <select
                                    className={inputClass}
                                    value={member.role}
                                    onChange={(event) =>
                                      updatePlatformFamilyMemberRole(
                                        member.id,
                                        event.target.value,
                                      )
                                    }
                                  >
                                    <option value="owner">Owner</option>
                                    <option value="parent">Parent</option>
                                    <option value="carer">Carer</option>
                                    <option value="viewer">Viewer</option>
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      removePlatformFamilyMember(member.id)
                                    }
                                    disabled={isPlatformSaving}
                                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 disabled:opacity-60"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <form
                            className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3"
                            onSubmit={addPlatformFamilyMember}
                          >
                            <h5 className="font-bold text-slate-900">
                              Add user to family
                            </h5>
                            <label className="mt-3 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                              Email
                            </label>
                            <input
                              className={inputClass}
                              type="email"
                              value={platformMemberForm.email}
                              onChange={(event) =>
                                setPlatformMemberForm((current) => ({
                                  ...current,
                                  email: event.target.value,
                                }))
                              }
                              placeholder="user@example.com"
                              required
                            />
                            <label className="mt-3 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                              Role
                            </label>
                            <select
                              className={inputClass}
                              value={platformMemberForm.role}
                              onChange={(event) =>
                                setPlatformMemberForm((current) => ({
                                  ...current,
                                  role: event.target.value,
                                }))
                              }
                            >
                              <option value="owner">Owner</option>
                              <option value="parent">Parent</option>
                              <option value="carer">Carer</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <button
                              type="submit"
                              disabled={isPlatformSaving}
                              className="mt-3 w-full rounded-xl bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                            >
                              {isPlatformSaving
                                ? "Adding..."
                                : "Add or invite user"}
                            </button>
                          </form>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <h4 className="font-bold text-slate-900">Children</h4>
                          <div className="mt-2 space-y-2">
                            {selectedPlatformFamily.children.map((child) => (
                              <div key={child.id} className="text-sm">
                                <p className="font-semibold text-slate-800">
                                  {child.firstName} {child.lastName || ""}
                                </p>
                                <p className="text-slate-600">
                                  DOB: {child.dateOfBirth || "Not set"}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <h4 className="font-bold text-slate-900">
                            Platform controls
                          </h4>
                          <label className="mt-3 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            Workspace status
                          </label>
                          <select
                            className={inputClass}
                            value={
                              selectedPlatformFamily.family.platformStatus ||
                              "active"
                            }
                            onChange={(event) =>
                              updatePlatformFamilyField(
                                "platformStatus",
                                event.target.value,
                              )
                            }
                          >
                            <option value="active">Active</option>
                            <option value="watch">Watch</option>
                            <option value="suspended">Suspended</option>
                          </select>
                          <label className="mt-3 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            Internal notes
                          </label>
                          <textarea
                            className={inputClass}
                            rows={4}
                            value={
                              selectedPlatformFamily.family.platformAdminNotes ||
                              ""
                            }
                            onChange={(event) =>
                              updatePlatformFamilyField(
                                "platformAdminNotes",
                                event.target.value,
                              )
                            }
                            placeholder="Private platform notes"
                          />
                          <div className="mt-3 grid gap-2">
                            <button
                              type="button"
                              onClick={savePlatformFamilyControls}
                              disabled={isPlatformSaving}
                              className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                            >
                              {isPlatformSaving ? "Saving..." : "Save controls"}
                            </button>
                            <button
                              type="button"
                              onClick={syncPlatformFamilyStripe}
                              disabled={isPlatformSaving}
                              className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-indigo-700 disabled:opacity-60"
                            >
                              Sync Stripe status
                            </button>
                            {selectedPlatformFamily.family.stripeCustomerUrl ? (
                              <a
                                href={selectedPlatformFamily.family.stripeCustomerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-sm font-bold text-slate-700"
                              >
                                Open Stripe customer
                              </a>
                            ) : null}
                            {selectedPlatformFamily.family.stripeSubscriptionUrl ? (
                              <a
                                href={
                                  selectedPlatformFamily.family
                                    .stripeSubscriptionUrl
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-sm font-bold text-slate-700"
                              >
                                Open Stripe subscription
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <h4 className="font-bold text-slate-900">Recent logs</h4>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {selectedPlatformFamily.recentLogs.map((log) => (
                            <div
                              key={log.id}
                              className="rounded-xl border border-slate-200 bg-white p-3 text-sm"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-bold capitalize text-slate-900">
                                  {log.category}
                                </p>
                                <span className="text-xs font-semibold text-slate-500">
                                  {log.logDate} {log.logTime || ""}
                                </span>
                              </div>
                              <p className="mt-1 text-slate-600">
                                {log.childFirstName} · {log.createdByName}
                              </p>
                              {log.notes ? (
                                <p className="mt-1 text-slate-700">{log.notes}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <h4 className="font-bold text-slate-900">
                          Platform audit history
                        </h4>
                        <div className="mt-2 space-y-2">
                          {selectedPlatformFamily.auditLogs?.length ? (
                            selectedPlatformFamily.auditLogs.map((auditLog) => (
                              <div
                                key={auditLog.id}
                                className="rounded-xl border border-slate-200 bg-white p-3 text-sm"
                              >
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                  <p className="font-bold text-slate-900">
                                    {auditLog.action}
                                  </p>
                                  <p className="text-xs font-semibold text-slate-500">
                                    {new Date(auditLog.createdAt).toLocaleString()}
                                  </p>
                                </div>
                                <p className="mt-1 text-slate-600">
                                  {auditLog.adminName ||
                                    auditLog.adminEmail ||
                                    "System"}
                                </p>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate-600">
                              No platform audit entries for this family yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </section>
                ) : null}

                {false ? (
                <section className="mt-4 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-bold text-slate-900">User detail</h3>
                    {isUserDetailLoading ? (
                      <span className="text-sm font-semibold text-slate-500">
                        Loading...
                      </span>
                    ) : null}
                  </div>

                  {!selectedPlatformUser ? (
                    <p className="mt-3 text-sm text-slate-600">
                      Select a user above to inspect account controls.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-3 md:grid-cols-4">
                        {[
                          [
                            "Created",
                            selectedPlatformUser.user.createdAt
                              ? new Date(
                                  selectedPlatformUser.user.createdAt,
                                ).toLocaleDateString()
                              : "Unknown",
                          ],
                          [
                            "Last login",
                            selectedPlatformUser.user.lastLoginAt
                              ? new Date(
                                  selectedPlatformUser.user.lastLoginAt,
                                ).toLocaleString()
                              : "Never",
                          ],
                          [
                            "Families",
                            selectedPlatformUser.activity?.familyCount || 0,
                          ],
                          ["Logs", selectedPlatformUser.activity?.logCount || 0],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                          >
                            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                              {label}
                            </p>
                            <p className="mt-1 font-bold text-slate-900">
                              {value}
                            </p>
                          </div>
                        ))}
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                          Account details
                        </p>
                        <label className="mt-3 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                          Full name
                        </label>
                        <input
                          className={inputClass}
                          value={selectedPlatformUser.user.fullName || ""}
                          onChange={(event) =>
                            updatePlatformUserField("fullName", event.target.value)
                          }
                          placeholder="Full name"
                        />

                        <label className="mt-3 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                          Email
                        </label>
                        <input
                          className={inputClass}
                          type="email"
                          value={selectedPlatformUser.user.email || ""}
                          onChange={(event) =>
                            updatePlatformUserField("email", event.target.value)
                          }
                          placeholder="email@example.com"
                        />

                        <label className="mt-4 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                          Account status
                        </label>
                        <select
                          className={inputClass}
                          value={selectedPlatformUser.user.platformStatus || "active"}
                          onChange={(event) =>
                            updatePlatformUserField(
                              "platformStatus",
                              event.target.value,
                            )
                          }
                        >
                          <option value="active">Active</option>
                          <option value="watch">Watch</option>
                          <option value="suspended">Suspended</option>
                        </select>

                        <label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(
                              selectedPlatformUser.user.isPlatformAdmin,
                            )}
                            onChange={(event) =>
                              updatePlatformUserField(
                                "isPlatformAdmin",
                                event.target.checked,
                              )
                            }
                          />
                          Platform admin access
                        </label>

                        <label className="mt-3 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                          Internal notes
                        </label>
                        <textarea
                          className={inputClass}
                          rows={4}
                          value={
                            selectedPlatformUser.user.platformAdminNotes || ""
                          }
                          onChange={(event) =>
                            updatePlatformUserField(
                              "platformAdminNotes",
                              event.target.value,
                            )
                          }
                          placeholder="Private user notes"
                        />

                        <button
                          type="button"
                          onClick={savePlatformUserControls}
                          disabled={isPlatformSaving}
                          className="mt-3 w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                        >
                          {isPlatformSaving ? "Saving..." : "Save user controls"}
                        </button>

                        <form
                          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3"
                          onSubmit={resetPlatformUserPassword}
                        >
                          <h5 className="font-bold text-slate-900">
                            Reset password
                          </h5>
                          <p className="mt-1 text-sm text-amber-800">
                            Set a temporary password for this user. Passwords are
                            hashed by the backend.
                          </p>
                          <label className="mt-3 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            Temporary password
                          </label>
                          <input
                            className={inputClass}
                            type="password"
                            value={platformPasswordForm.password}
                            onChange={(event) =>
                              setPlatformPasswordForm({
                                password: event.target.value,
                              })
                            }
                            placeholder="At least 10 characters"
                            minLength={10}
                            required
                          />
                          <button
                            type="submit"
                            disabled={isPlatformSaving}
                            className="mt-3 w-full rounded-xl bg-amber-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                          >
                            {isPlatformSaving
                              ? "Resetting..."
                              : "Set temporary password"}
                          </button>
                        </form>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <h4 className="font-bold text-slate-900">
                          Family memberships
                        </h4>
                        <div className="mt-2 space-y-2">
                          {selectedPlatformUser.memberships.length ? (
                            selectedPlatformUser.memberships.map((membership) => (
                              <button
                                type="button"
                                key={membership.id}
                                onClick={() =>
                                  openPlatformFamily(membership.familyId)
                                }
                                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left text-sm transition hover:border-indigo-200 hover:bg-indigo-50"
                              >
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                  <p className="font-bold text-slate-900">
                                    {membership.familyName}
                                  </p>
                                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-600">
                                    {membership.role}
                                  </span>
                                </div>
                                <p className="mt-1 text-slate-600">
                                  Subscription: {membership.subscriptionStatus} -
                                  Platform:{" "}
                                  {membership.familyPlatformStatus || "active"}
                                </p>
                              </button>
                            ))
                          ) : (
                            <p className="text-sm text-slate-600">
                              This user is not currently joined to any families.
                            </p>
                          )}
                        </div>
                      </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <h4 className="font-bold text-slate-900">
                            Recent account activity
                          </h4>
                          <div className="mt-2 space-y-2">
                            {selectedPlatformUser.recentLogs?.length ? (
                              selectedPlatformUser.recentLogs.map((log) => (
                                <div
                                  key={log.id}
                                  className="rounded-xl border border-slate-200 bg-white p-3 text-sm"
                                >
                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                    <p className="font-bold capitalize text-slate-900">
                                      {log.category}
                                    </p>
                                    <p className="text-xs font-semibold text-slate-500">
                                      {log.logDate} {log.logTime || ""}
                                    </p>
                                  </div>
                                  <p className="mt-1 text-slate-600">
                                    {log.familyName} - {log.childFirstName}
                                  </p>
                                  {log.notes ? (
                                    <p className="mt-1 text-slate-700">
                                      {log.notes}
                                    </p>
                                  ) : null}
                                </div>
                              ))
                            ) : (
                              <p className="text-sm text-slate-600">
                                No care logs have been created by this account yet.
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <h4 className="font-bold text-slate-900">
                            Account audit history
                          </h4>
                          <div className="mt-2 space-y-2">
                            {selectedPlatformUser.auditLogs?.length ? (
                              selectedPlatformUser.auditLogs.map((auditLog) => (
                                <div
                                  key={auditLog.id}
                                  className="rounded-xl border border-slate-200 bg-white p-3 text-sm"
                                >
                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                    <p className="font-bold text-slate-900">
                                      {auditLog.action}
                                    </p>
                                    <p className="text-xs font-semibold text-slate-500">
                                      {new Date(
                                        auditLog.createdAt,
                                      ).toLocaleString()}
                                    </p>
                                  </div>
                                  <p className="mt-1 text-slate-600">
                                    {auditLog.adminName ||
                                      auditLog.adminEmail ||
                                      "System"}
                                  </p>
                                </div>
                              ))
                            ) : (
                              <p className="text-sm text-slate-600">
                                No account admin changes recorded yet.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {!showAdmin && !showPlatformAdmin ? (
      <>
      <KaylenCareMonitorDashboard
        familyId={selectedFamily.familyId}
        childId={selectedChild.id}
        childName={selectedChild.firstName || selectedChild.first_name}
        childDetails={selectedChild}
        familyDetails={selectedFamily}
        children={children}
        selectedChildId={selectedChildId}
        onSelectChild={selectChild}
        onAddRegularMedication={addRegularMedicationFromDiary}
        customFoodOptions={groupedCareOptions.food}
        customMedicationOptions={groupedCareOptions.medication}
        customGivenByOptions={groupedCareOptions.givenBy}
        customLocationOptions={groupedCareOptions.locations}
        onCreateCareOption={addCareOptionFromDiary}
        childProfile={childProfile}
        importantEvents={importantEvents}
        useSaasApi
      />
      </>
      ) : null}
      {platformSnapshot ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 px-3 py-5">
          <div className="mx-auto max-w-3xl rounded-[1.5rem] border border-cyan-100 bg-white shadow-2xl">
            <div className="sticky top-3 z-10 flex items-start justify-between gap-3 rounded-t-[1.5rem] border-b border-cyan-100 bg-cyan-50 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-700">
                  Read-only Care Snapshot
                </p>
                <h3 className="truncate text-lg font-black text-slate-950">
                  {platformSnapshot.family?.name ||
                    platformSnapshot.user?.fullName ||
                    "FamilyTrack account"}
                </h3>
                <p className="text-xs font-semibold text-slate-600">
                  Owner Platform quick view
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlatformSnapshot(null)}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm"
              >
                Close
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    Family
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {platformSnapshot.family?.name || "Not linked"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    Owner
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {platformSnapshot.family?.ownerName ||
                      platformSnapshot.user?.fullName ||
                      "Unknown"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    Children
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {platformSnapshot.children?.length || 0}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    Subscription
                  </p>
                  <p className="mt-1 text-sm font-bold capitalize text-slate-900">
                    {platformSnapshot.family?.subscriptionStatus || "Unknown"}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <section className="rounded-2xl border border-indigo-100 bg-indigo-50 p-3">
                  <h4 className="text-sm font-black text-slate-900">
                    Children
                  </h4>
                  <div className="mt-2 space-y-2">
                    {(platformSnapshot.children || []).map((child) => (
                      <div
                        key={child.id}
                        className="rounded-xl border border-white bg-white/80 px-3 py-2 text-sm"
                      >
                        <p className="font-bold text-slate-900">
                          {child.firstName} {child.lastName || ""}
                        </p>
                        <p className="text-xs font-semibold text-slate-500">
                          DOB: {child.dateOfBirth || "Not set"}
                        </p>
                      </div>
                    ))}
                    {!platformSnapshot.children?.length ? (
                      <p className="text-sm font-semibold text-slate-600">
                        No children found for this snapshot.
                      </p>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                  <h4 className="text-sm font-black text-slate-900">
                    Members
                  </h4>
                  <div className="mt-2 space-y-2">
                    {(platformSnapshot.members || []).slice(0, 6).map((member) => (
                      <div
                        key={member.id}
                        className="rounded-xl border border-white bg-white/80 px-3 py-2 text-sm"
                      >
                        <p className="font-bold text-slate-900">
                          {member.fullName}
                        </p>
                        <p className="text-xs font-semibold text-slate-500">
                          {member.email} - {member.role}
                        </p>
                      </div>
                    ))}
                    {!platformSnapshot.members?.length ? (
                      <p className="text-sm font-semibold text-slate-600">
                        No members found for this snapshot.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>

              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-black text-slate-900">
                  Recent care activity
                </h4>
                <div className="mt-2 space-y-2">
                  {(platformSnapshot.recentLogs || []).slice(0, 10).map((log) => (
                    <div
                      key={log.id}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <p className="font-bold capitalize text-slate-900">
                          {log.category} - {log.childFirstName || "Child"}
                        </p>
                        <p className="text-xs font-semibold text-slate-500">
                          {log.logDate} {log.logTime || ""}
                        </p>
                      </div>
                      {log.notes ? (
                        <p className="mt-1 text-slate-700">{log.notes}</p>
                      ) : null}
                    </div>
                  ))}
                  {!platformSnapshot.recentLogs?.length ? (
                    <p className="text-sm font-semibold text-slate-600">
                      No recent logs found.
                    </p>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
      {resolvedIssueNotice ? (
        <div className="fixed bottom-20 right-4 z-[9998] max-w-[20rem] rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 shadow-xl">
          <div className="flex items-start gap-3">
            <p>{resolvedIssueNotice}</p>
            <button
              type="button"
              onClick={() => setResolvedIssueNotice("")}
              className="rounded-full bg-white px-2 py-0.5 text-xs font-black text-emerald-700"
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
      <ReportIssueWidget
        enabled={isFeedbackEnabled}
        selectedChild={selectedChild}
        selectedFamily={selectedFamily}
        selectedChildId={selectedChildId}
        selectedFamilyId={selectedFamilyId}
      />
    </div>
  );
}

export default function SaasApp() {
  const [session, setSession] = useState(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [publicView, setPublicView] = useState("landing");

  useEffect(() => {
    let ignore = false;

    async function checkSession() {
      try {
        const data = await api.me();
        if (!ignore) setSession(data);
      } catch (error) {
        if (!ignore) setSession(null);
      } finally {
        if (!ignore) setIsCheckingSession(false);
      }
    }

    checkSession();
    return () => {
      ignore = true;
    };
  }, []);

  const logout = async () => {
    await api.logout().catch(() => null);
    setSession(null);
  };

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-700">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          Opening FamilyTrack...
        </div>
      </div>
    );
  }

  if (!session) {
    if (publicView === "auth") {
      return (
        <AuthScreen
          initialMode="signup"
          onAuthenticated={setSession}
          onBack={() => setPublicView("landing")}
        />
      );
    }

    if (publicView === "login") {
      return (
        <AuthScreen
          initialMode="login"
          onAuthenticated={setSession}
          onBack={() => setPublicView("landing")}
        />
      );
    }

    return (
      <LandingPage
        onStartFree={() => setPublicView("auth")}
        onLogin={() => setPublicView("login")}
      />
    );
  }

  return <WorkspaceGate session={session} onLogout={logout} />;
}
