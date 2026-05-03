import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { supabase } from "./Supabase";
import { api } from "./api/client";

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

const uniqueList = (items) =>
  Array.from(new Set(items.map((item) => (item || "").trim()).filter(Boolean)));

const cleanFormText = (value) => {
  const text = String(value ?? "").trim();
  return ["null", "undefined"].includes(text.toLowerCase()) ? "" : text;
};

const parseMedicationProfile = (value = "") => {
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
          doseUnit = "",
          times = "",
          active = "active",
          notes = "",
        ] = line
          .split("|")
          .map((part) => cleanFormText(part));
        const dose = [doseAmount, doseUnit].filter(Boolean).join(" ");
        return {
          name,
          doseAmount,
          doseUnit,
          dose,
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
        return { name: cleanFormText(line), dose: "", doseAmount: "", doseUnit: "", times: [], active: true, notes: "" };
      }
      const [name, ...doseParts] = line.split(separator);
      const dose = cleanFormText(doseParts.join(separator));
      return {
        name: cleanFormText(name),
        dose,
        doseAmount: dose,
        doseUnit: "",
        times: [],
        active: true,
        notes: "",
      };
    })
    .filter((item) => item.name && item.active !== false);
};

const medicationStatusLabel = (status) => {
  switch (status) {
    case "missed":
      return "Missed dose";
    case "late":
      return "Late dose";
    case "refused":
      return "Refused dose";
    case "given":
    default:
      return "Given";
  }
};

const compactCardPadding = (mode) => (mode === "pdf" ? "p-2" : "p-3 shadow-sm");
const compactSectionPadding = (mode) => (mode === "pdf" ? "p-3" : "p-4");

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

const formatDisplayDateFromIso = (value) => {
  if (!value) return "";
  if (value.includes("T")) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      const day = String(parsed.getDate()).padStart(2, "0");
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      const year = parsed.getFullYear();
      return `${day}/${month}/${year}`;
    }
  }

  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
};

const getCareSnapshotEntryDate = (entry) => {
  const hasLoggedTime =
    typeof entry?.time === "string" && entry.time.includes(":");
  const createdAt = entry?.createdAt ? new Date(entry.createdAt) : null;
  const validCreatedAt =
    createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null;

  if (hasLoggedTime) {
    return parseDisplayDateTime(entry.date, entry.time) || validCreatedAt;
  }

  const parsedDate = parseDisplayDate(entry?.date);
  if (parsedDate && validCreatedAt) {
    const createdDisplayDate = formatDisplayDateFromIso(
      validCreatedAt.toISOString(),
    );
    if (createdDisplayDate === entry.date) {
      return validCreatedAt;
    }
  }

  if (parsedDate) {
    const endOfLoggedDay = new Date(parsedDate);
    endOfLoggedDay.setHours(23, 59, 59, 999);
    return endOfLoggedDay;
  }

  return validCreatedAt;
};

const formatLongDateFromIso = (value) => {
  if (!value) return "";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const calculateAge = (value) => {
  if (!value) return "";
  const birthDate = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return "";
  const today = new Date();
  let years = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    years -= 1;
  }
  return years >= 0 ? `${years}` : "";
};

