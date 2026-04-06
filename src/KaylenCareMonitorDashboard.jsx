import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { supabase } from "./Supabase";

const todayValue = () => {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const nowTimeValue = () => {
  const d = new Date();
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${mins}`;
};

const dedupeAppend = (items, value) => {
  const next = (value || "").trim();
  if (!next) return items;
  return items.includes(next) ? items : [...items, next];
};

const formatTimeInput = (value) => {
  const digits = (value || "").replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
};

const formatReportDateLabel = (dateString) => {
  if (!dateString) return "";
  const [day, month, year] = dateString.split("/");
  const date = new Date(`${year}-${month}-${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const PIN_SESSION_KEY = "kaylens-diary-pin-session";
const PIN_INACTIVITY_MS = 5 * 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 15 * 1000;
const REPORT_WINDOW_DAYS = 7;
const APP_PASSWORD = "030920";

const dateTimeInputClass =
  "mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100";

const smallActionButtonClass =
  "mt-2 shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const sectionTheme = {
  "Food Diary": {
    report: "border-emerald-200 bg-emerald-50",
    badge: "bg-emerald-100 text-emerald-700",
    solidHeader: "bg-emerald-600 text-white border-emerald-700",
  },
  Medication: {
    report: "border-rose-200 bg-rose-50",
    badge: "bg-rose-100 text-rose-700",
    solidHeader: "bg-rose-600 text-white border-rose-700",
  },
  Toileting: {
    report: "border-sky-200 bg-sky-50",
    badge: "bg-sky-100 text-sky-700",
    solidHeader: "bg-sky-600 text-white border-sky-700",
  },
  Health: {
    report: "border-emerald-200 bg-green-50",
    badge: "bg-green-100 text-green-700",
    solidHeader: "bg-green-600 text-white border-green-700",
  },
  Sleep: {
    report: "border-indigo-200 bg-indigo-50",
    badge: "bg-indigo-100 text-indigo-700",
    solidHeader: "bg-indigo-600 text-white border-indigo-700",
  },
};

const getDefaultDoseForMedicine = (medicine) => {
  switch ((medicine || "").trim()) {
    case "Kepra (Levetiracetam)":
      return "5ml";
    case "Chlorphenamine Maleate":
      return "2.5ml";
    case "Melatonin":
      return "3ml";
    case "Vitamin D":
      return "3 drops";
    case "Calcichew":
    case "Calcichews":
      return "1 tablet";
    case "Midazolam":
      return "1 syringe";
    default:
      return "";
  }
};

const buildSubmissionSignature = (scope, payload) =>
  `${scope}:${JSON.stringify(payload)}`;

const readPinSession = () => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(PIN_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("Failed to read saved PIN session:", error);
    return null;
  }
};

const writePinSession = (payload) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(PIN_SESSION_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to persist PIN session:", error);
  }
};

const clearPinSession = () => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(PIN_SESSION_KEY);
  } catch (error) {
    console.error("Failed to clear PIN session:", error);
  }
};

