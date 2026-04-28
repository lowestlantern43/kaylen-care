import { useEffect, useMemo, useState } from "react";
import { api } from "./api/client";
import KaylenCareMonitorDashboard from "./KaylenCareMonitorDashboard";

const inputClass =
  "mt-2 w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

const buttonClass =
  "flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-4 text-base font-semibold text-white shadow-md transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClass =
  "flex w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

const avatarUrlForChild = (child) => child?.avatarUrl || child?.avatar_url || "";

function ChildAvatar({ child, active = false, size = "sm" }) {
  const avatarUrl = avatarUrlForChild(child);
  const sizeClass = size === "lg" ? "h-14 w-14" : "h-8 w-8";
  const iconSizeClass = size === "lg" ? "h-7 w-7" : "h-4 w-4";

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`${sizeClass} rounded-full object-cover ring-2 ${
          active ? "ring-indigo-200" : "ring-white"
        }`}
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

function WorkspaceGate({ session, onLogout }) {
  const normalizeFamily = (family) => ({
    familyId: family.familyId || family.id,
    familyName: family.familyName || family.name,
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
  const [platformSearch, setPlatformSearch] = useState("");
  const [selectedPlatformFamily, setSelectedPlatformFamily] = useState(null);
  const [selectedPlatformUser, setSelectedPlatformUser] = useState(null);
  const [isPlatformLoading, setIsPlatformLoading] = useState(false);
  const [isFamilyDetailLoading, setIsFamilyDetailLoading] = useState(false);
  const [isUserDetailLoading, setIsUserDetailLoading] = useState(false);
  const [isPlatformSaving, setIsPlatformSaving] = useState(false);
  const [platformActionMessage, setPlatformActionMessage] = useState("");
  const [platformMemberForm, setPlatformMemberForm] = useState({
    email: "",
    role: "parent",
  });
  const [platformPasswordForm, setPlatformPasswordForm] = useState({
    password: "",
  });
  const [platformAdminTab, setPlatformAdminTab] = useState("overview");

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
  }, [selectedFamily?.familyName]);

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
        if (!ignore) setChildProfile({ ...emptyChildProfile, ...profile });
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
      });
      setFamilies((current) =>
        current.map((family) =>
          family.familyId === selectedFamilyId
            ? { ...family, familyName: updated.name }
            : family,
        ),
      );
      setAccountMessage("Family name updated.");
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
        avatarObjectKey: childEditForm.avatarObjectKey,
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
      const upload = await api.signProfilePhotoUpload({
        familyId: selectedFamilyId,
        childId: selectedChildId,
        fileName: file.name,
        fileType: file.type,
      });

      await api.uploadToSignedUrl(upload.signedUploadUrl, file);

      const updated = await api.updateChild(selectedFamilyId, selectedChildId, {
        firstName: childEditForm.firstName,
        lastName: childEditForm.lastName,
        dateOfBirth: childEditForm.dateOfBirth,
        nhsNumber: childEditForm.nhsNumber,
        avatarUrl: upload.publicUrl,
        avatarObjectKey: upload.objectKey,
        notes: childEditForm.notes,
      });

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
      const profile = await api.updateChildProfile(
        selectedFamilyId,
        selectedChildId,
        childProfile,
      );
      setChildProfile({ ...emptyChildProfile, ...profile });
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSavingProfile(false);
    }
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
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsPlatformLoading(false);
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

  const filteredPlatformFamilies = platformData.families.filter((family) => {
    const haystack = [
      family.name,
      family.ownerName,
      family.ownerEmail,
      family.subscriptionStatus,
      family.platformStatus,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(platformSearch.toLowerCase());
  });

  const filteredPlatformUsers = platformData.users.filter((user) => {
    const haystack = [user.fullName, user.email, user.platformStatus]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(platformSearch.toLowerCase());
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
                  className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"
                  onSubmit={saveFamilyProfile}
                >
                  <input
                    className={`${inputClass} mt-0`}
                    value={familyEditName}
                    onChange={(event) => setFamilyEditName(event.target.value)}
                    placeholder="Family name"
                  />
                  <button
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isSavingFamily || !familyEditName.trim()}
                  >
                    {isSavingFamily ? "Saving..." : "Save family"}
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
                  <div className="grid gap-3 md:grid-cols-2">
                    {[
                      ["diagnosisNeeds", "Diagnosis / needs"],
                      ["communicationStyle", "Communication style"],
                      ["keyNeeds", "Key needs"],
                      ["currentMedications", "Current medications and doses"],
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
        <div className="min-h-screen bg-indigo-50 px-4 py-5">
          <div className="mx-auto max-w-6xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-600">
                  Platform admin
                </p>
                <h2 className="text-lg font-bold text-slate-900">
                  FamilyTrack SaaS
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowPlatformAdmin(false)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
              >
                Back to diary
              </button>
            </div>

            {error ? (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {error}
              </p>
            ) : null}

            {isPlatformLoading ? (
              <div className="mt-4 rounded-2xl border border-indigo-100 bg-white p-4 text-sm font-semibold text-slate-600">
                Loading platform dashboard...
              </div>
            ) : (
              <>
                <div className="mt-4 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
                  <label className="text-sm font-bold text-slate-700">
                    Search platform data
                  </label>
                  <input
                    className={inputClass}
                    value={platformSearch}
                    onChange={(event) => setPlatformSearch(event.target.value)}
                    placeholder="Search family, owner, user, email, subscription"
                  />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  {[
                    ["Families", platformData.overview?.families],
                    ["Users", platformData.overview?.users],
                    ["Children", platformData.overview?.children],
                    ["Logs", platformData.overview?.careLogs],
                    ["Active subs", platformData.overview?.activeSubscriptions],
                    ["Inactive subs", platformData.overview?.inactiveSubscriptions],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm"
                    >
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                        {label}
                      </p>
                      <p className="mt-1 text-2xl font-bold text-slate-900">
                        {value ?? 0}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex gap-2 overflow-x-auto rounded-2xl border border-indigo-100 bg-white p-2 shadow-sm">
                  {[
                    ["overview", "Overview"],
                    ["accounts", "Accounts"],
                    ["families", "Families"],
                    ["billing", "Billing"],
                  ].map(([tabId, label]) => (
                    <button
                      type="button"
                      key={tabId}
                      onClick={() => setPlatformAdminTab(tabId)}
                      className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition ${
                        platformAdminTab === tabId
                          ? "bg-indigo-600 text-white"
                          : "bg-slate-50 text-slate-700 hover:bg-indigo-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {platformAdminTab === "overview" ? (
                  <section className="mt-4 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
                    <h3 className="font-bold text-slate-900">Platform overview</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Use the tabs above to manage accounts, families and billing
                      separately.
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setPlatformAdminTab("accounts")}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-indigo-200 hover:bg-indigo-50"
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
                        className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-indigo-200 hover:bg-indigo-50"
                      >
                        <p className="font-bold text-slate-900">Manage families</p>
                        <p className="mt-1 text-sm text-slate-600">
                          Add members, change family roles, review children and
                          inspect family activity.
                        </p>
                      </button>
                    </div>
                  </section>
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
                        <button
                          type="button"
                          key={family.id}
                          onClick={() => openPlatformFamily(family.id)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50"
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
                    <div className="mt-3 max-h-[640px] space-y-2 overflow-y-auto pr-1">
                      {filteredPlatformUsers.map((user) => (
                        <button
                          type="button"
                          key={user.id}
                          onClick={() => openPlatformUser(user.id)}
                          className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                            selectedPlatformUser?.user?.id === user.id
                              ? "border-indigo-300 bg-indigo-50"
                              : "border-slate-200 bg-slate-50 hover:border-indigo-200 hover:bg-indigo-50"
                          }`}
                        >
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <p className="font-semibold text-slate-900">
                              {user.fullName}
                            </p>
                            <div className="flex flex-wrap gap-2">
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
                            {user.lastLoginAt
                              ? ` - Last login ${new Date(
                                  user.lastLoginAt,
                                ).toLocaleDateString()}`
                              : " - Never logged in"}
                          </p>
                        </button>
                      ))}
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
      <KaylenCareMonitorDashboard
        familyId={selectedFamily.familyId}
        childId={selectedChild.id}
        childName={selectedChild.firstName || selectedChild.first_name}
        childDetails={selectedChild}
        customFoodOptions={groupedCareOptions.food}
        customMedicationOptions={groupedCareOptions.medication}
        customGivenByOptions={groupedCareOptions.givenBy}
        onCreateCareOption={addCareOptionFromDiary}
        childProfile={childProfile}
        importantEvents={importantEvents}
        useSaasApi
      />
      ) : null}
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