const formatDateInput = (value) => {
  const digits = (value || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
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

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundTo = (value, decimals = 1) =>
  Number(Number(value || 0).toFixed(decimals));

const formatSignedNumber = (value, suffix = "", decimals = 1) => {
  const rounded = roundTo(value, decimals);
  if (!rounded) return `0${suffix}`;
  return `${rounded > 0 ? "+" : ""}${rounded}${suffix}`;
};

const getFluidMlFromEntry = (entry) => {
  if (!entry?.isMilk) return 0;
  if (entry.amountMl !== undefined && entry.amountMl !== null) {
    return toFiniteNumber(entry.amountMl);
  }
  if (entry.amountOz !== undefined && entry.amountOz !== null) {
    return toFiniteNumber(entry.amountOz) * 29.5735;
  }
  const text = `${entry.summary || ""} ${(entry.details || []).join(" ")}`;
  const mlMatch = text.match(/(\d+(?:\.\d+)?)\s*ml/i);
  if (mlMatch) return toFiniteNumber(mlMatch[1]);
  const ozMatch = text.match(/(\d+(?:\.\d+)?)\s*oz/i);
  return ozMatch ? toFiniteNumber(ozMatch[1]) * 29.5735 : 0;
};

const getEntryDateTime = (entry) =>
  getCareSnapshotEntryDate(entry) ||
  parseDisplayDateTime(entry?.date, entry?.time) ||
  parseDisplayDate(entry?.date);

const significantHealthEvents = [
  "seizure",
  "injury",
  "meltdown",
  "distress",
  "hospital",
  "medication reaction",
  "reaction",
  "illness",
  "sick",
  "vomit",
  "temperature",
  "fever",
];

const isSignificantHealthEntry = (entry) => {
  if (entry?.section !== "Health") return false;
  const text = [
    entry.event,
    entry.summary,
    ...(entry.details || []),
    entry.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return significantHealthEvents.some((keyword) => text.includes(keyword));
};

const PIN_STORAGE_KEY = "kaylen-diary-pin-session";
const PIN_INACTIVITY_LIMIT_MS = 5 * 60 * 60 * 1000;
const DRINK_UNIT_STORAGE_KEY = "familytrack:drink-unit";
const LOG_DRAFT_VERSION = 1;

const getStoredDrinkUnit = () => {
  try {
    const saved = localStorage.getItem(DRINK_UNIT_STORAGE_KEY);
    return saved === "ml" ? "ml" : "oz";
  } catch {
    return "oz";
  }
};

const dateTimeInputClass =
  "mt-2 block box-border w-full min-w-0 max-w-full appearance-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

const smallActionButtonClass =
  "mt-2 shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const safeLocalStorageGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeLocalStorageSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Draft recovery is helpful, but logging must keep working.
  }
};

const safeLocalStorageRemove = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Draft recovery is helpful, but logging must keep working.
  }
};

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
  "Growth / Measurements": {
    report: "border-teal-200 bg-teal-50",
    badge: "bg-teal-100 text-teal-700",
    solidHeader: "bg-teal-600 text-white border-teal-700",
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

export default function KaylenCareMonitorDashboard({
  familyId,
  childId,
  childName = "Child",
  childDetails = {},
  familyDetails = {},
  children = [],
  selectedChildId = "",
  onSelectChild,
  onOpenChildSetup,
  onAddRegularMedication,
  customFoodOptions = [],
  customMedicationOptions = [],
  customGivenByOptions = [],
  customLocationOptions = [],
  onCreateCareOption,
  childProfile = {},
  importantEvents = [],
  accountAccess = null,
  showToast,
  useSaasApi = false,
} = {}) {
  const APP_PASSWORD = "030920";

  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(() => Boolean(useSaasApi));

  const [activeSection, setActiveSection] = useState(null);
  const [medicationValue, setMedicationValue] = useState("");
  const [foodValue, setFoodValue] = useState("");
  const [reportDays, setReportDays] = useState("7");
  const [customReportDays, setCustomReportDays] = useState("7");
  const [reportTab, setReportTab] = useState("recent");
  const [reportLayout, setReportLayout] = useState("daily");
  const [reportCategoryFilter, setReportCategoryFilter] = useState("All");
  const [reportFiltersOpen, setReportFiltersOpen] = useState(false);
  const [reportNotes, setReportNotes] = useState("");
  const [reportType, setReportType] = useState("full");
  const [professionalLanguage, setProfessionalLanguage] = useState(false);
  const [reportTemplate, setReportTemplate] = useState("hospital");
  const [showReportCharts, setShowReportCharts] = useState(true);
  const [snapshotIncludeSensitive, setSnapshotIncludeSensitive] = useState(false);
  const [shareSections, setShareSections] = useState({
    emergency: true,
    food: true,
    medication: true,
    sleep: true,
    toileting: true,
    health: true,
    notes: true,
  });
  const [calendarMonth, setCalendarMonth] = useState(() => todayIsoValue().slice(0, 7));
  const [calendarSelectedDate, setCalendarSelectedDate] = useState(todayIsoValue());
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
  const [isReportEmailOpen, setIsReportEmailOpen] = useState(false);
  const [isSendingReportEmail, setIsSendingReportEmail] = useState(false);
  const [reportEmailForm, setReportEmailForm] = useState({
    recipientEmail: "",
    message: "",
    confirmed: false,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncState, setSyncState] = useState("Synced");

  const [savedFoodOptions, setSavedFoodOptions] = useState([]);
  const [savedMedicationOptions, setSavedMedicationOptions] = useState([]);
  const [savedGivenByOptions, setSavedGivenByOptions] = useState([]);
  const [saveFoodForFuture, setSaveFoodForFuture] = useState(false);
  const [saveMedicationForFuture, setSaveMedicationForFuture] =
    useState(false);
  const [addOtherMedicationToProfile, setAddOtherMedicationToProfile] =
    useState(false);
  const [saveGivenByForFuture, setSaveGivenByForFuture] = useState(false);
  const [saveLocationForFuture, setSaveLocationForFuture] = useState(false);

  const touchStartY = useRef(0);
  const touchCurrentY = useRef(0);
  const isPullingRef = useRef(false);
  const initialDraftSnapshotRef = useRef(null);
  const skipNextDraftSaveRef = useRef({});

  const [activeSaveAction, setActiveSaveAction] = useState("");
  const saveLockRef = useRef(false);
  const [overviewIndex, setOverviewIndex] = useState(0);
  const [reportOverviewIndex, setReportOverviewIndex] = useState(0);
  const offlineQueueKey = `familytrack:offline-log-queue:${familyId || "legacy"}`;
  const careSnapshotPromptKey = `familytrack:care-snapshot-prompt-dismissed:${familyId || "legacy"}:${childId || "legacy"}`;
  const careSnapshotViewedKey = `familytrack:care-snapshot-viewed:${familyId || "legacy"}:${childId || "legacy"}`;
  const [isCareSnapshotPromptDismissed, setIsCareSnapshotPromptDismissed] =
    useState(() => safeLocalStorageGet(careSnapshotPromptKey) === "true");
  const [hasViewedCareSnapshot, setHasViewedCareSnapshot] = useState(
    () => safeLocalStorageGet(careSnapshotViewedKey) === "true",
  );
  const careSnapshotPreferenceKey = `onboarding-care-snapshot:${familyId || "legacy"}:${childId || "legacy"}`;

  const [foodForm, setFoodForm] = useState({
    date: todayValue(),
    time: nowTimeValue(),
    location: "",
    otherLocation: "",
    entryType: "Food",
    mealContext: "",
    item: "",
    otherItem: "",
    amount: "",
    unit: getStoredDrinkUnit(),
    description: "",
    intakeStatus: "normal",
    notes: "",
  });

  const [medicationForm, setMedicationForm] = useState({
    medicine: "",
    otherMedicine: "",
    dose: "",
    status: "given",
    time: "",
    givenBy: "",
    otherGivenBy: "",
    date: todayValue(),
    notes: "",
  });
  const medicationScheduleStorageKey = `familytrack:medication-schedules:${
    childId || "legacy"
  }`;
  const [medicationSchedules, setMedicationSchedules] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(medicationScheduleStorageKey) || "[]");
    } catch {
      return [];
    }
  });
  const [medicationScheduleForm, setMedicationScheduleForm] = useState({
    medicine: "",
    dose: "",
    time: "08:00",
  });
  const profileMedicationSchedules = useMemo(() => {
    const schedules = [];
    parseMedicationProfile(childProfile.currentMedications).forEach((medicine) => {
      medicine.times.forEach((time) => {
        schedules.push({
          id: `profile-${medicine.name}-${time}`,
          medicine: medicine.name,
          dose: medicine.dose,
          time,
          profile: true,
        });
      });
    });
    return schedules;
  }, [childProfile.currentMedications]);

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
    outcome: "",
    notes: "",
    weightKg: "",
    heightCm: "",
  });

  const [sleepForm, setSleepForm] = useState({
    date: todayValue(),
    wakeDate: todayValue(),
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
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [selectedMedicationShortcut, setSelectedMedicationShortcut] = useState("");
  const [draftPrompts, setDraftPrompts] = useState({});
  const [draggingCardTitle, setDraggingCardTitle] = useState("");
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [dashboardOrder, setDashboardOrder] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("familytrack:dashboard-order") || "[]");
    } catch {
      return [];
    }
  });

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
      subtitle: "Symptoms, concerns, actions taken",
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
      title: "Growth / Measurements",
      subtitle: "Height, weight and BMI notes",
      button: "Open Log",
      emoji: "GM",
      color: "from-teal-400 to-cyan-500",
      soft: "bg-teal-50 border-teal-300",
    },
    {
      title: "Reports",
      subtitle: "View and share recent entries",
      button: "View Reports",
      emoji: "📊",
      color: "from-fuchsia-400 to-pink-500",
      soft: "bg-fuchsia-50 border-fuchsia-300",
    },
    {
      title: "Care Snapshot",
      subtitle: "72-hour emergency summary",
      button: "Open Snapshot",
      emoji: "CS",
      color: "from-cyan-400 to-blue-500",
      soft: "bg-cyan-50 border-cyan-300",
    },
    {
      title: "Calendar",
      subtitle: "Monthly log overview",
      button: "Open Calendar",
      emoji: "CAL",
      color: "from-violet-400 to-purple-500",
      soft: "bg-violet-50 border-violet-300",
    },
  ];

  const customMedicationLabels = customMedicationOptions.map(
    (option) => option.label,
  );
  const profileMedicationOptions = parseMedicationProfile(
    childProfile.currentMedications,
  );
  const profileMedicationLabels = profileMedicationOptions.map((item) => item.name);
  const orderedSections = useMemo(() => {
    const byTitle = new Map(sections.map((section) => [section.title, section]));
    const ordered = dashboardOrder
      .map((title) => byTitle.get(title))
      .filter(Boolean);
    const missing = sections.filter((section) => !dashboardOrder.includes(section.title));
    return [...ordered, ...missing];
  }, [dashboardOrder, sections]);

  const sectionDraftKind = (title = activeSection?.title) => {
    switch (title) {
      case "Food Diary":
        return "food";
      case "Medication":
        return "medication";
      case "Toileting":
        return "toileting";
      case "Health":
        return "health";
      case "Sleep":
        return "sleep";
      default:
        return "";
    }
  };

  const logDraftStorageKey = (kind) =>
    `familytrack:log-draft:${familyId || "legacy"}:${childId || "legacy"}:${kind}`;

  const getDraftPayload = (kind) => {
    switch (kind) {
      case "food":
        return {
          foodForm,
          foodValue,
          saveFoodForFuture,
          saveLocationForFuture,
        };
      case "medication":
        return {
          medicationForm,
          medicationValue,
          selectedMedicationShortcut,
          addOtherMedicationToProfile,
          saveGivenByForFuture,
        };
      case "toileting":
        return { toiletingForm };
      case "health":
        return { healthForm };
      case "sleep":
        return { sleepForm };
      default:
        return null;
    }
  };

  if (!initialDraftSnapshotRef.current) {
    initialDraftSnapshotRef.current = {
      food: JSON.stringify(getDraftPayload("food")),
      medication: JSON.stringify(getDraftPayload("medication")),
      toileting: JSON.stringify(getDraftPayload("toileting")),
      health: JSON.stringify(getDraftPayload("health")),
      sleep: JSON.stringify(getDraftPayload("sleep")),
    };
  }

  const hasMeaningfulDraft = (kind, payload) => {
    if (!payload) return false;

    switch (kind) {
      case "food":
        return Boolean(
          payload.foodValue ||
            payload.foodForm?.location ||
            payload.foodForm?.otherLocation ||
            payload.foodForm?.mealContext ||
            payload.foodForm?.item ||
            payload.foodForm?.otherItem ||
            payload.foodForm?.amount ||
            payload.foodForm?.description ||
            payload.foodForm?.notes ||
            payload.foodForm?.entryType === "Drink" ||
            payload.foodForm?.intakeStatus !== "normal" ||
            payload.saveFoodForFuture ||
            payload.saveLocationForFuture,
        );
      case "medication":
        return Boolean(
          payload.medicationValue ||
            payload.medicationForm?.medicine ||
            payload.medicationForm?.otherMedicine ||
            payload.medicationForm?.dose ||
            payload.medicationForm?.time ||
            payload.medicationForm?.givenBy ||
            payload.medicationForm?.otherGivenBy ||
            payload.medicationForm?.notes ||
            payload.medicationForm?.status !== "given" ||
            payload.addOtherMedicationToProfile ||
            payload.saveGivenByForFuture,
        );
      case "toileting":
        return Boolean(payload.toiletingForm?.entry || payload.toiletingForm?.notes);
      case "health":
        return Boolean(
          payload.healthForm?.event ||
            payload.healthForm?.duration ||
            payload.healthForm?.happened ||
            payload.healthForm?.action ||
            payload.healthForm?.outcome ||
            payload.healthForm?.notes ||
            payload.healthForm?.weightKg ||
            payload.healthForm?.heightCm,
        );
      case "sleep":
        return (
          JSON.stringify(payload) !== initialDraftSnapshotRef.current.sleep &&
          Boolean(
            payload.sleepForm?.bedtime ||
              payload.sleepForm?.wakeTime ||
              payload.sleepForm?.nightWakings ||
              payload.sleepForm?.nap !== "No" ||
              payload.sleepForm?.quality !== "Good" ||
              payload.sleepForm?.notes,
          )
        );
      default:
        return JSON.stringify(payload) !== initialDraftSnapshotRef.current[kind];
    }
  };

  const clearLogDraft = (kind) => {
    if (!kind) return;
    skipNextDraftSaveRef.current[kind] = true;
    safeLocalStorageRemove(logDraftStorageKey(kind));
    setDraftPrompts((current) => {
      const next = { ...current };
      delete next[kind];
      return next;
    });
  };

  const resumeLogDraft = (kind) => {
    const draft = draftPrompts[kind]?.draft;
    if (!draft) return;

    skipNextDraftSaveRef.current[kind] = true;

    if (kind === "food") {
      setFoodForm({ ...foodForm, ...(draft.foodForm || {}) });
      setFoodValue(draft.foodValue || "");
      setSaveFoodForFuture(Boolean(draft.saveFoodForFuture));
      setSaveLocationForFuture(Boolean(draft.saveLocationForFuture));
    }

    if (kind === "medication") {
      setMedicationForm({ ...medicationForm, ...(draft.medicationForm || {}) });
      setMedicationValue(draft.medicationValue || "");
      setSelectedMedicationShortcut(draft.selectedMedicationShortcut || "");
      setAddOtherMedicationToProfile(Boolean(draft.addOtherMedicationToProfile));
      setSaveGivenByForFuture(Boolean(draft.saveGivenByForFuture));
    }

    if (kind === "toileting") {
      setToiletingForm({ ...toiletingForm, ...(draft.toiletingForm || {}) });
    }

    if (kind === "health") {
      setHealthForm({ ...healthForm, ...(draft.healthForm || {}) });
    }

    if (kind === "sleep") {
      setSleepForm({ ...sleepForm, ...(draft.sleepForm || {}) });
    }

    setDraftPrompts((current) => ({
      ...current,
      [kind]: { ...current[kind], dismissed: true },
    }));
  };

  const renderDraftRecoveryPrompt = (kind) => {
    const prompt = draftPrompts[kind];
    if (kind === "sleep" && sleepEntryId) return null;
    if (!prompt?.draft || prompt.dismissed) return null;

    return (
      <div className="md:col-span-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 shadow-sm">
        <p className="font-black">We've saved your previous entry.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => resumeLogDraft(kind)}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={() => clearLogDraft(kind)}
            className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-700 shadow-sm"
          >
            Start fresh
          </button>
        </div>
      </div>
    );
  };

  const dismissCareSnapshotPrompt = () => {
    safeLocalStorageSet(careSnapshotPromptKey, "true");
    setIsCareSnapshotPromptDismissed(true);
  };

  const openCareSnapshot = () => {
    const snapshotSection = sections.find(
      (section) => section.title === "Care Snapshot",
    );
    if (!snapshotSection) return;

    safeLocalStorageSet(careSnapshotViewedKey, "true");
    setHasViewedCareSnapshot(true);
    if (useSaasApi) {
      api
        .updatePreference(careSnapshotPreferenceKey, { completed: true })
        .catch(() => null);
    }
    openSection(snapshotSection);
  };

  const openOnboardingItem = (action) => {
    switch (action) {
      case "child":
        if (onOpenChildSetup) onOpenChildSetup();
        return;
      case "medication":
        openSection(sections.find((section) => section.title === "Medication"));
        return;
      case "food":
        openSection(sections.find((section) => section.title === "Food Diary"));
        return;
      case "sleep":
        openSection(sections.find((section) => section.title === "Sleep"));
        return;
      case "snapshot":
        openCareSnapshot();
        return;
      default:
        return;
    }
  };

  useEffect(() => {
    const kind = sectionDraftKind();
    if (!kind || draftPrompts[kind]?.checked || draftPrompts[kind]?.draft) {
      return;
    }

    const rawDraft = safeLocalStorageGet(logDraftStorageKey(kind));
    if (!rawDraft) {
      setDraftPrompts((current) => ({
        ...current,
        [kind]: { checked: true },
      }));
      return;
    }

    try {
      const parsed = JSON.parse(rawDraft);
      const draft = parsed?.version === LOG_DRAFT_VERSION ? parsed.payload : parsed;
      setDraftPrompts((current) => ({
        ...current,
        [kind]: { checked: true, draft },
      }));
    } catch {
      safeLocalStorageRemove(logDraftStorageKey(kind));
      setDraftPrompts((current) => ({
        ...current,
        [kind]: { checked: true },
      }));
    }
  }, [activeSection?.title, childId, familyId]);

  useEffect(() => {
    setIsCareSnapshotPromptDismissed(
      safeLocalStorageGet(careSnapshotPromptKey) === "true",
    );
  }, [careSnapshotPromptKey]);

  useEffect(() => {
    setHasViewedCareSnapshot(safeLocalStorageGet(careSnapshotViewedKey) === "true");
  }, [careSnapshotViewedKey]);

  useEffect(() => {
    let ignore = false;

    async function loadCareSnapshotPreference() {
      if (!useSaasApi || !familyId || !childId) return;

      try {
        const preference = await api.getPreference(careSnapshotPreferenceKey);
        if (!ignore && preference?.completed) {
          safeLocalStorageSet(careSnapshotViewedKey, "true");
          setHasViewedCareSnapshot(true);
        }
      } catch {
        // Backend onboarding persistence is helpful, but local app use should continue.
      }
    }

    loadCareSnapshotPreference();
    return () => {
      ignore = true;
    };
  }, [careSnapshotPreferenceKey, careSnapshotViewedKey, childId, familyId, useSaasApi]);

  useEffect(() => {
    const kind = sectionDraftKind();
    if (!kind || !activeSection) return;
    if (kind === "sleep" && sleepEntryId) return;

    if (skipNextDraftSaveRef.current[kind]) {
      skipNextDraftSaveRef.current[kind] = false;
      return;
    }

    const payload = getDraftPayload(kind);
    if (!hasMeaningfulDraft(kind, payload)) return;

    safeLocalStorageSet(
      logDraftStorageKey(kind),
      JSON.stringify({
        version: LOG_DRAFT_VERSION,
        savedAt: new Date().toISOString(),
        payload,
      }),
    );
  }, [
    activeSection?.title,
    addOtherMedicationToProfile,
    childId,
    familyId,
    foodForm,
    foodValue,
    healthForm,
    medicationForm,
    medicationValue,
    saveFoodForFuture,
    saveGivenByForFuture,
    saveLocationForFuture,
    selectedMedicationShortcut,
    sleepForm,
    sleepEntryId,
    toiletingForm,
  ]);

  const saveDashboardOrder = (next) => {
    setDashboardOrder(next);
    try {
      localStorage.setItem("familytrack:dashboard-order", JSON.stringify(next));
    } catch {
      // Local preference only.
    }
  };

  const reorderDashboardCard = (fromTitle, toTitle) => {
    const titles = orderedSections.map((section) => section.title);
    const index = titles.indexOf(fromTitle);
    const nextIndex = titles.indexOf(toTitle);
    if (index < 0 || nextIndex < 0 || index === nextIndex) return;
    const next = [...titles];
    const [moved] = next.splice(index, 1);
    next.splice(nextIndex, 0, moved);
    saveDashboardOrder(next);
  };

  const moveDashboardCardByStep = (title, step) => {
    const titles = orderedSections.map((section) => section.title);
    const index = titles.indexOf(title);
    const nextIndex = index + step;
    if (index < 0 || nextIndex < 0 || nextIndex >= titles.length) return;
    const next = [...titles];
    const [moved] = next.splice(index, 1);
    next.splice(nextIndex, 0, moved);
    saveDashboardOrder(next);
  };

  const usesAddedSvgIcon = (sectionTitle) =>
    ["Growth / Measurements", "Care Snapshot", "Calendar"].includes(sectionTitle);

  const renderSectionIcon = (sectionTitle, className = "h-8 w-8") => {
    const common = {
      className,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    };

    switch (sectionTitle) {
      case "Food Diary":
        return (
          <svg {...common}>
            <path d="M4 3v8" />
            <path d="M8 3v8" />
            <path d="M4 7h4" />
            <path d="M6 11v10" />
            <path d="M15 3v18" />
            <path d="M15 3c3 2 5 5 5 8h-5" />
          </svg>
        );
      case "Medication":
        return (
          <svg {...common}>
            <path d="m10.5 20.5 10-10a4.2 4.2 0 0 0-6-6l-10 10a4.2 4.2 0 0 0 6 6Z" />
            <path d="m8.5 8.5 7 7" />
          </svg>
        );
      case "Toileting":
        return (
          <svg {...common}>
            <path d="M7 4h10" />
            <path d="M9 4v7a5 5 0 0 0 10 0V4" />
            <path d="M5 20h14" />
            <path d="M12 16v4" />
          </svg>
        );
      case "Health":
        return (
          <svg {...common}>
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
            <path d="M12 8v6" />
            <path d="M9 11h6" />
          </svg>
        );
      case "Sleep":
        return (
          <svg {...common}>
            <path d="M20 14.5A7.5 7.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
          </svg>
        );
      case "Growth / Measurements":
        return (
          <svg {...common}>
            <path d="M4 19V5" />
            <path d="M4 19h16" />
            <path d="M8 17v-5" />
            <path d="M12 17V8" />
            <path d="M16 17v-7" />
            <path d="M4 8h4" />
            <path d="M4 12h3" />
            <path d="M4 16h4" />
          </svg>
        );
      case "Reports":
        return (
          <svg {...common}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6" />
            <path d="M8 13h8" />
            <path d="M8 17h5" />
          </svg>
        );
      case "Care Snapshot":
        return (
          <svg {...common}>
            <path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Z" />
            <path d="M12 8v6" />
            <path d="M9 11h6" />
          </svg>
        );
      case "Calendar":
        return (
          <svg {...common}>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4" />
            <path d="M8 2v4" />
            <path d="M3 10h18" />
            <path d="M8 14h.01" />
            <path d="M12 14h.01" />
            <path d="M16 14h.01" />
          </svg>
        );
      default:
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
        );
    }
  };

  const renderDashboardIcon = (
    section,
    iconClassName = "h-8 w-8",
    textClassName = "text-4xl",
  ) => {
    if (usesAddedSvgIcon(section.title)) {
      return renderSectionIcon(section.title, iconClassName);
    }

    return <span className={textClassName}>{section.emoji}</span>;
  };

  const customFoodLabels = customFoodOptions.map((option) => option.label);
  const customGivenByLabels = customGivenByOptions.map((option) => option.label);
  const customLocationLabels = customLocationOptions.map((option) => option.label);

  const defaultMedicationOptions = useSaasApi
    ? ["Other"]
    : [
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

  const medicationOptions = uniqueList([
    ...defaultMedicationOptions.slice(0, -1),
    ...profileMedicationLabels,
    ...customMedicationLabels,
    ...savedMedicationOptions,
    "Other",
  ]);

  const defaultFoodOptions = useSaasApi
    ? ["Drink", "Breakfast", "Lunch", "Dinner", "Dessert", "Snack", "Other"]
    : ["Cottage pie", "Weetabix", "Heinz Fruit Custard", "Drink", "Other"];

  const foodOptions = uniqueList([
    ...defaultFoodOptions.slice(0, -1),
    ...customFoodLabels,
    ...savedFoodOptions,
    "Other",
  ]);

  const defaultGivenByOptions = useSaasApi
    ? ["Other"]
    : ["Martin", "Rachel", "Other"];

  const givenByOptions = uniqueList([
    ...defaultGivenByOptions.slice(0, -1),
    ...customGivenByLabels,
    ...savedGivenByOptions,
    "Other",
  ]);

  const locationOptions = uniqueList([
    "Home",
    "School",
    ...customLocationLabels,
    "Other",
  ]);

  const getMedicationDefaultDose = (medicine) =>
    customMedicationOptions.find((option) => option.label === medicine)
      ?.defaultValue ||
    profileMedicationOptions.find((option) => option.name === medicine)?.dose ||
    getDefaultDoseForMedicine(medicine);
  const getMedicationSuggestedTimes = (medicine) =>
    uniqueList(
      profileMedicationOptions.find((option) => option.name === medicine)?.times ||
        [],
    );
  const getFoodDefaultNote = (food) =>
    customFoodOptions.find((option) => option.label === food)?.defaultValue || "";

  useEffect(() => {
    if (useSaasApi) {
      setIsUnlocked(true);
    }
  }, [useSaasApi]);

  useEffect(() => {
    const stopDragging = () => setDraggingCardTitle("");
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, []);

  useEffect(() => {
    try {
      setMedicationSchedules(
        JSON.parse(localStorage.getItem(medicationScheduleStorageKey) || "[]"),
      );
    } catch {
      setMedicationSchedules([]);
    }
  }, [medicationScheduleStorageKey]);

  const inputClassName =
    "mt-2 block box-border w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

  const cardClassName =
    "rounded-2xl border border-slate-300 bg-slate-50/80 p-4 shadow-sm";

  const effectiveReportDays =
    reportDays === "custom"
      ? Math.max(1, Number(customReportDays) || 7)
      : reportDays === "24h"
        ? 1
        : reportDays === "72h"
          ? 3
          : Math.max(1, Number(reportDays) || 7);

  const reportRangeStart =
    reportDays === "custom"
      ? parseIsoDate(reportStartDate)
      : reportDays === "24h" || reportDays === "72h"
        ? (() => {
            const start = new Date();
            start.setHours(start.getHours() - (reportDays === "24h" ? 24 : 72));
            return start;
          })()
      : (() => {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          start.setDate(start.getDate() - (effectiveReportDays - 1));
          return start;
        })();

  const reportRangeEnd =
    reportDays === "custom"
      ? parseIsoDate(reportEndDate, true)
      : reportDays === "24h" || reportDays === "72h"
        ? new Date()
      : (() => {
          const end = new Date();
          end.setHours(23, 59, 59, 999);
          return end;
        })();

  const reportRangeLabel =
    reportDays === "custom"
      ? `${reportStartDate || "Start"} to ${reportEndDate || "End"}`
      : reportDays === "24h"
        ? "Last 24 hours"
        : reportDays === "72h"
          ? "Last 72 hours"
          : `Last ${effectiveReportDays} day${effectiveReportDays === 1 ? "" : "s"}`;

  const openSection = (section) => {
    setActiveSection(section);
    if (section.title !== "Medication") setMedicationValue("");
    if (section.title !== "Food Diary") setFoodValue("");
    if (section.title !== "Reports") {
      setReportFiltersOpen(false);
    }
    setShareCopied(false);
  };

  const openQuickAdd = (title, preset = "") => {
    const section = sections.find((item) => item.title === title);
    if (!section) return;

    if (title === "Food Diary" && preset) {
      setFoodValue(preset);
      setFoodForm((current) => ({
        ...current,
        entryType: preset === "Drink" ? "Drink" : "Food",
        mealContext: preset === "Drink" ? "" : preset,
        item: "",
        otherItem: preset === "Drink" ? "" : current.otherItem,
        unit: getStoredDrinkUnit(),
      }));
    }

    setQuickAddOpen(false);
    openSection(section);
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
      entryType: "Food",
      mealContext: "",
      item: "",
      otherItem: "",
      amount: "",
      unit: getStoredDrinkUnit(),
      description: "",
      intakeStatus: "normal",
      notes: "",
    });
    setFoodValue("");
    setSaveFoodForFuture(false);
    setSaveLocationForFuture(false);
  };

  const resetMedicationForm = () => {
    setMedicationForm({
      medicine: "",
      otherMedicine: "",
      dose: "",
      status: "given",
      time: "",
      givenBy: "",
      otherGivenBy: "",
      date: todayValue(),
      notes: "",
    });
    setMedicationValue("");
    setSelectedMedicationShortcut("");
    setSaveMedicationForFuture(false);
    setAddOtherMedicationToProfile(false);
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
      outcome: "",
      notes: "",
      weightKg: "",
      heightCm: "",
    });
  };

  const resetSleepForm = () => {
    setSleepForm({
      date: todayValue(),
      wakeDate: todayValue(),
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

  const addDaysToDisplayDate = (value, days) => {
    const iso = parseDateToIso(value);
    if (!iso) return value;
    const parsed = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    parsed.setDate(parsed.getDate() + days);
    return formatDisplayDateFromIso(parsed.toISOString().slice(0, 10));
  };

  const getDefaultWakeDate = (sleepDateValue) =>
    addDaysToDisplayDate(sleepDateValue || todayValue(), 1);

  const getEffectiveWakeDateIso = (sleepDateValue, bedtime, wakeDateValue, wakeTime) => {
    const sleepDateIso = parseDateToIso(sleepDateValue);
    const wakeDateIso = parseDateToIso(wakeDateValue);

    if (!sleepDateIso || !wakeDateIso || !bedtime || !wakeTime) {
      return wakeDateIso;
    }

    const bedtimeDate = new Date(`${sleepDateIso}T${bedtime}:00`);
    const wakeDate = new Date(`${wakeDateIso}T${wakeTime}:00`);

    if (Number.isNaN(bedtimeDate.getTime()) || Number.isNaN(wakeDate.getTime())) {
      return wakeDateIso;
    }

    if (wakeDate <= bedtimeDate) {
      const next = new Date(wakeDate);
      next.setDate(next.getDate() + 1);
      return next.toISOString().slice(0, 10);
    }

    return wakeDateIso;
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

      if (useSaasApi) {
        if (!familyId || !childId) return;

        const latest = await api.getIncompleteSleepLog(familyId, childId);

        if (!latest) {
          setSleepEntryId(null);
          setSleepBanner("");
          setSleepForm({
            date: todayValue(),
            wakeDate: getDefaultWakeDate(todayValue()),
            quality: "Good",
            bedtime: nowTimeValue(),
            wakeTime: "",
            nightWakings: "",
            nap: "No",
            notes: "",
          });
          return;
        }

        const savedDate = formatDisplayDateFromIso(latest.logDate) || todayValue();

        setSleepEntryId(String(latest.id));
        setSleepBanner(
          `Continuing previous sleep from ${savedDate} at ${
            latest.data?.bedtime || latest.logTime || "time not set"
          }`,
        );
        setSleepForm({
          date: savedDate,
          wakeDate: getDefaultWakeDate(savedDate),
          quality: latest.data?.quality || "Good",
          bedtime: latest.data?.bedtime || latest.logTime || "",
          wakeTime: "",
          nightWakings: latest.data?.night_wakings || "0",
          nap: latest.data?.nap || "No",
          notes: latest.notes || "",
        });
        return;
      }

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
          wakeDate: getDefaultWakeDate(todayValue()),
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
        wakeDate: todayValue(),
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

  const mapSaasFoodEntry = (row) => {
    const isDrink = row.data?.type === "drink" || row.data?.type === "milk";
    const amount = row.data?.amount || "";
    const unit = row.data?.unit || "oz";
    const amountNumber = toFiniteNumber(amount);

    return {
      id: `care-${row.id}`,
      createdAt: row.createdAt || new Date().toISOString(),
      section: "Food Diary",
      date: formatDisplayDateFromIso(row.logDate) || todayValue(),
      time: row.logTime || "",
      amountOz: isDrink && unit === "oz" ? amountNumber : undefined,
      amountMl:
        isDrink && amountNumber
          ? unit === "ml"
            ? amountNumber
            : amountNumber * 29.5735
          : undefined,
      isMilk: isDrink,
      summary: `${row.data?.item || (isDrink ? "Drink" : "Food entry")} - ${
        isDrink ? `${amount || 0}${unit}` : amount || "No amount"
      }`,
      details: [
        row.data?.intake_status
          ? `Intake: ${row.data.intake_status}`
          : null,
        row.data?.description ? `Description: ${row.data.description}` : null,
        `Location: ${row.data?.location || "Not set"}`,
        row.notes ? `Notes: ${row.notes}` : null,
        row.createdByName ? `Logged by: ${row.createdByName}` : null,
      ].filter(Boolean),
      intakeStatus: row.data?.intake_status || "",
    };
  };

  const readOfflineQueue = () => {
    try {
      return JSON.parse(localStorage.getItem(offlineQueueKey) || "[]");
    } catch {
      return [];
    }
  };

  const writeOfflineQueue = (queue) => {
    try {
      localStorage.setItem(offlineQueueKey, JSON.stringify(queue));
    } catch {
      // If local storage is unavailable, normal online saves still work.
    }
  };

  const createCareLogWithOfflineQueue = async (payload) => {
    const queuedPayload = {
      id: crypto?.randomUUID?.() || `${Date.now()}`,
      familyId,
      payload,
      queuedAt: new Date().toISOString(),
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      writeOfflineQueue([...readOfflineQueue(), queuedPayload]);
      setSyncState("Saved locally");
      return { offline: true };
    }

    try {
      const saved = await api.createCareLog(familyId, payload);
      setSyncState("Synced");
      return saved;
    } catch (error) {
      if (
        typeof navigator !== "undefined" &&
        !navigator.onLine
      ) {
        writeOfflineQueue([...readOfflineQueue(), queuedPayload]);
        setSyncState("Saved locally");
        return { offline: true };
      }
      throw error;
    }
  };

  const syncOfflineQueue = async () => {
    const queue = readOfflineQueue();
    if (!queue.length || !familyId) {
      setSyncState("Synced");
      return;
    }

    setSyncState("Syncing");
    const failed = [];

    for (const item of queue) {
      try {
        await api.createCareLog(item.familyId || familyId, item.payload);
      } catch {
        failed.push(item);
      }
    }

    writeOfflineQueue(failed);
    setSyncState(failed.length ? "Failed" : "Synced");
    if (!failed.length) {
      await loadEntriesFromSupabase();
    }
  };

  const mapSaasMedicationEntry = (row) => ({
    id: `care-${row.id}`,
    createdAt: row.createdAt || new Date().toISOString(),
    section: "Medication",
    date: formatDisplayDateFromIso(row.logDate) || todayValue(),
    time: row.logTime || "",
    summary: `${row.data?.medicine || "Medication"} - ${
      row.data?.dose || "No dose"
    }`,
    details: [
      row.data?.status && row.data.status !== "given"
        ? `Medication status: ${medicationStatusLabel(row.data.status)}`
        : null,
      `Given by: ${row.data?.given_by || "Not set"}`,
      row.notes ? `Notes: ${row.notes}` : null,
      row.createdByName ? `Logged by: ${row.createdByName}` : null,
    ].filter(Boolean),
    medicationStatus: row.data?.status || "given",
  });

  const mapSaasToiletingEntry = (row) => ({
    id: `care-${row.id}`,
    createdAt: row.createdAt || new Date().toISOString(),
    section: "Toileting",
    date: formatDisplayDateFromIso(row.logDate) || todayValue(),
    time: row.logTime || "",
    summary: row.data?.entry || "Toileting entry",
    details: [
      row.notes ? `Notes: ${row.notes}` : null,
      row.createdByName ? `Logged by: ${row.createdByName}` : null,
    ].filter(Boolean),
  });

  const mapSaasSleepEntry = (row) => {
    const entryDate = formatDisplayDateFromIso(row.logDate) || todayValue();
    const wakeDate = formatDisplayDateFromIso(row.data?.wake_date) || entryDate;
    const bedtime = row.data?.bedtime || row.logTime || "";
    const wakeTime = row.data?.wake_time || "";
    const durationMinutes = getSleepDurationMinutes(
      entryDate,
      bedtime,
      wakeDate,
      wakeTime,
    );
    const durationText = formatSleepDuration(durationMinutes);

    return {
      id: `care-${row.id}`,
      createdAt: row.createdAt || new Date().toISOString(),
      section: "Sleep",
      date: entryDate,
      time: bedtime,
      durationMinutes,
      summary: wakeTime
        ? `Sleep · ${bedtime || "No bedtime"} to ${wakeTime}${
            durationText ? ` · ${durationText}` : ""
          }`
        : `Sleep started · ${bedtime || "No bedtime"}`,
      details: [
        row.data?.quality ? `Sleep quality: ${row.data.quality}` : null,
        wakeTime ? `Wake-up: ${wakeDate} ${wakeTime}` : "Wake-up: Not logged yet",
        `Night wakings: ${row.data?.night_wakings || "0"}`,
        `Daytime nap: ${row.data?.nap || "Not set"}`,
        durationText ? `Sleep duration: ${durationText}` : null,
        row.notes ? `Notes: ${row.notes}` : null,
        row.createdByName ? `Logged by: ${row.createdByName}` : null,
      ].filter(Boolean),
      quality: row.data?.quality || "",
      nightWakings: row.data?.night_wakings || "0",
    };
  };

  const mapSaasHealthEntry = (row) => {
    const weightKg = row.data?.weight_kg || "";
    const heightCm = row.data?.height_cm || "";
    const bmi = row.data?.bmi || calculateBmi(weightKg, heightCm);

    return {
      id: `care-${row.id}`,
      createdAt: row.createdAt || new Date().toISOString(),
      section: "Health",
      date: formatDisplayDateFromIso(row.logDate) || todayValue(),
      time: row.logTime || "",
      event: row.data?.event || "Health",
      weightKg,
      heightCm,
      bmi,
      summary: `${row.data?.event || "Health"} - ${
        row.data?.duration || "No duration"
      }`,
      details: [
        row.data?.happened ? `What happened: ${row.data.happened}` : null,
        row.data?.action ? `Action taken: ${row.data.action}` : null,
        row.data?.outcome ? `Outcome: ${row.data.outcome}` : null,
        weightKg ? `Weight (kg): ${weightKg}` : null,
        heightCm ? `Height (cm): ${heightCm}` : null,
        bmi ? `BMI: ${bmi}` : null,
        row.notes ? `Notes: ${row.notes}` : null,
        row.createdByName ? `Logged by: ${row.createdByName}` : null,
      ].filter(Boolean),
      happened: row.data?.happened || "",
      actionTaken: row.data?.action || "",
      outcome: row.data?.outcome || "",
      notes: row.notes || "",
    };
  };

  const loadEntriesFromSaasApi = async () => {
    if (!familyId || !childId) return false;

    const logs = await api.listCareLogs(familyId, {
      childId,
    });

    setSharedLog(
      logs
        .map((row) => {
          switch (row.category) {
            case "food":
              return mapSaasFoodEntry(row);
            case "medication":
              return mapSaasMedicationEntry(row);
            case "toileting":
              return mapSaasToiletingEntry(row);
            case "sleep":
              return mapSaasSleepEntry(row);
            case "health":
              return mapSaasHealthEntry(row);
            default:
              return null;
          }
        })
        .filter(Boolean),
    );
    return true;
  };

  const loadEntriesFromSupabase = async () => {
    if (useSaasApi) {
      try {
        await loadEntriesFromSaasApi();
      } catch (error) {
        console.error("Error loading SaaS diary entries:", error);
      }
      return;
    }

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
        amountMl: Number(row.amount || 0) * 29.5735,
        isMilk: true,
        summary: `${parseNotesValue(row.notes, "Item") || "Drink"} - ${
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
    if (useSaasApi) return;
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
  }, [useSaasApi]);

  useEffect(() => {
    if (isUnlocked) {
      loadEntriesFromSupabase();
    }
  }, [isUnlocked, familyId, childId]);

  useEffect(() => {
    const handleOnline = () => {
      syncOfflineQueue();
    };
    window.addEventListener("online", handleOnline);
    if (typeof navigator !== "undefined" && navigator.onLine) {
      syncOfflineQueue();
    } else {
      setSyncState(readOfflineQueue().length ? "Saved locally" : "Synced");
    }
    return () => window.removeEventListener("online", handleOnline);
  }, [familyId]);

  useEffect(() => {
    if (!isUnlocked || activeSection?.title !== "Sleep") return;
    loadLatestIncompleteSleepEntry();
  }, [isUnlocked, activeSection]);

  useEffect(() => {
    if (!isUnlocked) return undefined;
    if (useSaasApi) return undefined;

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
  }, [isUnlocked, useSaasApi]);

  useEffect(() => {
    if (!isUnlocked) return;

    const handleTouchStart = (e) => {
      if (!window.matchMedia("(max-width: 767px)").matches) return;
      if (window.scrollY > 0 || activeSection) return;
      touchStartY.current = e.touches[0].clientY;
      touchCurrentY.current = e.touches[0].clientY;
      isPullingRef.current = true;
    };

    const handleTouchMove = (e) => {
      if (!window.matchMedia("(max-width: 767px)").matches) return;
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
      case "Care Snapshot":
        return "A compact 72-hour summary for urgent handovers and appointments.";
      case "Calendar":
        return "Tap a date to review that day's logs.";
      default:
        return "Form preview";
    }
  }, [activeSection]);

  const recentEntries = useMemo(() => {
    return sharedLog
      .filter((entry) => {
      const entryDate =
        reportDays === "24h" || reportDays === "72h"
          ? getCareSnapshotEntryDate(entry)
          : parseDisplayDate(entry.date);
      if (!entryDate || !reportRangeStart || !reportRangeEnd) return false;
      if (entryDate < reportRangeStart || entryDate > reportRangeEnd) return false;

      if (
        reportCategoryFilter !== "All" &&
        entry.section !== reportCategoryFilter
      ) {
        return false;
      }

      return true;
      })
      .sort((a, b) => {
        const dateA = parseDisplayDate(a.date)?.getTime() || 0;
        const dateB = parseDisplayDate(b.date)?.getTime() || 0;
        if (dateA !== dateB) return dateB - dateA;
        return (a.time || "99:99").localeCompare(b.time || "99:99");
      });
  }, [reportCategoryFilter, reportDays, reportRangeEnd, reportRangeStart, sharedLog]);

  const childDob = childDetails?.dateOfBirth || childDetails?.date_of_birth || "";
  const childAge = calculateAge(childDob);
  const childNhsNumber = childDetails?.nhsNumber || childDetails?.nhs_number || "";
  const familyAddress = familyDetails?.address || "";
  const familyEmergencyContacts = Array.isArray(familyDetails?.emergencyContacts)
    ? familyDetails.emergencyContacts
    : Array.isArray(familyDetails?.emergency_contacts)
      ? familyDetails.emergency_contacts
      : [];
  const visibleEmergencyContacts = familyEmergencyContacts
    .slice(0, 2)
    .filter((contact) =>
      [contact?.name, contact?.relationship, contact?.phone, contact?.notes].some(
        (value) => String(value || "").trim(),
      ),
    );

  const snapshotEntries = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setHours(start.getHours() - 72);

    return sharedLog
      .filter((entry) => {
        const parsed = getCareSnapshotEntryDate(entry);
        return parsed && parsed >= start && parsed <= end;
      })
      .sort((a, b) => {
        const dateA = getCareSnapshotEntryDate(a)?.getTime() || 0;
        const dateB = getCareSnapshotEntryDate(b)?.getTime() || 0;
        return dateB - dateA;
      });
  }, [sharedLog]);

  const snapshotBySection = useMemo(
    () => ({
      food: snapshotEntries.filter((entry) => entry.section === "Food Diary"),
      medication: snapshotEntries.filter((entry) => entry.section === "Medication"),
      sleep: snapshotEntries.filter((entry) => entry.section === "Sleep"),
      toileting: snapshotEntries.filter((entry) => entry.section === "Toileting"),
      health: snapshotEntries.filter((entry) => entry.section === "Health"),
      notes: snapshotEntries.filter((entry) => entry.section === "General Notes"),
    }),
    [snapshotEntries],
  );

  const calendarDays = useMemo(() => {
    const [year, month] = calendarMonth.split("-").map(Number);
    if (!year || !month) return [];
    const first = new Date(year, month - 1, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));

    return Array.from({ length: 42 }).map((_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
        2,
        "0",
      )}-${String(date.getDate()).padStart(2, "0")}`;
      const display = formatDisplayDateFromIso(iso);
      const entries = sharedLog.filter((entry) => entry.date === display);
      return {
        iso,
        day: date.getDate(),
        isCurrentMonth: date.getMonth() === month - 1,
        entries,
      };
    });
  }, [calendarMonth, sharedLog]);

  const selectedCalendarEntries = useMemo(() => {
    const selectedDisplay = formatDisplayDateFromIso(calendarSelectedDate);
    return sharedLog.filter((entry) => entry.date === selectedDisplay);
  }, [calendarSelectedDate, sharedLog]);

  const latestTwoBySection = useMemo(() => {
    const findLatestTwo = (sectionTitle) =>
      sharedLog.filter((entry) => entry.section === sectionTitle).slice(0, 2);

    return {
      food: findLatestTwo("Food Diary"),
      medication: findLatestTwo("Medication"),
      toileting: findLatestTwo("Toileting"),
      health: findLatestTwo("Health"),
      measurements: sharedLog
        .filter(
          (entry) =>
            entry.section === "Health" &&
            String(entry.event || "").toLowerCase() === "measurements",
        )
        .slice(0, 2),
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
        summary: latestTwoBySection.sleep[0]?.summary || "No entries today",
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
          latestTwoBySection.medication[0]?.summary || "No entries today",
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
        summary: latestTwoBySection.food[0]?.summary || "No entries today",
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
          latestTwoBySection.toileting[0]?.summary || "No entries today",
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
        summary: latestTwoBySection.health[0]?.summary || "No entries today",
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

  const reportCategoryOrder = [
    "Food Diary",
    "Medication",
    "Sleep",
    "Toileting",
    "Health",
    "General Notes",
  ];

  const reportCategoryLabel = (section) =>
    section === "Food Diary" ? "Food" : section;

  const dailyReportGroups = useMemo(() => {
    const groups = [];

    recentEntries.forEach((entry) => {
      let group = groups.find((item) => item.date === entry.date);
      if (!group) {
        group = {
          date: entry.date,
          label: formatReportDateLabel(entry.date),
          categories: {},
        };
        reportCategoryOrder.forEach((section) => {
          group.categories[section] = [];
        });
        groups.push(group);
      }

      const section = group.categories[entry.section]
        ? entry.section
        : "General Notes";
      group.categories[section].push(entry);
    });

    return groups;
  }, [recentEntries]);

  const groupedReportEntries = useMemo(() => {
    const groups = {};
    reportCategoryOrder.forEach((section) => {
      groups[section] = [];
    });
    recentEntries.forEach((entry) => {
      const section = groups[entry.section] ? entry.section : "General Notes";
      groups[section].push(entry);
    });
    return groups;
  }, [recentEntries]);

  const previousReportEntries = useMemo(() => {
    if (!reportRangeStart || !reportRangeEnd) return [];

    const rangeDuration = Math.max(
      24 * 60 * 60 * 1000,
      reportRangeEnd.getTime() - reportRangeStart.getTime(),
    );
    const previousEnd = new Date(reportRangeStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - rangeDuration);

    return sharedLog
      .filter((entry) => {
        const entryDate = getEntryDateTime(entry);
        if (!entryDate) return false;
        if (entryDate < previousStart || entryDate > previousEnd) return false;
        if (
          reportCategoryFilter !== "All" &&
          entry.section !== reportCategoryFilter
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const dateA = getEntryDateTime(a)?.getTime() || 0;
        const dateB = getEntryDateTime(b)?.getTime() || 0;
        return dateA - dateB;
      });
  }, [reportCategoryFilter, reportRangeEnd, reportRangeStart, sharedLog]);

  const quickReportSummary = useMemo(() => {
    const countBySection = (section) =>
      recentEntries.filter((entry) => entry.section === section).length;
    const sleepDurations = recentEntries
      .filter((entry) => entry.section === "Sleep")
      .map((entry) => Number(entry.durationMinutes || 0))
      .filter((minutes) => minutes > 0);
    const healthDays = new Set(
      recentEntries
        .filter((entry) => entry.section === "Health")
        .map((entry) => entry.date),
    );
    const missedMedication = recentEntries.filter(
      (entry) => entry.section === "Medication" && entry.medicationStatus === "missed",
    ).length;
    const lateMedication = recentEntries.filter(
      (entry) => entry.section === "Medication" && entry.medicationStatus === "late",
    ).length;
    const refusedMedication = recentEntries.filter(
      (entry) => entry.section === "Medication" && entry.medicationStatus === "refused",
    ).length;
    const reducedAppetiteDays = new Set(
      recentEntries
        .filter(
          (entry) =>
            entry.section === "Food Diary" &&
            ["reduced", "refused"].includes(entry.intakeStatus),
        )
        .map((entry) => entry.date),
    );
    const refusedFood = recentEntries.filter(
      (entry) => entry.section === "Food Diary" && entry.intakeStatus === "refused",
    ).length;
    const disruptedSleep = recentEntries.filter(
      (entry) =>
        entry.section === "Sleep" &&
        (Number(entry.nightWakings || 0) > 0 ||
          ["poor", "restless", "disrupted"].includes(
            String(entry.quality || "").toLowerCase(),
          )),
    ).length;

    return {
      food: countBySection("Food Diary"),
      medication: countBySection("Medication"),
      sleep: countBySection("Sleep"),
      toileting: countBySection("Toileting"),
      health: countBySection("Health"),
      averageSleepMinutes: sleepDurations.length
        ? Math.round(
            sleepDurations.reduce((sum, minutes) => sum + minutes, 0) /
              sleepDurations.length,
          )
        : 0,
      healthDays: healthDays.size,
      missedMedication,
      lateMedication,
      refusedMedication,
      reducedAppetiteDays: reducedAppetiteDays.size,
      refusedFood,
      disruptedSleep,
    };
  }, [recentEntries]);

  const reportTrendModel = useMemo(() => {
    const rangeDays = Math.max(
      1,
      Math.ceil(
        ((reportRangeEnd?.getTime?.() || Date.now()) -
          (reportRangeStart?.getTime?.() || Date.now()) +
          1) /
          (24 * 60 * 60 * 1000),
      ),
    );
    const typicalMedicationPerDay = profileMedicationOptions.reduce(
      (sum, medicine) => sum + Math.max(1, medicine.times?.length || 0),
      0,
    );

    const getDayKey = (entry) => {
      if (entry.date) return entry.date;
      const parsed = getEntryDateTime(entry);
      return parsed ? formatDisplayDateFromIso(parsed.toISOString()) : "Unknown";
    };

    const classifyToileting = (entry) => {
      const text = `${entry.summary || ""} ${(entry.details || []).join(" ")}`.toLowerCase();
      return {
        wet: /wet|wee|urine|nappy|toilet/.test(text) ? 1 : 0,
        soiled: /bowel|poo|stool|soiled|bm/.test(text) ? 1 : 0,
      };
    };

    const summariseEntries = (entries) => {
      const sorted = [...entries].sort((a, b) => {
        const dateA = getEntryDateTime(a)?.getTime() || 0;
        const dateB = getEntryDateTime(b)?.getTime() || 0;
        return dateA - dateB;
      });
      const dayMap = new Map();
      const weights = [];
      let sleepMinutes = 0;
      let sleepLogsWithDuration = 0;
      let fluidMl = 0;
      let medicationCount = 0;
      let medicationConcernCount = 0;
      let toiletingCount = 0;
      let soiledCount = 0;

      sorted.forEach((entry) => {
        const key = getDayKey(entry);
        if (!dayMap.has(key)) {
          dayMap.set(key, {
            date: key,
            label: formatReportDateLabel(key) || key,
            fluidMl: 0,
            sleepMinutes: 0,
            medication: 0,
            toileting: 0,
            wet: 0,
            soiled: 0,
          });
        }
        const day = dayMap.get(key);

        if (entry.section === "Food Diary") {
          const drinkMl = getFluidMlFromEntry(entry);
          fluidMl += drinkMl;
          day.fluidMl += drinkMl;
        }

        if (entry.section === "Sleep") {
          const minutes = toFiniteNumber(entry.durationMinutes);
          if (minutes > 0) {
            sleepMinutes += minutes;
            sleepLogsWithDuration += 1;
            day.sleepMinutes += minutes;
          }
        }

        if (entry.section === "Medication") {
          medicationCount += 1;
          day.medication += 1;
          if (
            ["missed", "late", "refused"].includes(
              String(entry.medicationStatus || "").toLowerCase(),
            )
          ) {
            medicationConcernCount += 1;
          }
        }

        if (entry.section === "Toileting") {
          const toileting = classifyToileting(entry);
          toiletingCount += 1;
          soiledCount += toileting.soiled;
          day.toileting += 1;
          day.wet += toileting.wet;
          day.soiled += toileting.soiled;
        }

        if (entry.section === "Health" && entry.weightKg) {
          const weight = toFiniteNumber(entry.weightKg);
          if (weight > 0) {
            weights.push({
              date: key,
              label: key.slice(0, 5),
              value: weight,
            });
          }
        }
      });

      const daily = Array.from(dayMap.values()).sort((a, b) => {
        const dateA = parseDisplayDate(a.date)?.getTime() || 0;
        const dateB = parseDisplayDate(b.date)?.getTime() || 0;
        return dateA - dateB;
      });
      const latestWeight = weights[weights.length - 1]?.value || 0;
      const firstWeight = weights[0]?.value || 0;

      return {
        entries: sorted,
        daily,
        days: Math.max(rangeDays, daily.length || 1),
        sleepMinutes,
        avgSleepHours: sleepLogsWithDuration
          ? sleepMinutes / sleepLogsWithDuration / 60
          : 0,
        fluidMl,
        avgFluidMl: fluidMl / Math.max(rangeDays, 1),
        medicationCount,
        typicalMedicationCount: typicalMedicationPerDay
          ? typicalMedicationPerDay * Math.max(rangeDays, 1)
          : 0,
        medicationConcernCount,
        toiletingCount,
        toiletingAvg: toiletingCount / Math.max(rangeDays, 1),
        soiledCount,
        weights,
        weightChange:
          weights.length >= 2 ? latestWeight - firstWeight : 0,
      };
    };

    const current = summariseEntries(recentEntries);
    const previous = summariseEntries(previousReportEntries);

    const trendBadge = (diff, positiveGood = true) => {
      const threshold = Math.abs(diff) < 0.05;
      if (threshold) {
        return {
          label: "Stable",
          icon: "->",
          className: "bg-slate-100 text-slate-600",
        };
      }
      const isGood = positiveGood ? diff > 0 : diff < 0;
      return {
        label: isGood ? "Improving" : "Declining",
        icon: diff > 0 ? "↑" : "↓",
        className: isGood
          ? "bg-emerald-50 text-emerald-700"
          : "bg-rose-50 text-rose-700",
      };
    };

    const medicationPercent = current.typicalMedicationCount
      ? Math.min(100, Math.round((current.medicationCount / current.typicalMedicationCount) * 100))
      : current.medicationCount
        ? 100
        : 0;
    const previousMedicationPercent = previous.typicalMedicationCount
      ? Math.min(100, Math.round((previous.medicationCount / previous.typicalMedicationCount) * 100))
      : previous.medicationCount
        ? 100
        : 0;

    const summaryStats = [
      {
        key: "sleep",
        label: "Avg Sleep",
        value: current.avgSleepHours ? `${roundTo(current.avgSleepHours)}h` : "No data",
        change: formatSignedNumber(current.avgSleepHours - previous.avgSleepHours, "h"),
        trend: trendBadge(current.avgSleepHours - previous.avgSleepHours, true),
        tone: "indigo",
      },
      {
        key: "fluids",
        label: "Avg Fluid Intake",
        value: `${Math.round(current.avgFluidMl)}ml`,
        change: formatSignedNumber(current.avgFluidMl - previous.avgFluidMl, "ml", 0),
        trend: trendBadge(current.avgFluidMl - previous.avgFluidMl, true),
        tone: "sky",
      },
      {
        key: "medication",
        label: "Medication Routine",
        value: current.typicalMedicationCount
          ? `${current.medicationCount} of ${current.typicalMedicationCount}`
          : `${current.medicationCount} logged`,
        change: formatSignedNumber(medicationPercent - previousMedicationPercent, "%", 0),
        trend: trendBadge(medicationPercent - previousMedicationPercent, true),
        tone: "rose",
      },
      {
        key: "toileting",
        label: "Toileting Avg",
        value: `${roundTo(current.toiletingAvg)} / day`,
        change: formatSignedNumber(current.toiletingAvg - previous.toiletingAvg, "", 1),
        trend: trendBadge(current.toiletingAvg - previous.toiletingAvg, true),
        tone: "cyan",
      },
      {
        key: "weight",
        label: "Weight Change",
        value: current.weights.length >= 2 ? `${formatSignedNumber(current.weightChange, "kg")}` : "No trend",
        change: previous.weights.length >= 2
          ? `${formatSignedNumber(current.weightChange - previous.weightChange, "kg")}`
          : "No previous",
        trend: trendBadge(current.weightChange - previous.weightChange, true),
        tone: "emerald",
      },
    ];

    const currentDailyDesc = [...current.daily].reverse();
    const countStreak = (predicate) => {
      let streak = 0;
      for (const day of currentDailyDesc) {
        if (!predicate(day)) break;
        streak += 1;
      }
      return streak;
    };

    const hydrationStreak = countStreak((day) => day.fluidMl > 0);
    const medicationStreak = countStreak((day) => day.medication > 0);
    const sleepStreak = countStreak((day) => day.sleepMinutes >= 8 * 60);

    const lowFluidDays = current.daily.filter(
      (day) => day.fluidMl > 0 && day.fluidMl < Math.max(250, previous.avgFluidMl * 0.75),
    ).length;
    const recentThree = currentDailyDesc.slice(0, 3);
    const noBowelThreeDays =
      recentThree.length >= 3 && recentThree.every((day) => day.soiled === 0);

    const keyChanges = [];
    const sleepDiff = current.avgSleepHours - previous.avgSleepHours;
    const fluidDiff = current.avgFluidMl - previous.avgFluidMl;
    const weightDiff = current.weightChange;

    if (Math.abs(sleepDiff) >= 0.3) {
      keyChanges.push({
        type: sleepDiff > 0 ? "increase" : "decrease",
        icon: sleepDiff > 0 ? "↑" : "↓",
        title: sleepDiff > 0 ? "Sleep increased" : "Sleep decreased",
        text: `${formatSignedNumber(sleepDiff, "h")} vs previous period`,
      });
    }

    if (Math.abs(fluidDiff) >= 100) {
      keyChanges.push({
        type: fluidDiff > 0 ? "increase" : "decrease",
        icon: fluidDiff > 0 ? "↑" : "↓",
        title: fluidDiff > 0 ? "Fluids increased" : "Fluids decreased",
        text: `${formatSignedNumber(fluidDiff, "ml", 0)} average per day`,
      });
    }

    if (current.weights.length >= 2 && Math.abs(weightDiff) >= 0.2) {
      keyChanges.push({
        type: weightDiff >= 0 ? "increase" : "warning",
        icon: weightDiff >= 0 ? "↑" : "!",
        title: weightDiff >= 0 ? "Weight increased" : "Weight dropped",
        text: `${formatSignedNumber(weightDiff, "kg")} in this range`,
      });
    }

    if (noBowelThreeDays) {
      keyChanges.push({
        type: "warning",
        icon: "!",
        title: "No bowel movement logged",
        text: "No soiled/bowel entry in the latest 3 logged days",
      });
    }

    if (current.typicalMedicationCount && medicationPercent < 80) {
      keyChanges.push({
        type: "warning",
        icon: "!",
        title: "Medication routine changed",
        text: `${medicationPercent}% of typical doses logged`,
      });
    }

    if (!keyChanges.length) {
      keyChanges.push({
        type: "stable",
        icon: "->",
        title: "No major changes found",
        text: "Recent logs look broadly stable for this range",
      });
    }

    const insights = [
      lowFluidDays
        ? `Fluid intake below typical levels on ${lowFluidDays} day${lowFluidDays === 1 ? "" : "s"}.`
        : "",
      Math.abs(sleepDiff) >= 0.3
        ? `Sleep has ${sleepDiff > 0 ? "increased" : "decreased"} by ${Math.abs(roundTo(sleepDiff))} hours on average.`
        : "",
      current.toiletingAvg + 0.2 < previous.toiletingAvg
        ? "Toileting frequency is lower than the previous period."
        : "",
      current.typicalMedicationCount && medicationPercent < 90
        ? "Medication routine is slightly inconsistent."
        : "",
      noBowelThreeDays ? "No bowel movement has been logged in the latest 3 logged days." : "",
    ].filter(Boolean);

    return {
      current,
      previous,
      summaryStats,
      keyChanges: keyChanges.slice(0, 4),
      insights: insights.length ? insights.slice(0, 5) : ["No major trends found."],
      streaks: [
        { label: `Hydration streak: ${hydrationStreak} day${hydrationStreak === 1 ? "" : "s"}`, tone: "bg-sky-50 text-sky-700" },
        { label: `Medication: ${medicationStreak} day${medicationStreak === 1 ? "" : "s"}`, tone: "bg-rose-50 text-rose-700" },
        { label: `Sleep goal met: ${sleepStreak} day${sleepStreak === 1 ? "" : "s"}`, tone: "bg-indigo-50 text-indigo-700" },
      ],
      graphs: {
        weight: current.weights.map((point, index, array) => ({
          ...point,
          isDrop: index > 0 && point.value < array[index - 1].value,
        })),
        fluid: current.daily.map((day) => ({
          label: day.date.slice(0, 5),
          value: Math.round(day.fluidMl),
        })),
        sleep: current.daily.map((day) => ({
          label: day.date.slice(0, 5),
          value: roundTo(day.sleepMinutes / 60),
        })),
        toileting: current.daily.map((day) => ({
          label: day.date.slice(0, 5),
          wet: day.wet,
          soiled: day.soiled,
          value: day.toileting,
        })),
        medication: {
          percent: medicationPercent,
          logged: current.medicationCount,
          typical: current.typicalMedicationCount,
        },
      },
    };
  }, [
    previousReportEntries,
    profileMedicationOptions,
    recentEntries,
    reportRangeEnd,
    reportRangeStart,
  ]);

  const reportTrendObservations = useMemo(() => {
    const observations = [];
    const sleepByDay = dailyReportGroups
      .map((group) => ({
        date: group.date,
        minutes: group.categories.Sleep.reduce(
          (sum, entry) => sum + Number(entry.durationMinutes || 0),
          0,
        ),
      }))
      .filter((day) => day.minutes > 0)
      .reverse();
    const lastThreeSleep = sleepByDay.slice(-3);
    const previousSleep = sleepByDay.slice(-6, -3);

    if (lastThreeSleep.length >= 2 && previousSleep.length) {
      const lastAverage =
        lastThreeSleep.reduce((sum, day) => sum + day.minutes, 0) /
        lastThreeSleep.length;
      const previousAverage =
        previousSleep.reduce((sum, day) => sum + day.minutes, 0) /
        previousSleep.length;
      if (lastAverage + 30 < previousAverage) {
        observations.push("Sleep appears lower over the last 3 days.");
      }
    }

    const reducedAppetiteDays = dailyReportGroups.filter((group) =>
      group.categories["Food Diary"].some((entry) =>
        `${entry.summary} ${(entry.details || []).join(" ")}`
          .toLowerCase()
          .match(/reduced|refused|little|less|poor appetite/),
      ),
    ).length;
    if (reducedAppetiteDays) {
      observations.push(
        `Appetite notes appear reduced on ${reducedAppetiteDays} day${
          reducedAppetiteDays === 1 ? "" : "s"
        }.`,
      );
    }

    const medicationDays = dailyReportGroups.filter(
      (group) => group.categories.Medication.length,
    ).length;
    if (medicationDays && medicationDays === dailyReportGroups.length) {
      observations.push("Medication was logged consistently.");
    }
    if (quickReportSummary.missedMedication) {
      observations.push(
        `${quickReportSummary.missedMedication} missed dose${
          quickReportSummary.missedMedication === 1 ? "" : "s"
        } recorded.`,
      );
    }
    if (quickReportSummary.lateMedication) {
      observations.push(
        `${quickReportSummary.lateMedication} late dose${
          quickReportSummary.lateMedication === 1 ? "" : "s"
        } recorded.`,
      );
    }
    if (quickReportSummary.averageSleepMinutes) {
      observations.push(
        `Average sleep was ${formatHoursMinutes(
          quickReportSummary.averageSleepMinutes,
        )}.`,
      );
    }
    if (quickReportSummary.disruptedSleep) {
      observations.push(
        `Sleep was disrupted on ${quickReportSummary.disruptedSleep} night${
          quickReportSummary.disruptedSleep === 1 ? "" : "s"
        }.`,
      );
    }
    if (quickReportSummary.reducedAppetiteDays) {
      observations.push(
        `Reduced appetite recorded on ${quickReportSummary.reducedAppetiteDays} day${
          quickReportSummary.reducedAppetiteDays === 1 ? "" : "s"
        }.`,
      );
    } else if (quickReportSummary.food) {
      observations.push("Food intake appeared normal.");
    }
    if (quickReportSummary.refusedFood) {
      observations.push(
        `Food refusal recorded ${quickReportSummary.refusedFood} time${
          quickReportSummary.refusedFood === 1 ? "" : "s"
        }.`,
      );
    }

    if (quickReportSummary.healthDays) {
      observations.push(
        `Health notes were added on ${quickReportSummary.healthDays} day${
          quickReportSummary.healthDays === 1 ? "" : "s"
        }.`,
      );
    }

    return observations.length ? observations : ["No major trends found."];
  }, [dailyReportGroups, quickReportSummary]);

  const reportImportantEvents = useMemo(() => {
    const legacyEvents = importantEvents
      .map((event) => ({
        ...event,
        displayDate: formatDisplayDateFromIso(event.eventDate),
        parsedDate: parseIsoDate(event.eventDate),
        source: "legacy",
      }));

    const healthEvents = recentEntries
      .filter(isSignificantHealthEntry)
      .map((entry) => ({
        id: entry.id,
        eventDate: entry.date,
        eventTime: entry.time,
        eventType: entry.event || "Health",
        notes: entry.happened || entry.notes || entry.summary,
        actionTaken: entry.actionTaken || "",
        outcome: entry.outcome || "",
        displayDate: entry.date,
        parsedDate: parseDisplayDate(entry.date),
        source: "health",
      }));

    return [...legacyEvents, ...healthEvents]
      .filter((event) => {
        if (!event.parsedDate || !reportRangeStart || !reportRangeEnd) return false;
        return event.parsedDate >= reportRangeStart && event.parsedDate <= reportRangeEnd;
      })
      .sort((a, b) => {
        const dateDiff = b.parsedDate - a.parsedDate;
        if (dateDiff) return dateDiff;
        return (a.eventTime || "99:99").localeCompare(b.eventTime || "99:99");
      });
  }, [importantEvents, recentEntries, reportRangeEnd, reportRangeStart]);

  const eventTypeLabel = (value) =>
    (value || "other")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

  const profileItems = useMemo(
    () =>
      [
        ["Diagnosis / needs", childProfile.diagnosisNeeds],
        ["Communication", childProfile.communicationStyle],
        ["Key needs", childProfile.keyNeeds],
        ["Current medication", childProfile.currentMedications],
        ["Allergies", childProfile.allergies],
        ["Emergency notes", childProfile.emergencyNotes],
        ["Sensory needs", childProfile.sensoryNeeds],
        ["Calming strategies", childProfile.calmingStrategies],
        ["Eating preferences", childProfile.eatingPreferences],
        ["Sleep preferences", childProfile.sleepPreferences],
        ["Toileting notes", childProfile.toiletingNotes],
        ["School / EHCP notes", childProfile.schoolEhcpNotes],
        ["Medical notes", childProfile.medicalNotes],
        ["Likes", childProfile.likes],
        ["Dislikes", childProfile.dislikes],
        ["Triggers", childProfile.triggers],
      ].filter(([, value]) => value),
    [childProfile],
  );

  const atAGlance = useMemo(() => {
    const sleep =
      quickReportSummary.disruptedSleep >= 3
        ? "Concern"
        : quickReportSummary.disruptedSleep
          ? "Variable"
          : quickReportSummary.sleep
            ? "Consistent"
            : "Not enough data";
    const medication =
      quickReportSummary.missedMedication + quickReportSummary.refusedMedication > 1
        ? "Concern"
        : quickReportSummary.missedMedication ||
            quickReportSummary.lateMedication ||
            quickReportSummary.refusedMedication
          ? "Some missed"
          : quickReportSummary.medication
            ? "Consistent"
            : "Not enough data";
    const appetite =
      quickReportSummary.refusedFood || quickReportSummary.reducedAppetiteDays >= 3
        ? "Concern"
        : quickReportSummary.reducedAppetiteDays
          ? "Reduced"
          : quickReportSummary.food
            ? "Normal"
            : "Not enough data";
    const health =
      quickReportSummary.healthDays >= 3
        ? "Concern"
        : quickReportSummary.healthDays
          ? "Notes recorded"
          : "No major concerns";

    return { sleep, medication, appetite, health };
  }, [quickReportSummary]);

  const professionalText = (text) => {
    if (!professionalLanguage || !text) return text;
    return text
      .replace(/didn'?t eat much/gi, "reduced appetite observed")
      .replace(/bad sleep/gi, "poor sleep quality recorded")
      .replace(/meltdown/gi, "period of distress")
      .replace(/was sick/gi, "vomiting/sickness recorded");
  };

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

  const reportChartData = useMemo(() => {
    const countSection = (section) =>
      recentEntries.filter((entry) => entry.section === section).length;
    const totalSleepMinutes = recentEntries
      .filter((entry) => entry.section === "Sleep")
      .reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);

    return [
      {
        label: "Food frequency",
        value: countSection("Food Diary"),
        max: Math.max(1, recentEntries.length),
        meta: "food logs",
        tone: "bg-amber-500",
      },
      {
        label: "Medication frequency",
        value: countSection("Medication"),
        max: Math.max(1, recentEntries.length),
        meta: "medication logs",
        tone: "bg-rose-500",
      },
      {
        label: "Sleep duration",
        value: Math.round(totalSleepMinutes / 60),
        max: Math.max(1, effectiveReportDays * 12),
        meta: "hours total",
        tone: "bg-indigo-500",
      },
      {
        label: "Toileting patterns",
        value: countSection("Toileting"),
        max: Math.max(1, recentEntries.length),
        meta: "toileting logs",
        tone: "bg-sky-500",
      },
    ];
  }, [effectiveReportDays, recentEntries]);

  const onboardingChecklistItems = useMemo(() => {
    const hasMedication =
      profileMedicationOptions.length > 0 ||
      sharedLog.some((entry) => entry.section === "Medication");

    const items = [
      {
        label: "Add your child",
        completed: Boolean(childId),
        action: "child",
      },
      {
        label: "Add first medication",
        completed: hasMedication,
        action: "medication",
      },
      {
        label: "Add first meal",
        completed: sharedLog.some((entry) => entry.section === "Food Diary"),
        action: "food",
      },
      {
        label: "Add first sleep entry",
        completed: sharedLog.some((entry) => entry.section === "Sleep"),
        action: "sleep",
      },
      {
        label: "View Care Snapshot",
        completed: hasViewedCareSnapshot,
        action: "snapshot",
      },
    ];

    return items;
  }, [childId, hasViewedCareSnapshot, profileMedicationOptions.length, sharedLog]);

  const showOnboardingChecklist = onboardingChecklistItems.some(
    (item) => !item.completed,
  );

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
    if (sectionTitle === "Growth / Measurements") {
      const latest = latestTwoBySection.measurements[0];
      if (!latest) return ["No entries today"];
      const parsedDate = parseDisplayDate(latest.date);
      const dateLabel = parsedDate
        ? parsedDate.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : latest.date || "Date not set";
      if (latest.weightKg) return [`Weight: ${latest.weightKg}kg`, `Date: ${dateLabel}`];
      if (latest.heightCm) return [`Height: ${latest.heightCm}cm`, `Date: ${dateLabel}`];
      return [`Date: ${dateLabel}`];
    }

    const formatList = (entries) => {
      if (!entries.length) return ["No entries today"];
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
      case "Growth / Measurements":
        return formatList(latestTwoBySection.measurements);
      case "Sleep":
        return formatList(latestTwoBySection.sleep);
      default:
        return [""];
    }
  };

  const legacyReportText = useMemo(() => {
    if (reportLayout === "daily") {
      return [
        `FamilyTrack Report - ${reportRangeLabel}`,
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
      `FamilyTrack Report - ${reportRangeLabel}`,
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
    groupedReportEntries,
    recentEntries,
    reportCategoryFilter,
    reportLayout,
    reportRangeLabel,
  ]);

  const reportText = useMemo(() => {
    return [
      `FamilyTrack Care Report - ${childName}`,
      `Date range: ${reportRangeLabel}`,
      `Generated: ${new Date().toLocaleDateString("en-GB")}`,
      reportNotes.trim() ? `Parent/carer notes: ${reportNotes.trim()}` : "",
      "",
      "Quick summary",
      `Food logs: ${quickReportSummary.food}`,
      `Medication logs: ${quickReportSummary.medication}`,
      `Sleep logs: ${quickReportSummary.sleep}`,
      `Toileting logs: ${quickReportSummary.toileting}`,
      `Health logs: ${quickReportSummary.health}`,
      `Average sleep: ${
        quickReportSummary.averageSleepMinutes
          ? formatHoursMinutes(quickReportSummary.averageSleepMinutes)
          : "Not available"
      }`,
      `Days with health notes: ${quickReportSummary.healthDays}`,
      `Medication missed/late/refused: ${quickReportSummary.missedMedication}/${quickReportSummary.lateMedication}/${quickReportSummary.refusedMedication}`,
      "",
      "At a glance",
      `Sleep: ${atAGlance.sleep}`,
      `Medication: ${atAGlance.medication}`,
      `Appetite: ${atAGlance.appetite}`,
      `Health: ${atAGlance.health}`,
      "",
      "Care profile",
      ...(profileItems.length
        ? profileItems.map(([label, value]) => `${label}: ${value}`)
        : ["No care profile details added."]),
      "",
      "Important events",
      ...(reportImportantEvents.length
        ? reportImportantEvents.map(
            (event) =>
              `- ${event.displayDate}${
                event.eventTime ? ` ${event.eventTime}` : ""
              }: ${eventTypeLabel(event.eventType)}${
                event.notes ? ` - ${event.notes}` : ""
              }${event.actionTaken ? ` Action: ${event.actionTaken}` : ""}${
                event.outcome ? ` Outcome: ${event.outcome}` : ""
              }`,
          )
        : ["No important events recorded in this date range."]),
      "",
      "Observations",
      ...reportTrendObservations.map((observation) => `- ${professionalText(observation)}`),
      "",
      ...(reportType === "full"
        ? [
            "Daily timeline",
            ...dailyReportGroups.flatMap((group) => [
              group.label,
              ...reportCategoryOrder.flatMap((section) => {
                const entries = group.categories[section] || [];
                if (!entries.length) return [];
                return [
                  `${reportCategoryLabel(section)}:`,
                  ...entries.map(
                    (entry) =>
                      `- ${entry.time ? `${entry.time}: ` : ""}${professionalText(entry.summary)}${
                        entry.details?.length
                          ? ` (${entry.details.map(professionalText).join("; ")})`
                          : ""
                      }`,
                  ),
                ];
              }),
              "",
            ]),
          ]
        : []),
      ...(recentEntries.length ? [] : ["No logs found for this date range."]),
    ]
      .filter((line) => line !== null)
      .join("\n");
  }, [
    childName,
    dailyReportGroups,
    atAGlance,
    profileItems,
    quickReportSummary,
    recentEntries.length,
    reportImportantEvents,
    reportNotes,
    reportRangeLabel,
    reportTrendObservations,
    reportType,
    professionalLanguage,
  ]);

  const saveFoodEntryToSupabase = async ({
    selectedFood,
    selectedLocation,
    isDrink,
  }) => {
    const mealContext = foodForm.mealContext || "";

    if (useSaasApi) {
      if (!familyId || !childId) {
        alert("Choose a family and child before saving.");
        return false;
      }

      const logDate = parseDateToIso(foodForm.date);

      if (!logDate) {
        alert("Use date format DD/MM/YYYY.");
        return false;
      }

      try {
        const saved = await createCareLogWithOfflineQueue({
          childId,
          category: "food",
          logDate,
            logTime: foodForm.time,
            data: {
            type: isDrink ? "drink" : "food",
            item: selectedFood || (isDrink ? "Drink" : "Food entry"),
            meal_context: mealContext,
            amount: isDrink ? Number(foodForm.amount || 0) : foodForm.amount || "",
            unit: isDrink ? foodForm.unit || "oz" : "",
            description: foodForm.description || "",
            location: selectedLocation,
            intake_status: foodForm.intakeStatus || "normal",
          },
          notes: [foodForm.description, foodForm.notes].filter(Boolean).join("\n"),
        });

        return saved || true;
      } catch (error) {
        console.error("SaaS food save failed:", error);
        alert(error.message || "Food save failed");
        return false;
      }
    }

    if (isDrink) {
      const payload = {
        amount: Number(foodForm.amount || 0),
        unit: foodForm.unit || "oz",
        time: new Date().toISOString(),
        notes: [
          `Date: ${foodForm.date}`,
          `Time: ${foodForm.time}`,
          `Location: ${selectedLocation}`,
          mealContext ? `Meal: ${mealContext}` : null,
          `Item: ${selectedFood || "Drink"}`,
          foodForm.description ? `Description: ${foodForm.description}` : null,
          foodForm.notes ? `Notes: ${foodForm.notes}` : null,
        ]
          .filter(Boolean)
          .join(" | "),
      };

      const { error } = await supabase.from("milk_logs").insert([payload]);

      if (error) {
        console.error("Supabase milk save failed:", error);
        alert("Drink save failed - check console");
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
        mealContext ? `Meal: ${mealContext}` : null,
        foodForm.description ? `Description: ${foodForm.description}` : null,
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
    if (useSaasApi) {
      if (!familyId || !childId) {
        alert("Choose a family and child before saving.");
        return false;
      }

      const logDate = parseDateToIso(medicationForm.date);

      if (!logDate) {
        alert("Use date format DD/MM/YYYY.");
        return false;
      }

      try {
        const saved = await createCareLogWithOfflineQueue({
          childId,
          category: "medication",
          logDate,
          logTime: medicationForm.time,
          data: {
            medicine: selectedMedicine || "Medication",
            dose: medicationForm.dose || "",
            status: medicationForm.status || "given",
            given_by: selectedGivenBy || "Not set",
          },
          notes: medicationForm.notes || "",
        });

        return saved || true;
      } catch (error) {
        console.error("SaaS medication save failed:", error);
        alert(error.message || "Medication save failed");
        return false;
      }
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

    return true;
  };

  const saveToiletingEntryToSupabase = async () => {
    if (useSaasApi) {
      if (!familyId || !childId) {
        alert("Choose a family and child before saving.");
        return false;
      }

      const logDate = parseDateToIso(toiletingForm.date);

      if (!logDate) {
        alert("Use date format DD/MM/YYYY.");
        return false;
      }

      try {
        const saved = await createCareLogWithOfflineQueue({
          childId,
          category: "toileting",
          logDate,
          logTime: toiletingForm.time,
          data: {
            entry: toiletingForm.entry || "Toileting entry",
          },
          notes: toiletingForm.notes || "",
        });

        return saved || true;
      } catch (error) {
        console.error("SaaS toileting save failed:", error);
        alert(error.message || "Toileting save failed");
        return false;
      }
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

        if (useSaasApi) {
          if (!familyId || !childId) {
            alert("Choose a family and child before saving.");
            return false;
          }

          const logDate = parseDateToIso(sleepForm.date);

          if (!logDate) {
            alert("Use date format DD/MM/YYYY.");
            return false;
          }

          const saved = await createCareLogWithOfflineQueue({
            childId,
            category: "sleep",
            logDate,
            logTime: sleepForm.bedtime,
            data: {
              bedtime: sleepForm.bedtime,
              wake_time: "",
              night_wakings: "0",
              nap: "No",
              quality: "",
            },
            notes: "",
          });

          await loadLatestIncompleteSleepEntry();
          await loadEntriesFromSupabase();
          return saved || true;
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

        if (useSaasApi) {
          if (!familyId || !childId) {
            alert("Choose a family and child before saving.");
            return false;
          }

          const logDate = parseDateToIso(sleepForm.date);
          const wakeDateIso = getEffectiveWakeDateIso(
            sleepForm.date,
            sleepForm.bedtime,
            sleepForm.wakeDate,
            sleepForm.wakeTime,
          );

          if (!logDate || !wakeDateIso) {
            alert("Use date format DD/MM/YYYY.");
            return false;
          }

          await api.updateCareLog(familyId, sleepEntryId, {
            childId,
            category: "sleep",
            logDate,
            logTime: sleepForm.bedtime,
            data: {
              bedtime: sleepForm.bedtime,
              wake_time: sleepForm.wakeTime,
              wake_date: wakeDateIso,
              night_wakings: sleepForm.nightWakings || "0",
              nap: sleepForm.nap || "No",
              quality: sleepForm.quality,
            },
            notes: sleepForm.notes || "",
          });

          setSleepEntryId(null);
          setSleepBanner("");
          setSleepForm({
            date: todayValue(),
            wakeDate: todayValue(),
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
          wakeDate: todayValue(),
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

  const saveHealthEntryToSupabase = async (override = {}) => {
    const form = { ...healthForm, ...override };

    if (useSaasApi) {
      if (!familyId || !childId) {
        alert("Choose a family and child before saving.");
        return false;
      }

      const logDate = parseDateToIso(form.date);

      if (!logDate) {
        alert("Use date format DD/MM/YYYY.");
        return false;
      }

      try {
        const saved = await createCareLogWithOfflineQueue({
          childId,
          category: "health",
          logDate,
          logTime: form.time,
          data: {
            event: form.event || "Health",
            duration: form.duration || "",
            happened: form.happened || "",
            action: form.action || "",
            outcome: form.outcome || "",
            weight_kg: form.weightKg || "",
            height_cm: form.heightCm || "",
            bmi: calculateBmi(form.weightKg || "", form.heightCm || ""),
          },
          notes: form.notes || "",
        });

        return saved || true;
      } catch (error) {
        console.error("SaaS health save failed:", error);
        alert(error.message || "Health save failed");
        return false;
      }
    }

    const payload = {
      event: form.event || "Health",
      duration: form.duration || "",
      time: new Date().toISOString(),
      happened: form.happened || "",
      action: form.action || "",
      outcome: form.outcome || "",
      weight_kg: form.weightKg || "",
      height_cm: form.heightCm || "",
      notes: [
        `Date: ${form.date}`,
        `Time: ${form.time}`,
        form.notes ? `Notes: ${form.notes}` : null,
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

  const toastSavedForChild = (saved) => {
    if (!showToast) return;
    const rawId = saved?.id ? String(saved.id).replace(/^care-/, "") : "";
    showToast({
      message: `Saved for ${childName}`,
      type: "success",
      undoLabel: "Undo",
      onUndo:
        useSaasApi && familyId && rawId
          ? async () => {
              await api.deleteCareLog(familyId, rawId);
              await loadEntriesFromSupabase();
            }
          : null,
    });
  };

  const defaultReportPdfFilename = () =>
    `familytrack-care-report-${childName
      .toLowerCase()
      .replace(/\s+/g, "-")}-${effectiveReportDays}-days.pdf`;

  const createReportPdf = async () => {
    const pdfWidth = 297;
    const pdfHeight = 210;
    const margin = 8;
    const gap = 3;
    const usableWidth = pdfWidth - margin * 2;
    const pdf = new jsPDF("l", "mm", "a4");
    let cursorY = margin;
    const pdfGeneratedDate = new Date().toLocaleDateString("en-GB");
    const tones = {
      sky: {
        fill: [240, 249, 255],
        stroke: [186, 230, 253],
        accent: [2, 132, 199],
      },
      amber: {
        fill: [255, 251, 235],
        stroke: [253, 230, 138],
        accent: [217, 119, 6],
      },
      rose: {
        fill: [255, 241, 242],
        stroke: [254, 205, 211],
        accent: [190, 18, 60],
      },
      indigo: {
        fill: [238, 242, 255],
        stroke: [199, 210, 254],
        accent: [79, 70, 229],
      },
      emerald: {
        fill: [236, 253, 245],
        stroke: [167, 243, 208],
        accent: [5, 150, 105],
      },
      slate: {
        fill: [248, 250, 252],
        stroke: [226, 232, 240],
        accent: [71, 85, 105],
      },
      violet: {
        fill: [245, 243, 255],
        stroke: [221, 214, 254],
        accent: [124, 58, 237],
      },
    };

    const setText = (size, color = [15, 23, 42], style = "normal") => {
      pdf.setFont("helvetica", style);
      pdf.setFontSize(size);
      pdf.setTextColor(...color);
    };

    const addPage = () => {
      pdf.addPage("a4", "l");
      cursorY = margin;
    };

    const ensureSpace = (height) => {
      if (cursorY > margin && cursorY + height > pdfHeight - margin) {
        addPage();
      }
    };

    const drawCard = ({
      title,
      lines = [],
      x = margin,
      width = usableWidth,
      fill = tones.slate.fill,
      stroke = tones.slate.stroke,
      titleColor = tones.slate.accent,
    }) => {
      const cleanLines = lines
        .flatMap((line) =>
          pdf.splitTextToSize(String(line || ""), width - 8),
        )
        .filter(Boolean);
      const height = Math.max(16, 12 + cleanLines.length * 4.2);
      ensureSpace(height);

      pdf.setFillColor(...fill);
      pdf.setDrawColor(...stroke);
      pdf.roundedRect(x, cursorY, width, height, 3, 3, "FD");
      setText(7, titleColor, "bold");
      pdf.text(String(title || "").toUpperCase(), x + 4, cursorY + 5);
      setText(8, [15, 23, 42], "normal");
      pdf.text(cleanLines, x + 4, cursorY + 10);
      cursorY += height + gap;
    };

    const drawMetricGrid = (items) => {
      const columns = 4;
      const cardWidth = (usableWidth - gap * (columns - 1)) / columns;
      const cardHeight = 20;
      items.forEach((item, index) => {
        const tone = item.tone || tones.slate;
        const column = index % columns;
        if (column === 0) ensureSpace(cardHeight);
        const x = margin + column * (cardWidth + gap);
        const y = cursorY;
        pdf.setFillColor(...tone.fill);
        pdf.setDrawColor(...tone.stroke);
        pdf.roundedRect(x, y, cardWidth, cardHeight, 3, 3, "FD");
        pdf.setFillColor(...tone.accent);
        pdf.roundedRect(x + 2.5, y + 3, 1.6, cardHeight - 6, 1, 1, "F");
        setText(6.5, tone.accent, "bold");
        pdf.text(String(item.label || "").toUpperCase(), x + 3, y + 5);
        setText(11, [15, 23, 42], "bold");
        pdf.text(String(item.value ?? ""), x + 6, y + 13);
        if (column === columns - 1 || index === items.length - 1) {
          cursorY += cardHeight + gap;
        }
      });
    };

    const drawTrendGrid = () => {
      const columns = 4;
      const cardWidth = (usableWidth - gap * (columns - 1)) / columns;
      const cardHeight = 28;
      const toneForStat = {
        indigo: tones.indigo,
        sky: tones.sky,
        rose: tones.rose,
        cyan: tones.sky,
        emerald: tones.emerald,
      };
      reportTrendModel.summaryStats.forEach((item, index) => {
        const tone = toneForStat[item.tone] || tones.slate;
        const column = index % columns;
        if (column === 0) ensureSpace(cardHeight);
        const x = margin + column * (cardWidth + gap);
        const y = cursorY;
        pdf.setFillColor(...tone.fill);
        pdf.setDrawColor(...tone.stroke);
        pdf.roundedRect(x, y, cardWidth, cardHeight, 3, 3, "FD");
        setText(6.5, tone.accent, "bold");
        pdf.text(String(item.label).toUpperCase(), x + 3, y + 5);
        setText(12, [15, 23, 42], "bold");
        pdf.text(String(item.value), x + 3, y + 13);
        setText(7, [100, 116, 139], "normal");
        pdf.text(`${item.trend.icon} ${item.trend.label} (${item.change})`, x + 3, y + 19);
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(x + 3, y + 23, cardWidth - 6, 2, 1, 1, "F");
        pdf.setFillColor(...tone.accent);
        pdf.roundedRect(
          x + 3,
          y + 23,
          cardWidth - 6,
          2,
          1,
          1,
          "F",
        );
        if (column === columns - 1 || index === reportTrendModel.summaryStats.length - 1) {
          cursorY += cardHeight + gap;
        }
      });
    };

    const drawDailyActivityChart = () => {
      const groups = [...dailyReportGroups].reverse().slice(-12);
      if (!groups.length) return;
      const entriesForGroup = (group) =>
        Object.values(group.categories || {}).flat();

      const chartHeight = 44;
      ensureSpace(chartHeight);

      const x = margin;
      const y = cursorY;
      const width = usableWidth;
      const plotX = x + 9;
      const plotY = y + 13;
      const plotWidth = width - 18;
      const plotHeight = 22;
      const maxTotal = Math.max(
        1,
        ...groups.map((group) => entriesForGroup(group).length),
      );
      const barGap = 3;
      const barWidth = Math.max(
        4,
        (plotWidth - barGap * (groups.length - 1)) / groups.length,
      );
      const categories = [
        ["Food Diary", tones.amber.accent],
        ["Medication", tones.rose.accent],
        ["Sleep", tones.indigo.accent],
        ["Toileting", tones.sky.accent],
        ["Health", tones.emerald.accent],
      ];

      pdf.setFillColor(...tones.slate.fill);
      pdf.setDrawColor(...tones.slate.stroke);
      pdf.roundedRect(x, y, width, chartHeight, 3, 3, "FD");
      setText(7, tones.slate.accent, "bold");
      pdf.text("DAILY ACTIVITY PATTERN", x + 4, y + 6);
      setText(6.5, [100, 116, 139], "normal");
      pdf.text("Stacked bars show food, medication, sleep, toileting and health logs by day.", x + 4, y + 10);

      pdf.setDrawColor(203, 213, 225);
      pdf.line(plotX, plotY + plotHeight, plotX + plotWidth, plotY + plotHeight);

      groups.forEach((group, index) => {
        const barX = plotX + index * (barWidth + barGap);
        let barBottom = plotY + plotHeight;
        const groupEntries = entriesForGroup(group);

        categories.forEach(([section, color]) => {
          const count = groupEntries.filter((entry) => entry.section === section).length;
          if (!count) return;
          const segmentHeight = Math.max(1.2, (count / maxTotal) * plotHeight);
          barBottom -= segmentHeight;
          pdf.setFillColor(...color);
          pdf.roundedRect(barX, barBottom, barWidth, segmentHeight, 1, 1, "F");
        });

        setText(5.5, [100, 116, 139], "normal");
        pdf.text(group.date.slice(0, 5), barX, y + chartHeight - 3);
      });

      const legendY = y + chartHeight - 8;
      categories.forEach(([label, color], index) => {
        const legendX = x + 90 + index * 34;
        pdf.setFillColor(...color);
        pdf.circle(legendX, legendY - 1, 1.2, "F");
        setText(5.5, [71, 85, 105], "normal");
        pdf.text(reportCategoryLabel(label), legendX + 3, legendY);
      });

      cursorY += chartHeight + gap;
    };

    const addSectionTitle = (title) => {
      ensureSpace(10);
      setText(9, [71, 85, 105], "bold");
      pdf.text(String(title).toUpperCase(), margin, cursorY + 4);
      cursorY += 8;
    };

    const formatEntryLine = (entry) => {
      const details = entry.details?.length
        ? ` (${entry.details.map(professionalText).join("; ")})`
        : "";
      return `${entry.time ? `${entry.time} - ` : ""}${professionalText(
        entry.summary,
      )}${details}`;
    };

    pdf.setFillColor(...tones.sky.fill);
    pdf.setDrawColor(...tones.sky.stroke);
    pdf.roundedRect(margin, cursorY, usableWidth, 28, 4, 4, "FD");
    pdf.setFillColor(...tones.sky.accent);
    pdf.roundedRect(margin, cursorY, 3, 28, 1.5, 1.5, "F");
    setText(8, tones.sky.accent, "bold");
    pdf.text("SHAREABLE CARE REPORT", margin + 5, cursorY + 7);
    setText(18, [15, 23, 42], "bold");
    pdf.text(childName || "Child", margin + 5, cursorY + 16);
    setText(8, [51, 65, 85], "normal");
    pdf.text(`Date range: ${reportRangeLabel}`, margin + 5, cursorY + 23);
    pdf.text(
      `Generated: ${pdfGeneratedDate}`,
      margin + 120,
      cursorY + 23,
    );
    cursorY += 32;

    if (reportNotes.trim()) {
      drawCard({
        title: "Parent/carer notes",
        lines: [reportNotes.trim()],
        fill: tones.sky.fill,
        stroke: tones.sky.stroke,
        titleColor: tones.sky.accent,
      });
    }

    addSectionTitle("Key changes");
    reportTrendModel.keyChanges.forEach((item) => {
      const tone =
        item.type === "increase"
          ? tones.emerald
          : item.type === "decrease"
            ? tones.rose
            : item.type === "warning"
              ? tones.amber
              : tones.slate;
      drawCard({
        title: item.title,
        lines: [item.text],
        fill: tone.fill,
        stroke: tone.stroke,
        titleColor: tone.accent,
      });
    });

    addSectionTitle("Summary stats");
    drawMetricGrid(
      reportTrendModel.summaryStats.map((item) => ({
        label: item.label,
        value: item.value,
        tone:
          item.tone === "indigo"
            ? tones.indigo
            : item.tone === "rose"
              ? tones.rose
              : item.tone === "emerald"
                ? tones.emerald
                : tones.sky,
      })),
    );

    addSectionTitle("At a glance");
    drawMetricGrid([
      { label: "Sleep", value: atAGlance.sleep, tone: tones.indigo },
      { label: "Medication", value: atAGlance.medication, tone: tones.rose },
      { label: "Appetite", value: atAGlance.appetite, tone: tones.amber },
      { label: "Health", value: atAGlance.health, tone: tones.emerald },
    ]);

    if (showReportCharts) {
      addSectionTitle("Trends and patterns");
      drawTrendGrid();
      drawDailyActivityChart();
    }

    addSectionTitle("Insights");
    drawCard({
      title: "Insights",
      lines: reportTrendModel.insights.map((item) => `- ${item}`),
    });

    if (reportImportantEvents.length) {
      addSectionTitle("Important events");
      reportImportantEvents.forEach((event) => {
        drawCard({
          title: `${event.displayDate}${event.eventTime ? ` ${event.eventTime}` : ""} - ${eventTypeLabel(event.eventType)}`,
          lines: [
            event.notes ? professionalText(event.notes) : "",
            event.actionTaken ? `Action: ${professionalText(event.actionTaken)}` : "",
            event.outcome ? `Outcome: ${professionalText(event.outcome)}` : "",
          ].filter(Boolean),
          fill: [255, 241, 242],
          stroke: [254, 205, 211],
          titleColor: tones.rose.accent,
        });
      });
    }

    if (reportType === "full") {
      addSectionTitle("Daily grouped timeline");
      if (!dailyReportGroups.length) {
        drawCard({
          title: "No logs found",
          lines: ["No logs were found for this date range."],
          fill: tones.slate.fill,
          stroke: tones.slate.stroke,
          titleColor: tones.slate.accent,
        });
      } else {
        dailyReportGroups.forEach((group) => {
          drawCard({
            title: group.label,
            lines: reportCategoryOrder.flatMap((section) => {
              const entries = group.categories[section] || [];
              if (!entries.length) return [];
              return [
                reportCategoryLabel(section),
                ...entries.map((entry) => `- ${formatEntryLine(entry)}`),
              ];
            }),
            fill: [255, 255, 255],
            stroke: tones.slate.stroke,
            titleColor: tones.slate.accent,
          });
        });
      }
    }

    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page);
      pdf.setDrawColor(226, 232, 240);
      pdf.line(margin, pdfHeight - 7, pdfWidth - margin, pdfHeight - 7);
      setText(6.5, [100, 116, 139], "normal");
      pdf.text(`FamilyTrack report - ${childName}`, margin, pdfHeight - 3);
      pdf.text(`Page ${page} of ${pageCount}`, pdfWidth - margin - 22, pdfHeight - 3);
    }

    return pdf;
  };

  const blobToBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",").pop());
      reader.onerror = () => reject(new Error("Could not prepare PDF email."));
      reader.readAsDataURL(blob);
    });

  const handleExportPdf = async (
    elementId = "report-pdf-export",
    filename = defaultReportPdfFilename(),
  ) => {
    try {
      setIsExportingPdf(true);
      const pdf = await createReportPdf(elementId);
      pdf.save(filename);
    } catch (error) {
      console.error("PDF export failed", error);
      alert(
        `PDF export failed: ${
          error?.message || "Please try again or reduce the report date range."
        }`,
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  const sendReportByEmail = async (event) => {
    event.preventDefault();

    if (!familyId || !childId) {
      showToast?.({ message: "Choose a child before sending", type: "warning" });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reportEmailForm.recipientEmail)) {
      showToast?.({ message: "Enter a valid email address", type: "warning" });
      return;
    }

    if (!reportEmailForm.confirmed) {
      showToast?.({
        message: "Confirm this report will be emailed externally",
        type: "warning",
      });
      return;
    }

    try {
      setIsSendingReportEmail(true);
      const filename = defaultReportPdfFilename();
      const pdf = await createReportPdf();
      const pdfBase64 = await blobToBase64(pdf.output("blob"));

      await api.sendReportEmail(familyId, {
        recipientEmail: reportEmailForm.recipientEmail,
        message: reportEmailForm.message,
        childId,
        childName,
        dateRange: reportRangeLabel,
        filename,
        pdfBase64,
      });

      setIsReportEmailOpen(false);
      setReportEmailForm({ recipientEmail: "", message: "", confirmed: false });
      showToast?.({ message: "📧 Report sent", type: "success" });
    } catch (error) {
      console.error("Report email failed", error);
      showToast?.({
        message: "Report email failed - please try again",
        type: "error",
      });
    } finally {
      setIsSendingReportEmail(false);
    }
  };

  const handleExportCareSnapshotPdf = async () => {
    try {
      setIsExportingPdf(true);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const exportNode = document.getElementById("snapshot-pdf-export");
      const cards = Array.from(
        exportNode?.querySelectorAll("[data-snapshot-pdf-card]") || [],
      );

      if (!exportNode || !cards.length) {
        alert("Snapshot export area not found");
        return;
      }

      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = 210;
      const pdfHeight = 297;
      const margin = 8;
      const gap = 3;
      const usableWidth = pdfWidth - margin * 2;
      const usableHeight = pdfHeight - margin * 2;
      const halfWidth = (usableWidth - gap) / 2;
      let cursorY = margin;
      let column = 0;
      let rowHeight = 0;

      const finishHalfRow = () => {
        if (column === 1) {
          cursorY += rowHeight + gap;
          column = 0;
          rowHeight = 0;
        }
      };

      for (const card of cards) {
        const cardWidth = card.dataset.snapshotPdfCard === "full"
          ? usableWidth
          : halfWidth;
        const isFullWidth = cardWidth === usableWidth;

        if (isFullWidth) finishHalfRow();

        const canvas = await html2canvas(card, {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
          windowWidth: 794,
        });

        const imageData = canvas.toDataURL("image/png");
        let imageWidth = cardWidth;
        let imageHeight = (canvas.height * imageWidth) / canvas.width;

        if (imageHeight > usableHeight) {
          const scale = usableHeight / imageHeight;
          imageHeight = usableHeight;
          imageWidth *= scale;
        }

        if (cursorY + imageHeight > pdfHeight - margin) {
          pdf.addPage();
          cursorY = margin;
          column = 0;
          rowHeight = 0;
        }

        const x = isFullWidth
          ? margin
          : margin + column * (halfWidth + gap);

        pdf.addImage(imageData, "PNG", x, cursorY, imageWidth, imageHeight);

        if (isFullWidth) {
          cursorY += imageHeight + gap;
        } else if (column === 0) {
          rowHeight = imageHeight;
          column = 1;
        } else {
          rowHeight = Math.max(rowHeight, imageHeight);
          cursorY += rowHeight + gap;
          column = 0;
          rowHeight = 0;
        }
      }

      finishHalfRow();

      pdf.save(
        `familytrack-care-snapshot-${childName
          .toLowerCase()
          .replace(/\s+/g, "-")}.pdf`,
      );
    } catch (error) {
      console.error("Care Snapshot PDF export failed", error);
      alert("Care Snapshot PDF export failed - check console");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const renderTimeInput = ({
    label,
    value,
    onChange,
    onNow,
    suggestedTimes = [],
    onSuggestedTime,
    placeholder = "HH:MM",
    disabled = false,
  }) => {
    const cleanSuggestedTimes = uniqueList(suggestedTimes);

    return (
      <div className={cardClassName}>
        <label className="text-sm font-semibold text-slate-700">{label}</label>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
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
        {cleanSuggestedTimes.length ? (
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            {cleanSuggestedTimes.length === 1 ? (
              <button
                type="button"
                onClick={() =>
                  onSuggestedTime
                    ? onSuggestedTime(cleanSuggestedTimes[0])
                    : onChange(cleanSuggestedTimes[0])
                }
                className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700"
                disabled={disabled}
              >
                Suggested {cleanSuggestedTimes[0]}
              </button>
            ) : (
              <>
                <span className="py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Suggested
                </span>
                {cleanSuggestedTimes.map((time) => (
                  <button
                    key={time}
                    type="button"
                    onClick={() =>
                      onSuggestedTime ? onSuggestedTime(time) : onChange(time)
                    }
                    className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700"
                    disabled={disabled}
                  >
                    {time}
                  </button>
                ))}
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const renderFoodForm = () => {
    const typedFood = foodForm.otherItem?.trim() || "";
    const entryType = foodForm.entryType === "Drink" ? "Drink" : "Food";
    const isDrink = entryType === "Drink";
    const selectedFood = typedFood || foodForm.item || (isDrink ? "Drink" : "");
    const mealContextOptions = [
      "Breakfast",
      "Lunch",
      "Dinner",
      "Dessert",
      "Snack",
      "Other",
    ];
    const savedFoodSuggestions = uniqueList([
      ...customFoodLabels,
      ...savedFoodOptions,
      ...(useSaasApi ? [] : ["Cottage pie", "Weetabix", "Heinz Fruit Custard"]),
    ]);
    const showOtherLocation = foodForm.location === "Other";
    const typedLocation = foodForm.otherLocation?.trim() || "";
    const selectedLocation = showOtherLocation
      ? typedLocation || "Other"
      : foodForm.location || "Not set";
    const canSaveTypedFood =
      !!typedFood &&
      !["drink", "breakfast", "lunch", "dinner", "dessert", "snack", "other"].includes(
        typedFood.toLowerCase(),
      );
    const canSaveTypedLocation =
      !!typedLocation &&
      !["home", "school", "other"].includes(typedLocation.toLowerCase());

    const canSaveFood =
      !!foodForm.date.trim() &&
      !!foodForm.time.trim() &&
      !!selectedFood?.trim() &&
      !!foodForm.amount?.toString().trim() &&
      !activeSaveAction;

    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {renderDraftRecoveryPrompt("food")}

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
            Quick pick location
          </label>
          <select
            className={`${inputClassName} min-h-[48px]`}
            value={foodForm.location}
            onChange={(e) =>
              setFoodForm({
                ...foodForm,
                location: e.target.value,
                otherLocation: e.target.value === "Other" ? foodForm.otherLocation : "",
              })
            }
          >
            <option value="">Select location</option>
            {locationOptions.map((location) => (
              <option key={location} value={location}>
                {location}
              </option>
            ))}
          </select>
        </div>

        {showOtherLocation ? (
        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Location name
          </label>
          <input
            type="text"
            placeholder="Type location, e.g. Nan's house, respite, nursery"
            className={`${inputClassName} min-h-[48px]`}
            value={foodForm.otherLocation}
            onChange={(e) =>
              setFoodForm({ ...foodForm, otherLocation: e.target.value })
            }
          />
          <label className="mt-3 flex items-center gap-3 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={saveLocationForFuture}
              onChange={(e) => setSaveLocationForFuture(e.target.checked)}
              disabled={!canSaveTypedLocation}
              className="h-4 w-4 rounded border-slate-300 disabled:opacity-50"
            />
            Save this location for later
          </label>
          {!canSaveTypedLocation ? (
            <p className="mt-2 text-xs font-medium text-slate-500">
              Home and School are always available. Type another place to save it
              for next time.
            </p>
          ) : null}
        </div>
        ) : null}

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Entry type
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {["Food", "Drink"].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setFoodValue(type === "Drink" ? "Drink" : "");
                  setFoodForm({
                    ...foodForm,
                    entryType: type,
                    mealContext:
                      type === "Drink" ? "" : foodForm.mealContext || "",
                    item: "",
                  });
                }}
                className={`rounded-xl border px-4 py-3 text-sm font-bold transition ${
                  entryType === type
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {entryType === "Food" ? (
          <div className={`${cardClassName} md:col-span-2`}>
            <label className="text-sm font-semibold text-slate-700">
              Meal / context
            </label>
            <select
              className={`${inputClassName} min-h-[48px]`}
              value={foodForm.mealContext || ""}
              onChange={(e) =>
                setFoodForm({ ...foodForm, mealContext: e.target.value })
              }
            >
              <option value="">Select meal or context</option>
              {mealContextOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Food or drink name
          </label>
          <input
            type="text"
            placeholder={
              isDrink
                ? "Type drink, e.g. water, juice, milk"
                : "Type food, e.g. toast, pasta, Weetabix"
            }
            className={`${inputClassName} min-h-[48px]`}
            value={foodForm.otherItem}
            onChange={(e) =>
              setFoodForm({ ...foodForm, otherItem: e.target.value, item: "" })
            }
          />
          {savedFoodSuggestions.length ? (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {savedFoodSuggestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    const recalledNote = getFoodDefaultNote(item);
                    setFoodForm({
                      ...foodForm,
                      item,
                      otherItem: item,
                      description:
                        recalledNote && !foodForm.description.trim()
                          ? recalledNote
                          : foodForm.description,
                    });
                  }}
                  className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800"
                >
                  {item}
                </button>
              ))}
            </div>
          ) : null}
          <label className="mt-3 flex items-center gap-3 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={saveFoodForFuture}
              onChange={(e) => setSaveFoodForFuture(e.target.checked)}
              disabled={!canSaveTypedFood}
              className="h-4 w-4 rounded border-slate-300 disabled:opacity-50"
            />
            Save this food or drink for later
          </label>
          {!canSaveTypedFood ? (
            <p className="mt-2 text-xs font-medium text-slate-500">
              Type a specific food or drink name to save it for next time.
            </p>
          ) : null}
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            {isDrink ? `Amount (${foodForm.unit || "oz"})` : "Amount"}
          </label>

          {isDrink ? (
            <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                type="number"
                min="0"
                step={foodForm.unit === "ml" ? "1" : "0.5"}
                placeholder={`Enter ${foodForm.unit || "oz"}`}
                className={`${inputClassName} mt-0 min-h-[48px]`}
                value={foodForm.amount}
                onChange={(e) =>
                  setFoodForm({ ...foodForm, amount: e.target.value })
                }
              />
              <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-300 bg-white text-sm font-bold">
                {["oz", "ml"].map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => {
                      try {
                        localStorage.setItem(DRINK_UNIT_STORAGE_KEY, unit);
                      } catch {
                        // Preference is optional; the save should still work.
                      }
                      setFoodForm({ ...foodForm, unit });
                    }}
                    className={`px-4 py-3 ${
                      foodForm.unit === unit
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-700"
                    }`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>
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
          <label className="text-sm font-semibold text-slate-700">
            Intake
          </label>
          <select
            className={`${inputClassName} min-h-[48px]`}
            value={foodForm.intakeStatus}
            onChange={(e) =>
              setFoodForm({ ...foodForm, intakeStatus: e.target.value })
            }
          >
            <option value="normal">Normal</option>
            <option value="reduced">Reduced</option>
            <option value="refused">Refused</option>
            <option value="increased">Increased</option>
          </select>
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Description
          </label>
          <textarea
            rows={3}
            placeholder="What was offered, texture, brand, flavour, or cup/bottle"
            className={`${inputClassName} min-h-[48px]`}
            value={foodForm.description}
            onChange={(e) =>
              setFoodForm({ ...foodForm, description: e.target.value })
            }
          />
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
                  isDrink,
                });

                if (!saved) return;

                await loadEntriesFromSupabase();
                toastSavedForChild(saved);

                if (saveFoodForFuture && canSaveTypedFood) {
                  if (onCreateCareOption) {
                    await onCreateCareOption({
                      category: "food",
                      label: typedFood,
                      defaultValue: foodForm.description || foodForm.notes,
                    });
                  }
                  setSavedFoodOptions((current) =>
                    dedupeAppend(current, typedFood),
                  );
                }

                if (saveLocationForFuture && canSaveTypedLocation) {
                  if (onCreateCareOption) {
                    await onCreateCareOption({
                      category: "location",
                      label: typedLocation,
                      defaultValue: "",
                    });
                  }
                }

                clearLogDraft("food");
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
    const medicationSuggestedTimes =
      !showOtherMedication && medicationForm.medicine
        ? getMedicationSuggestedTimes(medicationForm.medicine)
        : showOtherMedication && medicationForm.otherMedicine
          ? getMedicationSuggestedTimes(medicationForm.otherMedicine)
          : [];

    const canSaveMedication =
      !!selectedMedicine.trim() &&
      !!medicationForm.dose.trim() &&
      !!medicationForm.time.trim() &&
      !!medicationForm.date.trim() &&
      !activeSaveAction;

    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {renderDraftRecoveryPrompt("medication")}

        {profileMedicationOptions.length ? (
          <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900">
              Regular medication
            </h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {profileMedicationOptions.map((medicine) => (
                <button
                  key={medicine.name}
                  type="button"
                  onClick={() => prefillMedicationFromProfile(medicine)}
                  className={`rounded-xl border px-3 py-2 text-left transition ${
                    selectedMedicationShortcut === medicine.name
                      ? "border-rose-300 bg-rose-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-rose-200"
                  }`}
                >
                  <p className="truncate text-sm font-bold text-slate-900">
                    {medicine.name}
                  </p>
                  <p className="mt-0.5 truncate text-xs font-semibold text-slate-600">
                    {medicine.dose || "Dose not set"}
                    {medicine.times?.length
                      ? ` • ${medicine.times.join(", ")}`
                      : ""}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Medicine
          </label>
          <select
            value={medicationValue}
            onChange={(e) => {
              const value = e.target.value;
              const defaultDose =
                value === "Other" ? "" : getMedicationDefaultDose(value);

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
            {profileMedicationLabels.length ? (
              <optgroup label="Child profile">
                {profileMedicationLabels.map((item) => (
                  <option key={`profile-${item}`} value={item}>
                    {item}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {medicationOptions.map((item) => (
              profileMedicationLabels.includes(item) ? null : (
                <option key={item} value={item}>
                  {item}
                </option>
              )
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
                  const defaultDose = getMedicationDefaultDose(value);

                  setMedicationForm({
                    ...medicationForm,
                    otherMedicine: value,
                    dose: defaultDose || medicationForm.dose,
                  });
                }}
              />
            </div>
            <div className={`${cardClassName} md:col-span-2`}>
              {onAddRegularMedication ? (
              <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={addOtherMedicationToProfile}
                  onChange={(e) => setAddOtherMedicationToProfile(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Add to regular medication
              </label>
              ) : null}
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
          suggestedTimes: medicationSuggestedTimes,
          onSuggestedTime: (time) =>
            setMedicationForm({ ...medicationForm, time }),
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
                toastSavedForChild(saved);

                if (
                  showOtherMedication &&
                  addOtherMedicationToProfile &&
                  onAddRegularMedication
                ) {
                  await onAddRegularMedication({
                    name: medicationForm.otherMedicine,
                    dose: medicationForm.dose,
                  });
                }

                if (showOtherGivenBy && saveGivenByForFuture) {
                  setSavedGivenByOptions((current) =>
                    dedupeAppend(current, medicationForm.otherGivenBy),
                  );
                }

                clearLogDraft("medication");
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
        {renderDraftRecoveryPrompt("toileting")}

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
                toastSavedForChild(saved);
                clearLogDraft("toileting");
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
        {renderDraftRecoveryPrompt("health")}

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
          <label className="text-sm font-semibold text-slate-700">
            Outcome
          </label>
          <textarea
            rows={3}
            placeholder="What happened afterwards"
            className={`${inputClassName} min-h-[48px]`}
            value={healthForm.outcome}
            onChange={(e) =>
              setHealthForm({ ...healthForm, outcome: e.target.value })
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

        {false ? (
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
        ) : null}

        <div className="md:col-span-2">
          <button
            type="button"
            disabled={!canSaveHealth}
            onClick={() =>
              runLockedSave("health", async () => {
                const saved = await saveHealthEntryToSupabase();

                if (!saved) return;

                await loadEntriesFromSupabase();
                toastSavedForChild(saved);
                clearLogDraft("health");
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

  const saveMedicationSchedules = (nextSchedules) => {
    setMedicationSchedules(nextSchedules);
    try {
      localStorage.setItem(
        medicationScheduleStorageKey,
        JSON.stringify(nextSchedules),
      );
    } catch {
      // Local reminders are helpful, but the medication log must keep working.
    }
  };

  const addMedicationSchedule = () => {
    if (!medicationScheduleForm.medicine.trim() || !medicationScheduleForm.time) {
      return;
    }

    saveMedicationSchedules([
      ...medicationSchedules,
      {
        id: crypto?.randomUUID?.() || `${Date.now()}`,
        ...medicationScheduleForm,
      },
    ]);
    setMedicationScheduleForm({ medicine: "", dose: "", time: "08:00" });
  };

  const medicationScheduleStatus = (schedule) => {
    const now = new Date();
    const [hours, minutes] = schedule.time.split(":").map(Number);
    const due = new Date();
    due.setHours(hours || 0, minutes || 0, 0, 0);
    const today = todayValue();
    const matchingLog = sharedLog.find(
      (entry) =>
        entry.section === "Medication" &&
        entry.date === today &&
        (entry.summary || "").toLowerCase().includes(schedule.medicine.toLowerCase()),
    );

    if (matchingLog) return "given";
    if (now > due) return "missed";
    return "upcoming";
  };

  const markScheduleAsGiven = (schedule) => {
    setMedicationValue(
      medicationOptions.includes(schedule.medicine) ? schedule.medicine : "Other",
    );
    setMedicationForm((current) => ({
      ...current,
      medicine: medicationOptions.includes(schedule.medicine)
        ? schedule.medicine
        : "",
      otherMedicine: medicationOptions.includes(schedule.medicine)
        ? ""
        : schedule.medicine,
      dose: schedule.dose || getMedicationDefaultDose(schedule.medicine),
      status: "given",
      date: todayValue(),
      time: nowTimeValue(),
    }));
  };

  const prefillMedicationFromProfile = (medicine) => {
    if (!medicine?.name) return;
    setSelectedMedicationShortcut(medicine.name);
    setMedicationValue(
      medicationOptions.includes(medicine.name) ? medicine.name : "Other",
    );
    setMedicationForm((current) => ({
      ...current,
      medicine: medicationOptions.includes(medicine.name) ? medicine.name : "",
      otherMedicine: medicationOptions.includes(medicine.name) ? "" : medicine.name,
      dose: medicine.dose || getMedicationDefaultDose(medicine.name) || current.dose,
      time: current.time,
      notes: medicine.notes || current.notes,
      status: "given",
      date: todayValue(),
    }));
  };

  const renderMeasurementsForm = () => {
    const canSaveMeasurements =
      !!healthForm.date.trim() &&
      !!healthForm.time.trim() &&
      (!!healthForm.weightKg || !!healthForm.heightCm) &&
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
            Weight (kg)
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            placeholder="e.g. 18.4"
            className={`${inputClassName} min-h-[48px]`}
            value={healthForm.weightKg}
            onChange={(e) =>
              setHealthForm({ ...healthForm, weightKg: e.target.value })
            }
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Height (cm)
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            placeholder="e.g. 105.5"
            className={`${inputClassName} min-h-[48px]`}
            value={healthForm.heightCm}
            onChange={(e) =>
              setHealthForm({ ...healthForm, heightCm: e.target.value })
            }
          />
        </div>

        {healthForm.weightKg && healthForm.heightCm ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 md:col-span-2">
            BMI: {calculateBmi(healthForm.weightKg, healthForm.heightCm) || "Not available"}
          </div>
        ) : null}

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Notes</label>
          <textarea
            rows={4}
            placeholder="Optional notes about the measurement"
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
            disabled={!canSaveMeasurements}
            onClick={() =>
              runLockedSave("measurements", async () => {
                const saved = await saveHealthEntryToSupabase({
                  event: "Measurements",
                  duration: "",
                  happened: "Growth measurement recorded",
                  action: "",
                  outcome: "",
                });

                if (!saved) return;

                await loadEntriesFromSupabase();
                resetHealthForm();
                closeSection();
              })
            }
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {activeSaveAction === "measurements"
              ? "Saving..."
              : "Save measurement"}
          </button>
        </div>
      </div>
    );
  };

  const renderSleepForm = () => {
    const wakeDate = sleepForm.wakeDate || todayValue();
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
        {renderDraftRecoveryPrompt("sleep")}

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
                  setSleepForm({
                    ...sleepForm,
                    date: formatDateInput(e.target.value),
                    wakeDate: getDefaultWakeDate(formatDateInput(e.target.value)),
                  })
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
                  const saved = await saveSleepEntryToSupabase({ mode: "sleep" });
                  if (saved) {
                    toastSavedForChild(saved);
                    clearLogDraft("sleep");
                  }
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
                inputMode="numeric"
                placeholder="DD/MM/YYYY"
                className={dateTimeInputClass}
                value={wakeDate}
                onChange={(e) =>
                  setSleepForm({
                    ...sleepForm,
                    wakeDate: formatDateInput(e.target.value),
                  })
                }
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

                  showToast?.({
                    message: `Saved for ${childName}`,
                    type: "success",
                  });
                  clearLogDraft("sleep");
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
              onClick={() => {
                clearLogDraft("sleep");
                resetSleepForm();
              }}
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
            Since {childDob ? formatDisplayDateFromIso(childDob) : "profile start"}
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
          No entries for these filters.
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
                        Drink {milkOz}oz
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
        title: "Drink",
        value: `${recentEntries
          .filter((entry) => entry.isMilk)
          .reduce((sum, entry) => sum + Number(entry.amountOz || 0), 0)}oz`,
        meta: `${recentEntries.filter((entry) => entry.isMilk).length} drink logs`,
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

        {showReportCharts ? (
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
        ) : null}
      </div>
    );
  };

  const renderSummaryCard = (label, value, mode = "screen") => (
    <div
      key={label}
      className={`rounded-2xl border border-slate-200 bg-white ${
        compactCardPadding(mode)
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-base font-bold text-slate-900">{value}</p>
    </div>
  );

  const keyChangeToneClass = (type) => {
    if (type === "increase") return "border-emerald-200 bg-emerald-50 text-emerald-800";
    if (type === "decrease") return "border-rose-200 bg-rose-50 text-rose-800";
    if (type === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
    return "border-slate-200 bg-slate-50 text-slate-700";
  };

  const statToneClass = (tone) => {
    const classes = {
      indigo: "border-indigo-100 bg-indigo-50 text-indigo-800",
      sky: "border-sky-100 bg-sky-50 text-sky-800",
      rose: "border-rose-100 bg-rose-50 text-rose-800",
      cyan: "border-cyan-100 bg-cyan-50 text-cyan-800",
      emerald: "border-emerald-100 bg-emerald-50 text-emerald-800",
    };
    return classes[tone] || "border-slate-100 bg-slate-50 text-slate-800";
  };

  const renderTrendPill = (trend) => (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${trend.className}`}
    >
      <span>{trend.icon}</span>
      {trend.label}
    </span>
  );

  const renderKeyChangesSection = (mode = "screen") => (
    <section
      data-report-pdf-card="full"
      className={`rounded-2xl border border-slate-200 bg-white ${compactSectionPadding(
        mode,
      )}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-600">
            Top changes
          </p>
          <h3 className="mt-1 text-lg font-black text-slate-950">
            Key Changes
          </h3>
        </div>
        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">
          {reportRangeLabel}
        </span>
      </div>
      <div className={`mt-3 grid gap-2 ${mode === "pdf" ? "grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-4"}`}>
        {reportTrendModel.keyChanges.map((item) => (
          <div
            key={`${item.title}-${item.text}`}
            className={`rounded-xl border px-3 py-3 shadow-sm ${keyChangeToneClass(
              item.type,
            )}`}
          >
            <div className="flex items-start gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 text-base font-black shadow-sm">
                {item.icon}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-950">
                  {item.title}
                </p>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                  {item.text}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const renderReportSummaryStatsRow = (mode = "screen") => (
    <section
      data-report-pdf-card="full"
      className={`rounded-2xl border border-sky-100 bg-sky-50/70 ${compactSectionPadding(
        mode,
      )}`}
    >
      <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-sky-700">
        Summary stats
      </h3>
      <div
        className={`mt-3 flex gap-3 overflow-x-auto pb-1 ${
          mode === "pdf" ? "grid grid-cols-5 overflow-visible" : ""
        }`}
      >
        {reportTrendModel.summaryStats.map((stat) => (
          <div
            key={stat.key}
            className={`min-w-[10rem] rounded-xl border px-3 py-3 shadow-sm ${statToneClass(
              stat.tone,
            )}`}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
              {stat.label}
            </p>
            <p className="mt-1 text-xl font-black text-slate-950">{stat.value}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {renderTrendPill(stat.trend)}
              <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-bold text-slate-600">
                {stat.change}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const renderLineGraphCard = ({
    title,
    data,
    suffix = "",
    stroke = "#0ea5e9",
    markerDrop = false,
    emptyText = "Not enough data yet",
  }) => {
    const points = data.filter((item) => Number.isFinite(Number(item.value)));
    const values = points.map((item) => Number(item.value));
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    const span = Math.max(1, max - min);
    const chartPoints = points.map((item, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = 92 - ((Number(item.value) - min) / span) * 74;
      return { ...item, x, y };
    });
    const polyline = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");

    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              {title}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              {points.length ? `${points.length} plotted point${points.length === 1 ? "" : "s"}` : emptyText}
            </p>
          </div>
          {points.length ? (
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
              {roundTo(values[values.length - 1])}
              {suffix}
            </span>
          ) : null}
        </div>
        <div className="mt-4 h-36">
          {points.length ? (
            <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
              <line x1="0" y1="92" x2="100" y2="92" stroke="#e2e8f0" strokeWidth="1" />
              <polyline
                points={polyline}
                fill="none"
                stroke={stroke}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {chartPoints.map((point) => (
                <circle
                  key={`${title}-${point.label}-${point.value}`}
                  cx={point.x}
                  cy={point.y}
                  r="3.2"
                  fill={markerDrop && point.isDrop ? "#e11d48" : "#ffffff"}
                  stroke={markerDrop && point.isDrop ? "#e11d48" : stroke}
                  strokeWidth="2"
                />
              ))}
            </svg>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
              {emptyText}
            </div>
          )}
        </div>
        {points.length ? (
          <div className="mt-2 flex justify-between text-[10px] font-bold text-slate-400">
            <span>{points[0]?.label}</span>
            <span>{points[points.length - 1]?.label}</span>
          </div>
        ) : null}
      </div>
    );
  };

  const renderFluidBarGraph = () => {
    const data = reportTrendModel.graphs.fluid;
    const target = 1000;
    const max = Math.max(target, ...data.map((item) => item.value), 1);

    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              Fluid intake
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Daily drink totals in ml
            </p>
          </div>
          <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700">
            target {target}ml
          </span>
        </div>
        <div className="mt-4 flex h-40 items-end gap-2 border-b border-slate-200 pb-1">
          {data.length ? (
            data.map((item) => {
              const height = Math.max(6, (item.value / max) * 100);
              const low = item.value > 0 && item.value < target * 0.5;
              return (
                <div key={`fluid-${item.label}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="flex h-32 w-full items-end rounded-t-xl bg-slate-50 px-1">
                    <div
                      className={`w-full rounded-t-lg ${low ? "bg-amber-400" : "bg-sky-500"}`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-slate-400">{item.label}</span>
                </div>
              );
            })
          ) : (
            <div className="flex h-full flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
              No drink logs yet
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderMedicationConsistencyCard = () => {
    const graph = reportTrendModel.graphs.medication;
    const width = Math.max(0, Math.min(100, graph.percent));
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
          Medication routine consistency
        </p>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-3xl font-black text-slate-950">{width}%</p>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              {graph.typical
                ? `${graph.logged} logged from ${graph.typical} typical`
                : `${graph.logged} medication log${graph.logged === 1 ? "" : "s"}`}
            </p>
          </div>
          <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700">
            not strict schedule
          </span>
        </div>
        <div className="mt-5 h-4 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-rose-500"
            style={{ width: `${width}%` }}
          />
        </div>
      </div>
    );
  };

  const renderToiletingPatternCard = () => {
    const data = reportTrendModel.graphs.toileting;
    const max = Math.max(...data.map((item) => item.value), 1);
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
          Toileting pattern
        </p>
        <p className="mt-1 text-sm font-semibold text-slate-600">
          Wet and soiled entries by day
        </p>
        <div className="mt-4 flex h-40 items-end gap-2 border-b border-slate-200 pb-1">
          {data.length ? (
            data.map((item) => (
              <div key={`toileting-${item.label}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div className="flex h-32 w-full items-end rounded-t-xl bg-slate-50 px-1">
                  <div className="flex w-full flex-col justify-end overflow-hidden rounded-t-lg">
                    <div
                      className="bg-cyan-500"
                      style={{ height: `${Math.max(0, (item.wet / max) * 100)}%` }}
                    />
                    <div
                      className="bg-amber-500"
                      style={{ height: `${Math.max(0, (item.soiled / max) * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="text-[10px] font-bold text-slate-400">{item.label}</span>
              </div>
            ))
          ) : (
            <div className="flex h-full flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
              No toileting logs yet
            </div>
          )}
        </div>
        <div className="mt-3 flex gap-2 text-xs font-bold text-slate-600">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-500" /> Wet</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Soiled</span>
        </div>
      </div>
    );
  };

  const renderReportStreaks = () => (
    <div className="flex flex-wrap gap-2">
      {reportTrendModel.streaks.map((streak) => (
        <span
          key={streak.label}
          className={`rounded-full px-3 py-1.5 text-xs font-bold ${streak.tone}`}
        >
          {streak.label}
        </span>
      ))}
    </div>
  );

  const renderReportChartCards = (mode = "screen") => (
    <section
      data-report-pdf-card={mode === "pdf" ? "full" : undefined}
      className={`rounded-2xl border border-slate-200 bg-slate-50 ${compactSectionPadding(
        mode,
      )}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-600">
            Trends
          </p>
          <h3 className="mt-1 text-lg font-black text-slate-950">
            Graphs and patterns
          </h3>
        </div>
        {renderReportStreaks()}
      </div>
      <div className={`mt-4 grid gap-3 ${mode === "pdf" ? "grid-cols-2" : "lg:grid-cols-2"}`}>
        {renderLineGraphCard({
          title: "Weight progress",
          data: reportTrendModel.graphs.weight,
          suffix: "kg",
          stroke: "#10b981",
          markerDrop: true,
          emptyText: "Add at least two weight measurements",
        })}
        {renderFluidBarGraph()}
        {renderLineGraphCard({
          title: "Sleep trend",
          data: reportTrendModel.graphs.sleep,
          suffix: "h",
          stroke: "#6366f1",
          emptyText: "No sleep durations in this range",
        })}
        {renderMedicationConsistencyCard()}
        {renderToiletingPatternCard()}
      </div>
    </section>
  );

  const renderShareableCareReport = ({ mode = "screen" } = {}) => {
    const isPdf = mode === "pdf";
    const rangeLabel = reportRangeLabel;
    const generatedDate = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    return (
      <div
        className={
          isPdf
            ? "space-y-2 bg-white text-slate-900"
            : "space-y-3 rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-3 shadow-sm"
        }
      >
        <section
          data-report-pdf-card="full"
          className={`rounded-2xl border border-sky-100 bg-sky-50 ${compactSectionPadding(mode)}`}
        >
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-600">
            Shareable care report
          </p>
          <h2 className={`${isPdf ? "mt-0.5 text-xl" : "mt-1 text-2xl"} font-extrabold text-slate-950`}>
            {childName}
          </h2>
          <div className={`${isPdf ? "mt-2" : "mt-3"} grid gap-2 text-sm font-semibold text-slate-700 sm:grid-cols-2`}>
            <p>Date range: {rangeLabel}</p>
            <p>Generated: {generatedDate}</p>
          </div>
          {reportNotes.trim() ? (
            <div className="mt-3 rounded-xl border border-sky-100 bg-white/80 px-3 py-2 text-sm text-slate-700">
              <span className="font-bold">Parent/carer notes:</span>{" "}
              {reportNotes.trim()}
            </div>
          ) : null}
        </section>

        {renderKeyChangesSection(mode)}
        {renderReportSummaryStatsRow(mode)}

        <section
          data-report-pdf-card="half"
          className={`rounded-2xl border border-slate-200 bg-white ${compactSectionPadding(mode)}`}
        >
          <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-600">
            At a glance
          </h3>
          <div className={`mt-2 grid gap-2 ${isPdf ? "grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
            {renderSummaryCard("Sleep", atAGlance.sleep, mode)}
            {renderSummaryCard("Medication", atAGlance.medication, mode)}
            {renderSummaryCard("Appetite", atAGlance.appetite, mode)}
            {renderSummaryCard("Health", atAGlance.health, mode)}
          </div>
        </section>

        {showReportCharts ? renderReportChartCards(mode) : null}

        <section
          data-report-pdf-card={isPdf ? "half" : undefined}
          className={`rounded-2xl border border-amber-200 bg-amber-50 ${compactSectionPadding(mode)}`}
        >
          <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-amber-800">
            Child / Emergency Summary
          </h3>
          {profileItems.length ? (
            <div className={`mt-3 grid gap-2 ${isPdf ? "grid-cols-2" : "md:grid-cols-2"}`}>
              {profileItems.slice(0, reportType === "appointment" ? 8 : profileItems.length).map(([label, value]) => (
                <div key={label} className="rounded-xl border border-amber-100 bg-white/80 px-2.5 py-2 text-sm">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700">
                    {label}
                  </p>
                  <p className="mt-1 text-slate-800">{professionalText(value)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-amber-800">
              No care profile details have been added yet.
            </p>
          )}
        </section>

        {reportImportantEvents.length ? (
          <section
            data-report-pdf-card="full"
            className={`rounded-2xl border border-rose-200 bg-rose-50 ${compactSectionPadding(mode)}`}
          >
            <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-rose-800">
              Important events
            </h3>
            <div className="mt-3 space-y-2">
              {reportImportantEvents.map((event) => (
                <div key={event.id} className="break-inside-avoid rounded-xl border border-rose-100 bg-white px-3 py-2 text-sm">
                  <p className="font-bold text-slate-900">
                    {event.displayDate}
                    {event.eventTime ? ` at ${event.eventTime}` : ""} -{" "}
                    {eventTypeLabel(event.eventType)}
                  </p>
                  {event.notes ? <p className="mt-1 text-slate-700">{professionalText(event.notes)}</p> : null}
                  {event.actionTaken ? <p className="mt-1 text-slate-600">Action: {professionalText(event.actionTaken)}</p> : null}
                  {event.outcome ? <p className="mt-1 text-slate-600">Outcome: {professionalText(event.outcome)}</p> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section
          data-report-pdf-card="half"
          className={`rounded-2xl border border-slate-200 bg-white ${compactSectionPadding(mode)}`}
        >
          <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-600">
            Insights
          </h3>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-700">
            {reportTrendModel.insights.map((observation) => (
              <li key={observation}>- {observation}</li>
            ))}
          </ul>
        </section>

        {reportType === "full" ? (
        isPdf ? (
          <>
            <section
              data-report-pdf-card="full"
              className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
            >
              <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-600">
                Daily grouped timeline
              </h3>
              <p className="mt-1 text-xs font-semibold text-slate-600">
                {dailyReportGroups.length
                  ? `${recentEntries.length} entr${recentEntries.length === 1 ? "y" : "ies"} across ${dailyReportGroups.length} day${dailyReportGroups.length === 1 ? "" : "s"}`
                  : "No logs found for this date range."}
              </p>
            </section>
            {dailyReportGroups.flatMap((group) => {
              const eventCards = reportImportantEvents
                .filter((event) => event.displayDate === group.date)
                .map((event) => (
                  <article
                    key={`event-${event.id}`}
                    data-report-pdf-card="half"
                    className="pdf-avoid-break rounded-xl border border-rose-100 bg-rose-50 p-2"
                  >
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-rose-700">
                      {group.label} - important event
                    </p>
                    <p className="mt-1 text-xs font-bold text-slate-900">
                      {event.eventTime ? `${event.eventTime} - ` : ""}
                      {eventTypeLabel(event.eventType)}
                    </p>
                    {event.notes ? (
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-600">
                        {professionalText(event.notes)}
                      </p>
                    ) : null}
                    {event.actionTaken ? (
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-600">
                        Action: {professionalText(event.actionTaken)}
                      </p>
                    ) : null}
                  </article>
                ));

              const entryCards = reportCategoryOrder.flatMap((section) =>
                (group.categories[section] || []).map((entry) => {
                  const theme = sectionTheme[entry.section] || {
                    report: "border-slate-200 bg-slate-50",
                  };

                  return (
                    <article
                      key={`entry-${entry.id}`}
                      data-report-pdf-card="half"
                      className={`pdf-avoid-break rounded-xl border p-2 ${theme.report}`}
                    >
                      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">
                        {group.label} - {reportCategoryLabel(section)}
                      </p>
                      <p className="mt-1 text-xs font-bold text-slate-900">
                        {entry.time ? `${entry.time} - ` : ""}
                        {professionalText(entry.summary)}
                      </p>
                      {entry.details?.slice(0, 3).map((detail, detailIndex) => (
                        <p
                          key={detailIndex}
                          className="mt-0.5 text-[11px] leading-snug text-slate-600"
                        >
                          {professionalText(detail)}
                        </p>
                      ))}
                    </article>
                  );
                }),
              );

              return [...eventCards, ...entryCards];
            })}
          </>
        ) : (
          <section>
            <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-600">
              Daily grouped timeline
            </h3>

            {!dailyReportGroups.length ? (
              <div className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm font-medium text-slate-500">
                No logs found for this date range.
              </div>
            ) : (
              <div className="mt-2 grid gap-3 xl:grid-cols-2">
                {dailyReportGroups.map((group) => (
                  <article
                    key={group.date}
                    className={`break-inside-avoid rounded-2xl border border-slate-200 bg-white ${compactSectionPadding(mode)}`}
                  >
                    <h4 className="text-base font-extrabold text-slate-950">
                      {group.label}
                    </h4>
                    <div className="mt-3 space-y-3">
                      {reportImportantEvents.filter((event) => event.displayDate === group.date).length ? (
                        <div className="break-inside-avoid">
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-rose-700">
                            Important events
                          </p>
                          <ul className="mt-1 space-y-1 text-sm leading-6 text-slate-700">
                            {reportImportantEvents
                              .filter((event) => event.displayDate === group.date)
                              .map((event) => (
                                <li key={event.id}>
                                  - {event.eventTime ? `${event.eventTime}: ` : ""}
                                  <span className="font-semibold text-slate-900">
                                    {eventTypeLabel(event.eventType)}
                                  </span>
                                  {event.notes ? ` - ${professionalText(event.notes)}` : ""}
                                </li>
                              ))}
                          </ul>
                        </div>
                      ) : null}
                      {reportCategoryOrder.map((section) => {
                        const entries = group.categories[section] || [];
                        if (!entries.length) return null;

                        return (
                          <div key={section} className="break-inside-avoid">
                            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                              {reportCategoryLabel(section)}
                            </p>
                            <ul className="mt-1 space-y-1 text-sm leading-6 text-slate-700">
                              {entries.map((entry) => (
                                <li key={entry.id}>
                                  - {entry.time ? `${entry.time}: ` : ""}
                                  <span className="font-semibold text-slate-900">
                                    {professionalText(entry.summary)}
                                  </span>
                                  {entry.details?.length ? (
                                    <span className="text-slate-600">
                                      {" "}
                                      ({entry.details.map(professionalText).join("; ")})
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )
        ) : null}
      </div>
    );
  };

  const renderPdfExportArea = () => (
    <div className="fixed left-[-99999px] top-0 z-[-1]">
      <div
        id="report-pdf-export"
        className="pdf-export-document w-[1120px] bg-white p-4 text-slate-900"
      >
        {renderShareableCareReport({ mode: "pdf" })}
      </div>
    </div>
  );

  const renderSnapshotList = (
    title,
    entries,
    tone = "slate",
    limit = 5,
    mode = "screen",
  ) => {
    if (mode === "pdf") {
      return (
        <>
          <section
            data-snapshot-pdf-card="half"
            className={`pdf-avoid-break rounded-xl border border-${tone}-200 bg-${tone}-50 p-2`}
          >
            <h4 className={`text-xs font-bold uppercase tracking-[0.14em] text-${tone}-700`}>
              {title}
            </h4>
            <p className="mt-1 text-xs font-semibold text-slate-600">
              {entries.length
                ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"} in the last 72 hours`
                : "Nothing logged in the last 72 hours."}
            </p>
          </section>
          {entries.map((entry) => (
            <article
              key={`${title}-${entry.id}`}
              data-snapshot-pdf-card="half"
              className={`pdf-avoid-break rounded-xl border border-${tone}-100 bg-${tone}-50 p-2`}
            >
              <p className={`text-[10px] font-black uppercase tracking-[0.12em] text-${tone}-700`}>
                {title}
              </p>
              <p className="mt-1 text-xs font-bold text-slate-900">
                {entry.date}
                {entry.time ? ` ${entry.time}` : ""} - {entry.summary}
              </p>
              {entry.details?.slice(0, 2).map((detail, index) => (
                <p key={index} className="mt-0.5 text-[11px] leading-snug text-slate-600">
                  {detail}
                </p>
              ))}
            </article>
          ))}
        </>
      );
    }

    return (
      <section
        data-snapshot-pdf-card="half"
        className={`rounded-2xl border border-${tone}-200 bg-${tone}-50 p-3`}
      >
        <h4 className={`text-xs font-bold uppercase tracking-[0.14em] text-${tone}-700`}>
          {title}
        </h4>
        {entries.length ? (
          <div className="mt-2 space-y-2">
            {entries.map((entry) => (
            <div
              key={entry.id}
              className="pdf-avoid-break rounded-xl bg-white/85 px-3 py-2 text-sm"
            >
              <p className="font-bold text-slate-900">
                {entry.date}
                {entry.time ? ` ${entry.time}` : ""} - {entry.summary}
              </p>
              {entry.details?.slice(0, 2).map((detail, index) => (
                <p key={index} className="mt-1 text-xs text-slate-600">
                  {detail}
                </p>
              ))}
            </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm font-medium text-slate-500">
            Nothing logged in the last 72 hours.
          </p>
        )}
      </section>
    );
  };

  const renderCareSnapshotDocument = ({ mode = "screen" } = {}) => {
    const isPdf = mode === "pdf";
    const generatedDate = new Date().toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const allergies = childProfile.allergies || "Not added";

    return (
      <div
        className={
          isPdf
            ? "space-y-2 bg-white text-slate-900"
            : "space-y-3 rounded-[1.75rem] border border-slate-200 bg-slate-50 p-3"
        }
      >
        <section
          data-snapshot-pdf-card="full"
          className={`pdf-avoid-break border border-cyan-100 bg-cyan-50 ${
            isPdf ? "rounded-xl p-3" : "rounded-2xl p-4"
          }`}
        >
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-700">
            Care Snapshot - last 72 hours
          </p>
          <h2 className={`${isPdf ? "mt-0.5 text-xl" : "mt-1 text-2xl"} font-extrabold text-slate-950`}>
            {childName}
          </h2>
          <div className={`${isPdf ? "mt-2" : "mt-3"} grid gap-2 text-sm font-semibold text-slate-700 sm:grid-cols-2`}>
            <p>DOB: {formatLongDateFromIso(childDob) || "Not added"}</p>
            <p>Age: {childAge || "Not added"}</p>
            {snapshotIncludeSensitive ? (
              <p>NHS number: {childNhsNumber || "Not added"}</p>
            ) : null}
            <p>Generated: {generatedDate}</p>
          </div>
        </section>

        <section className={`${isPdf ? "grid grid-cols-2 gap-2" : "grid gap-2 md:grid-cols-2"}`}>
          <div
            data-snapshot-pdf-card="half"
            className={`pdf-avoid-break border border-amber-200 bg-amber-50 ${isPdf ? "rounded-xl p-2.5" : "rounded-2xl p-3"}`}
          >
            <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-amber-800">
              Emergency details
            </h4>
            <div className="mt-2 space-y-2">
              {visibleEmergencyContacts.length ? (
                visibleEmergencyContacts.map((contact, index) => (
                  <div
                    key={`${contact.name || "contact"}-${index}`}
                    className="rounded-xl border border-amber-100 bg-white/80 px-2.5 py-2 text-sm text-slate-700"
                  >
                    <p className="font-bold text-slate-900">
                      Emergency contact {index + 1}: {contact.name || "Name not added"}
                    </p>
                    {contact.relationship ? (
                      <p>Relationship: {contact.relationship}</p>
                    ) : null}
                    {contact.phone ? <p>Phone: {contact.phone}</p> : null}
                    {contact.notes ? <p>Notes: {contact.notes}</p> : null}
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-700">
                  Add emergency contacts in Settings &gt; Family.
                </p>
              )}
            </div>
            <p className="mt-2 text-sm text-slate-700">
              <span className="font-bold">Family address:</span>{" "}
              {familyAddress || "Not added"}
            </p>
            {childProfile.emergencyNotes ? (
              <p className="mt-1 text-sm text-slate-700">
                <span className="font-bold">Emergency notes:</span>{" "}
                {childProfile.emergencyNotes}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-slate-700">
              <span className="font-bold">Allergies:</span> {allergies}
            </p>
          </div>
          <div
            data-snapshot-pdf-card="half"
            className={`pdf-avoid-break border border-rose-200 bg-rose-50 ${isPdf ? "rounded-xl p-2.5" : "rounded-2xl p-3"}`}
          >
            <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-rose-800">
              Medications
            </h4>
            {profileMedicationOptions.length ? (
              <div className="mt-2 space-y-2">
                {profileMedicationOptions.map((medicine, index) => (
                  <div
                    key={`${medicine.name}-${index}`}
                    className="rounded-xl border border-rose-100 bg-white/85 px-2.5 py-2 text-sm text-slate-700"
                  >
                    <p className="font-bold text-slate-900">{medicine.name}</p>
                    {medicine.dose ? <p>Dose: {medicine.dose}</p> : null}
                    {medicine.times?.length ? (
                      <p>Times: {medicine.times.join(", ")}</p>
                    ) : null}
                    {medicine.notes ? <p>Notes: {medicine.notes}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-700">Not added</p>
            )}
          </div>
        </section>

        <section className={`${isPdf ? "grid grid-cols-2 gap-2" : "grid gap-2 md:grid-cols-2"}`}>
          {shareSections.medication
            ? renderSnapshotList(
                "Medication logs",
                snapshotBySection.medication,
                "rose",
                5,
                mode,
              )
            : null}
          {shareSections.food
            ? renderSnapshotList(
                "Food / drink",
                snapshotBySection.food,
                "amber",
                4,
                mode,
              )
            : null}
          {shareSections.sleep
            ? renderSnapshotList("Sleep", snapshotBySection.sleep, "indigo", 3, mode)
            : null}
          {shareSections.toileting
            ? renderSnapshotList(
                "Toileting",
                snapshotBySection.toileting,
                "sky",
                4,
                mode,
              )
            : null}
          {shareSections.health
            ? renderSnapshotList(
                "Health events",
                snapshotBySection.health,
                "emerald",
                5,
                mode,
              )
            : null}
          {shareSections.notes
            ? renderSnapshotList("Key notes", snapshotBySection.notes, "slate", 3, mode)
            : null}
        </section>
      </div>
    );
  };

  const renderCareSnapshotForm = () => (
    <>
      <div className="fixed left-[-99999px] top-0 z-[-1]">
        <div id="snapshot-pdf-export" className="pdf-export-document w-[794px] bg-white p-3 text-slate-900">
          {renderCareSnapshotDocument({ mode: "pdf" })}
        </div>
      </div>

      <div className="mt-6 space-y-4">
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-extrabold text-slate-950">
            Care Snapshot
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            A compact 72-hour handover for school, hospital, GP or emergency use.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
              <input
                type="checkbox"
                checked={snapshotIncludeSensitive}
                onChange={(event) => setSnapshotIncludeSensitive(event.target.checked)}
              />
              Include sensitive info
            </label>
            {Object.entries(shareSections).map(([key, value]) => (
              <label
                key={key}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold capitalize text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(event) =>
                    setShareSections((current) => ({
                      ...current,
                      [key]: event.target.checked,
                    }))
                  }
                />
                {key}
              </label>
            ))}
          </div>
        </section>

        {renderCareSnapshotDocument()}

        <button
          type="button"
          onClick={handleExportCareSnapshotPdf}
          disabled={isExportingPdf}
          className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700 shadow-sm disabled:opacity-60"
        >
          {isExportingPdf ? "Exporting..." : "Export snapshot PDF"}
        </button>
      </div>
    </>
  );

  const renderCalendarForm = () => (
    <div className="mt-6 space-y-4">
      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-extrabold text-slate-950">Calendar</h3>
            <p className="mt-1 text-sm text-slate-600">
              Monthly view of logs for {childName}.
            </p>
          </div>
          <input
            type="month"
            className={`${inputClassName} mt-0 sm:max-w-[180px]`}
            value={calendarMonth}
            onChange={(event) => setCalendarMonth(event.target.value)}
          />
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <div key={day} className="py-2">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day) => {
            const selected = day.iso === calendarSelectedDate;
            const categories = Array.from(new Set(day.entries.map((entry) => entry.section)));
            return (
              <button
                key={day.iso}
                type="button"
                onClick={() => setCalendarSelectedDate(day.iso)}
                className={`min-h-[4.25rem] rounded-xl border p-1.5 text-left transition ${
                  selected
                    ? "border-violet-300 bg-violet-50"
                    : day.isCurrentMonth
                      ? "border-slate-200 bg-slate-50"
                      : "border-slate-100 bg-white text-slate-300"
                }`}
              >
                <span className="text-sm font-extrabold">{day.day}</span>
                <div className="mt-2 flex flex-wrap gap-1">
                  {categories.slice(0, 5).map((category) => (
                    <span
                      key={category}
                      className={`h-2 w-2 rounded-full ${
                        sectionTheme[category]?.badge?.split(" ")[0] || "bg-slate-300"
                      }`}
                      title={category}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h4 className="font-bold text-slate-900">
          {formatReportDateLabel(formatDisplayDateFromIso(calendarSelectedDate)) ||
            formatDisplayDateFromIso(calendarSelectedDate)}
        </h4>
        <div className="mt-3 space-y-2">
          {selectedCalendarEntries.length ? (
            selectedCalendarEntries.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="font-bold text-slate-900">
                  {entry.time || "Time not set"} - {entry.section}
                </p>
                <p className="mt-1 text-slate-700">{entry.summary}</p>
              </div>
            ))
          ) : (
            <p className="text-sm font-medium text-slate-500">
              No logs for this day.
            </p>
          )}
        </div>
      </section>
    </div>
  );

  const renderReportsForm = () => {
    const filtersLabel =
      reportCategoryFilter === "All"
        ? "All categories"
        : reportCategoryFilter;

    const reportInputClassName =
      "mt-2 block min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

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
        title: "Drink",
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
                    <option value="24h">Last 24 hours</option>
                    <option value="72h">Last 72 hours</option>
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
                    <option value="Food Diary">Food</option>
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
                    <option value="24h">Last 24 hours</option>
                    <option value="72h">Last 72 hours</option>
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
                    <option value="Food Diary">Food</option>
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
                    {reportRangeLabel}
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
                    <option value="Food Diary">Food</option>
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

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                    <button
                      type="button"
                      onClick={() => setIsReportEmailOpen(true)}
                      disabled={isExportingPdf || invalidCustomRange || !useSaasApi}
                      className="rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 text-base font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Send Report
                    </button>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm">
                      {reportLayout === "daily" ? "Full daily log" : "Summary with graphs"}
                    </div>
                  </div>
                </div>
              </div>

              {isReportEmailOpen ? (
                <div className="fixed inset-0 z-[70] flex items-end bg-slate-950/45 p-3 sm:items-center sm:justify-center">
                  <form
                    className="w-full rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-2xl sm:max-w-md"
                    onSubmit={sendReportByEmail}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-black text-slate-950">
                          Send Report
                        </h3>
                        <p className="mt-1 text-sm font-medium text-slate-600">
                          This will email the current PDF report outside the app.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsReportEmailOpen(false)}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700"
                      >
                        Close
                      </button>
                    </div>

                    <label className="mt-4 block text-sm font-bold text-slate-700">
                      Recipient email
                      <input
                        className={reportInputClassName}
                        type="email"
                        value={reportEmailForm.recipientEmail}
                        onChange={(event) =>
                          setReportEmailForm((current) => ({
                            ...current,
                            recipientEmail: event.target.value,
                          }))
                        }
                        placeholder="professional@example.com"
                        required
                      />
                    </label>

                    <label className="mt-3 block text-sm font-bold text-slate-700">
                      Optional message
                      <textarea
                        className={reportInputClassName}
                        rows={3}
                        value={reportEmailForm.message}
                        onChange={(event) =>
                          setReportEmailForm((current) => ({
                            ...current,
                            message: event.target.value,
                          }))
                        }
                        placeholder="Short note to include in the email"
                      />
                    </label>

                    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                      Child: {childName}. Range:{" "}
                      {reportRangeLabel}
                      . Filter: {reportCategoryFilter}.
                    </div>

                    <label className="mt-3 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
                      <input
                        type="checkbox"
                        checked={reportEmailForm.confirmed}
                        onChange={(event) =>
                          setReportEmailForm((current) => ({
                            ...current,
                            confirmed: event.target.checked,
                          }))
                        }
                        className="mt-1 h-4 w-4"
                      />
                      I understand this report will be emailed externally.
                    </label>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setIsReportEmailOpen(false)}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                        disabled={isSendingReportEmail}
                      >
                        {isSendingReportEmail ? "Sending..." : "Send"}
                      </button>
                    </div>
                  </form>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </>
    );
  };

  const renderShareableReportsForm = () => {
    const reportInputClassName =
      "mt-2 block min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";
    const invalidCustomRange =
      reportDays === "custom" &&
      reportRangeStart &&
      reportRangeEnd &&
      reportRangeStart > reportRangeEnd;

    return (
      <>
        {renderPdfExportArea()}

        <div className="mt-6 space-y-4">
          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Report settings
            </p>
            <h3 className="mt-1 text-lg font-extrabold text-slate-950">
              Shareable Care Report
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              A simple parent/carer summary for school, hospital appointments,
              EHCP reviews and care handovers.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className={cardClassName}>
                <label className="text-sm font-semibold text-slate-700">
                  Child
                </label>
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-900">
                  {childName}
                </div>
              </div>
              <div className={cardClassName}>
                <label className="text-sm font-semibold text-slate-700">
                  Date range
                </label>
                <select
                  className={reportInputClassName}
                  value={reportDays}
                  onChange={(event) => setReportDays(event.target.value)}
                >
                  <option value="24h">Last 24 hours</option>
                  <option value="72h">Last 72 hours</option>
                  <option value="7">Last 7 days</option>
                  <option value="14">Last 14 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="60">Last 60 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="custom">Custom range</option>
                </select>
              </div>
              <div className={cardClassName}>
                <label className="text-sm font-semibold text-slate-700">
                  Report type
                </label>
                <select
                  className={reportInputClassName}
                  value={reportType}
                  onChange={(event) => setReportType(event.target.value)}
                >
                  <option value="full">Full Care Report</option>
                  <option value="appointment">Appointment Report</option>
                </select>
              </div>
              <div className={cardClassName}>
                <label className="text-sm font-semibold text-slate-700">
                  Template
                </label>
                <select
                  className={reportInputClassName}
                  value={reportTemplate}
                  onChange={(event) => {
                    const template = event.target.value;
                    setReportTemplate(template);
                    if (template === "medication") {
                      setReportCategoryFilter("Medication");
                      setReportType("appointment");
                    } else if (template === "school") {
                      setReportType("appointment");
                      setReportCategoryFilter("All");
                    } else {
                      setReportType("full");
                      setReportCategoryFilter("All");
                    }
                  }}
                >
                  <option value="hospital">Hospital report</option>
                  <option value="ehcp">EHCP review report</option>
                  <option value="school">School handover</option>
                  <option value="medication">Medication summary</option>
                </select>
              </div>
              <div className={cardClassName}>
                <label className="text-sm font-semibold text-slate-700">
                  Wording
                </label>
                <select
                  className={reportInputClassName}
                  value={professionalLanguage ? "professional" : "parent"}
                  onChange={(event) =>
                    setProfessionalLanguage(event.target.value === "professional")
                  }
                >
                  <option value="parent">Parent-friendly</option>
                  <option value="professional">Professional</option>
                </select>
              </div>
              <label className={`${cardClassName} flex items-center gap-3 text-sm font-bold text-slate-700`}>
                <input
                  type="checkbox"
                  checked={showReportCharts}
                  onChange={(event) => setShowReportCharts(event.target.checked)}
                  className="h-4 w-4"
                />
                Include simple charts
              </label>
            </div>

            {reportDays === "custom" ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">
                    Start date
                  </label>
                  <input
                    type="date"
                    className={reportInputClassName}
                    value={reportStartDate}
                    onChange={(event) => setReportStartDate(event.target.value)}
                  />
                </div>
                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">
                    End date
                  </label>
                  <input
                    type="date"
                    className={reportInputClassName}
                    value={reportEndDate}
                    onChange={(event) => setReportEndDate(event.target.value)}
                  />
                </div>
              </div>
            ) : null}

            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label className="text-sm font-semibold text-slate-700">
                Optional parent/carer notes
              </label>
              <textarea
                rows={4}
                className={`${reportInputClassName} resize-none`}
                value={reportNotes}
                onChange={(event) => setReportNotes(event.target.value)}
                placeholder="Anything you want the reader to know before they read the report."
              />
            </div>

            {invalidCustomRange ? (
              <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                End date must be on or after the start date.
              </div>
            ) : null}
          </section>

          {renderShareableCareReport()}

          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-bold text-slate-900">Export or copy</h3>
                <p className="mt-1 text-sm text-slate-600">
                  PDF exports as A4 portrait for sharing with school, hospital
                  or EHCP professionals.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
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
              </div>
            </div>
          </section>
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
      case "Growth / Measurements":
        return renderMeasurementsForm();
      case "Sleep":
        return renderSleepForm();
      case "Reports":
        return renderShareableReportsForm();
      case "Care Snapshot":
        return renderCareSnapshotForm();
      case "Calendar":
        return renderCalendarForm();
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
                <h1 className="text-center text-xl font-black tracking-tight text-slate-950 md:text-2xl">
                  FamilyTrack
                </h1>
                <p className="mt-1 text-sm font-bold text-sky-700">{childName}</p>
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

  const isReportsOpen = ["Reports", "Care Snapshot", "Calendar"].includes(
    activeSection?.title,
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-white to-slate-100 text-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-10 md:py-14">
        {accountAccess && !accountAccess.canAddLogs ? (
          <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
            This family account is view-only. Existing diary entries, reports and
            Care Snapshot are still available, but adding or editing logs is disabled.
          </div>
        ) : null}
        {isRefreshing ? (
          <div className="mb-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-700 md:hidden">
            Refreshing diary...
          </div>
        ) : (
          <div className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 md:hidden">
            Pull down from the top to refresh. Sync: {syncState}
          </div>
        )}

        {showOnboardingChecklist ? (
          <section className="mb-4 rounded-[1.5rem] border border-indigo-100 bg-indigo-50/80 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">
                  Getting started
                </p>
                <h2 className="mt-1 text-base font-black text-slate-950">
                  Finish setting up your diary
                </h2>
              </div>
              <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-bold text-indigo-700 shadow-sm">
                {onboardingChecklistItems.filter((item) => item.completed).length}/
                {onboardingChecklistItems.length} done
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {onboardingChecklistItems.map((item) => (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => openOnboardingItem(item.action)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-bold transition ${
                    item.completed
                      ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                      : "border-indigo-100 bg-white/90 text-slate-700 hover:border-indigo-200 hover:bg-white"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                      item.completed
                        ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                        : "border-indigo-200 text-indigo-500"
                    }`}
                  >
                    {item.completed ? "✓" : "+"}
                  </span>
                  <span className={item.completed ? "line-through decoration-emerald-400" : ""}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {!isCareSnapshotPromptDismissed ? (
        <section className="relative mb-5 rounded-[1.5rem] border border-cyan-100 bg-cyan-50/80 p-4 pr-12 shadow-sm">
          <button
            type="button"
            onClick={dismissCareSnapshotPrompt}
            className="absolute right-3 top-3 rounded-full border border-cyan-200 bg-white/80 px-2 py-1 text-xs font-black text-cyan-700 shadow-sm"
            aria-label="Hide Care Snapshot dashboard prompt"
          >
            ×
          </button>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-700">
                Care Snapshot
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-700">
                Download a 72-hour summary any time, including view-only accounts.
              </p>
            </div>
            <button
              type="button"
              onClick={openCareSnapshot}
              className="w-full rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-black text-white shadow-sm sm:w-auto"
            >
              Download Care Snapshot
            </button>
          </div>
        </section>
        ) : null}

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
          </div>
        </section>

        <section className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {orderedSections.map((section) => {
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
                  : ["No entries today"];

            return (
              <div
                key={section.title}
                onPointerEnter={() => {
                  if (isReorderMode && draggingCardTitle) {
                    reorderDashboardCard(draggingCardTitle, section.title);
                  }
                }}
                className={`group flex min-h-[17rem] flex-col rounded-[2rem] border p-5 shadow-md transition duration-200 hover:-translate-y-1 hover:shadow-lg sm:p-6 ${
                  section.soft
                } ${
                  draggingCardTitle === section.title
                    ? "scale-[1.02] shadow-xl"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div
                    className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br text-4xl text-white shadow-lg ${section.color}`}
                  >
                    {renderDashboardIcon(section)}
                  </div>
                  <div className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700">
                    {["Reports", "Care Snapshot", "Calendar"].includes(section.title)
                      ? "View"
                      : "Log"}
                  </div>
                </div>

                {isReorderMode ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      setDraggingCardTitle(section.title);
                    }}
                    className="touch-none cursor-grab select-none rounded-lg border border-white/70 bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-600 active:cursor-grabbing"
                    aria-label={`Drag ${section.title}`}
                  >
                    Drag
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDashboardCardByStep(section.title, -1)}
                    className="rounded-lg border border-white/70 bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40"
                    disabled={orderedSections[0]?.title === section.title}
                  >
                    Earlier
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDashboardCardByStep(section.title, 1)}
                    className="rounded-lg border border-white/70 bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40"
                    disabled={
                      orderedSections[orderedSections.length - 1]?.title ===
                      section.title
                    }
                  >
                    Later
                  </button>
                </div>
                ) : null}

                <div className="mt-6 flex-1">
                  <h2 className="text-[1.6rem] font-bold leading-tight tracking-tight sm:text-[1.9rem]">
                    {section.title}
                  </h2>

                  {section.subtitle ? (
                    <p className="mt-2 min-h-[2.5rem] text-sm font-medium leading-5 text-slate-600">
                      {section.subtitle}
                    </p>
                  ) : null}

                  {!["Care Snapshot", "Calendar"].includes(section.title) ? (
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
                  ) : null}
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

        <div className="mt-8 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-slate-900">Dashboard order</p>
            <p className="text-xs font-medium text-slate-500">
              {isReorderMode
                ? "Drag cards or use Earlier/Later on mobile."
                : "Open reorder mode to arrange the cards."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setIsReorderMode((current) => !current);
              setDraggingCardTitle("");
            }}
            className="w-fit rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm"
          >
            {isReorderMode ? "Done" : "Reorder cards"}
          </button>
        </div>
      </div>

      <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 md:hidden">
        {quickAddOpen ? (
          <div className="w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Adding for
            </p>
            <p className="mt-1 truncate text-sm font-black text-slate-900">
              {childName}
            </p>
            {children.length > 1 && onSelectChild ? (
              <select
                className="mt-2 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700"
                value={selectedChildId || childId}
                onChange={(event) => onSelectChild(event.target.value)}
              >
                {children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.firstName || child.first_name || "Child"}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="mt-2 border-t border-slate-100 pt-2">
            {[
              ["Food", "Food Diary", "", "🍽"],
              ["Drink", "Food Diary", "Drink", "🥤"],
              ["Medication", "Medication", "", "💊"],
              ["Sleep", "Sleep", "", "🌙"],
              ["Toileting", "Toileting", "", "🚽"],
              ["Health", "Health", "", "✚"],
            ].map(([label, title, preset, icon]) => (
              <button
                key={label}
                type="button"
                onClick={() => openQuickAdd(title, preset)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-base">
                  {icon}
                </span>
                <span>{label}</span>
              </button>
            ))}
            </div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setQuickAddOpen((current) => !current)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-3xl font-light leading-none text-white shadow-xl"
          aria-label="Quick add"
        >
          {quickAddOpen ? "×" : "+"}
        </button>
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
                  {renderDashboardIcon(activeSection, "h-6 w-6", "text-2xl")}
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