export default function KaylenCareMonitorDashboard() {
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isCheckingPinSession, setIsCheckingPinSession] = useState(true);

  const [activeSection, setActiveSection] = useState(null);
  const [medicationValue, setMedicationValue] = useState("");
  const [foodValue, setFoodValue] = useState("");
  const [sharedLog, setSharedLog] = useState([]);
  const [shareCopied, setShareCopied] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [reportOpenDays, setReportOpenDays] = useState({});
  const [rawMilkLogs, setRawMilkLogs] = useState([]);
  const [rawSleepLogs, setRawSleepLogs] = useState([]);
  const [rawHealthLogs, setRawHealthLogs] = useState([]);

  const [savedFoodOptions, setSavedFoodOptions] = useState([]);
  const [savedMedicationOptions, setSavedMedicationOptions] = useState([]);
  const [savedGivenByOptions, setSavedGivenByOptions] = useState([]);
  const [saveFoodForFuture, setSaveFoodForFuture] = useState(false);
  const [saveMedicationForFuture, setSaveMedicationForFuture] =
    useState(false);
  const [saveGivenByForFuture, setSaveGivenByForFuture] = useState(false);

  const touchStartY = useRef(0);
  const touchCurrentY = useRef(0);
  const isPullingRef = useRef(false);

  const [activeSaveAction, setActiveSaveAction] = useState("");
  const saveLockRef = useRef(false);
  const recentSubmissionRef = useRef(new Map());
  const lastActivityAtRef = useRef(0);
  const lastSessionWriteRef = useRef(0);

  const [foodForm, setFoodForm] = useState({
    date: todayValue(),
    time: nowTimeValue(),
    location: "",
    otherLocation: "",
    item: "",
    otherItem: "",
    amount: "",
    notes: "",
  });

  const [medicationForm, setMedicationForm] = useState({
    medicine: "",
    otherMedicine: "",
    dose: "",
    time: nowTimeValue(),
    givenBy: "",
    otherGivenBy: "",
    date: todayValue(),
    notes: "",
  });

  const [toiletingForm, setToiletingForm] = useState({
    date: todayValue(),
    time: nowTimeValue(),
    entry: "",
    notes: "",
  });

  const [healthForm, setHealthForm] = useState({
    date: todayValue(),
    time: nowTimeValue(),
    event: "",
    duration: "",
    happened: "",
    action: "",
    notes: "",
    weightKg: "",
    heightCm: "",
  });

  const [sleepForm, setSleepForm] = useState({
    date: todayValue(),
    quality: "Good",
    bedtime: nowTimeValue(),
    wakeTime: "",
    nightWakings: "",
    nap: "No",
    notes: "",
  });
  const [sleepEntryId, setSleepEntryId] = useState(null);
  const [sleepBanner, setSleepBanner] = useState("");
  const [isLoadingSleepDraft, setIsLoadingSleepDraft] = useState(false);
  const [isSavingSleep, setIsSavingSleep] = useState(false);

  const sections = [
    {
      title: "Food Diary",
      subtitle: "Meals, drinks, and amounts",
      button: "Open food",
      emoji: "FD",
      color: "from-amber-400 to-orange-500",
      soft: "bg-amber-50 border-amber-200",
    },
    {
      title: "Medication",
      subtitle: "Medication timing and notes",
      button: "Open meds",
      emoji: "MD",
      color: "from-rose-400 to-pink-500",
      soft: "bg-rose-50 border-rose-200",
    },
    {
      title: "Toileting",
      subtitle: "Quick toileting entries",
      button: "Open toileting",
      emoji: "TL",
      color: "from-sky-400 to-blue-500",
      soft: "bg-sky-50 border-sky-200",
    },
    {
      title: "Health",
      subtitle: "Symptoms, actions, measurements",
      button: "Open health",
      emoji: "HL",
      color: "from-emerald-400 to-green-500",
      soft: "bg-emerald-50 border-emerald-200",
    },
    {
      title: "Sleep",
      subtitle: "Night sleep and wake-up tracking",
      button: "Open sleep",
      emoji: "SL",
      color: "from-indigo-400 to-violet-500",
      soft: "bg-indigo-50 border-indigo-200",
    },
    {
      title: "Reports",
      subtitle: "Last 7 days only",
      button: "Open reports",
      emoji: "RP",
      color: "from-fuchsia-400 to-pink-500",
      soft: "bg-fuchsia-50 border-fuchsia-200",
    },
  ];

  const defaultMedicationOptions = [
    "Kepra (Levetiracetam)",
    "Chlorphenamine Maleate",
    "Melatonin",
    "Calpol",
    "Ibuprofen",
    "Vitamin D",
    "Calcichews",
    "Midazolam",
    "Other",
  ];

  const medicationOptions = [
    ...defaultMedicationOptions.slice(0, -1),
    ...savedMedicationOptions,
    "Other",
  ];

  const defaultFoodOptions = [
    "Cottage pie",
    "Weetabix",
    "Heinz Fruit Custard",
    "Milk",
    "Other",
  ];

  const foodOptions = [
    ...defaultFoodOptions.slice(0, -1),
    ...savedFoodOptions,
    "Other",
  ];

  const defaultGivenByOptions = ["Martin", "Rachel", "Other"];

  const givenByOptions = [
    ...defaultGivenByOptions.slice(0, -1),
    ...savedGivenByOptions,
    "Other",
  ];

  const inputClassName =
    "mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100";

  const cardClassName =
    "rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm";

  const openSection = (section) => {
    setActiveSection(section);
    if (section.title !== "Medication") setMedicationValue("");
    if (section.title !== "Food Diary") setFoodValue("");
    setShareCopied(false);
    lastActivityAtRef.current = Date.now();
  };

  const closeSection = () => {
    setActiveSection(null);
    setMedicationValue("");
    setFoodValue("");
    setShareCopied(false);
  };

  const lockDiary = () => {
    clearPinSession();
    setIsUnlocked(false);
    setActiveSection(null);
    setPasswordInput("");
    setPasswordError("");
  };

  const refreshSessionActivity = (force = false) => {
    if (!isUnlocked) return;

    const now = Date.now();
    lastActivityAtRef.current = now;

    if (!force && now - lastSessionWriteRef.current < 15000) {
      return;
    }

    lastSessionWriteRef.current = now;
    writePinSession({
      unlockedAt: now,
      lastActiveAt: now,
    });
  };

  const isRecentDuplicate = (signature) => {
    const now = Date.now();

    for (const [key, timestamp] of recentSubmissionRef.current.entries()) {
      if (now - timestamp > DUPLICATE_WINDOW_MS) {
        recentSubmissionRef.current.delete(key);
      }
    }

    const lastSavedAt = recentSubmissionRef.current.get(signature);
    return Boolean(lastSavedAt && now - lastSavedAt < DUPLICATE_WINDOW_MS);
  };

  const rememberSubmission = (signature) => {
    recentSubmissionRef.current.set(signature, Date.now());
  };

  const handlePinPress = (value) => {
    if (passwordInput.length >= 6) return;
    setPasswordInput((current) => `${current}${value}`);
    if (passwordError) setPasswordError("");
  };

  const handlePinDelete = () => {
    setPasswordInput((current) => current.slice(0, -1));
    if (passwordError) setPasswordError("");
  };

  const handlePinClear = () => {
    setPasswordInput("");
    if (passwordError) setPasswordError("");
  };

  const handleUnlock = () => {
    if (passwordInput === APP_PASSWORD) {
      setIsUnlocked(true);
      setPasswordError("");
      setPasswordInput("");
      const now = Date.now();
      lastActivityAtRef.current = now;
      lastSessionWriteRef.current = now;
      writePinSession({
        unlockedAt: now,
        lastActiveAt: now,
      });
    } else {
      setPasswordError("Incorrect PIN");
    }
  };

  const resetFoodForm = () => {
    setFoodForm({
      date: todayValue(),
      time: nowTimeValue(),
      location: "",
      otherLocation: "",
      item: "",
      otherItem: "",
      amount: "",
      notes: "",
    });
    setFoodValue("");
    setSaveFoodForFuture(false);
  };

  const resetMedicationForm = () => {
    setMedicationForm({
      medicine: "",
      otherMedicine: "",
      dose: "",
      time: nowTimeValue(),
      givenBy: "",
      otherGivenBy: "",
      date: todayValue(),
      notes: "",
    });
    setMedicationValue("");
    setSaveMedicationForFuture(false);
    setSaveGivenByForFuture(false);
  };

  const resetToiletingForm = () => {
    setToiletingForm({
      date: todayValue(),
      time: nowTimeValue(),
      entry: "",
      notes: "",
    });
  };

  const resetHealthForm = () => {
    setHealthForm({
      date: todayValue(),
      time: nowTimeValue(),
      event: "",
      duration: "",
      happened: "",
      action: "",
      notes: "",
      weightKg: "",
      heightCm: "",
    });
  };

  const resetSleepForm = () => {
    setSleepForm({
      date: todayValue(),
      quality: "Good",
      bedtime: nowTimeValue(),
      wakeTime: "",
      nightWakings: "",
      nap: "No",
      notes: "",
    });
    setSleepEntryId(null);
    setSleepBanner("");
  };

  const parseNotesValue = (text, label) => {
    const parts = (text || "").split(" | ");
    const found = parts.find((part) => part.startsWith(`${label}: `));
    return found ? found.replace(`${label}: `, "") : "";
  };

  const parseDateToIso = (value) => {
    if (!value || !value.includes("/")) return null;
    const [day, month, year] = value.split("/");
    if (!day || !month || !year) return null;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  };

  const getSleepDurationMinutes = (
    sleepDateValue,
    bedtime,
    wakeDateValue,
    wakeTime,
  ) => {
    const sleepDateIso = parseDateToIso(sleepDateValue);
    const wakeDateIso = parseDateToIso(wakeDateValue || sleepDateValue);

    if (!sleepDateIso || !wakeDateIso || !bedtime || !wakeTime) return null;

    const bedtimeDate = new Date(`${sleepDateIso}T${bedtime}:00`);
    let wakeDate = new Date(`${wakeDateIso}T${wakeTime}:00`);

    if (Number.isNaN(bedtimeDate.getTime()) || Number.isNaN(wakeDate.getTime())) {
      return null;
    }

    if (wakeDate <= bedtimeDate) {
      wakeDate = new Date(wakeDate.getTime() + 24 * 60 * 60 * 1000);
    }

    const diffMs = wakeDate.getTime() - bedtimeDate.getTime();
    return Math.round(diffMs / 60000);
  };

  const formatSleepDuration = (minutes) => {
    if (minutes === null || minutes === undefined || Number.isNaN(minutes)) {
      return "";
    }

    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hrs && mins) return `${hrs}h ${mins}m`;
    if (hrs) return `${hrs}h`;
    return `${mins}m`;
  };

  const runLockedSave = async (actionKey, action) => {
    if (saveLockRef.current) return;
    saveLockRef.current = true;
    setActiveSaveAction(actionKey);
    try {
      await action();
    } finally {
      saveLockRef.current = false;
      setActiveSaveAction("");
    }
  };

  const loadLatestIncompleteSleepEntry = async () => {
    try {
      setIsLoadingSleepDraft(true);

      const { data, error } = await supabase
        .from("sleep_logs")
        .select("*")
        .is("wake_time", null)
        .order("time", { ascending: false })
        .limit(1);

      if (error) {
        console.error("Error loading incomplete sleep entry:", error);
        return;
      }

      const latest = data?.[0];

      if (!latest) {
        setSleepEntryId(null);
        setSleepBanner("");
        setSleepForm({
          date: todayValue(),
          quality: "Good",
          bedtime: nowTimeValue(),
          wakeTime: "",
          nightWakings: "",
          nap: "No",
          notes: "",
        });
        return;
      }

      const savedDate = parseNotesValue(latest.notes, "Date") || todayValue();

      setSleepEntryId(String(latest.id));
      setSleepBanner(
        `Continuing previous sleep from ${savedDate} at ${
          latest.bedtime || "time not set"
        }`,
      );
      setSleepForm({
        date: savedDate,
        quality: latest.quality || "Good",
        bedtime: latest.bedtime || "",
        wakeTime: "",
        nightWakings: latest.night_wakings || "0",
        nap: latest.nap || "No",
        notes: parseNotesValue(latest.notes, "Notes") || "",
      });
    } catch (error) {
      console.error("Error preparing sleep form:", error);
    } finally {
      setIsLoadingSleepDraft(false);
    }
  };

  const loadEntriesFromSupabase = async () => {
    const [
      { data: milkData, error: milkError },
      { data: foodData, error: foodError },
      { data: medicationData, error: medicationError },
      { data: toiletingData, error: toiletingError },
      { data: sleepData, error: sleepError },
      { data: healthData, error: healthError },
    ] = await Promise.all([
      supabase.from("milk_logs").select("*").order("time", { ascending: false }),
      supabase.from("food_logs").select("*").order("time", { ascending: false }),
      supabase
        .from("medication_logs")
        .select("*")
        .order("time", { ascending: false }),
      supabase
        .from("toileting_logs")
        .select("*")
        .order("time", { ascending: false }),
      supabase
        .from("sleep_logs")
        .select("*")
        .order("time", { ascending: false }),
      supabase
        .from("health_logs")
        .select("*")
        .order("time", { ascending: false }),
    ]);

    if (milkError) console.error("Error loading milk entries:", milkError);
    if (foodError) console.error("Error loading food entries:", foodError);
    if (medicationError)
      console.error("Error loading medication entries:", medicationError);
    if (toiletingError)
      console.error("Error loading toileting entries:", toiletingError);
    if (sleepError) console.error("Error loading sleep entries:", sleepError);
    if (healthError) console.error("Error loading health entries:", healthError);

    setRawMilkLogs(milkData || []);
    setRawSleepLogs(sleepData || []);
    setRawHealthLogs(healthData || []);

    const mappedMilkEntries = (milkData || []).map((row) => ({
      id: `milk-${row.id}`,
      createdAt: row.time || new Date().toISOString(),
      section: "Food Diary",
      date: parseNotesValue(row.notes, "Date") || todayValue(),
      time: parseNotesValue(row.notes, "Time") || "",
      summary: `${parseNotesValue(row.notes, "Item") || "Milk"} · ${
        row.amount || 0
      }oz`,
      details: [
        `Location: ${parseNotesValue(row.notes, "Location") || "Not set"}`,
        parseNotesValue(row.notes, "Notes")
          ? `Notes: ${parseNotesValue(row.notes, "Notes")}`
          : null,
      ].filter(Boolean),
    }));

    const mappedFoodEntries = (foodData || []).map((row) => ({
      id: `food-${row.id}`,
      createdAt: row.time || new Date().toISOString(),
      section: "Food Diary",
      date: parseNotesValue(row.notes, "Date") || todayValue(),
      time: parseNotesValue(row.notes, "Time") || "",
      summary: `${row.item || "Food entry"} · ${row.amount || "No amount"}`,
      details: [
        `Location: ${parseNotesValue(row.notes, "Location") || "Not set"}`,
        parseNotesValue(row.notes, "Notes")
          ? `Notes: ${parseNotesValue(row.notes, "Notes")}`
          : null,
      ].filter(Boolean),
    }));

    const mappedMedicationEntries = (medicationData || []).map((row) => ({
      id: `medication-${row.id}`,
      createdAt: row.time || new Date().toISOString(),
      section: "Medication",
      date: parseNotesValue(row.notes, "Date") || todayValue(),
      time: parseNotesValue(row.notes, "Time") || "",
      summary: `${row.medicine || "Medication"} · ${row.dose || "No dose"}`,
      details: [
        `Given by: ${parseNotesValue(row.notes, "Given by") || "Not set"}`,
        parseNotesValue(row.notes, "Notes")
          ? `Notes: ${parseNotesValue(row.notes, "Notes")}`
          : null,
      ].filter(Boolean),
    }));

    const mappedToiletingEntries = (toiletingData || []).map((row) => ({
      id: `toileting-${row.id}`,
      createdAt: row.time || new Date().toISOString(),
      section: "Toileting",
      date: parseNotesValue(row.notes, "Date") || todayValue(),
      time: parseNotesValue(row.notes, "Time") || "",
      summary: row.entry || "Toileting entry",
      details: [
        parseNotesValue(row.notes, "Notes")
          ? `Notes: ${parseNotesValue(row.notes, "Notes")}`
          : null,
      ].filter(Boolean),
    }));

    const mappedSleepEntries = (sleepData || []).map((row) => {
      const entryDate = parseNotesValue(row.notes, "Date") || todayValue();
      const wakeDate = parseNotesValue(row.notes, "Wake Date") || entryDate;
      const durationMinutes = getSleepDurationMinutes(
        entryDate,
        row.bedtime,
        wakeDate,
        row.wake_time,
      );
      const durationText = formatSleepDuration(durationMinutes);

      return {
        id: `sleep-${row.id}`,
        createdAt: row.time || new Date().toISOString(),
        section: "Sleep",
        date: entryDate,
        time: row.bedtime || "",
        summary: row.wake_time
          ? `Sleep · ${row.bedtime || "No bedtime"} to ${row.wake_time}${
              durationText ? ` · ${durationText}` : ""
            }`
          : `Sleep started · ${row.bedtime || "No bedtime"}`,
        details: [
          row.quality ? `Sleep quality: ${row.quality}` : null,
          row.wake_time
            ? `Wake-up: ${wakeDate} ${row.wake_time}`
            : "Wake-up: Not logged yet",
          `Night wakings: ${row.night_wakings || "0"}`,
          `Daytime nap: ${row.nap || "Not set"}`,
          durationText ? `Sleep duration: ${durationText}` : null,
          parseNotesValue(row.notes, "Notes")
            ? `Notes: ${parseNotesValue(row.notes, "Notes")}`
            : null,
        ].filter(Boolean),
      };
    });

    const mappedHealthEntries = (healthData || []).map((row) => ({
      id: `health-${row.id}`,
      createdAt: row.time || new Date().toISOString(),
      section: "Health",
      date: parseNotesValue(row.notes, "Date") || todayValue(),
      time: parseNotesValue(row.notes, "Time") || "",
      summary: `${row.event || "Health"} · ${row.duration || "No duration"}`,
      details: [
        row.happened ? `What happened: ${row.happened}` : null,
        row.action ? `Action taken: ${row.action}` : null,
        row.weight_kg ? `Weight (kg): ${row.weight_kg}` : null,
        row.height_cm ? `Height (cm): ${row.height_cm}` : null,
        parseNotesValue(row.notes, "Notes")
          ? `Notes: ${parseNotesValue(row.notes, "Notes")}`
          : null,
      ].filter(Boolean),
    }));

    const combined = [
      ...mappedMilkEntries,
      ...mappedFoodEntries,
      ...mappedMedicationEntries,
      ...mappedToiletingEntries,
      ...mappedSleepEntries,
      ...mappedHealthEntries,
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    setSharedLog(combined);
  };

  const refreshAllData = async () => {
    if (!isUnlocked || isRefreshing) return;
    try {
      setIsRefreshing(true);
      await loadEntriesFromSupabase();
      if (activeSection?.title === "Sleep") {
        await loadLatestIncompleteSleepEntry();
      }
    } finally {
      setPullDistance(0);
      setTimeout(() => setIsRefreshing(false), 400);
    }
  };

  useEffect(() => {
    const session = readPinSession();
    const now = Date.now();

    if (session?.lastActiveAt && now - session.lastActiveAt < PIN_INACTIVITY_MS) {
      setIsUnlocked(true);
      lastActivityAtRef.current = now;
      lastSessionWriteRef.current = now;
      writePinSession({
        unlockedAt: session.unlockedAt || now,
        lastActiveAt: now,
      });
    } else {
      clearPinSession();
    }

    setIsCheckingPinSession(false);
  }, []);

  useEffect(() => {
    if (isUnlocked) {
      loadEntriesFromSupabase();
    }
  }, [isUnlocked]);

  useEffect(() => {
    if (!isUnlocked || activeSection?.title !== "Sleep") return;
    loadLatestIncompleteSleepEntry();
  }, [isUnlocked, activeSection]);

  useEffect(() => {
    if (!isUnlocked) return;

    const markActive = () => refreshSessionActivity();
    const validateSession = () => {
      const now = Date.now();
      if (
        lastActivityAtRef.current &&
        now - lastActivityAtRef.current >= PIN_INACTIVITY_MS
      ) {
        lockDiary();
      }
    };

    const interval = window.setInterval(validateSession, 60 * 1000);

    window.addEventListener("click", markActive, { passive: true });
    window.addEventListener("touchstart", markActive, { passive: true });
    window.addEventListener("keydown", markActive);
    window.addEventListener("scroll", markActive, { passive: true });

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("click", markActive);
      window.removeEventListener("touchstart", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("scroll", markActive);
    };
  }, [isUnlocked]);

  useEffect(() => {
    if (!isUnlocked) return;

    const handleTouchStart = (e) => {
      if (window.scrollY > 0 || activeSection || isRefreshing) return;
      touchStartY.current = e.touches[0].clientY;
      touchCurrentY.current = e.touches[0].clientY;
      isPullingRef.current = true;
    };

    const handleTouchMove = (e) => {
      if (!isPullingRef.current) return;
      touchCurrentY.current = e.touches[0].clientY;
      const distance = Math.max(0, touchCurrentY.current - touchStartY.current);
      setPullDistance(Math.min(distance, 120));
    };

    const handleTouchEnd = async () => {
      if (!isPullingRef.current) return;
      const pullDistance = touchCurrentY.current - touchStartY.current;
      isPullingRef.current = false;

      if (pullDistance > 110) {
        await refreshAllData();
        return;
      }

      setPullDistance(0);
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd);

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isUnlocked, activeSection, isRefreshing]);

  const sectionHelpText = useMemo(() => {
    if (!activeSection) return "";

    switch (activeSection.title) {
      case "Food Diary":
        return "Log meals, drinks, and milk amounts with one quick save.";
      case "Medication":
        return "Safer medication logging with duplicate protection and rescue note checks.";
      case "Toileting":
        return "Quick toileting logging with clean notes when needed.";
      case "Health":
        return "Record symptoms, actions, and metric measurements.";
      case "Sleep":
        return "Log bedtime first, then complete wake-up the next morning.";
      case "Reports":
        return "See the latest 7 days with collapsible daily summaries.";
      default:
        return "Form preview";
    }
  }, [activeSection]);

  const recentEntries = useMemo(() => {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (REPORT_WINDOW_DAYS - 1));

    return sharedLog.filter((entry) => {
      if (!entry.date) return false;
      const [day, month, year] = entry.date.split("/");
      const entryDate = new Date(`${year}-${month}-${day}T00:00:00`);
      return !Number.isNaN(entryDate.getTime()) && entryDate >= cutoff;
    });
  }, [sharedLog]);

  const latestTwoBySection = useMemo(() => {
    const findLatestTwo = (sectionTitle) =>
      sharedLog.filter((entry) => entry.section === sectionTitle).slice(0, 2);

    return {
      food: findLatestTwo("Food Diary"),
      medication: findLatestTwo("Medication"),
      toileting: findLatestTwo("Toileting"),
      health: findLatestTwo("Health"),
      sleep: findLatestTwo("Sleep"),
    };
  }, [sharedLog]);

  const quickOverview = useMemo(
    () => [
      {
        label: "Last sleep",
        value: latestTwoBySection.sleep[0]?.summary || "No sleep logged",
      },
      {
        label: "Last medication",
        value: latestTwoBySection.medication[0]?.summary || "No medication logged",
      },
      {
        label: "Milk today",
        value: `${rawMilkLogs
          .filter(
            (row) => (parseNotesValue(row.notes, "Date") || todayValue()) === todayValue(),
          )
          .reduce((total, row) => total + Number(row.amount || 0), 0)}oz`,
      },
      {
        label: "Sleep status",
        value: sleepEntryId ? "Wake-up still pending" : "No open sleep entry",
      },
    ],
    [latestTwoBySection, rawMilkLogs, sleepEntryId],
  );

  const tileStatusText = (sectionTitle) => {
    const formatList = (entries) => {
      if (!entries.length) return ["Nothing logged yet"];
      return entries.map(
        (entry) => `${entry.summary}${entry.time ? ` - ${entry.time}` : ""}`,
      );
    };

    switch (sectionTitle) {
      case "Food Diary":
        return formatList(latestTwoBySection.food);
      case "Medication":
        return formatList(latestTwoBySection.medication);
      case "Toileting":
        return formatList(latestTwoBySection.toileting);
      case "Health":
        return formatList(latestTwoBySection.health);
      case "Sleep":
        return formatList(latestTwoBySection.sleep);
      default:
        return [""];
    }
  };

  const shortcutItems = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        latest:
          tileStatusText(section.title)[0] ||
          (section.title === "Reports" ? "7 day summary" : "Nothing logged yet"),
      })),
    [latestTwoBySection, sharedLog],
  );

  const dailyReportGroups = useMemo(() => {
    const groups = [];

    recentEntries.forEach((entry) => {
      const lastGroup = groups[groups.length - 1];

      if (!lastGroup || lastGroup.date !== entry.date) {
        groups.push({
          date: entry.date,
          label: formatReportDateLabel(entry.date),
          entries: [entry],
        });
      } else {
        lastGroup.entries.push(entry);
      }
    });

    return groups;
  }, [recentEntries]);

  useEffect(() => {
    if (!dailyReportGroups.length) return;

    setReportOpenDays((current) => {
      const next = {};

      dailyReportGroups.forEach((group, index) => {
        next[group.date] = current[group.date] ?? index === 0;
      });

      return next;
    });
  }, [dailyReportGroups]);

  const reportSummary = useMemo(() => {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (REPORT_WINDOW_DAYS - 1));

    const totalMilk = rawMilkLogs
      .filter((row) => {
        const parsed = parseDateToIso(parseNotesValue(row.notes, "Date"));
        if (!parsed) return false;
        const entryDate = new Date(`${parsed}T00:00:00`);
        return !Number.isNaN(entryDate.getTime()) && entryDate >= cutoff;
      })
      .reduce((total, row) => total + Number(row.amount || 0), 0);

    const totalSleepMinutes = rawSleepLogs
      .filter((row) => row.wake_time)
      .reduce((total, row) => {
        const sleepDate = parseNotesValue(row.notes, "Date") || "";
        const wakeDate = parseNotesValue(row.notes, "Wake Date") || sleepDate;
        const parsed = parseDateToIso(sleepDate);

        if (!parsed) return total;

        const entryDate = new Date(`${parsed}T00:00:00`);

        if (Number.isNaN(entryDate.getTime()) || entryDate < cutoff) {
          return total;
        }

        return (
          total +
          (getSleepDurationMinutes(sleepDate, row.bedtime, wakeDate, row.wake_time) || 0)
        );
      }, 0);

    const latestWeight = rawHealthLogs.find((row) => row.weight_kg)?.weight_kg || "";

    return {
      totalMilk,
      totalSleepMinutes,
      latestWeight,
    };
  }, [rawHealthLogs, rawMilkLogs, rawSleepLogs]);

  const reportText = useMemo(
    () =>
      [
        "Kaylen's Diary Report - Last 7 days",
        `Total sleep: ${formatSleepDuration(reportSummary.totalSleepMinutes) || "0m"}`,
        `Total milk: ${reportSummary.totalMilk}oz`,
        `Latest weight: ${
          reportSummary.latestWeight ? `${reportSummary.latestWeight}kg` : "Not logged"
        }`,
        "",
        ...dailyReportGroups.flatMap((group) => [
          group.label,
          ...group.entries.flatMap((entry) => [
            `${entry.section}${entry.time ? ` - ${entry.time}` : ""}`,
            entry.summary,
            ...(entry.details?.length ? entry.details : []),
            "",
          ]),
        ]),
        ...(dailyReportGroups.length ? [] : ["No entries logged in the last 7 days."]),
      ].join("\n"),
    [dailyReportGroups, reportSummary],
  );

  const saveFoodEntryToSupabase = async ({
    selectedFood,
    selectedLocation,
    isMilk,
  }) => {
    const signature = buildSubmissionSignature("food", {
      date: foodForm.date,
      time: foodForm.time,
      selectedFood,
      selectedLocation,
      amount: foodForm.amount,
      notes: foodForm.notes,
      isMilk,
    });

    if (isRecentDuplicate(signature)) {
      alert("That food entry was just saved. Duplicate tap prevented.");
      return false;
    }

    if (isMilk) {
      const payload = {
        amount: Number(foodForm.amount || 0),
        unit: "oz",
        time: new Date().toISOString(),
        notes: [
          `Date: ${foodForm.date}`,
          `Time: ${foodForm.time}`,
          `Location: ${selectedLocation}`,
          `Item: ${selectedFood || "Milk"}`,
          foodForm.notes ? `Notes: ${foodForm.notes}` : null,
        ]
          .filter(Boolean)
          .join(" | "),
      };

      const { error } = await supabase.from("milk_logs").insert([payload]);

      if (error) {
        console.error("Supabase milk save failed:", error);
        alert("Milk save failed - check console");
        return false;
      }

      rememberSubmission(signature);
      return true;
    }

    const payload = {
      item: selectedFood || "Food entry",
      amount: foodForm.amount || "",
      time: new Date().toISOString(),
      notes: [
        `Date: ${foodForm.date}`,
        `Time: ${foodForm.time}`,
        `Location: ${selectedLocation}`,
        foodForm.notes ? `Notes: ${foodForm.notes}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
    };

    const { error } = await supabase.from("food_logs").insert([payload]);

    if (error) {
      console.error("Supabase food save failed:", error);
      alert("Food save failed - check console");
      return false;
    }

    rememberSubmission(signature);
    return true;
  };

  const saveMedicationEntryToSupabase = async ({
    selectedMedicine,
    selectedGivenBy,
  }) => {
    const signature = buildSubmissionSignature("medication", {
      date: medicationForm.date,
      time: medicationForm.time,
      selectedMedicine,
      dose: medicationForm.dose,
      selectedGivenBy,
      notes: medicationForm.notes,
    });

    if (isRecentDuplicate(signature)) {
      alert("That medication entry was just saved. Duplicate tap prevented.");
      return false;
    }

    const payload = {
      medicine: selectedMedicine || "Medication",
      dose: medicationForm.dose || "",
      time: new Date().toISOString(),
      notes: [
        `Date: ${medicationForm.date}`,
        `Time: ${medicationForm.time}`,
        `Given by: ${selectedGivenBy || "Not set"}`,
        medicationForm.notes ? `Notes: ${medicationForm.notes}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
    };

    const { error } = await supabase
      .from("medication_logs")
      .insert([payload]);

    if (error) {
      console.error("Supabase medication save failed:", error);
      alert("Medication save failed - check console");
      return false;
    }

    rememberSubmission(signature);
    return true;
  };

  const saveToiletingEntryToSupabase = async () => {
    const signature = buildSubmissionSignature("toileting", {
      date: toiletingForm.date,
      time: toiletingForm.time,
      entry: toiletingForm.entry,
      notes: toiletingForm.notes,
    });

    if (isRecentDuplicate(signature)) {
      alert("That toileting entry was just saved. Duplicate tap prevented.");
      return false;
    }

    const payload = {
      entry: toiletingForm.entry || "Toileting entry",
      time: new Date().toISOString(),
      notes: [
        `Date: ${toiletingForm.date}`,
        `Time: ${toiletingForm.time}`,
        toiletingForm.notes ? `Notes: ${toiletingForm.notes}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
    };

    const { error } = await supabase
      .from("toileting_logs")
      .insert([payload]);

    if (error) {
      console.error("Supabase toileting save failed:", error);
      alert("Toileting save failed - check console");
      return false;
    }

    rememberSubmission(signature);
    return true;
  };

  const saveSleepEntryToSupabase = async ({ mode }) => {
    try {
      setIsSavingSleep(true);

      if (mode === "sleep") {
        if (!sleepForm.date.trim() || !sleepForm.bedtime.trim()) {
          alert("Sleep date and bedtime are required");
          return false;
        }

        if (sleepEntryId) {
          alert("There is already an unfinished sleep entry");
          return false;
        }

        const signature = buildSubmissionSignature("sleep-start", {
          date: sleepForm.date,
          bedtime: sleepForm.bedtime,
        });

        if (isRecentDuplicate(signature)) {
          alert("That bedtime was just saved. Duplicate tap prevented.");
          return false;
        }

        const payload = {
          quality: "",
          bedtime: sleepForm.bedtime,
          wake_time: null,
          night_wakings: "0",
          nap: "No",
          time: new Date().toISOString(),
          notes: `Date: ${sleepForm.date}`,
        };

        const { data, error } = await supabase
          .from("sleep_logs")
          .insert([payload])
          .select("*");

        if (error) {
          console.error("Sleep insert failed:", error);
          alert(`Sleep save failed: ${error.message}`);
          return false;
        }

        rememberSubmission(signature);
        await loadLatestIncompleteSleepEntry();
        await loadEntriesFromSupabase();
        return true;
      }

      if (mode === "wake") {
        if (!sleepEntryId) {
          alert("No sleep entry found to complete");
          return false;
        }

        if (
          !sleepForm.date.trim() ||
          !sleepForm.bedtime.trim() ||
          !sleepForm.wakeTime.trim() ||
          !sleepForm.quality.trim()
        ) {
          alert("Fill all required wake-up fields");
          return false;
        }

        const signature = buildSubmissionSignature("sleep-wake", {
          sleepEntryId,
          date: sleepForm.date,
          bedtime: sleepForm.bedtime,
          wakeTime: sleepForm.wakeTime,
          quality: sleepForm.quality,
          nightWakings: sleepForm.nightWakings,
          nap: sleepForm.nap,
          notes: sleepForm.notes,
        });

        if (isRecentDuplicate(signature)) {
          alert("That wake-up was just saved. Duplicate tap prevented.");
          return false;
        }

        const payload = {
          quality: sleepForm.quality,
          bedtime: sleepForm.bedtime,
          wake_time: sleepForm.wakeTime,
          night_wakings: sleepForm.nightWakings || "0",
          nap: sleepForm.nap || "No",
          time: new Date().toISOString(),
          notes: [
            `Date: ${sleepForm.date}`,
            `Wake Date: ${todayValue()}`,
            sleepForm.notes ? `Notes: ${sleepForm.notes}` : null,
          ]
            .filter(Boolean)
            .join(" | "),
        };

        const { data, error } = await supabase
          .from("sleep_logs")
          .update(payload)
          .match({ id: String(sleepEntryId) })
          .select("*");

        if (error) {
          console.error("Wake update failed:", error);
          alert(`Wake save failed: ${error.message}`);
          return false;
        }

        if (!data || data.length === 0) {
          alert("Wake save ran but no row updated");
          return false;
        }

        rememberSubmission(signature);
        setSleepEntryId(null);
        setSleepBanner("");
        setSleepForm({
          date: todayValue(),
          quality: "Good",
          bedtime: "",
          wakeTime: "",
          nightWakings: "0",
          nap: "No",
          notes: "",
        });

        await loadEntriesFromSupabase();
        return true;
      }

      return false;
    } catch (error) {
      console.error("Sleep save unexpected error:", error);
      alert(`Sleep save failed: ${error.message || "Unexpected error"}`);
      return false;
    } finally {
      setIsSavingSleep(false);
    }
  };

  const saveHealthEntryToSupabase = async () => {
    const signature = buildSubmissionSignature("health", {
      date: healthForm.date,
      time: healthForm.time,
      event: healthForm.event,
      duration: healthForm.duration,
      happened: healthForm.happened,
      action: healthForm.action,
      notes: healthForm.notes,
      weightKg: healthForm.weightKg,
      heightCm: healthForm.heightCm,
    });

    if (isRecentDuplicate(signature)) {
      alert("That health entry was just saved. Duplicate tap prevented.");
      return false;
    }

    const payload = {
      event: healthForm.event || "Health",
      duration: healthForm.duration || "",
      time: new Date().toISOString(),
      happened: healthForm.happened || "",
      action: healthForm.action || "",
      weight_kg: healthForm.weightKg || "",
      weight_lb: "",
      height_cm: healthForm.heightCm || "",
      height_ft: "",
      height_in: "",
      notes: [
        `Date: ${healthForm.date}`,
        `Time: ${healthForm.time}`,
        healthForm.notes ? `Notes: ${healthForm.notes}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
    };

    const { error } = await supabase.from("health_logs").insert([payload]);

    if (error) {
      console.error("Supabase health save failed:", error);
      alert("Health save failed - check console");
      return false;
    }

    rememberSubmission(signature);
    return true;
  };

  const handleExportPdf = async () => {
    try {
      setIsExportingPdf(true);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const exportNode = document.getElementById("report-pdf-export");
      if (!exportNode) {
        alert("PDF export area not found");
        return;
      }

      const canvas = await html2canvas(exportNode, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        windowWidth: 1123,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("l", "mm", "a4");

      const pdfWidth = 297;
      const pdfHeight = 210;
      const margin = 8;
      const usableWidth = pdfWidth - margin * 2;
      const usableHeight = pdfHeight - margin * 2;

      const imgWidth = usableWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = margin;

      pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
      heightLeft -= usableHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight + margin;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
        heightLeft -= usableHeight;
      }

      pdf.save(
        `kaylens-diary-report-last-7-days.pdf`,
      );
    } catch (error) {
      console.error("PDF export failed", error);
      alert("PDF export failed - check console");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const renderTimeInput = ({
    label,
    value,
    onChange,
    onNow,
    placeholder = "HH:MM",
    disabled = false,
  }) => (
    <div className={cardClassName}>
      <label className="text-sm font-semibold text-slate-700">{label}</label>
      <div className="flex items-start gap-2">
        <input
          type="text"
          inputMode="numeric"
          placeholder={placeholder}
          className={`${dateTimeInputClass} mt-2 flex-1 ${
            disabled ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""
          }`}
          value={value}
          onChange={(e) => onChange(formatTimeInput(e.target.value))}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={onNow}
          className={smallActionButtonClass}
          disabled={disabled}
        >
          Now
        </button>
      </div>
    </div>
  );

  const renderFoodForm = () => {
    const showOtherFood = foodValue === "Other";
    const showOtherLocation = foodForm.location === "Other";
    const selectedFood = showOtherFood
      ? foodForm.otherItem
      : foodForm.item || foodValue;
    const selectedLocation = showOtherLocation
      ? foodForm.otherLocation || "Other"
      : foodForm.location || "Not set";

    const isMilk = selectedFood?.toLowerCase() === "milk";
    const canSaveFood =
      !!foodForm.date.trim() &&
      !!foodForm.time.trim() &&
      !!selectedFood?.trim() &&
      !!foodForm.amount?.toString().trim() &&
      !activeSaveAction;

    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Date</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="DD/MM/YYYY"
            className={dateTimeInputClass}
            value={foodForm.date}
            onChange={(e) => setFoodForm({ ...foodForm, date: e.target.value })}
          />
        </div>

        {renderTimeInput({
          label: "Time",
          value: foodForm.time,
          onChange: (time) => setFoodForm({ ...foodForm, time }),
          onNow: () => setFoodForm({ ...foodForm, time: nowTimeValue() }),
        })}

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Location
          </label>
          <select
            className={`${inputClassName} min-h-[48px]`}
            value={foodForm.location}
            onChange={(e) =>
              setFoodForm({
                ...foodForm,
                location: e.target.value,
                otherLocation:
                  e.target.value === "Other" ? foodForm.otherLocation : "",
              })
            }
          >
            <option value="">Select location</option>
            <option>Home</option>
            <option>School</option>
            <option>Grandparents</option>
            <option>Other</option>
          </select>
        </div>

        {showOtherLocation ? (
          <div className={`${cardClassName} md:col-span-2`}>
            <label className="text-sm font-semibold text-slate-700">
              Other location
            </label>
            <input
              type="text"
              placeholder="Type location"
              className={`${inputClassName} min-h-[48px] border-dashed`}
              value={foodForm.otherLocation}
              onChange={(e) =>
                setFoodForm({ ...foodForm, otherLocation: e.target.value })
              }
            />
          </div>
        ) : null}

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Food or drink
          </label>
          <select
            className={`${inputClassName} min-h-[48px]`}
            value={foodValue}
            onChange={(e) => {
              const value = e.target.value;
              setFoodValue(value);
              setFoodForm({
                ...foodForm,
                item: value === "Other" ? "" : value,
                otherItem: value === "Other" ? foodForm.otherItem : "",
              });
            }}
          >
            <option value="">Select food or drink</option>
            {foodOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        {showOtherFood ? (
          <>
            <div className={`${cardClassName} md:col-span-2`}>
              <label className="text-sm font-semibold text-slate-700">
                Other food or drink
              </label>
              <input
                type="text"
                placeholder="Type another food or drink"
                className={`${inputClassName} min-h-[48px] border-dashed`}
                value={foodForm.otherItem}
                onChange={(e) =>
                  setFoodForm({ ...foodForm, otherItem: e.target.value })
                }
              />
            </div>
            <div className={`${cardClassName} md:col-span-2`}>
              <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={saveFoodForFuture}
                  onChange={(e) => setSaveFoodForFuture(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Save this food or drink for future
              </label>
            </div>
          </>
        ) : null}

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            {isMilk ? "Amount (oz)" : "Amount"}
          </label>

          {isMilk ? (
            <input
              type="number"
              min="0"
              step="0.5"
              placeholder="Enter oz"
              className={`${inputClassName} min-h-[48px]`}
              value={foodForm.amount}
              onChange={(e) =>
                setFoodForm({ ...foodForm, amount: e.target.value })
              }
            />
          ) : (
            <select
              className={`${inputClassName} min-h-[48px]`}
              value={foodForm.amount}
              onChange={(e) =>
                setFoodForm({ ...foodForm, amount: e.target.value })
              }
            >
              <option value="">Select amount</option>
              <option>All</option>
              <option>Most</option>
              <option>Half</option>
              <option>A little</option>
              <option>Tasted only</option>
              <option>Refused</option>
            </select>
          )}
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Notes</label>
          <textarea
            rows={5}
            placeholder="Texture, brand, where eaten, who helped, anything important"
            className={`${inputClassName} min-h-[48px]`}
            value={foodForm.notes}
            onChange={(e) => setFoodForm({ ...foodForm, notes: e.target.value })}
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            disabled={!canSaveFood}
            onClick={() =>
              runLockedSave("food", async () => {
                const saved = await saveFoodEntryToSupabase({
                  selectedFood,
                  selectedLocation,
                  isMilk,
                });

                if (!saved) return;

                await loadEntriesFromSupabase();

                if (showOtherFood && saveFoodForFuture) {
                  setSavedFoodOptions((current) =>
                    dedupeAppend(current, foodForm.otherItem),
                  );
                }

                resetFoodForm();
                closeSection();
              })
            }
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {activeSaveAction === "food" ? "Saving..." : "Save food entry"}
          </button>
        </div>
      </div>
    );
  };

  const renderMedicationForm = () => {
    const showOtherMedication = medicationValue === "Other";
    const selectedMedicine = showOtherMedication
      ? medicationForm.otherMedicine || "Other medicine"
      : medicationForm.medicine || "Medication";
    const isMelatonin = selectedMedicine === "Melatonin";
    const isMidazolam = selectedMedicine === "Midazolam";
    const notesRequired = isMelatonin || isMidazolam;

    const showOtherGivenBy = medicationForm.givenBy === "Other";
    const selectedGivenBy = showOtherGivenBy
      ? medicationForm.otherGivenBy || "Other"
      : medicationForm.givenBy || "";

    const canSaveMedication =
      !!selectedMedicine.trim() &&
      !!medicationForm.dose.trim() &&
      !!medicationForm.time.trim() &&
      !!medicationForm.date.trim() &&
      (!notesRequired || !!medicationForm.notes.trim()) &&
      !activeSaveAction;

    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Medicine
          </label>
          <select
            value={medicationValue}
            onChange={(e) => {
              const value = e.target.value;
              const defaultDose =
                value === "Other" ? "" : getDefaultDoseForMedicine(value);

              setMedicationValue(value);
              setMedicationForm({
                ...medicationForm,
                medicine: value === "Other" ? "" : value,
                otherMedicine:
                  value === "Other" ? medicationForm.otherMedicine : "",
                dose: defaultDose || medicationForm.dose,
              });
            }}
            className={`${inputClassName} min-h-[48px]`}
          >
            <option value="">Select medication</option>
            {medicationOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        {showOtherMedication ? (
          <>
            <div className={`${cardClassName} md:col-span-2`}>
              <label className="text-sm font-semibold text-slate-700">
                Other medicine
              </label>
              <input
                type="text"
                placeholder="Type medicine name if not in dropdown"
                className={`${inputClassName} min-h-[48px] border-dashed`}
                value={medicationForm.otherMedicine}
                onChange={(e) => {
                  const value = e.target.value;
                  const defaultDose = getDefaultDoseForMedicine(value);

                  setMedicationForm({
                    ...medicationForm,
                    otherMedicine: value,
                    dose: defaultDose || medicationForm.dose,
                  });
                }}
              />
            </div>
            <div className={`${cardClassName} md:col-span-2`}>
              <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={saveMedicationForFuture}
                  onChange={(e) => setSaveMedicationForFuture(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Save this medicine for future
              </label>
            </div>
          </>
        ) : null}

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Dose</label>
          <input
            type="text"
            placeholder="e.g. 5ml / 1 tablet"
            className={`${inputClassName} min-h-[48px]`}
            value={medicationForm.dose}
            onChange={(e) =>
              setMedicationForm({ ...medicationForm, dose: e.target.value })
            }
          />
        </div>

        {renderTimeInput({
          label: "Time",
          value: medicationForm.time,
          onChange: (time) => setMedicationForm({ ...medicationForm, time }),
          onNow: () =>
            setMedicationForm({ ...medicationForm, time: nowTimeValue() }),
        })}

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Given by
          </label>
          <select
            className={`${inputClassName} min-h-[48px]`}
            value={medicationForm.givenBy}
            onChange={(e) =>
              setMedicationForm({
                ...medicationForm,
                givenBy: e.target.value,
                otherGivenBy:
                  e.target.value === "Other" ? medicationForm.otherGivenBy : "",
              })
            }
          >
            <option value="">Select name</option>
            {givenByOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Date</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="DD/MM/YYYY"
            className={dateTimeInputClass}
            value={medicationForm.date}
            onChange={(e) =>
              setMedicationForm({ ...medicationForm, date: e.target.value })
            }
          />
        </div>

        {showOtherGivenBy ? (
          <>
            <div className={`${cardClassName} md:col-span-2`}>
              <label className="text-sm font-semibold text-slate-700">
                Other name
              </label>
              <input
                type="text"
                placeholder="Type name"
                className={`${inputClassName} min-h-[48px] border-dashed`}
                value={medicationForm.otherGivenBy}
                onChange={(e) =>
                  setMedicationForm({
                    ...medicationForm,
                    otherGivenBy: e.target.value,
                  })
                }
              />
            </div>

            <div className={`${cardClassName} md:col-span-2`}>
              <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={saveGivenByForFuture}
                  onChange={(e) => setSaveGivenByForFuture(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Save this name for future
              </label>
            </div>
          </>
        ) : null}

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Notes{notesRequired ? " *" : ""}
          </label>
          <textarea
            placeholder={
              isMidazolam
                ? "Notes required for Midazolam rescue medication"
                : isMelatonin
                  ? "Notes required for Melatonin"
                  : "Optional notes"
            }
            rows={5}
            className={`${inputClassName} min-h-[48px]`}
            value={medicationForm.notes}
            onChange={(e) =>
              setMedicationForm({ ...medicationForm, notes: e.target.value })
            }
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            disabled={!canSaveMedication}
            onClick={() =>
              runLockedSave("medication", async () => {
                if (notesRequired && !medicationForm.notes.trim()) {
                  alert(
                    isMidazolam
                      ? "Notes are required for Midazolam"
                      : "Notes are required for Melatonin",
                  );
                  return;
                }

                const saved = await saveMedicationEntryToSupabase({
                  selectedMedicine,
                  selectedGivenBy,
                });

                if (!saved) return;

                await loadEntriesFromSupabase();

                if (showOtherMedication && saveMedicationForFuture) {
                  setSavedMedicationOptions((current) =>
                    dedupeAppend(current, medicationForm.otherMedicine),
                  );
                }

                if (showOtherGivenBy && saveGivenByForFuture) {
                  setSavedGivenByOptions((current) =>
                    dedupeAppend(current, medicationForm.otherGivenBy),
                  );
                }

                resetMedicationForm();
                closeSection();
              })
            }
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {activeSaveAction === "medication"
              ? "Saving..."
              : "Save medication entry"}
          </button>
        </div>
      </div>
    );
  };

  const renderToiletingForm = () => {
    const canSaveToileting =
      !!toiletingForm.date.trim() &&
      !!toiletingForm.time.trim() &&
      !!toiletingForm.entry.trim() &&
      !activeSaveAction;

    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Date</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="DD/MM/YYYY"
            className={dateTimeInputClass}
            value={toiletingForm.date}
            onChange={(e) =>
              setToiletingForm({ ...toiletingForm, date: e.target.value })
            }
          />
        </div>

        {renderTimeInput({
          label: "Time",
          value: toiletingForm.time,
          onChange: (time) => setToiletingForm({ ...toiletingForm, time }),
          onNow: () =>
            setToiletingForm({ ...toiletingForm, time: nowTimeValue() }),
        })}

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Toileting entry
          </label>
          <select
            className={`${inputClassName} min-h-[48px]`}
            value={toiletingForm.entry}
            onChange={(e) =>
              setToiletingForm({ ...toiletingForm, entry: e.target.value })
            }
          >
            <option value="">Select entry</option>
            <option>Toilet - Dry</option>
            <option>Toilet - Wet</option>
            <option>Toilet - Soiled</option>
            <option>Wet nappy</option>
            <option>Soiled nappy</option>
            <option>Both (wet & soiled)</option>
            <option>Accident</option>
          </select>
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Notes</label>
          <textarea
            rows={5}
            placeholder="Any patterns, concerns, or extra detail"
            className={`${inputClassName} min-h-[48px]`}
            value={toiletingForm.notes}
            onChange={(e) =>
              setToiletingForm({ ...toiletingForm, notes: e.target.value })
            }
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            disabled={!canSaveToileting}
            onClick={() =>
              runLockedSave("toileting", async () => {
                const saved = await saveToiletingEntryToSupabase();

                if (!saved) return;

                await loadEntriesFromSupabase();
                resetToiletingForm();
                closeSection();
              })
            }
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {activeSaveAction === "toileting"
              ? "Saving..."
              : "Save toileting entry"}
          </button>
        </div>
      </div>
    );
  };

  const renderHealthForm = () => {
    const canSaveHealth =
      !!healthForm.date.trim() &&
      !!healthForm.time.trim() &&
      !!healthForm.event.trim() &&
      !activeSaveAction;

    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Date</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="DD/MM/YYYY"
            className={dateTimeInputClass}
            value={healthForm.date}
            onChange={(e) =>
              setHealthForm({ ...healthForm, date: e.target.value })
            }
          />
        </div>

        {renderTimeInput({
          label: "Time",
          value: healthForm.time,
          onChange: (time) => setHealthForm({ ...healthForm, time }),
          onNow: () => setHealthForm({ ...healthForm, time: nowTimeValue() }),
        })}

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Health event
          </label>
          <select
            className={`${inputClassName} min-h-[48px]`}
            value={healthForm.event}
            onChange={(e) =>
              setHealthForm({ ...healthForm, event: e.target.value })
            }
          >
            <option value="">Select event</option>
            <option>Seizure</option>
            <option>Illness</option>
            <option>Injury</option>
            <option>Medication reaction</option>
            <option>Other concern</option>
          </select>
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Duration
          </label>
          <input
            type="text"
            placeholder="e.g. 2 minutes"
            className={`${inputClassName} min-h-[48px]`}
            value={healthForm.duration}
            onChange={(e) =>
              setHealthForm({ ...healthForm, duration: e.target.value })
            }
          />
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            What happened
          </label>
          <textarea
            rows={5}
            placeholder="Describe symptoms or what was observed"
            className={`${inputClassName} min-h-[48px]`}
            value={healthForm.happened}
            onChange={(e) =>
              setHealthForm({ ...healthForm, happened: e.target.value })
            }
          />
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Action taken
          </label>
          <textarea
            rows={4}
            placeholder="First aid, rescue medication, call to school, etc"
            className={`${inputClassName} min-h-[48px]`}
            value={healthForm.action}
            onChange={(e) =>
              setHealthForm({ ...healthForm, action: e.target.value })
            }
          />
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-semibold text-slate-700">
              Measurements
            </label>
            <span className="rounded-full bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">
              Metric only
            </span>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Weight (kg)
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="e.g. 18.4"
                className={`${inputClassName} mt-1 min-h-[48px]`}
                value={healthForm.weightKg}
                onChange={(e) =>
                  setHealthForm({ ...healthForm, weightKg: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Height (cm)
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="e.g. 105.5"
                className={`${inputClassName} mt-1 min-h-[48px]`}
                value={healthForm.heightCm}
                onChange={(e) =>
                  setHealthForm({ ...healthForm, heightCm: e.target.value })
                }
              />
            </div>
          </div>
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Notes</label>
          <textarea
            rows={4}
            placeholder="Anything else important"
            className={`${inputClassName} min-h-[48px]`}
            value={healthForm.notes}
            onChange={(e) =>
              setHealthForm({ ...healthForm, notes: e.target.value })
            }
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            disabled={!canSaveHealth}
            onClick={() =>
              runLockedSave("health", async () => {
                const saved = await saveHealthEntryToSupabase();

                if (!saved) return;

                await loadEntriesFromSupabase();
                resetHealthForm();
                closeSection();
              })
            }
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {activeSaveAction === "health" ? "Saving..." : "Save health entry"}
          </button>
        </div>
      </div>
    );
  };

  const renderSleepForm = () => {
    const wakeDate = todayValue();
    const durationPreview = formatSleepDuration(
      getSleepDurationMinutes(
        sleepForm.date,
        sleepForm.bedtime,
        wakeDate,
        sleepForm.wakeTime,
      ),
    );

    const canSaveSleep =
      !!sleepForm.date.trim() &&
      !!sleepForm.bedtime.trim() &&
      !sleepEntryId &&
      !isLoadingSleepDraft &&
      !isSavingSleep &&
      !activeSaveAction;

    const canSaveWake =
      !!sleepEntryId &&
      !!sleepForm.date.trim() &&
      !!sleepForm.bedtime.trim() &&
      !!sleepForm.wakeTime.trim() &&
      !!sleepForm.quality.trim() &&
      !isLoadingSleepDraft &&
      !isSavingSleep &&
      !activeSaveAction;

    return (
      <div className="mt-6 space-y-4">
        {sleepBanner ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            {sleepBanner}
          </div>
        ) : null}

        {isLoadingSleepDraft ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600">
            Checking for unfinished sleep entry...
          </div>
        ) : null}

        <div className="rounded-3xl border border-indigo-200 bg-indigo-50/70 p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-lg font-bold text-slate-900">Sleep</h4>
              <p className="text-sm font-medium text-slate-600">
                Log bedtime at night
              </p>
            </div>
            <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-indigo-700">
              Step 1
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className={cardClassName}>
              <label className="text-sm font-semibold text-slate-700">Date</label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="DD/MM/YYYY"
                className={`${dateTimeInputClass} ${
                  sleepEntryId ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""
                }`}
                value={sleepForm.date}
                onChange={(e) =>
                  setSleepForm({ ...sleepForm, date: e.target.value })
                }
                disabled={!!sleepEntryId}
              />
            </div>

            {renderTimeInput({
              label: "Time",
              value: sleepForm.bedtime,
              onChange: (bedtime) => setSleepForm({ ...sleepForm, bedtime }),
              onNow: () =>
                setSleepForm({ ...sleepForm, bedtime: nowTimeValue() }),
              disabled: !!sleepEntryId,
            })}
          </div>

          <div className="mt-4">
            <button
              type="button"
              disabled={!canSaveSleep}
              onClick={() =>
                runLockedSave("sleep-start", async () => {
                  await saveSleepEntryToSupabase({ mode: "sleep" });
                })
              }
              className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {activeSaveAction === "sleep-start" || isSavingSleep
                ? "Saving..."
                : "Save sleep"}
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-indigo-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-lg font-bold text-slate-900">Wake-up</h4>
              <p className="text-sm font-medium text-slate-600">
                Complete the saved sleep in the morning
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-700">
              Step 2
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className={cardClassName}>
              <label className="text-sm font-semibold text-slate-700">
                Sleep date
              </label>
              <input
                type="text"
                className={`${dateTimeInputClass} cursor-not-allowed bg-slate-100 text-slate-500`}
                value={sleepForm.date}
                disabled
              />
            </div>

            <div className={cardClassName}>
              <label className="text-sm font-semibold text-slate-700">
                Wake-up date
              </label>
              <input
                type="text"
                className={`${dateTimeInputClass} cursor-not-allowed bg-slate-100 text-slate-500`}
                value={wakeDate}
                readOnly
              />
            </div>

            <div className={cardClassName}>
              <label className="text-sm font-semibold text-slate-700">
                Bedtime
              </label>
              <input
                type="text"
                className={`${dateTimeInputClass} cursor-not-allowed bg-slate-100 text-slate-500`}
                value={sleepForm.bedtime}
                readOnly
              />
            </div>

            {renderTimeInput({
              label: "Wake-up time",
              value: sleepForm.wakeTime,
              onChange: (wakeTime) => setSleepForm({ ...sleepForm, wakeTime }),
              onNow: () =>
                setSleepForm({ ...sleepForm, wakeTime: nowTimeValue() }),
            })}

            <div className={cardClassName}>
              <label className="text-sm font-semibold text-slate-700">
                Sleep quality
              </label>
              <select
                className={`${inputClassName} min-h-[48px]`}
                value={sleepForm.quality}
                onChange={(e) =>
                  setSleepForm({ ...sleepForm, quality: e.target.value })
                }
              >
                <option value="">Select quality</option>
                <option>Good</option>
                <option>Broken</option>
                <option>Poor</option>
              </select>
            </div>

            <div className={cardClassName}>
              <label className="text-sm font-semibold text-slate-700">
                Night wakings
              </label>
              <input
                type="number"
                min="0"
                placeholder="0"
                className={`${inputClassName} min-h-[48px]`}
                value={sleepForm.nightWakings}
                onChange={(e) =>
                  setSleepForm({ ...sleepForm, nightWakings: e.target.value })
                }
              />
            </div>

            <div className={cardClassName}>
              <label className="text-sm font-semibold text-slate-700">
                Daytime nap
              </label>
              <select
                className={`${inputClassName} min-h-[48px]`}
                value={sleepForm.nap}
                onChange={(e) =>
                  setSleepForm({ ...sleepForm, nap: e.target.value })
                }
              >
                <option>No</option>
                <option>Yes</option>
              </select>
            </div>

            <div className={cardClassName}>
              <label className="text-sm font-semibold text-slate-700">
                Sleep duration
              </label>
              <div className="mt-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                {durationPreview || "Will calculate when wake-up time is entered"}
              </div>
            </div>

            <div className={`${cardClassName} md:col-span-2`}>
              <label className="text-sm font-semibold text-slate-700">Notes</label>
              <textarea
                rows={5}
                placeholder="Anything unusual about sleep"
                className={`${inputClassName} min-h-[48px]`}
                value={sleepForm.notes}
                onChange={(e) =>
                  setSleepForm({ ...sleepForm, notes: e.target.value })
                }
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={!canSaveWake}
              onClick={() =>
                runLockedSave("sleep-wake", async () => {
                  const saved = await saveSleepEntryToSupabase({ mode: "wake" });

                  if (!saved) return;

                  resetSleepForm();
                  closeSection();
                })
              }
              className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {activeSaveAction === "sleep-wake" || isSavingSleep
                ? "Saving..."
                : "Save wake-up"}
            </button>

            <button
              type="button"
              onClick={resetSleepForm}
              disabled={isSavingSleep || !!activeSaveAction}
              className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear sleep form
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderReportEntryCard = (entry) => {
    const theme = sectionTheme[entry.section] || {
      report: "border-slate-200 bg-slate-50",
    };

    return (
      <div
        key={entry.id}
        className={`rounded-2xl border px-4 py-3 text-sm text-slate-700 ${theme.report}`}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-bold leading-5 text-slate-900">{entry.summary}</p>
            <span className="mt-2 inline-flex rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
              {entry.section}
            </span>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {entry.time || "Time not set"}
          </span>
        </div>

        {entry.details?.length ? (
          <div className="mt-2 space-y-1 break-words text-[13px] leading-5 text-slate-600">
            {entry.details.map((detail, index) => (
              <p key={`${entry.id}-detail-${index}`}>{detail}</p>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderReportEntries = ({ mode = "screen" }) => {
    if (!dailyReportGroups.length) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm font-medium text-slate-500">
          No entries logged in the last 7 days.
        </div>
      );
    }

    if (mode === "pdf") {
      return (
        <div className="space-y-4">
          {dailyReportGroups.map((group) => (
            <div key={`pdf-${group.date}`} className="space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3">
                <h4 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-700">
                  {group.label}
                </h4>
              </div>
              <div className="space-y-3">
                {group.entries.map((entry) => renderReportEntryCard(entry))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {dailyReportGroups.map((group, index) => {
          const isOpen = reportOpenDays[group.date];

          return (
            <div
              key={group.date}
              className="rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <button
                type="button"
                onClick={() =>
                  setReportOpenDays((current) => ({
                    ...current,
                    [group.date]: !current[group.date],
                  }))
                }
                className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
              >
                <div>
                  <p className="text-sm font-bold text-slate-900">{group.label}</p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                    {index === 0 ? "Today first" : `${group.entries.length} entries`}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                  {isOpen ? "Hide" : "Show"}
                </span>
              </button>

              {isOpen ? (
                <div className="space-y-3 border-t border-slate-100 px-4 py-4">
                  {group.entries.map((entry) => renderReportEntryCard(entry))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderPdfExportArea = () => (
    <div className="fixed left-[-99999px] top-0 z-[-1]">
      <div
        id="report-pdf-export"
        className="w-[1123px] bg-white p-8 text-slate-900"
      >
        <div className="rounded-3xl border border-sky-100 bg-sky-50 px-8 py-6">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-400">
            Kaylen&apos;s Diary
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            7 day care summary
          </h1>
          <p className="mt-2 text-sm font-medium text-slate-500">
            Prepared for future sleep and milk trend graphs.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Total sleep
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {formatSleepDuration(reportSummary.totalSleepMinutes) || "0m"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Total milk
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {reportSummary.totalMilk}oz
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Latest weight
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {reportSummary.latestWeight ? `${reportSummary.latestWeight}kg` : "Not logged"}
            </p>
          </div>
        </div>

        <div className="mt-4">{renderReportEntries({ mode: "pdf" })}</div>
      </div>
    </div>
  );

  const renderReportsForm = () => {
    return (
      <>
        {renderPdfExportArea()}

        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Total sleep
              </p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatSleepDuration(reportSummary.totalSleepMinutes) || "0m"}
              </p>
              <p className="mt-1 text-sm text-slate-500">Last 7 days</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Total milk
              </p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {reportSummary.totalMilk}oz
              </p>
              <p className="mt-1 text-sm text-slate-500">Last 7 days</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Latest weight
              </p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {reportSummary.latestWeight ? `${reportSummary.latestWeight}kg` : "Not logged"}
              </p>
              <p className="mt-1 text-sm text-slate-500">Most recent health entry</p>
            </div>
          </div>

          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Future graphs
                </p>
                <p className="mt-1 text-sm font-medium text-slate-600">
                  Placeholder ready for sleep and milk trend charts.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                Structure only
              </span>
            </div>
          </div>

          <div>{renderReportEntries({ mode: "screen" })}</div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  if (
                    typeof navigator !== "undefined" &&
                    navigator.clipboard?.writeText
                  ) {
                    await navigator.clipboard.writeText(reportText);
                    setShareCopied(true);
                    setTimeout(() => setShareCopied(false), 2000);
                  }
                } catch (error) {
                  console.error("Copy failed", error);
                }
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              {shareCopied ? "Report copied" : "Copy report"}
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isExportingPdf}
              className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {isExportingPdf ? "Exporting PDF..." : "Export PDF"}
            </button>
          </div>
        </div>
      </>
    );
  };

  const renderActiveForm = () => {
    if (!activeSection) return null;

    switch (activeSection.title) {
      case "Food Diary":
        return renderFoodForm();
      case "Medication":
        return renderMedicationForm();
      case "Toileting":
        return renderToiletingForm();
      case "Health":
        return renderHealthForm();
      case "Sleep":
        return renderSleepForm();
      case "Reports":
        return renderReportsForm();
      default:
        return null;
    }
  };

  if (isCheckingPinSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-sky-50 px-6">
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 text-sm font-medium text-slate-600 shadow-sm">
          Checking saved PIN session...
        </div>
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-sky-50 px-6 py-10 text-slate-900 md:py-16">
        <div className="mx-auto max-w-md">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-xl md:p-10">
            <div className="text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-sky-200 to-sky-400 text-xl font-bold uppercase tracking-[0.22em] text-sky-900 shadow-lg">
                PIN
              </div>

              <div className="mt-6 rounded-3xl border border-sky-100 bg-sky-50 px-6 py-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-400">
                  Kaylen&apos;s Diary
                </p>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                  Care tracker unlock
                </h1>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                  Enter the PIN to access the diary. The app stays unlocked for up to
                  5 hours of inactivity.
                </p>
              </div>

              <div className="mt-8">
                <label className="text-sm font-semibold text-slate-700">PIN</label>

                <div className="mt-3 flex justify-center gap-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div
                      key={index}
                      className={`flex h-12 w-12 items-center justify-center rounded-xl border text-xl font-bold ${
                        passwordInput[index]
                          ? "border-sky-300 bg-sky-50 text-slate-900"
                          : "border-slate-200 bg-white text-slate-300"
                      }`}
                    >
                      {passwordInput[index] ? "*" : ""}
                    </div>
                  ))}
                </div>

                {passwordError ? (
                  <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                    {passwordError}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-8 grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handlePinPress(num)}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-xl font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
                >
                  {num}
                </button>
              ))}

              <button
                type="button"
                onClick={handlePinClear}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
              >
                Clear
              </button>

              <button
                type="button"
                onClick={() => handlePinPress("0")}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-xl font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
              >
                0
              </button>

              <button
                type="button"
                onClick={handlePinDelete}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
              >
                Delete
              </button>
            </div>

            <button
              type="button"
              onClick={handleUnlock}
              className="mt-6 flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-sky-400 to-sky-500 px-5 py-4 text-base font-semibold text-sky-950 shadow-md transition hover:scale-[1.01]"
            >
              Unlock diary
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isReportsOpen = activeSection?.title === "Reports";
  const pullProgress = Math.min(100, Math.round((pullDistance / 100) * 100));

  return (
    <div className="min-h-screen overscroll-y-contain bg-gradient-to-br from-slate-50 via-white to-sky-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-6 sm:px-5">
        <header className="space-y-3">
          <div className="rounded-[2rem] border border-sky-100 bg-white/90 px-5 py-5 shadow-sm backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-300">
                  Kaylen&apos;s Diary
                </p>
                <h1 className="mt-2 text-[1.75rem] font-bold tracking-tight text-slate-900">
                  Mobile care tracker
                </h1>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                  Fast, thumb-friendly logging for sleep, medication, food,
                  toileting, health, and reports.
                </p>
              </div>

              <button
                type="button"
                onClick={lockDiary}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                Lock
              </button>
            </div>
          </div>

          <div className="h-12 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex h-full items-center justify-between px-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Pull to refresh
                </p>
                <p className="text-sm font-medium text-slate-600">
                  {isRefreshing
                    ? "Refreshing diary..."
                    : pullDistance
                      ? `Release to refresh (${pullProgress}%)`
                      : "Pull down from the top"}
                </p>
              </div>
              <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${
                    isRefreshing ? "bg-sky-500" : "bg-sky-300"
                  }`}
                  style={{ width: `${isRefreshing ? 100 : pullProgress}%` }}
                />
              </div>
            </div>
          </div>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Quick overview
                </p>
                <p className="mt-1 text-sm font-medium text-slate-600">
                  Compact summary for today&apos;s care.
                </p>
              </div>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                Live
              </span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {quickOverview.map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    {item.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold leading-5 text-slate-900">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {shortcutItems.map((section) => (
                <button
                  key={section.title}
                  type="button"
                  onClick={() => openSection(section)}
                  className="min-w-[132px] shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-left shadow-sm transition hover:bg-white"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br text-[11px] font-bold uppercase tracking-[0.16em] text-white ${section.color}`}
                    >
                      {section.emoji}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {section.title}
                      </p>
                      <p className="truncate text-xs font-medium text-slate-500">
                        {section.latest}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </header>

        <section className="mt-5 rounded-[2rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Ready to log
              </p>
              <p className="mt-1 text-sm font-medium text-slate-600">
                Use the shortcut row above to open a section without extra clutter.
              </p>
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              Mobile first
            </p>
          </div>
        </section>
      </div>

      {activeSection ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 p-3 backdrop-blur-sm md:p-4">
          <div className="flex min-h-full items-start justify-center py-2 md:items-center md:py-4">
            <div
              className={`relative my-auto w-full rounded-[2rem] border border-slate-200 bg-white p-4 shadow-2xl sm:p-5 md:p-8 ${
                isReportsOpen ? "max-w-4xl" : "max-w-2xl"
              }`}
            >
              <button
                type="button"
                onClick={closeSection}
                className="absolute right-3 top-3 z-10 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm md:right-4 md:top-4"
              >
                Close
              </button>

              <div className="flex min-w-0 items-start gap-3 pr-14 md:pr-16">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-xs font-bold uppercase tracking-[0.16em] text-white shadow-md ${activeSection.color}`}
                >
                  {activeSection.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                    {activeSection.title}
                  </h3>
                  <p className="break-words pr-1 text-sm font-medium leading-5 text-slate-600">
                    {sectionHelpText}
                  </p>
                </div>
              </div>

              {renderActiveForm()}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
