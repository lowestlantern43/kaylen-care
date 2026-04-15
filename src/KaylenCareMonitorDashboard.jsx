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

const todayIsoValue = () => {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${year}-${month}-${day}`;
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

const parseDisplayDate = (value) => {
  if (!value || !value.includes("/")) return null;
  const [day, month, year] = value.split("/");
  const parsed = new Date(`${year}-${month}-${day}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseDisplayDateTime = (dateValue, timeValue = "") => {
  const parsedDate = parseDisplayDate(dateValue);
  if (!parsedDate) return null;

  if (!timeValue || !timeValue.includes(":")) return parsedDate;

  const [hours, minutes] = timeValue.split(":");
  const next = new Date(parsedDate);
  next.setHours(Number(hours) || 0, Number(minutes) || 0, 0, 0);
  return Number.isNaN(next.getTime()) ? parsedDate : next;
};

const parseIsoDate = (value, endOfDay = false) => {
  if (!value) return null;
  const parsed = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatHoursMinutes = (minutes) => {
  if (!minutes) return "0h";
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hrs && mins) return `${hrs}h ${mins}m`;
  if (hrs) return `${hrs}h`;
  return `${mins}m`;
};

const calculateBmi = (weightKg, heightCm) => {
  const weight = Number(weightKg);
  const height = Number(heightCm);
  if (!weight || !height) return null;
  const heightM = height / 100;
  if (!heightM) return null;
  return Number((weight / (heightM * heightM)).toFixed(1));
};

const formatMetric = (value, suffix) => {
  if (value === null || value === undefined || value === "") return "Not logged";
  return `${value}${suffix}`;
};

const PIN_STORAGE_KEY = "kaylen-diary-pin-session";
const PIN_INACTIVITY_LIMIT_MS = 5 * 60 * 60 * 1000;
const KAYLEN_BIRTHDATE_ISO = "2020-09-03";

const dateTimeInputClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

const smallActionButtonClass =
  "mt-2 shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

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
    case "Midazolam (rescue meds)":
      return "1 syringe";
    default:
      return "";
  }
};

export default function KaylenCareMonitorDashboard() {
  const APP_PASSWORD = "030920";

  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);

  const [activeSection, setActiveSection] = useState(null);
  const [medicationValue, setMedicationValue] = useState("");
  const [foodValue, setFoodValue] = useState("");
  const [reportDays, setReportDays] = useState("7");
  const [customReportDays, setCustomReportDays] = useState("7");
  const [reportTab, setReportTab] = useState("recent");
  const [reportLayout, setReportLayout] = useState("daily");
  const [reportCategoryFilter, setReportCategoryFilter] = useState("All");
  const [reportFiltersOpen, setReportFiltersOpen] = useState(false);
  const [reportStartDate, setReportStartDate] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(start.getDate()).padStart(2, "0")}`;
  });
  const [reportEndDate, setReportEndDate] = useState(todayIsoValue());
  const [sharedLog, setSharedLog] = useState([]);
  const [shareCopied, setShareCopied] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
  const [overviewIndex, setOverviewIndex] = useState(0);
  const [reportOverviewIndex, setReportOverviewIndex] = useState(0);

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
      subtitle: "Meals, drinks, amounts, and refusals",
      button: "Open Log",
      emoji: "🍽️",
      color: "from-amber-400 to-orange-500",
      soft: "bg-amber-50 border-amber-300",
    },
    {
      title: "Medication",
      subtitle: "Medicine, dose, who gave it, and notes",
      button: "Open Log",
      emoji: "💊",
      color: "from-rose-400 to-pink-500",
      soft: "bg-rose-50 border-rose-300",
    },
    {
      title: "Toileting",
      subtitle: "Toilet and nappy logs with notes",
      button: "Open Log",
      emoji: "🚽",
      color: "from-sky-400 to-blue-500",
      soft: "bg-sky-50 border-sky-300",
    },
    {
      title: "Health",
      subtitle: "Symptoms, seizures, actions taken",
      button: "Open Log",
      emoji: "🩺",
      color: "from-emerald-400 to-green-500",
      soft: "bg-emerald-50 border-emerald-300",
    },
    {
      title: "Sleep",
      subtitle: "Night sleep and wake-up tracking",
      button: "Open Log",
      emoji: "🌙",
      color: "from-indigo-400 to-purple-500",
      soft: "bg-indigo-50 border-indigo-300",
    },
    {
      title: "Reports",
      subtitle: "View and share recent entries",
      button: "View Reports",
      emoji: "📊",
      color: "from-fuchsia-400 to-pink-500",
      soft: "bg-fuchsia-50 border-fuchsia-300",
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
    "Midazolam (rescue meds)",
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
    "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

  const cardClassName =
    "rounded-2xl border border-slate-300 bg-slate-50/80 p-4 shadow-sm";

  const effectiveReportDays =
    reportDays === "custom"
      ? Math.max(1, Number(customReportDays) || 7)
      : Math.max(1, Number(reportDays) || 7);

  const reportRangeStart =
    reportDays === "custom"
      ? parseIsoDate(reportStartDate)
      : (() => {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          start.setDate(start.getDate() - (effectiveReportDays - 1));
          return start;
        })();

  const reportRangeEnd =
    reportDays === "custom"
      ? parseIsoDate(reportEndDate, true)
      : (() => {
          const end = new Date();
          end.setHours(23, 59, 59, 999);
          return end;
        })();

  const openSection = (section) => {
    setActiveSection(section);
    if (section.title !== "Medication") setMedicationValue("");
    if (section.title !== "Food Diary") setFoodValue("");
    if (section.title !== "Reports") {
      setReportFiltersOpen(false);
    }
    setShareCopied(false);
  };

  const closeSection = () => {
    setActiveSection(null);
    setMedicationValue("");
    setFoodValue("");
    setShareCopied(false);
    setReportFiltersOpen(false);
  };

  const storePinSession = () => {
    try {
      localStorage.setItem(
        PIN_STORAGE_KEY,
        JSON.stringify({
          unlockedAt: Date.now(),
          lastActivityAt: Date.now(),
        }),
      );
    } catch (error) {
      console.error("Unable to store PIN session", error);
    }
  };

  const clearPinSession = () => {
    try {
      localStorage.removeItem(PIN_STORAGE_KEY);
    } catch (error) {
      console.error("Unable to clear PIN session", error);
    }
  };

  const refreshPinSessionActivity = () => {
    try {
      const raw = localStorage.getItem(PIN_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed?.unlockedAt) return;
      localStorage.setItem(
        PIN_STORAGE_KEY,
        JSON.stringify({
          unlockedAt: parsed.unlockedAt,
          lastActivityAt: Date.now(),
        }),
      );
    } catch (error) {
      console.error("Unable to refresh PIN session", error);
    }
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
      storePinSession();
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

    const mappedMilkEntries = (milkData || []).map((row) => {
      const entryDate = parseNotesValue(row.notes, "Date") || todayValue();
      const entryTime = parseNotesValue(row.notes, "Time") || "";

      return {
        id: `milk-${row.id}`,
        createdAt:
          parseDisplayDateTime(entryDate, entryTime)?.toISOString() ||
          row.time ||
          new Date().toISOString(),
        section: "Food Diary",
        date: entryDate,
        time: entryTime,
        amountOz: Number(row.amount || 0),
        isMilk: true,
        summary: `${parseNotesValue(row.notes, "Item") || "Milk"} - ${
          row.amount || 0
        }oz`,
        details: [
          `Location: ${parseNotesValue(row.notes, "Location") || "Not set"}`,
          parseNotesValue(row.notes, "Notes")
            ? `Notes: ${parseNotesValue(row.notes, "Notes")}`
            : null,
        ].filter(Boolean),
      };
    });

    const mappedFoodEntries = (foodData || []).map((row) => {
      const entryDate = parseNotesValue(row.notes, "Date") || todayValue();
      const entryTime = parseNotesValue(row.notes, "Time") || "";

      return {
        id: `food-${row.id}`,
        createdAt:
          parseDisplayDateTime(entryDate, entryTime)?.toISOString() ||
          row.time ||
          new Date().toISOString(),
        section: "Food Diary",
        date: entryDate,
        time: entryTime,
        summary: `${row.item || "Food entry"} - ${row.amount || "No amount"}`,
        details: [
          `Location: ${parseNotesValue(row.notes, "Location") || "Not set"}`,
          parseNotesValue(row.notes, "Notes")
            ? `Notes: ${parseNotesValue(row.notes, "Notes")}`
            : null,
        ].filter(Boolean),
      };
    });

    const mappedMedicationEntries = (medicationData || []).map((row) => {
      const entryDate = parseNotesValue(row.notes, "Date") || todayValue();
      const entryTime = parseNotesValue(row.notes, "Time") || "";

      return {
        id: `medication-${row.id}`,
        createdAt:
          parseDisplayDateTime(entryDate, entryTime)?.toISOString() ||
          row.time ||
          new Date().toISOString(),
        section: "Medication",
        date: entryDate,
        time: entryTime,
        summary: `${row.medicine || "Medication"} - ${row.dose || "No dose"}`,
        details: [
          `Given by: ${parseNotesValue(row.notes, "Given by") || "Not set"}`,
          parseNotesValue(row.notes, "Notes")
            ? `Notes: ${parseNotesValue(row.notes, "Notes")}`
            : null,
        ].filter(Boolean),
      };
    });

    const mappedToiletingEntries = (toiletingData || []).map((row) => {
      const entryDate = parseNotesValue(row.notes, "Date") || todayValue();
      const entryTime = parseNotesValue(row.notes, "Time") || "";

      return {
        id: `toileting-${row.id}`,
        createdAt:
          parseDisplayDateTime(entryDate, entryTime)?.toISOString() ||
          row.time ||
          new Date().toISOString(),
        section: "Toileting",
        date: entryDate,
        time: entryTime,
        summary: row.entry || "Toileting entry",
        details: [
          parseNotesValue(row.notes, "Notes")
            ? `Notes: ${parseNotesValue(row.notes, "Notes")}`
            : null,
        ].filter(Boolean),
      };
    });

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
        createdAt:
          parseDisplayDateTime(entryDate, row.bedtime || "")?.toISOString() ||
          row.time ||
          new Date().toISOString(),
        section: "Sleep",
        date: entryDate,
        time: row.bedtime || "",
        durationMinutes,
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

    const mappedHealthEntries = (healthData || []).map((row) => {
      const entryDate = parseNotesValue(row.notes, "Date") || todayValue();
      const entryTime = parseNotesValue(row.notes, "Time") || "";

      return {
        id: `health-${row.id}`,
        createdAt:
          parseDisplayDateTime(entryDate, entryTime)?.toISOString() ||
          row.time ||
          new Date().toISOString(),
        section: "Health",
        date: entryDate,
        time: entryTime,
        event: row.event || "Health",
        weightKg: row.weight_kg || "",
        heightCm: row.height_cm || "",
        bmi: calculateBmi(row.weight_kg || "", row.height_cm || ""),
        summary: `${row.event || "Health"} - ${row.duration || "No duration"}`,
        details: [
          row.happened ? `What happened: ${row.happened}` : null,
          row.action ? `Action taken: ${row.action}` : null,
          row.weight_kg ? `Weight (kg): ${row.weight_kg}` : null,
          row.height_cm ? `Height (cm): ${row.height_cm}` : null,
          calculateBmi(row.weight_kg || "", row.height_cm || "")
            ? `BMI: ${calculateBmi(row.weight_kg || "", row.height_cm || "")}`
            : null,
          parseNotesValue(row.notes, "Notes")
            ? `Notes: ${parseNotesValue(row.notes, "Notes")}`
            : null,
        ].filter(Boolean),
      };
    });

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
      setTimeout(() => setIsRefreshing(false), 400);
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIN_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const lastActivityAt = Number(parsed?.lastActivityAt || 0);
      if (Date.now() - lastActivityAt <= PIN_INACTIVITY_LIMIT_MS) {
        setIsUnlocked(true);
      } else {
        clearPinSession();
      }
    } catch (error) {
      console.error("Unable to restore PIN session", error);
      clearPinSession();
    }
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
    if (!isUnlocked) return undefined;

    refreshPinSessionActivity();

    const events = ["pointerdown", "keydown", "touchstart", "scroll"];
    const markActive = () => refreshPinSessionActivity();
    const interval = setInterval(() => {
      try {
        const raw = localStorage.getItem(PIN_STORAGE_KEY);
        if (!raw) {
          setIsUnlocked(false);
          return;
        }
        const parsed = JSON.parse(raw);
        const lastActivityAt = Number(parsed?.lastActivityAt || 0);
        if (Date.now() - lastActivityAt > PIN_INACTIVITY_LIMIT_MS) {
          clearPinSession();
          setIsUnlocked(false);
          setActiveSection(null);
          setPasswordInput("");
        }
      } catch (error) {
        console.error("Unable to validate PIN session", error);
        clearPinSession();
        setIsUnlocked(false);
      }
    }, 60000);

    events.forEach((eventName) =>
      window.addEventListener(eventName, markActive, { passive: true }),
    );

    return () => {
      clearInterval(interval);
      events.forEach((eventName) =>
        window.removeEventListener(eventName, markActive),
      );
    };
  }, [isUnlocked]);

  useEffect(() => {
    if (!isUnlocked) return;

    const handleTouchStart = (e) => {
      if (window.scrollY > 0 || activeSection) return;
      touchStartY.current = e.touches[0].clientY;
      touchCurrentY.current = e.touches[0].clientY;
      isPullingRef.current = true;
    };

    const handleTouchMove = (e) => {
      if (!isPullingRef.current) return;
      touchCurrentY.current = e.touches[0].clientY;
    };

    const handleTouchEnd = async () => {
      if (!isPullingRef.current) return;
      const pullDistance = touchCurrentY.current - touchStartY.current;
      isPullingRef.current = false;

      if (pullDistance > 110) {
        await refreshAllData();
      }
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
        return "Food saves into the same shared log as everything else.";
      case "Medication":
        return "Log medicine, dose, who gave it, and any notes.";
      case "Toileting":
        return "Log toilet or nappy changes with any extra notes.";
      case "Health":
        return "Record health events and measurements like weight and height.";
      case "Sleep":
        return "Log bedtime first, then complete wake-up the next morning.";
      case "Reports":
        return "View recent entries and export a proper PDF.";
      default:
        return "Form preview";
    }
  }, [activeSection]);

  const recentEntries = useMemo(() => {
    return sharedLog.filter((entry) => {
      const entryDate = parseDisplayDate(entry.date);
      if (!entryDate || !reportRangeStart || !reportRangeEnd) return false;
      if (entryDate < reportRangeStart || entryDate > reportRangeEnd) return false;

      if (
        reportCategoryFilter !== "All" &&
        entry.section !== reportCategoryFilter
      ) {
        return false;
      }

      return true;
    });
  }, [reportCategoryFilter, reportRangeEnd, reportRangeStart, sharedLog]);

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

  const overviewItems = useMemo(
    () => [
      {
        key: "sleep",
        title: "Sleep",
        emoji: "🌙",
        tone: "border-indigo-200 bg-indigo-50 text-indigo-800",
        summary: latestTwoBySection.sleep[0]?.summary || "Nothing logged yet",
        meta:
          latestTwoBySection.sleep[0]?.time ||
          latestTwoBySection.sleep[0]?.date ||
          "No recent entry",
      },
      {
        key: "medication",
        title: "Medication",
        emoji: "💊",
        tone: "border-rose-200 bg-rose-50 text-rose-800",
        summary:
          latestTwoBySection.medication[0]?.summary || "Nothing logged yet",
        meta:
          latestTwoBySection.medication[0]?.time ||
          latestTwoBySection.medication[0]?.date ||
          "No recent entry",
      },
      {
        key: "food",
        title: "Food",
        emoji: "🍽️",
        tone: "border-amber-200 bg-amber-50 text-amber-800",
        summary: latestTwoBySection.food[0]?.summary || "Nothing logged yet",
        meta:
          latestTwoBySection.food[0]?.time ||
          latestTwoBySection.food[0]?.date ||
          "No recent entry",
      },
      {
        key: "toileting",
        title: "Toileting",
        emoji: "🚽",
        tone: "border-sky-200 bg-sky-50 text-sky-800",
        summary:
          latestTwoBySection.toileting[0]?.summary || "Nothing logged yet",
        meta:
          latestTwoBySection.toileting[0]?.time ||
          latestTwoBySection.toileting[0]?.date ||
          "No recent entry",
      },
      {
        key: "health",
        title: "Health",
        emoji: "🩺",
        tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
        summary: latestTwoBySection.health[0]?.summary || "Nothing logged yet",
        meta:
          latestTwoBySection.health[0]?.time ||
          latestTwoBySection.health[0]?.date ||
          "No recent entry",
      },
    ],
    [latestTwoBySection],
  );

  useEffect(() => {
    if (!overviewItems.length) return;
    const timer = setInterval(() => {
      setOverviewIndex((current) => (current + 1) % overviewItems.length);
    }, 3200);
    return () => clearInterval(timer);
  }, [overviewItems.length]);

  useEffect(() => {
    const reportCardCount = 3;
    const timer = setInterval(() => {
      setReportOverviewIndex((current) => (current + 1) % reportCardCount);
    }, 3200);
    return () => clearInterval(timer);
  }, []);

  const activeOverview = overviewItems[overviewIndex] || overviewItems[0];

  const groupedReportEntries = useMemo(() => {
    const groups = {
      "Food Diary": [],
      Medication: [],
      Toileting: [],
      Health: [],
      Sleep: [],
    };

    recentEntries.forEach((entry) => {
      if (groups[entry.section]) {
        groups[entry.section].push(entry);
      }
    });

    return groups;
  }, [recentEntries]);

  const timelineGroups = useMemo(() => {
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

  const last7DaysEntries = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);

    return sharedLog.filter((entry) => {
      const entryDate = parseDisplayDate(entry.date);
      return entryDate && entryDate >= start && entryDate <= end;
    });
  }, [sharedLog]);

  const weeklyReportStats = useMemo(() => {
    const totalSleepMinutes = last7DaysEntries
      .filter((entry) => entry.section === "Sleep")
      .reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);

    const totalMilkOz = last7DaysEntries
      .filter((entry) => entry.isMilk)
      .reduce((sum, entry) => sum + Number(entry.amountOz || 0), 0);

    const latestMeasurement = [...sharedLog].find(
      (entry) => entry.section === "Health" && (entry.weightKg || entry.heightCm),
    );

    return {
      totalSleepMinutes,
      totalMilkOz,
      latestMeasurement,
    };
  }, [last7DaysEntries, sharedLog]);

  const measurementEntries = useMemo(
    () =>
      sharedLog
        .filter(
          (entry) =>
            entry.section === "Health" &&
            (entry.weightKg || entry.heightCm || entry.bmi),
        )
        .map((entry) => ({
          ...entry,
          parsedDate: parseDisplayDate(entry.date),
        }))
        .filter((entry) => entry.parsedDate)
        .sort((a, b) => a.parsedDate - b.parsedDate),
    [sharedLog],
  );

  const measurementChartStats = useMemo(() => {
    const weights = measurementEntries
      .map((entry) => Number(entry.weightKg))
      .filter(Boolean);
    const heights = measurementEntries
      .map((entry) => Number(entry.heightCm))
      .filter(Boolean);
    const bmis = measurementEntries
      .map((entry) => Number(entry.bmi))
      .filter(Boolean);

    return {
      weightMin: weights.length ? Math.min(...weights) : 0,
      weightMax: weights.length ? Math.max(...weights) : 0,
      heightMin: heights.length ? Math.min(...heights) : 0,
      heightMax: heights.length ? Math.max(...heights) : 0,
      bmiMin: bmis.length ? Math.min(...bmis) : 0,
      bmiMax: bmis.length ? Math.max(...bmis) : 0,
    };
  }, [measurementEntries]);

  const tileStatusText = (sectionTitle) => {
    const formatList = (entries) => {
      if (!entries.length) return ["Nothing logged yet"];
      return entries.map(
        (entry) => `${entry.summary}${entry.time ? ` · ${entry.time}` : ""}`,
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

  const reportText = useMemo(() => {
    if (reportLayout === "daily") {
      return [
        `Kaylen's Diary Report - Last ${effectiveReportDays} days`,
        `Daily view${
          reportCategoryFilter !== "All" ? ` - ${reportCategoryFilter}` : ""
        }`,
        "",
        ...recentEntries.flatMap((entry) => [
          `${entry.date}${entry.time ? ` ${entry.time}` : ""} · ${entry.section}`,
          entry.summary,
          ...(entry.details?.length ? entry.details : []),
          "",
        ]),
        ...(recentEntries.length ? [] : ["No entries found for this date range."]),
      ].join("\n");
    }

    const order = ["Food Diary", "Medication", "Toileting", "Health", "Sleep"];

    return [
      `Kaylen's Diary Report - Last ${effectiveReportDays} days`,
      `Summary view${
        reportCategoryFilter !== "All" ? ` - ${reportCategoryFilter}` : ""
      }`,
      "",
      ...order.flatMap((section) => {
        const entries = groupedReportEntries[section] || [];
        if (!entries.length) return [];
        return [
          section.toUpperCase(),
          ...entries.flatMap((entry) => [
            `${entry.date}${entry.time ? ` ${entry.time}` : ""}`,
            entry.summary,
            ...(entry.details?.length ? entry.details : []),
            "",
          ]),
        ];
      }),
      ...(recentEntries.length ? [] : ["No entries found for this date range."]),
    ].join("\n");
  }, [
    effectiveReportDays,
    groupedReportEntries,
    recentEntries,
    reportCategoryFilter,
      reportLayout,
  ]);

  const saveFoodEntryToSupabase = async ({
    selectedFood,
    selectedLocation,
    isMilk,
  }) => {
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

    return true;
  };

  const saveMedicationEntryToSupabase = async ({
    selectedMedicine,
    selectedGivenBy,
  }) => {
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

    return true;
  };

  const saveToiletingEntryToSupabase = async () => {
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

        console.log("SLEEP CREATED:", data);

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
    const payload = {
      event: healthForm.event || "Health",
      duration: healthForm.duration || "",
      time: new Date().toISOString(),
      happened: healthForm.happened || "",
      action: healthForm.action || "",
      weight_kg: healthForm.weightKg || "",
      height_cm: healthForm.heightCm || "",
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
        `kaylens-diary-report-${effectiveReportDays}-days-${reportLayout.toLowerCase()}.pdf`,
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
    const notesRequiredMedicines = ["Melatonin", "Midazolam (rescue meds)"];
    const notesRequired = notesRequiredMedicines.includes(selectedMedicine);

    const showOtherGivenBy = medicationForm.givenBy === "Other";
    const selectedGivenBy = showOtherGivenBy
      ? medicationForm.otherGivenBy || "Other"
      : medicationForm.givenBy || "";

    const canSaveMedication =
      !!selectedMedicine.trim() &&
      !!medicationForm.dose.trim() &&
      !!medicationForm.time.trim() &&
      !!medicationForm.date.trim() &&
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
            <option value="">Select regular medication</option>
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
              selectedMedicine === "Midazolam (rescue meds)"
                ? "Notes required for Midazolam"
                : notesRequired
                  ? "Notes required for this medicine"
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
                  alert(`Notes are required for ${selectedMedicine}`);
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
            <option>Measurements</option>
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

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Measurements
          </label>
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
          {healthForm.weightKg && healthForm.heightCm ? (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              BMI: {calculateBmi(healthForm.weightKg, healthForm.heightCm) || "Not available"}
            </div>
          ) : null}
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

  const renderTrendChart = ({
    entries,
    valueKey,
    label,
    suffix,
    strokeClass,
    fillClass,
    minValue,
    maxValue,
  }) => {
    const chartEntries = entries.filter((entry) => Number(entry[valueKey]));
    if (!chartEntries.length) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-sm font-medium text-slate-500">
          No {label.toLowerCase()} logged yet.
        </div>
      );
    }

    const range = maxValue - minValue || 1;
    const points = chartEntries
      .map((entry, index) => {
        const x =
          chartEntries.length === 1
            ? 50
            : (index / (chartEntries.length - 1)) * 100;
        const value = Number(entry[valueKey]);
        const y = 90 - ((value - minValue) / range) * 70;
        return `${x},${y}`;
      })
      .join(" ");

    const latest = chartEntries[chartEntries.length - 1];

    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              {label}
            </p>
            <p className="mt-1 text-lg font-bold text-slate-900">
              {latest[valueKey]}
              {suffix}
            </p>
          </div>
          <p className="text-right text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Since {KAYLEN_BIRTHDATE_ISO}
          </p>
        </div>

        <svg viewBox="0 0 100 100" className="mt-4 h-32 w-full overflow-visible">
          <line x1="0" y1="90" x2="100" y2="90" className="stroke-slate-200" />
          <polyline
            fill="none"
            points={points}
            className={`${strokeClass} stroke-[3]`}
          />
          <polyline
            fill="none"
            points={points}
            className={`${fillClass} stroke-[8] opacity-20`}
          />
          {chartEntries.map((entry, index) => {
            const x =
              chartEntries.length === 1
                ? 50
                : (index / (chartEntries.length - 1)) * 100;
            const value = Number(entry[valueKey]);
            const y = 90 - ((value - minValue) / range) * 70;
            return (
              <circle
                key={`${valueKey}-${entry.id}`}
                cx={x}
                cy={y}
                r="2.8"
                className={strokeClass}
              />
            );
          })}
        </svg>

        <div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-500">
          <span>{chartEntries[0].date}</span>
          <span>{latest.date}</span>
        </div>
      </div>
    );
  };

  const renderReportEntries = ({ mode = "screen", layout = reportLayout }) => {
    if (!recentEntries.length) {
      return (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm font-medium text-slate-500">
          Nothing logged yet for these filters.
        </div>
      );
    }

    if (layout === "daily") {
      return (
        <div className="space-y-3">
          {timelineGroups.map((group, index) => {
            const sleepMinutes = group.entries
              .filter((entry) => entry.section === "Sleep")
              .reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);
            const milkOz = group.entries
              .filter((entry) => entry.isMilk)
              .reduce((sum, entry) => sum + Number(entry.amountOz || 0), 0);
            const medsCount = group.entries.filter(
              (entry) => entry.section === "Medication",
            ).length;
            const healthCount = group.entries.filter(
              (entry) => entry.section === "Health",
            ).length;

            return (
              <details
                key={group.date}
                open={mode === "pdf" || index === 0}
                className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm"
              >
                <summary className="list-none cursor-pointer px-4 py-4 md:px-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                        {group.label}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-700">
                          {index === 0 ? "Today first" : `${group.entries.length} entries`}
                        </p>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
                          {group.entries.length} item{group.entries.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-700">
                        Sleep {formatHoursMinutes(sleepMinutes)}
                      </span>
                      <span className="rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700">
                        Milk {milkOz}oz
                      </span>
                      <span className="rounded-full bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-700">
                        Meds {medsCount}
                      </span>
                      <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
                        Health {healthCount}
                      </span>
                    </div>

                    <div className="hidden lg:flex items-center">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                        Open
                      </span>
                    </div>
                  </div>
                </summary>

                <div className="border-t border-slate-100 bg-slate-50/60 px-4 pb-4 pt-3 md:px-5">
                  <div className="space-y-2.5">
                    {group.entries.map((entry) => {
                      const theme = sectionTheme[entry.section] || {
                        report: "border-slate-200 bg-slate-50",
                      };

                      return (
                        <div
                          key={entry.id}
                          className={`rounded-2xl border px-3 py-3 text-sm text-slate-700 shadow-sm ${theme.report}`}
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="inline-flex rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
                                  {entry.section}
                                </div>
                                <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                  {entry.time || "Time not set"}
                                </span>
                              </div>

                              <p className="mt-2 font-bold leading-5 text-slate-900">
                                {entry.summary}
                              </p>
                            </div>

                            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 sm:pt-1">
                              {entry.date}
                            </span>
                          </div>

                          {entry.details?.length ? (
                            <div className="mt-2.5 rounded-xl bg-white/70 px-3 py-2.5">
                              <div className="space-y-1 break-words text-[13px] leading-5 text-slate-600">
                                {entry.details.map((detail, detailIndex) => (
                                  <p key={detailIndex}>{detail}</p>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      );
    }

    const latestMeasurement = weeklyReportStats.latestMeasurement;
    const summaryCards = [
      {
        title: "Sleep",
        value: formatHoursMinutes(
          recentEntries
            .filter((entry) => entry.section === "Sleep")
            .reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0),
        ),
        meta: `${recentEntries.filter((entry) => entry.section === "Sleep").length} sleep logs`,
      },
      {
        title: "Milk",
        value: `${recentEntries
          .filter((entry) => entry.isMilk)
          .reduce((sum, entry) => sum + Number(entry.amountOz || 0), 0)}oz`,
        meta: `${recentEntries.filter((entry) => entry.isMilk).length} milk logs`,
      },
      {
        title: "Weight",
        value: formatMetric(latestMeasurement?.weightKg || "", "kg"),
        meta: latestMeasurement?.date || "No measurement yet",
      },
      {
        title: "Height",
        value: formatMetric(latestMeasurement?.heightCm || "", "cm"),
        meta: latestMeasurement?.date || "No measurement yet",
      },
      {
        title: "BMI",
        value: latestMeasurement?.bmi ? `${latestMeasurement.bmi}` : "Not logged",
        meta: "Latest measurement",
      },
      {
        title: "Entries",
        value: `${recentEntries.length}`,
        meta: reportCategoryFilter === "All" ? "All categories" : reportCategoryFilter,
      },
    ];

    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {summaryCards.map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                {card.title}
              </p>
              <p className="mt-2 text-xl font-bold text-slate-900">{card.value}</p>
              <p className="mt-1 text-sm font-medium text-slate-500">{card.meta}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-3">
          {renderTrendChart({
            entries: measurementEntries,
            valueKey: "weightKg",
            label: "Weight trend",
            suffix: "kg",
            strokeClass: "stroke-emerald-500",
            fillClass: "stroke-emerald-300",
            minValue: measurementChartStats.weightMin,
            maxValue: measurementChartStats.weightMax,
          })}
          {renderTrendChart({
            entries: measurementEntries,
            valueKey: "heightCm",
            label: "Height trend",
            suffix: "cm",
            strokeClass: "stroke-sky-500",
            fillClass: "stroke-sky-300",
            minValue: measurementChartStats.heightMin,
            maxValue: measurementChartStats.heightMax,
          })}
          {renderTrendChart({
            entries: measurementEntries,
            valueKey: "bmi",
            label: "BMI trend",
            suffix: "",
            strokeClass: "stroke-violet-500",
            fillClass: "stroke-violet-300",
            minValue: measurementChartStats.bmiMin,
            maxValue: measurementChartStats.bmiMax,
          })}
        </div>
      </div>
    );
  };

  const renderPdfExportArea = () => (
    <div className="fixed left-[-99999px] top-0 z-[-1]">
      <div
        id="report-pdf-export"
        className="w-[1123px] bg-white p-8 text-slate-900"
      >
        <div className="rounded-2xl border border-sky-100 bg-sky-50 px-6 py-4">
          <h1 className="text-center text-2xl font-bold uppercase tracking-[0.18em] text-sky-300">
            Kaylen's Diary
          </h1>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-300 bg-slate-50 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                Report summary
              </p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">
                {reportLayout === "daily" ? "Daily log view" : "Summary view"}
                {reportCategoryFilter !== "All" ? ` - ${reportCategoryFilter}` : ""}
              </h2>
            </div>
            <div className="text-right text-sm font-semibold text-slate-600">
              <p>
                {reportDays === "custom"
                  ? `${reportStartDate || "Start"} to ${reportEndDate || "End"}`
                  : `Last ${effectiveReportDays} day${effectiveReportDays === 1 ? "" : "s"}`}
              </p>
              <p>
                {recentEntries.length} entr{recentEntries.length === 1 ? "y" : "ies"}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4">{renderReportEntries({ mode: "pdf", layout: reportLayout })}</div>
      </div>
    </div>
  );

  const renderReportsForm = () => {
    const filtersLabel =
      reportCategoryFilter === "All"
        ? "All categories"
        : reportCategoryFilter;

    const reportInputClassName =
      "mt-2 min-h-[44px] w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

    const invalidCustomRange =
      reportDays === "custom" &&
      reportRangeStart &&
      reportRangeEnd &&
      reportRangeStart > reportRangeEnd;

    const tabButtonClass = (tab) =>
      `rounded-2xl px-4 py-3 text-sm font-semibold transition ${
        reportTab === tab
          ? "bg-slate-900 text-white shadow-sm"
          : "bg-white text-slate-600 hover:bg-slate-50"
      }`;

    const topStats = [
      {
        title: "Sleep",
        icon: sections.find((section) => section.title === "Sleep")?.emoji || "S",
        value: formatHoursMinutes(weeklyReportStats.totalSleepMinutes),
        meta: "Last 7 days",
        tone: "border-indigo-200 bg-indigo-50 text-indigo-800",
      },
      {
        title: "Milk",
        icon: sections.find((section) => section.title === "Food Diary")?.emoji || "M",
        value: `${weeklyReportStats.totalMilkOz}oz`,
        meta: "Last 7 days",
        tone: "border-amber-200 bg-amber-50 text-amber-800",
      },
      {
        title: "Weight",
        icon: sections.find((section) => section.title === "Health")?.emoji || "W",
        value: formatMetric(weeklyReportStats.latestMeasurement?.weightKg || "", "kg"),
        meta: weeklyReportStats.latestMeasurement?.date || "Latest measurement",
        tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
      },
    ];

    const activeReportStat = topStats[reportOverviewIndex] || topStats[0];

    return (
      <>
        {renderPdfExportArea()}

        <div className="mt-6 space-y-4">
          <div className={`rounded-[1.75rem] border p-3 shadow-sm ${activeReportStat.tone}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/80 text-2xl shadow-sm">
                  {activeReportStat.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.16em]">
                    {activeReportStat.title}
                  </p>
                  <p className="mt-1 text-lg font-bold text-slate-900">
                    {activeReportStat.value}
                  </p>
                  <p className="text-xs font-semibold text-slate-500">
                    {activeReportStat.meta}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {topStats.map((stat, index) => (
                  <span
                    key={`report-stat-${stat.title}`}
                    className={`h-2 w-2 rounded-full transition ${
                      index === reportOverviewIndex ? "bg-slate-700" : "bg-slate-300"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-3 shadow-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <button type="button" onClick={() => setReportTab("recent")} className={tabButtonClass("recent")}>
                Daily logs
              </button>
              <button type="button" onClick={() => setReportTab("summary")} className={tabButtonClass("summary")}>
                Trends
              </button>
              <button type="button" onClick={() => setReportTab("export")} className={tabButtonClass("export")}>
                Export
              </button>
            </div>
          </div>

          {reportTab === "recent" ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  Daily logs
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Day-by-day logs with today at the top. Open only the days you want to read.
                </p>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,220px)_minmax(0,220px)]">
                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">
                    Range
                  </label>
                  <select
                    className={reportInputClassName}
                    value={reportDays}
                    onChange={(e) => setReportDays(e.target.value)}
                  >
                    <option value="7">Last 7 days</option>
                    <option value="14">Last 14 days</option>
                    <option value="30">Last 30 days</option>
                    <option value="custom">Custom range</option>
                  </select>
                </div>

                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">
                    Filter
                  </label>
                  <select
                    className={reportInputClassName}
                    value={reportCategoryFilter}
                    onChange={(e) => setReportCategoryFilter(e.target.value)}
                  >
                    <option value="All">All categories</option>
                    <option value="Food Diary">Food Diary</option>
                    <option value="Medication">Medication</option>
                    <option value="Toileting">Toileting</option>
                    <option value="Health">Health</option>
                    <option value="Sleep">Sleep</option>
                  </select>
                </div>
              </div>

              {reportDays === "custom" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className={cardClassName}>
                    <label className="text-sm font-semibold text-slate-700">Start date</label>
                    <input
                      type="date"
                      className={reportInputClassName}
                      value={reportStartDate}
                      onChange={(e) => setReportStartDate(e.target.value)}
                    />
                  </div>
                  <div className={cardClassName}>
                    <label className="text-sm font-semibold text-slate-700">End date</label>
                    <input
                      type="date"
                      className={reportInputClassName}
                      value={reportEndDate}
                      onChange={(e) => setReportEndDate(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}

              {invalidCustomRange ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  End date must be on or after the start date.
                </div>
              ) : null}

              {renderReportEntries({ mode: "screen", layout: "daily" })}
            </div>
          ) : null}

          {reportTab === "summary" ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Trends</p>
                <p className="mt-1 text-sm text-slate-600">
                  Cleaner totals and graphs for spotting patterns without all the logs underneath.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">Range</label>
                  <select
                    className={reportInputClassName}
                    value={reportDays}
                    onChange={(e) => setReportDays(e.target.value)}
                  >
                    <option value="7">Last 7 days</option>
                    <option value="14">Last 14 days</option>
                    <option value="30">Last 30 days</option>
                    <option value="60">Last 60 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="custom">Custom range</option>
                  </select>
                </div>
                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">Filter</label>
                  <select
                    className={reportInputClassName}
                    value={reportCategoryFilter}
                    onChange={(e) => setReportCategoryFilter(e.target.value)}
                  >
                    <option value="All">All categories</option>
                    <option value="Food Diary">Food Diary</option>
                    <option value="Medication">Medication</option>
                    <option value="Toileting">Toileting</option>
                    <option value="Health">Health</option>
                    <option value="Sleep">Sleep</option>
                  </select>
                </div>
              </div>

              {reportDays === "custom" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className={cardClassName}>
                    <label className="text-sm font-semibold text-slate-700">Start date</label>
                    <input
                      type="date"
                      className={reportInputClassName}
                      value={reportStartDate}
                      onChange={(e) => setReportStartDate(e.target.value)}
                    />
                  </div>
                  <div className={cardClassName}>
                    <label className="text-sm font-semibold text-slate-700">End date</label>
                    <input
                      type="date"
                      className={reportInputClassName}
                      value={reportEndDate}
                      onChange={(e) => setReportEndDate(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}

              {invalidCustomRange ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  End date must be on or after the start date.
                </div>
              ) : null}

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                  <span className="rounded-full bg-slate-100 px-3 py-1">{filtersLabel}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">
                    {reportDays === "custom"
                      ? `${reportStartDate || "Start"} to ${reportEndDate || "End"}`
                      : `Last ${effectiveReportDays} days`}
                  </span>
                </div>
              </div>

              {renderReportEntries({ mode: "screen", layout: "summary" })}
            </div>
          ) : null}

          {reportTab === "export" ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Export</p>
                <p className="mt-1 text-sm text-slate-600">
                  Pick the date range and report style, then copy or export the finished report.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">Report type</label>
                  <select
                    className={reportInputClassName}
                    value={reportLayout}
                    onChange={(e) => setReportLayout(e.target.value)}
                  >
                    <option value="daily">Full daily log</option>
                    <option value="summary">Summary with graphs</option>
                  </select>
                </div>
                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">Filter</label>
                  <select
                    className={reportInputClassName}
                    value={reportCategoryFilter}
                    onChange={(e) => setReportCategoryFilter(e.target.value)}
                  >
                    <option value="All">All categories</option>
                    <option value="Food Diary">Food Diary</option>
                    <option value="Medication">Medication</option>
                    <option value="Toileting">Toileting</option>
                    <option value="Health">Health</option>
                    <option value="Sleep">Sleep</option>
                  </select>
                </div>
                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">Start date</label>
                  <input
                    type="date"
                    className={reportInputClassName}
                    value={reportStartDate}
                    onChange={(e) => {
                      setReportDays("custom");
                      setReportStartDate(e.target.value);
                    }}
                  />
                </div>
                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">End date</label>
                  <input
                    type="date"
                    className={reportInputClassName}
                    value={reportEndDate}
                    onChange={(e) => {
                      setReportDays("custom");
                      setReportEndDate(e.target.value);
                    }}
                  />
                </div>
              </div>

              {invalidCustomRange ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  End date must be on or after the start date.
                </div>
              ) : null}

              <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h4 className="text-lg font-bold text-slate-900">
                      Create the report only when you need it
                    </h4>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <button
                      type="button"
                      onClick={async () => {
                        if (invalidCustomRange) return;
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
                      disabled={invalidCustomRange}
                      className={`rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {shareCopied ? "Copied" : "Copy report"}
                    </button>
                    <button
                      type="button"
                      onClick={handleExportPdf}
                      disabled={isExportingPdf || invalidCustomRange}
                      className="rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isExportingPdf ? "Exporting..." : "Export PDF"}
                    </button>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm">
                      {reportLayout === "daily" ? "Full daily log" : "Summary with graphs"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
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

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-slate-100 px-6 py-10 text-slate-900 md:py-16">
        <div className="mx-auto max-w-md">
          <div className="rounded-[2rem] border border-slate-300 bg-white p-8 shadow-xl md:p-10">
            <div className="text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-400 to-purple-500 text-4xl text-white shadow-lg">
                🔒
              </div>

              <div className="mt-6 w-full rounded-2xl border border-sky-100 bg-sky-50 px-6 py-4 shadow-md">
                <h1 className="text-center text-xl font-bold uppercase tracking-[0.18em] text-sky-300 md:text-2xl">
                  Kaylen's Diary
                </h1>
              </div>

              <p className="mt-3 text-sm font-medium leading-6 text-slate-600">
                Enter PIN to access the diary. This device stays unlocked unless inactive for 5 hours.
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
                        ? "border-indigo-400 bg-indigo-50 text-slate-900"
                        : "border-slate-300 bg-white text-slate-300"
                    }`}
                  >
                    {passwordInput[index] ? "•" : ""}
                  </div>
                ))}
              </div>

              {passwordError ? (
                <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  {passwordError}
                </p>
              ) : null}
            </div>

            <div className="mt-8 grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handlePinPress(num)}
                  className="rounded-2xl border border-slate-300 bg-white px-5 py-4 text-xl font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
                >
                  {num}
                </button>
              ))}

              <button
                type="button"
                onClick={handlePinClear}
                className="rounded-2xl border border-slate-300 bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
              >
                Clear
              </button>

              <button
                type="button"
                onClick={() => handlePinPress("0")}
                className="rounded-2xl border border-slate-300 bg-white px-5 py-4 text-xl font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
              >
                0
              </button>

              <button
                type="button"
                onClick={handlePinDelete}
                className="rounded-2xl border border-slate-300 bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
              >
                Delete
              </button>
            </div>

            <button
              type="button"
              onClick={handleUnlock}
              className="mt-6 flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-4 text-base font-semibold text-white shadow-md transition hover:scale-[1.01]"
            >
              Unlock diary
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isReportsOpen = activeSection?.title === "Reports";

  return (
    <div className="min-h-screen bg-gradient-to-br from-white to-slate-100 text-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-10 md:py-14">
        <header className="mb-5">
          <div className="mx-auto max-w-2xl">
            <div className="w-full rounded-2xl border border-sky-100 bg-sky-50 px-6 py-4 shadow-md">
              <h1 className="text-center text-xl font-bold uppercase tracking-[0.18em] text-sky-300 md:text-2xl">
                Kaylen's Diary
              </h1>
            </div>
          </div>
        </header>

        {isRefreshing ? (
          <div className="mb-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-700">
            Refreshing diary...
          </div>
        ) : (
          <div className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600">
            Pull down from the top to refresh.
          </div>
        )}

        <section className="mb-5">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Quick overview
                </p>
                <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900 md:text-xl">
                  Today at a glance
                </h2>
              </div>

              <div className="flex items-center gap-1.5">
                {overviewItems.map((item, index) => (
                  <span
                    key={item.key}
                    className={`h-2 w-2 rounded-full transition ${
                      index === overviewIndex ? "bg-slate-700" : "bg-slate-300"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div
              className={`mt-3 rounded-2xl border px-4 py-3 ${activeOverview.tone}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/70 text-2xl shadow-sm">
                  {activeOverview.emoji}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold uppercase tracking-[0.14em]">
                      {activeOverview.title}
                    </p>
                    <span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                      {activeOverview.meta}
                    </span>
                  </div>

                  <p className="mt-1.5 break-words text-sm font-bold leading-5 text-slate-900">
                    {activeOverview.summary}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
              {sections
                .filter((section) => section.title !== "Reports")
                .map((section) => (
                  <button
                    key={`shortcut-${section.title}`}
                    type="button"
                    onClick={() => openSection(section)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-xl shadow-sm transition hover:bg-white"
                    aria-label={`Open ${section.title}`}
                  >
                    {section.emoji}
                  </button>
                ))}
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => {
            const latestLines =
              section.title !== "Reports"
                ? tileStatusText(section.title)
                : sharedLog.length
                  ? sharedLog
                      .slice(0, 2)
                      .map(
                        (entry) =>
                          `${entry.summary}${entry.time ? ` · ${entry.time}` : ""}`,
                      )
                  : ["Nothing logged yet"];

            return (
              <div
                key={section.title}
                className={`group flex min-h-[17rem] flex-col rounded-[2rem] border p-5 shadow-md transition duration-200 hover:-translate-y-1 hover:shadow-lg sm:p-6 ${section.soft}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div
                    className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br text-4xl text-white shadow-lg ${section.color}`}
                  >
                    {section.emoji}
                  </div>
                  <div className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700">
                    Log
                  </div>
                </div>

                <div className="mt-6 flex-1">
                  <h2 className="text-[1.6rem] font-bold leading-tight tracking-tight sm:text-[1.9rem]">
                    {section.title}
                  </h2>

                  {section.subtitle ? (
                    <p className="mt-2 min-h-[2.5rem] text-sm font-medium leading-5 text-slate-600">
                      {section.subtitle}
                    </p>
                  ) : null}

                  <div className="mt-4 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-left shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Latest
                    </p>
                    <div className="mt-1 space-y-1">
                      {latestLines.map((line, index) => (
                        <p
                          key={`${section.title}-${index}`}
                          className="break-words text-sm font-semibold leading-5 text-slate-700"
                        >
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openSection(section)}
                  className={`mt-6 flex w-full items-center justify-between rounded-2xl bg-gradient-to-r px-5 py-3.5 text-base font-semibold text-white shadow-md transition hover:scale-[1.02] ${section.color}`}
                >
                  <span>{section.button}</span>
                  <span>→</span>
                </button>
              </div>
            );
          })}
        </section>
      </div>

      {activeSection ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 p-3 backdrop-blur-sm md:p-4">
          <div className="flex min-h-full items-start justify-center py-2 md:items-center md:py-4">
            <div
              className={`relative my-auto w-full rounded-[2rem] border border-slate-200 bg-white p-4 shadow-2xl sm:p-5 md:p-8 ${
                isReportsOpen ? "max-w-5xl" : "max-w-2xl"
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
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-2xl text-white shadow-md ${activeSection.color}`}
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
