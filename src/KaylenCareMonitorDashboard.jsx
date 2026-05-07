import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { supabase } from "./Supabase";
import { api } from "./api/client";

const DEFAULT_MODULE_VISIBILITY = {
  food: true,
  drink: true,
  medication: true,
  sleep: true,
  toileting: true,
  health: true,
  behaviour: true,
  measurements: true,
  reports: true,
  snapshot: true,
  documents: true,
  appointments: true,
  timeline: true,
  calendar: true,
};

const DOCUMENT_CATEGORIES = [
  "EHCP",
  "Diagnosis",
  "Hospital",
  "School",
  "Medication",
  "Therapy",
  "Benefits / DLA",
  "Other",
];

const DOCUMENT_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.doc,.docx";

const BEHAVIOUR_TYPES = [
  "Meltdown",
  "Shutdown",
  "Aggression",
  "Self-injury",
  "Distress/anxiety",
  "Emotional dysregulation",
  "Other",
];

const BEHAVIOUR_TRIGGERS = [
  "Noise",
  "Transition/change",
  "Hunger",
  "Tiredness",
  "Overstimulation",
  "School",
  "Communication frustration",
  "Pain/discomfort",
  "Unknown",
  "Other",
];

const APPOINTMENT_CATEGORIES = [
  "Hospital",
  "GP",
  "School",
  "EHCP",
  "Therapy",
  "Medication review",
  "Dentist",
  "Other",
];

const normalizeModuleVisibility = (value = {}) => ({
  ...DEFAULT_MODULE_VISIBILITY,
  ...(value && typeof value === "object" ? value : {}),
});

const DEFAULT_HYDRATION_CHECKPOINTS = [
  { time: "13:00", percent: 50 },
  { time: "16:30", percent: 70 },
  { time: "20:00", percent: 100 },
];

const normaliseHydrationCheckpoints = (value) => {
  const rawItems = Array.isArray(value) ? value : DEFAULT_HYDRATION_CHECKPOINTS;
  const checkpoints = rawItems
    .map((item) => ({
      time: String(item?.time || "").slice(0, 5),
      percent: Number.parseInt(item?.percent, 10),
    }))
    .filter(
      (item) =>
        /^\d{2}:\d{2}$/.test(item.time) &&
        Number.isFinite(item.percent) &&
        item.percent > 0,
    )
    .sort((a, b) => a.time.localeCompare(b.time));

  return checkpoints.length ? checkpoints : DEFAULT_HYDRATION_CHECKPOINTS;
};

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

const isLikelyDrinkLabel = (value) =>
  /\b(drink|water|juice|milk|squash|tea|bottle|cup|smoothie)\b/i.test(
    String(value || ""),
  );

const cleanFormText = (value) => {
  const text = String(value ?? "").trim();
  return ["null", "undefined"].includes(text.toLowerCase()) ? "" : text;
};

const safeRandomId = () => {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const medicationTimeWindows = ["morning", "afternoon", "evening"];
const medicationWeekDays = [
  ["sun", 0],
  ["mon", 1],
  ["tue", 2],
  ["wed", 3],
  ["thu", 4],
  ["fri", 5],
  ["sat", 6],
];
const medicationWeekDayKeys = medicationWeekDays.map(([key]) => key);

const formatTimeWindowLabel = (value) =>
  cleanFormText(value).replace(/^./, (letter) => letter.toUpperCase());

const normaliseMedicationTimeWindows = (value) => {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim());

  return Array.from(
    new Set(
      rawItems
        .map((item) => cleanFormText(item).toLowerCase())
        .filter((item) => medicationTimeWindows.includes(item)),
    ),
  );
};

const normaliseMedicationScheduleDays = (value, { requiredDaily = false } = {}) => {
  const rawText = Array.isArray(value)
    ? value.join(",")
    : String(value || "").trim().toLowerCase();
  if (rawText === "prn" || rawText === "as_needed") return ["prn"];
  if (!rawText || rawText === "every_day" || rawText === "daily") {
    return requiredDaily ? ["every_day"] : [];
  }

  const days = Array.from(
    new Set(
      rawText
        .split(",")
        .map((item) => cleanFormText(item).toLowerCase())
        .filter((item) => medicationWeekDayKeys.includes(item)),
    ),
  );

  return days.length ? days : requiredDaily ? ["every_day"] : [];
};

const isMedicationScheduledForDate = (medicine, date) => {
  if (!medicine?.requiredDaily) return false;
  const days = normaliseMedicationScheduleDays(medicine.scheduleDays, {
    requiredDaily: medicine.requiredDaily,
  });
  if (days.includes("prn")) return false;
  if (!days.length || days.includes("every_day")) return true;
  const dayKey = medicationWeekDays.find(([, dayNumber]) => dayNumber === date.getDay())?.[0];
  return dayKey ? days.includes(dayKey) : false;
};

const medicationScheduleLabel = (medicine) => {
  const days = normaliseMedicationScheduleDays(medicine?.scheduleDays, {
    requiredDaily: medicine?.requiredDaily,
  });
  if (days.includes("prn")) return "PRN";
  if (!days.length || days.includes("every_day")) return "Every day";
  return days.map((day) => day.toUpperCase()).join(", ");
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
          requiredDaily = "",
          timeWindow = "",
          scheduleDays = "",
        ] = line
          .split("|")
          .map((part) => cleanFormText(part));
        const dose = [doseAmount, doseUnit].filter(Boolean).join(" ");
        const timeWindows = normaliseMedicationTimeWindows(timeWindow);
        const isRequiredDaily = requiredDaily === "required";
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
          requiredDaily: isRequiredDaily,
          timeWindow: timeWindows[0] || "",
          timeWindows,
          scheduleDays: normaliseMedicationScheduleDays(scheduleDays, {
            requiredDaily: isRequiredDaily,
          }),
        };
      }

      const separator = [" - ", " – ", " — ", ":"].find((item) =>
        line.includes(item),
      );
      if (!separator) {
        return { name: cleanFormText(line), dose: "", doseAmount: "", doseUnit: "", times: [], active: true, notes: "", requiredDaily: false, timeWindow: "", timeWindows: [], scheduleDays: [] };
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
        requiredDaily: false,
        timeWindow: "",
        timeWindows: [],
        scheduleDays: [],
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

const isMeasurementEntry = (entry) =>
  entry?.section === "Health" &&
  (String(entry.event || "").toLowerCase() === "measurements" ||
    Boolean(entry.weightKg) ||
    Boolean(entry.heightCm));

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
  Behaviour: {
    report: "border-purple-200 bg-purple-50",
    badge: "bg-purple-100 text-purple-700",
    solidHeader: "bg-purple-600 text-white border-purple-700",
  },
  Appointments: {
    report: "border-blue-200 bg-blue-50",
    badge: "bg-blue-100 text-blue-700",
    solidHeader: "bg-blue-600 text-white border-blue-700",
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
  customDrinkOptions = [],
  customMedicationOptions = [],
  customGivenByOptions = [],
  customLocationOptions = [],
  onCreateCareOption,
  childProfile: childProfileProp = {},
  importantEvents = [],
  accountAccess = null,
  moduleVisibility = DEFAULT_MODULE_VISIBILITY,
  showToast,
  useSaasApi = false,
} = {}) {
  const childProfile = childProfileProp || {};
  const visibleModules = useMemo(
    () => normalizeModuleVisibility(moduleVisibility),
    [moduleVisibility],
  );
  const isModuleEnabled = (moduleKey) => visibleModules[moduleKey] !== false;
  const isReadOnly = Boolean(
    accountAccess?.viewOnly || accountAccess?.canAddLogs === false,
  );
  const APP_PASSWORD = "030920";

  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(() => Boolean(useSaasApi));

  const [activeSection, setActiveSection] = useState(null);
  const [medicationValue, setMedicationValue] = useState("");
  const [foodValue, setFoodValue] = useState("");
  const [reportDays, setReportDays] = useState("30");
  const [customReportDays, setCustomReportDays] = useState("7");
  const [reportTab, setReportTab] = useState("recent");
  const [reportLayout, setReportLayout] = useState("daily");
  const [reportView, setReportView] = useState("trends");
  const [reportCategoryFilter, setReportCategoryFilter] = useState("All");
  const [reportFiltersOpen, setReportFiltersOpen] = useState(false);
  const [reportNotes, setReportNotes] = useState("");
  const [reportType, setReportType] = useState("full");
  const [professionalLanguage, setProfessionalLanguage] = useState(false);
  const [reportTemplate, setReportTemplate] = useState("hospital");
  const [showReportCharts, setShowReportCharts] = useState(true);
  const [includeHealthHistory24Months, setIncludeHealthHistory24Months] =
    useState(false);
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
    attachmentType: "trends",
    confirmed: false,
  });
  const [documents, setDocuments] = useState([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [documentFilters, setDocumentFilters] = useState({
    search: "",
    childId: "",
    category: "All",
  });
  const [timelineFilters, setTimelineFilters] = useState({
    search: "",
    childId: "all",
    range: "30",
    category: "All",
    severity: "All",
  });
  const [timelineLogs, setTimelineLogs] = useState([]);
  const [timelineDocuments, setTimelineDocuments] = useState([]);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [expandedTimelineItem, setExpandedTimelineItem] = useState("");
  const [documentForm, setDocumentForm] = useState({
    title: "",
    category: "EHCP",
    childId: childId || "",
    documentDate: todayIsoValue(),
    notes: "",
    file: null,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshStatus, setRefreshStatus] = useState("idle");
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
  const [reportOverviewIndex, setReportOverviewIndex] = useState(0);
  const offlineQueueKey = `familytrack:offline-log-queue:${familyId || "legacy"}`;
  const careSnapshotPromptKey = `familytrack:care-snapshot-prompt-dismissed:${familyId || "legacy"}:${childId || "legacy"}`;
  const careSnapshotViewedKey = `familytrack:care-snapshot-viewed:${familyId || "legacy"}:${childId || "legacy"}`;
  const gettingStartedDismissedKey = `familytrack:getting-started-dismissed:${familyId || "legacy"}:${childId || "legacy"}`;
  const [isCareSnapshotPromptDismissed, setIsCareSnapshotPromptDismissed] =
    useState(() => safeLocalStorageGet(careSnapshotPromptKey) === "true");
  const [isGettingStartedDismissed, setIsGettingStartedDismissed] = useState(
    () => safeLocalStorageGet(gettingStartedDismissedKey) === "true",
  );
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
    scheduledWindow: "",
    scheduledDay: "",
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
  const [behaviourForm, setBehaviourForm] = useState({
    date: todayValue(),
    time: nowTimeValue(),
    severity: "3",
    duration: "",
    triggers: [],
    otherTrigger: "",
    location: "",
    otherLocation: "",
    behaviourType: "Meltdown",
    otherBehaviourType: "",
    recoveryTime: "",
    whatHelped: "",
    notes: "",
    attachment: null,
  });
  const [appointmentForm, setAppointmentForm] = useState({
    title: "",
    date: todayValue(),
    time: "",
    location: "",
    professional: "",
    category: "Hospital",
    notes: "",
    outcome: "",
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
      title: "Behaviour",
      subtitle: "Meltdowns, triggers, regulation and recovery",
      button: "Open Log",
      emoji: "BT",
      color: "from-purple-400 to-fuchsia-500",
      soft: "bg-purple-50 border-purple-300",
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
      title: "Document Vault",
      subtitle: "Private EHCP, school, medical and care files",
      button: "Open Vault",
      emoji: "DOC",
      color: "from-slate-500 to-blue-600",
      soft: "bg-slate-50 border-slate-300",
    },
    {
      title: "Appointments",
      subtitle: "Hospital, school, EHCP and care dates",
      button: "Open Calendar",
      emoji: "APPT",
      color: "from-blue-400 to-indigo-500",
      soft: "bg-blue-50 border-blue-300",
    },
    {
      title: "Timeline",
      subtitle: "Search logs, documents, appointments and care history",
      button: "Open Timeline",
      emoji: "TL",
      color: "from-slate-500 to-indigo-600",
      soft: "bg-slate-50 border-slate-300",
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

  const sectionModuleKey = (title) => {
    switch (title) {
      case "Food Diary":
        return "food";
      case "Medication":
        return "medication";
      case "Toileting":
        return "toileting";
      case "Health":
        return "health";
      case "Behaviour":
        return "behaviour";
      case "Sleep":
        return "sleep";
      case "Growth / Measurements":
        return "measurements";
      case "Reports":
        return "reports";
      case "Care Snapshot":
        return "snapshot";
      case "Document Vault":
        return "documents";
      case "Appointments":
        return "appointments";
      case "Timeline":
        return "timeline";
      case "Calendar":
        return "calendar";
      default:
        return "";
    }
  };

  const isSectionVisible = (section) => {
    const moduleKey = sectionModuleKey(section.title);
    if (moduleKey === "hidden") return false;
    return moduleKey ? isModuleEnabled(moduleKey) : true;
  };

  const visibleSections = useMemo(
    () => sections.filter((section) => isSectionVisible(section)),
    [sections, visibleModules],
  );

  const quickAddItems = useMemo(
    () =>
      [
        { label: "Food", title: "Food Diary", preset: "", icon: "Food", module: "food" },
        { label: "Drink", title: "Food Diary", preset: "Drink", icon: "Drink", module: "drink" },
        { label: "Medication", title: "Medication", preset: "", icon: "Med", module: "medication" },
        { label: "Sleep", title: "Sleep", preset: "", icon: "Sleep", module: "sleep" },
        { label: "Toileting", title: "Toileting", preset: "", icon: "Toilet", module: "toileting" },
        { label: "Health", title: "Health", preset: "", icon: "Health", module: "health" },
        { label: "Behaviour", title: "Behaviour", preset: "", icon: "Mood", module: "behaviour" },
        { label: "Appointment", title: "Appointments", preset: "", icon: "Date", module: "appointments" },
      ].filter((item) => isModuleEnabled(item.module)),
    [visibleModules],
  );

  const orderedSections = useMemo(() => {
    const byTitle = new Map(visibleSections.map((section) => [section.title, section]));
    const ordered = dashboardOrder
      .map((title) => byTitle.get(title))
      .filter(Boolean);
    const missing = visibleSections.filter((section) => !dashboardOrder.includes(section.title));
    return [...ordered, ...missing];
  }, [dashboardOrder, visibleSections]);

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
      case "Behaviour":
        return "behaviour";
      case "Appointments":
        return "appointments";
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
      case "behaviour":
        return { behaviourForm };
      case "appointments":
        return { appointmentForm };
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
      behaviour: JSON.stringify(getDraftPayload("behaviour")),
      appointments: JSON.stringify(getDraftPayload("appointments")),
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
      case "behaviour":
        return Boolean(
          payload.behaviourForm?.duration ||
            payload.behaviourForm?.triggers?.length ||
            payload.behaviourForm?.otherTrigger ||
            payload.behaviourForm?.location ||
            payload.behaviourForm?.otherLocation ||
            payload.behaviourForm?.behaviourType !== "Meltdown" ||
            payload.behaviourForm?.otherBehaviourType ||
            payload.behaviourForm?.recoveryTime ||
            payload.behaviourForm?.whatHelped ||
            payload.behaviourForm?.notes ||
            payload.behaviourForm?.attachment,
        );
      case "appointments":
        return Boolean(
          payload.appointmentForm?.title ||
            payload.appointmentForm?.time ||
            payload.appointmentForm?.location ||
            payload.appointmentForm?.professional ||
            payload.appointmentForm?.category !== "Hospital" ||
            payload.appointmentForm?.notes ||
            payload.appointmentForm?.outcome,
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

    if (kind === "behaviour") {
      setBehaviourForm({ ...behaviourForm, ...(draft.behaviourForm || {}) });
    }

    if (kind === "appointments") {
      setAppointmentForm({ ...appointmentForm, ...(draft.appointmentForm || {}) });
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

  const dismissGettingStarted = () => {
    safeLocalStorageSet(gettingStartedDismissedKey, "true");
    setIsGettingStartedDismissed(true);
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

  const formatFileSize = (bytes) => {
    const value = Number(bytes || 0);
    if (!value) return "Unknown size";
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))}KB`;
    return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  };

  const handleDocumentUpload = async (event) => {
    event.preventDefault();
    if (!familyId || !documentForm.file || !documentForm.title.trim()) return;

    setIsUploadingDocument(true);
    try {
      const uploaded = await api.uploadFamilyDocument(
        familyId,
        {
          title: documentForm.title.trim(),
          category: documentForm.category,
          childId: documentForm.childId,
          documentDate: documentForm.documentDate,
          notes: documentForm.notes.trim(),
        },
        documentForm.file,
      );
      setDocuments((current) => [uploaded, ...current]);
      setDocumentForm({
        title: "",
        category: "EHCP",
        childId: childId || "",
        documentDate: todayIsoValue(),
        notes: "",
        file: null,
      });
      event.currentTarget.reset();
      showToast?.({
        message: "Document saved securely",
        type: "success",
      });
    } catch (error) {
      showToast?.({
        message: error.message || "Document upload failed.",
        type: "error",
      });
    } finally {
      setIsUploadingDocument(false);
    }
  };

  const deleteDocument = async (document) => {
    if (!familyId || !document?.id) return;
    const confirmed = window.confirm(
      `Remove "${document.title}" from the Document Vault? This hides it from the app and removes the stored file.`,
    );
    if (!confirmed) return;

    try {
      await api.deleteDocument(familyId, document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      showToast?.({
        message: "Document removed",
        type: "success",
      });
    } catch (error) {
      showToast?.({
        message: error.message || "Document could not be removed.",
        type: "error",
      });
    }
  };

  useEffect(() => {
    setIsGettingStartedDismissed(
      safeLocalStorageGet(gettingStartedDismissedKey) === "true",
    );
  }, [gettingStartedDismissedKey]);

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
      case "reports":
        openSection(sections.find((section) => section.title === "Reports"));
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
    setDocumentForm((current) => ({
      ...current,
      childId: current.childId || childId || "",
    }));
  }, [childId]);

  const loadDocuments = async () => {
    if (!useSaasApi || !familyId) return;

    setIsLoadingDocuments(true);
    try {
      const results = await api.listDocuments(familyId, documentFilters);
      setDocuments(results || []);
    } catch (error) {
      showToast?.({
        message: error.message || "Documents could not be loaded.",
        type: "error",
      });
    } finally {
      setIsLoadingDocuments(false);
    }
  };

  useEffect(() => {
    if (!isUnlocked || !useSaasApi || !familyId) return;
    loadDocuments();
  }, [documentFilters, familyId, isUnlocked, useSaasApi]);

  useEffect(() => {
    if (!isUnlocked || activeSection?.title !== "Timeline") return;
    loadUnifiedTimelineData();
  }, [
    activeSection?.title,
    familyId,
    isUnlocked,
    timelineFilters.childId,
    useSaasApi,
  ]);

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
    behaviourForm,
    appointmentForm,
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
    [
      "Growth / Measurements",
      "Care Snapshot",
      "Document Vault",
      "Appointments",
      "Timeline",
      "Calendar",
    ].includes(sectionTitle);

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
      case "Document Vault":
        return (
          <svg {...common}>
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" />
            <path d="M14 2v5h5" />
            <path d="M9 13h6" />
            <path d="M9 17h4" />
          </svg>
        );
      case "Appointments":
        return (
          <svg {...common}>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3v4" />
            <path d="M8 3v4" />
            <path d="M3 11h18" />
            <path d="M9 16h.01" />
            <path d="M13 16h.01" />
          </svg>
        );
      case "Calendar":
      case "Timeline":
        return (
          <svg {...common}>
            {sectionTitle === "Timeline" ? (
              <>
                <path d="M4 6h16" />
                <path d="M4 12h10" />
                <path d="M4 18h7" />
                <circle cx="18" cy="17" r="3" />
                <path d="m20.5 19.5 1.5 1.5" />
              </>
            ) : (
              <>
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4" />
                <path d="M8 2v4" />
                <path d="M3 10h18" />
                <path d="M8 14h.01" />
                <path d="M12 14h.01" />
                <path d="M16 14h.01" />
              </>
            )}
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
  const customDrinkLabels = customDrinkOptions.map((option) => option.label);
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
    [...customFoodOptions, ...customDrinkOptions].find(
      (option) => option.label === food,
    )?.defaultValue || "";

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

  const resetFormForNewEntry = (title) => {
    const kind = sectionDraftKind(title);
    if (kind) {
      skipNextDraftSaveRef.current[kind] = true;
    }

    if (title === "Food Diary") resetFoodForm();
    if (title === "Medication") resetMedicationForm();
    if (title === "Toileting") resetToiletingForm();
    if (title === "Health" || title === "Growth / Measurements") resetHealthForm();
    if (title === "Behaviour") resetBehaviourForm();
    if (title === "Appointments") resetAppointmentForm();
    if (title === "Sleep") resetSleepForm();
  };

  const openSection = (section, options = {}) => {
    if (!section) return;
    if (options.reset !== false) {
      resetFormForNewEntry(section.title);
    }
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
      scheduledWindow: "",
      scheduledDay: "",
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
      id: safeRandomId(),
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
      row.data?.scheduled_window
        ? `Scheduled dose: ${formatTimeWindowLabel(row.data.scheduled_window)}`
        : null,
      row.data?.scheduled_day ? `Scheduled day: ${row.data.scheduled_day}` : null,
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

  const mapSaasBehaviourEntry = (row) => {
    const triggers = Array.isArray(row.data?.triggers)
      ? row.data.triggers.filter(Boolean)
      : String(row.data?.triggers || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
    const behaviourType =
      row.data?.behaviour_type || row.data?.type || "Behaviour entry";
    const severity = row.data?.severity || "";
    const duration = row.data?.duration || "";
    const recoveryTime = row.data?.recovery_time || "";
    const whatHelped = row.data?.what_helped || "";

    return {
      id: `care-${row.id}`,
      createdAt: row.createdAt || new Date().toISOString(),
      section: "Behaviour",
      date: formatDisplayDateFromIso(row.logDate) || todayValue(),
      time: row.logTime || "",
      behaviourType,
      severity,
      triggers,
      duration,
      recoveryTime,
      whatHelped,
      location: row.data?.location || "",
      summary: [
        behaviourType,
        severity ? `severity ${severity}/5` : "",
        duration ? duration : "",
      ]
        .filter(Boolean)
        .join(" - "),
      details: [
        triggers.length ? `Triggers: ${triggers.join(", ")}` : null,
        row.data?.location ? `Location: ${row.data.location}` : null,
        recoveryTime ? `Recovery time: ${recoveryTime}` : null,
        whatHelped ? `What helped: ${whatHelped}` : null,
        row.data?.attachment_file_name
          ? `Attachment: ${row.data.attachment_file_name}`
          : null,
        row.notes ? `Notes: ${row.notes}` : null,
        row.createdByName ? `Logged by: ${row.createdByName}` : null,
      ].filter(Boolean),
      notes: row.notes || "",
    };
  };

  const mapSaasAppointmentEntry = (row) => {
    const title = row.data?.title || "Appointment";
    const category = row.data?.category || "Other";
    const professional = row.data?.professional || "";
    const location = row.data?.location || "";
    const outcome = row.data?.outcome || "";

    return {
      id: `care-${row.id}`,
      createdAt: row.createdAt || new Date().toISOString(),
      section: "Appointments",
      date: formatDisplayDateFromIso(row.logDate) || todayValue(),
      time: row.logTime || "",
      appointmentCategory: category,
      appointmentTitle: title,
      professional,
      location,
      outcome,
      summary: `${title} - ${category}`,
      details: [
        professional ? `Professional/service: ${professional}` : null,
        location ? `Location: ${location}` : null,
        row.notes ? `Notes: ${row.notes}` : null,
        outcome ? `Outcome/follow-up: ${outcome}` : null,
        row.createdByName ? `Logged by: ${row.createdByName}` : null,
      ].filter(Boolean),
      notes: row.notes || "",
    };
  };

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

  const mapSaasCareLogEntry = (row) => {
    const mapped =
      row.category === "food"
        ? mapSaasFoodEntry(row)
        : row.category === "medication"
          ? mapSaasMedicationEntry(row)
          : row.category === "toileting"
            ? mapSaasToiletingEntry(row)
            : row.category === "behaviour"
              ? mapSaasBehaviourEntry(row)
              : row.category === "appointment"
                ? mapSaasAppointmentEntry(row)
                : row.category === "sleep"
                  ? mapSaasSleepEntry(row)
                  : row.category === "health"
                    ? mapSaasHealthEntry(row)
                    : null;

    if (!mapped) return null;

    return {
      ...mapped,
      childId: row.childId || row.child_id || "",
      childName: row.childFirstName || row.childName || "",
      rawCategory: row.category || "",
      rawData: row.data || {},
      rawNotes: row.notes || "",
    };
  };

  const loadEntriesFromSaasApi = async () => {
    if (!familyId || !childId) return false;

    const logs = await api.listCareLogs(familyId, {
      childId,
    });

    setSharedLog(
      logs
        .map(mapSaasCareLogEntry)
        .filter(Boolean),
    );
    return true;
  };

  const loadUnifiedTimelineData = async () => {
    if (!familyId) {
      setTimelineLogs(sharedLog);
      setTimelineDocuments(documents);
      return;
    }

    setIsLoadingTimeline(true);
    try {
      if (useSaasApi) {
        const childQuery =
          timelineFilters.childId && timelineFilters.childId !== "all"
            ? { childId: timelineFilters.childId }
            : {};
        const [logRows, documentRows] = await Promise.all([
          api.listCareLogs(familyId, childQuery),
          api.listDocuments(familyId, childQuery),
        ]);
        setTimelineLogs((logRows || []).map(mapSaasCareLogEntry).filter(Boolean));
        setTimelineDocuments(documentRows || []);
      } else {
        setTimelineLogs(sharedLog);
        setTimelineDocuments(documents);
      }
    } catch (error) {
      console.error("Error loading unified timeline:", error);
      showToast?.({
        message: "Timeline could not be loaded. Please try again.",
        type: "error",
      });
    } finally {
      setIsLoadingTimeline(false);
    }
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
      setRefreshStatus("refreshing");
      await loadEntriesFromSupabase();
      if (activeSection?.title === "Sleep") {
        await loadLatestIncompleteSleepEntry();
      }
      setRefreshStatus("done");
    } finally {
      setPullDistance(0);
      setTimeout(() => {
        setIsRefreshing(false);
        setRefreshStatus("idle");
      }, 700);
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
      const nextY = e.touches[0].clientY;
      touchCurrentY.current = nextY;
      const distance = Math.max(0, Math.min(130, nextY - touchStartY.current));
      setPullDistance(distance);
      if (distance > 24 && !isRefreshing) {
        setRefreshStatus(distance > 100 ? "ready" : "pulling");
      }
    };

    const handleTouchEnd = async () => {
      if (!isPullingRef.current) return;
      const pullDistance = touchCurrentY.current - touchStartY.current;
      isPullingRef.current = false;

      if (pullDistance > 110) {
        await refreshAllData();
      } else {
        setPullDistance(0);
        setRefreshStatus("idle");
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
      case "Behaviour":
        return "Track meltdowns, triggers, regulation and what helped recovery.";
      case "Sleep":
        return "Log bedtime first, then complete wake-up the next morning.";
      case "Reports":
        return "View recent entries and export a proper PDF.";
      case "Care Snapshot":
        return "A compact 72-hour summary for urgent handovers and appointments.";
      case "Document Vault":
        return "Store and download private family documents for school, medical and care use.";
      case "Appointments":
        return "Record hospital, school, EHCP and care appointments with follow-up notes.";
      case "Timeline":
        return "Search across logs, documents, appointments and care history.";
      case "Calendar":
        return "Tap a date to review that day's logs.";
      default:
        return "Form preview";
    }
  }, [activeSection]);

  const recentEntries = useMemo(() => {
    const healthHistoryStart = new Date();
    healthHistoryStart.setMonth(healthHistoryStart.getMonth() - 24);
    healthHistoryStart.setHours(0, 0, 0, 0);

    return sharedLog
      .filter((entry) => {
      const entryDate =
        reportDays === "24h" || reportDays === "72h"
          ? getCareSnapshotEntryDate(entry)
          : parseDisplayDate(entry.date);
      if (!entryDate || !reportRangeStart || !reportRangeEnd) return false;
      const inSelectedRange = entryDate >= reportRangeStart && entryDate <= reportRangeEnd;
      const inExtendedHealthRange =
        includeHealthHistory24Months &&
        entry.section === "Health" &&
        entryDate >= healthHistoryStart &&
        entryDate <= reportRangeEnd;
      if (!inSelectedRange && !inExtendedHealthRange) return false;

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
  }, [
    includeHealthHistory24Months,
    reportCategoryFilter,
    reportDays,
    reportRangeEnd,
    reportRangeStart,
    sharedLog,
  ]);

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

  const snapshotSummaryStats = useMemo(() => {
    const dayKey = (entry) => {
      const parsed = getCareSnapshotEntryDate(entry);
      if (!parsed) return "";
      return `${String(parsed.getDate()).padStart(2, "0")}/${String(
        parsed.getMonth() + 1,
      ).padStart(2, "0")}/${parsed.getFullYear()}`;
    };

    const fluidByDay = new Map();
    const sleepByDay = new Map();
    const toiletingByDay = new Map();

    snapshotEntries.forEach((entry) => {
      const key = dayKey(entry);
      if (!key) return;

      if (entry.section === "Food Diary") {
        const fluidMl = getFluidMlFromEntry(entry);
        if (fluidMl > 0) {
          fluidByDay.set(key, (fluidByDay.get(key) || 0) + fluidMl);
        }
      }

      if (entry.section === "Sleep") {
        const minutes = toFiniteNumber(entry.durationMinutes);
        if (minutes > 0) {
          sleepByDay.set(key, (sleepByDay.get(key) || 0) + minutes);
        }
      }

      if (entry.section === "Toileting") {
        toiletingByDay.set(key, (toiletingByDay.get(key) || 0) + 1);
      }
    });

    const average = (values) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

    const expectedMedicationDoses = Array.from({ length: 3 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (2 - index));
      return profileMedicationOptions
        .filter(
          (medicine) =>
            medicine.active !== false &&
            medicine.requiredDaily &&
            isMedicationScheduledForDate(medicine, date),
        )
        .reduce((sum, medicine) => {
          const windows = normaliseMedicationTimeWindows(
            medicine.timeWindows?.length ? medicine.timeWindows : medicine.timeWindow,
          );
          return sum + Math.max(1, windows.length || medicine.times?.length || 0);
        }, 0);
    }).reduce((sum, value) => sum + value, 0);
    const medicationLogged = snapshotBySection.medication.length;
    const sleepAverageMinutes = average(Array.from(sleepByDay.values()));
    const fluidAverageMl = average(Array.from(fluidByDay.values()));
    const toiletingAverage = average(Array.from(toiletingByDay.values()));

    return [
      {
        key: "sleep",
        label: "Sleep average",
        value:
          sleepAverageMinutes === null
            ? "No data recorded"
            : `${roundTo(sleepAverageMinutes / 60)}h avg`,
        meta:
          sleepAverageMinutes === null
            ? "No completed sleep entries"
            : `${sleepByDay.size} day${sleepByDay.size === 1 ? "" : "s"} logged`,
        tone: "indigo",
      },
      {
        key: "fluids",
        label: "Fluid intake",
        value:
          fluidAverageMl === null
            ? "No data recorded"
            : `${Math.round(fluidAverageMl)}ml avg`,
        meta:
          fluidAverageMl === null
            ? "No drink entries"
            : `${fluidByDay.size} day${fluidByDay.size === 1 ? "" : "s"} logged`,
        tone: "sky",
      },
      {
        key: "medication",
        label: "Medication adherence",
        value: expectedMedicationDoses
          ? `${medicationLogged} of ${expectedMedicationDoses} doses`
          : medicationLogged
            ? `${medicationLogged} doses logged`
            : "No data recorded",
        meta: expectedMedicationDoses
          ? "Logged vs expected"
          : "No required schedule set",
        tone: "rose",
      },
      {
        key: "toileting",
        label: "Toileting average",
        value:
          toiletingAverage === null
            ? "No data recorded"
            : `${roundTo(toiletingAverage)} / day`,
        meta:
          toiletingAverage === null
            ? "No toileting entries"
            : `${toiletingByDay.size} day${toiletingByDay.size === 1 ? "" : "s"} logged`,
        tone: "cyan",
      },
    ];
  }, [profileMedicationOptions, snapshotBySection.medication.length, snapshotEntries]);

  const snapshotTrendSummary = useMemo(() => {
    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setHours(currentStart.getHours() - 72);
    const previousStart = new Date(currentStart);
    previousStart.setHours(previousStart.getHours() - 72);
    const previousEnd = currentStart;

    const previousEntries = sharedLog.filter((entry) => {
      const parsed = getCareSnapshotEntryDate(entry);
      return parsed && parsed >= previousStart && parsed < previousEnd;
    });

    const averageSleep = (entries) => {
      const durations = entries
        .filter((entry) => entry.section === "Sleep")
        .map((entry) => Number(entry.durationMinutes || 0))
        .filter((minutes) => minutes > 0);
      if (durations.length < 1) return null;
      return durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length;
    };
    const fluidTotal = (entries) =>
      entries.reduce((sum, entry) => sum + getFluidMlFromEntry(entry), 0);
    const medicationIssues = (entries) =>
      entries.filter(
        (entry) =>
          entry.section === "Medication" &&
          ["missed", "late", "refused"].includes(
            String(entry.medicationStatus || "").toLowerCase(),
          ),
      ).length;
    const toiletingCount = (entries) =>
      entries.filter((entry) => entry.section === "Toileting").length;

    const compare = (current, previous, labels) => {
      if (current === null || previous === null || previous === 0) {
        return "Not enough data yet";
      }
      const diff = current - previous;
      const threshold = Math.max(1, Math.abs(previous) * 0.15);
      if (Math.abs(diff) < threshold) return labels.stable;
      return diff > 0 ? labels.up : labels.down;
    };

    const currentSleep = averageSleep(snapshotEntries);
    const previousSleep = averageSleep(previousEntries);
    const currentFluid = fluidTotal(snapshotEntries);
    const previousFluid = fluidTotal(previousEntries);
    const currentToileting = toiletingCount(snapshotEntries);
    const previousToileting = toiletingCount(previousEntries);
    const medIssues = medicationIssues(snapshotEntries);

    return [
      {
        label: "Sleep",
        text: compare(currentSleep, previousSleep, {
          up: "Sleep improving",
          down: "Sleep declining",
          stable: "Sleep stable",
        }),
      },
      {
        label: "Fluids",
        text: compare(currentFluid, previousFluid, {
          up: "Fluids up",
          down: "Fluids down",
          stable: "Fluids consistent",
        }),
      },
      {
        label: "Medication",
        text: medIssues
          ? `${medIssues} missed, late or refused dose${medIssues === 1 ? "" : "s"}`
          : snapshotBySection.medication.length
            ? "Medication on track"
            : "Not enough data yet",
      },
      {
        label: "Toileting",
        text: compare(currentToileting, previousToileting, {
          up: "Toileting more frequent",
          down: "Toileting less frequent",
          stable: "Toileting stable",
        }),
      },
    ];
  }, [sharedLog, snapshotBySection.medication.length, snapshotEntries]);

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

  const timelineCategoryOptions = [
    "All",
    "Food Diary",
    "Medication",
    "Sleep",
    "Toileting",
    "Health",
    "Behaviour",
    "Appointments",
    "Documents",
    "Reports / Snapshot",
  ];

  const getChildNameById = (value, fallback = "Child") => {
    const found = children.find(
      (child) => String(child.id) === String(value || ""),
    );
    return (
      found?.firstName ||
      found?.first_name ||
      found?.name ||
      fallback ||
      childName ||
      "Child"
    );
  };

  const getTimelineTheme = (category) => {
    switch (category) {
      case "Food Diary":
        return {
          label: "Food / Drink",
          icon: "Food",
          dot: "bg-amber-500",
          card: "border-amber-100 bg-amber-50/80",
          text: "text-amber-800",
        };
      case "Medication":
        return {
          label: "Medication",
          icon: "Med",
          dot: "bg-rose-500",
          card: "border-rose-100 bg-rose-50/80",
          text: "text-rose-800",
        };
      case "Sleep":
        return {
          label: "Sleep",
          icon: "Sleep",
          dot: "bg-indigo-500",
          card: "border-indigo-100 bg-indigo-50/80",
          text: "text-indigo-800",
        };
      case "Toileting":
        return {
          label: "Toileting",
          icon: "Care",
          dot: "bg-cyan-500",
          card: "border-cyan-100 bg-cyan-50/80",
          text: "text-cyan-800",
        };
      case "Health":
        return {
          label: "Health",
          icon: "Health",
          dot: "bg-emerald-500",
          card: "border-emerald-100 bg-emerald-50/80",
          text: "text-emerald-800",
        };
      case "Behaviour":
        return {
          label: "Behaviour",
          icon: "Mood",
          dot: "bg-purple-500",
          card: "border-purple-100 bg-purple-50/80",
          text: "text-purple-800",
        };
      case "Appointments":
        return {
          label: "Appointment",
          icon: "Date",
          dot: "bg-blue-500",
          card: "border-blue-100 bg-blue-50/80",
          text: "text-blue-800",
        };
      case "Documents":
        return {
          label: "Document",
          icon: "File",
          dot: "bg-slate-500",
          card: "border-slate-200 bg-slate-50/90",
          text: "text-slate-800",
        };
      default:
        return {
          label: category || "Timeline",
          icon: "Note",
          dot: "bg-slate-400",
          card: "border-slate-200 bg-white",
          text: "text-slate-800",
        };
    }
  };

  const getTimelineDate = (item) => {
    if (item.dateObject) return item.dateObject;
    if (item.kind === "document") {
      return parseIsoDate(item.documentDate) || new Date(item.createdAt || Date.now());
    }
    return getEntryDateTime(item.entry || item) || new Date(item.createdAt || Date.now());
  };

  const isTimelineItemVisibleByModule = (item) => {
    if (item.category === "Food Diary") {
      return item.entry?.isMilk ? isModuleEnabled("drink") : isModuleEnabled("food");
    }
    if (item.category === "Medication") return isModuleEnabled("medication");
    if (item.category === "Sleep") return isModuleEnabled("sleep");
    if (item.category === "Toileting") return isModuleEnabled("toileting");
    if (item.category === "Health") return isModuleEnabled("health");
    if (item.category === "Behaviour") return isModuleEnabled("behaviour");
    if (item.category === "Appointments") return isModuleEnabled("appointments");
    if (item.category === "Documents") return isModuleEnabled("documents");
    if (item.category === "Reports / Snapshot") {
      return isModuleEnabled("reports") || isModuleEnabled("snapshot");
    }
    return true;
  };

  const unifiedTimelineItems = useMemo(() => {
    const logItems = timelineLogs.map((entry) => {
      const dateObject = getEntryDateTime(entry) || new Date(entry.createdAt || Date.now());
      const rawText = [
        entry.section,
        entry.summary,
        ...(entry.details || []),
        entry.rawNotes,
        entry.behaviourType,
        entry.appointmentTitle,
        entry.appointmentCategory,
        entry.severity ? `severity ${entry.severity}` : "",
        Array.isArray(entry.triggers) ? entry.triggers.join(" ") : "",
      ]
        .filter(Boolean)
        .join(" ");

      return {
        id: entry.id,
        kind: "log",
        category: entry.section,
        childId: entry.childId || childId,
        childName: entry.childName || getChildNameById(entry.childId, childName),
        dateObject,
        title: entry.summary || entry.section,
        summary: entry.summary || "Diary entry",
        details: entry.details || [],
        searchText: rawText,
        severity: entry.severity || "",
        type:
          entry.behaviourType ||
          entry.appointmentCategory ||
          entry.medicationStatus ||
          entry.rawData?.entry ||
          "",
        entry,
      };
    });

    const documentItems = timelineDocuments.map((document) => {
      const dateObject =
        parseIsoDate(document.documentDate) ||
        new Date(document.createdAt || Date.now());
      const rawText = [
        document.title,
        document.category,
        document.notes,
        document.fileName,
        document.childName,
      ]
        .filter(Boolean)
        .join(" ");

      return {
        id: `document-${document.id}`,
        kind: "document",
        category: "Documents",
        childId: document.childId || "",
        childName:
          document.childName ||
          getChildNameById(document.childId, document.childId ? "Child" : "Family"),
        dateObject,
        title: document.title || document.fileName || "Document",
        summary: `${document.category || "Document"}${
          document.fileName ? ` - ${document.fileName}` : ""
        }`,
        details: [
          document.documentDate ? `Document date: ${document.documentDate}` : null,
          document.notes ? `Notes: ${document.notes}` : null,
          document.fileType ? `File type: ${document.fileType}` : null,
        ].filter(Boolean),
        searchText: rawText,
        type: document.category || "",
        document,
      };
    });

    const actionItems = [
      {
        id: "timeline-care-snapshot",
        kind: "action",
        category: "Reports / Snapshot",
        childId,
        childName,
        dateObject: new Date(),
        title: "Care Snapshot",
        summary: "Open the latest 72-hour emergency handover summary.",
        details: ["Useful for hospital, school, carer and professional handovers."],
        searchText: "care snapshot 72 hour emergency handover report",
        type: "Snapshot",
      },
      {
        id: "timeline-full-report",
        kind: "action",
        category: "Reports / Snapshot",
        childId,
        childName,
        dateObject: new Date(),
        title: "Full Care Report",
        summary: "Open the reports area for trends, summaries and PDF export.",
        details: ["Useful for EHCP, GP, dietitian, school and hospital reports."],
        searchText: "full care report trends pdf export ehcp school hospital",
        type: "Report",
      },
    ];

    const allItems = [...logItems, ...documentItems, ...actionItems];
    const now = new Date();
    const rangeDays = Number(timelineFilters.range);
    const rangeStart =
      timelineFilters.range === "all" || !rangeDays
        ? null
        : (() => {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            start.setDate(start.getDate() - (rangeDays - 1));
            return start;
          })();
    const search = timelineFilters.search.trim().toLowerCase();

    return allItems
      .filter((item) => {
        if (!isTimelineItemVisibleByModule(item)) return false;

        if (
          timelineFilters.childId !== "all" &&
          item.childId &&
          String(item.childId) !== String(timelineFilters.childId)
        ) {
          return false;
        }

        const itemDate = getTimelineDate(item);
        if (rangeStart && itemDate < rangeStart) return false;

        if (
          timelineFilters.category !== "All" &&
          item.category !== timelineFilters.category
        ) {
          return false;
        }

        if (timelineFilters.severity === "high-behaviour") {
          if (item.category !== "Behaviour" || Number(item.severity || 0) < 4) {
            return false;
          }
        } else if (timelineFilters.severity !== "All") {
          const text = `${item.type || ""} ${item.searchText || ""}`.toLowerCase();
          if (!text.includes(timelineFilters.severity.toLowerCase())) {
            return false;
          }
        }

        if (search) {
          const text = [
            item.title,
            item.summary,
            item.childName,
            item.category,
            item.type,
            item.searchText,
            ...(item.details || []),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!text.includes(search)) return false;
        }

        return true;
      })
      .sort((a, b) => getTimelineDate(b).getTime() - getTimelineDate(a).getTime());
  }, [
    childId,
    childName,
    children,
    timelineDocuments,
    timelineFilters,
    timelineLogs,
  ]);

  const latestTwoBySection = useMemo(() => {
    const findLatestTwo = (sectionTitle) =>
      sharedLog.filter((entry) => entry.section === sectionTitle).slice(0, 2);

    return {
      food: findLatestTwo("Food Diary"),
      medication: findLatestTwo("Medication"),
      toileting: findLatestTwo("Toileting"),
      health: sharedLog
        .filter((entry) => entry.section === "Health" && !isMeasurementEntry(entry))
        .slice(0, 2),
      measurements: sharedLog
        .filter(isMeasurementEntry)
        .slice(0, 2),
      sleep: findLatestTwo("Sleep"),
    };
  }, [sharedLog]);

  const todayDashboard = useMemo(() => {
    const today = todayValue();
    const now = new Date();
    const todayEntries = sharedLog.filter((entry) => entry.date === today);
    const todayDrinkEntries = todayEntries.filter(
      (entry) => entry.section === "Food Diary" && entry.isMilk,
    );
    const todayMedicationEntries = todayEntries.filter(
      (entry) => entry.section === "Medication",
    );
    const todayToiletingEntries = todayEntries.filter(
      (entry) => entry.section === "Toileting",
    );
    const todayHealthEntries = todayEntries.filter(
      (entry) => entry.section === "Health" && !isMeasurementEntry(entry),
    );
    const fluidMl = todayDrinkEntries.reduce(
      (sum, entry) => sum + getFluidMlFromEntry(entry),
      0,
    );
    const fluidTargetMl = Math.max(
      0,
      Number.parseInt(childProfile.dailyFluidTargetMl || 0, 10) || 0,
    );
    const fluidPercent = fluidTargetMl
      ? Math.min(100, Math.round((fluidMl / fluidTargetMl) * 100))
      : 0;
    const hydrationCheckpoints = normaliseHydrationCheckpoints(
      childProfile.hydrationCheckpoints,
    ).map((checkpoint) => {
      const expectedMl = fluidTargetMl
        ? Math.round((fluidTargetMl * checkpoint.percent) / 100)
        : 0;
      const met = fluidTargetMl ? fluidMl >= expectedMl : false;
      const isPast = nowTimeValue() >= checkpoint.time;
      return {
        ...checkpoint,
        expectedMl,
        met,
        isPast,
        statusLabel: met ? "Met" : isPast ? "Below" : "Later",
      };
    });
    const nextHydrationCheckpoint =
      hydrationCheckpoints.find((checkpoint) => !checkpoint.met && !checkpoint.isPast) ||
      hydrationCheckpoints.find((checkpoint) => !checkpoint.met) ||
      hydrationCheckpoints[hydrationCheckpoints.length - 1] ||
      null;

    const getWindowRange = (windowName) => {
      if (windowName === "morning") return { start: 6, end: 12 };
      if (windowName === "afternoon") return { start: 12, end: 18 };
      if (windowName === "evening") return { start: 18, end: 24 };
      return null;
    };

    const isWindowPast = (windowName) => {
      const range = getWindowRange(windowName);
      if (!range) return false;
      const hour = now.getHours();
      return hour >= range.end;
    };

    const isWindowUpcoming = (windowName) => {
      const range = getWindowRange(windowName);
      if (!range) return false;
      const hour = now.getHours();
      return hour < range.start;
    };

    const isWindowCurrent = (windowName) => {
      const range = getWindowRange(windowName);
      if (!range) return false;
      const hour = now.getHours();
      return hour >= range.start && hour < range.end;
    };

    const isEntryInWindow = (entry, windowName) => {
      if (!windowName) return true;
      const lowerWindow = String(windowName).toLowerCase();
      const entryText = [entry.summary, entry.notes, entry.details]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (entryText.includes(lowerWindow)) return true;
      if (!entry.time || !String(entry.time).includes(":")) return false;
      const [hours] = String(entry.time).split(":").map(Number);
      const range = getWindowRange(lowerWindow);
      return range ? hours >= range.start && hours < range.end : false;
    };

    const allRequiredMedication = profileMedicationOptions
      .filter(
        (medicine) =>
          medicine.active !== false &&
          medicine.requiredDaily &&
          isMedicationScheduledForDate(medicine, now),
      )
      .flatMap((medicine) => {
        const windows = normaliseMedicationTimeWindows(
          medicine.timeWindows?.length ? medicine.timeWindows : medicine.timeWindow,
        );
        const doseWindows = windows.length ? windows : [""];
        const matchingLogs = todayMedicationEntries.filter((entry) =>
          String(entry.summary || "")
            .toLowerCase()
            .includes(String(medicine.name || "").toLowerCase()),
        );

        return doseWindows.map((windowName) => {
          const slotLogs = matchingLogs.filter((entry) =>
            isEntryInWindow(entry, windowName),
          );
          const givenLog = slotLogs.find(
            (entry) =>
              !["missed", "refused"].includes(
                String(entry.medicationStatus || "").toLowerCase(),
              ),
          );
          const missedLog = slotLogs.find((entry) =>
            ["missed", "refused"].includes(
              String(entry.medicationStatus || "").toLowerCase(),
            ),
          );
          const scheduledTimes = (medicine.times || []).filter((time) => {
            if (!time || !time.includes(":")) return false;
            if (!windowName) return true;
            const [hours] = time.split(":").map(Number);
            const range = getWindowRange(windowName);
            return range ? hours >= range.start && hours < range.end : false;
          });
          const hasPastTime = !windowName && scheduledTimes.some((time) => {
            if (!time || !time.includes(":")) return false;
            const [hours, minutes] = time.split(":").map(Number);
            const due = new Date();
            due.setHours(hours || 0, minutes || 0, 0, 0);
            return now.getTime() > due.getTime() + 60 * 60 * 1000;
          });
          const hasFutureTime = !windowName && scheduledTimes.length
            ? scheduledTimes.every((time) => {
                if (!time || !time.includes(":")) return false;
                const [hours, minutes] = time.split(":").map(Number);
                const due = new Date();
                due.setHours(hours || 0, minutes || 0, 0, 0);
                return now.getTime() < due.getTime();
              })
            : false;
          const status = givenLog
            ? "taken"
            : missedLog || hasPastTime || isWindowPast(windowName)
              ? "missed"
              : isWindowUpcoming(windowName) || hasFutureTime
                ? "upcoming"
                : isWindowCurrent(windowName) || !scheduledTimes.length
                  ? "due"
                  : "upcoming";
          const id = [
            medicine.name,
            medicine.dose,
            windowName || "daily",
          ]
            .filter(Boolean)
            .join("|")
            .toLowerCase();
          return {
            ...medicine,
            id,
            timeWindow: windowName,
            status,
            statusLabel:
              status === "taken"
                ? "Taken"
                : status === "missed"
                  ? "Missed"
                  : status === "upcoming"
                    ? "Later"
                    : "Due now",
          };
        });
      });

    const requiredMedication = allRequiredMedication.filter(
      (item) => item.status !== "taken",
    );

    const alerts = [];
    if (!fluidMl) alerts.push("No fluids logged today");
    if (requiredMedication.some((item) => item.status !== "upcoming")) {
      alerts.push("Medication due but not fully logged");
    }

    return {
      today,
      entriesToday: todayEntries.length,
      healthToday: todayHealthEntries.length,
      fluidMl,
      fluidTargetMl,
      fluidPercent,
      hydrationCheckpoints,
      nextHydrationCheckpoint,
      drinkCount: todayDrinkEntries.length,
      toiletingCount: todayToiletingEntries.length,
      medicationTaken: allRequiredMedication.filter((item) => item.status === "taken")
        .length,
      medicationRequired: allRequiredMedication.length,
      allRequiredMedication,
      requiredMedication,
      alerts,
    };
  }, [
    childProfile.dailyFluidTargetMl,
    childProfile.hydrationCheckpoints,
    profileMedicationOptions,
    sharedLog,
  ]);

  useEffect(() => {
    const reportCardCount = 3;
    const timer = setInterval(() => {
      setReportOverviewIndex((current) => (current + 1) % reportCardCount);
    }, 3200);
    return () => clearInterval(timer);
  }, []);

  const reportCategoryOrder = [
    "Food Diary",
    "Medication",
    "Sleep",
    "Toileting",
    "Behaviour",
    "Appointments",
    "Health",
    "General Notes",
  ];

  const reportCategoryLabel = (section) =>
    section === "Food Diary" ? "Food" : section;

  const reportCategoryOptions = useMemo(
    () =>
      reportCategoryOrder.filter((section) => {
        if (section === "Food Diary") {
          return isModuleEnabled("food");
        }
        if (section === "Medication") return isModuleEnabled("medication");
        if (section === "Sleep") return isModuleEnabled("sleep");
        if (section === "Toileting") return isModuleEnabled("toileting");
        if (section === "Behaviour") return isModuleEnabled("behaviour");
        if (section === "Appointments") return isModuleEnabled("appointments");
        if (section === "Health") return isModuleEnabled("health");
        return true;
      }),
    [reportCategoryOrder, visibleModules],
  );

  useEffect(() => {
    if (
      reportCategoryFilter !== "All" &&
      !reportCategoryOptions.includes(reportCategoryFilter)
    ) {
      setReportCategoryFilter("All");
    }
  }, [reportCategoryFilter, reportCategoryOptions]);

  const renderReportCategoryOptions = () => (
    <>
      <option value="All">All categories</option>
      {reportCategoryOptions.map((section) => (
        <option key={section} value={section}>
          {section === "Food Diary" ? "Food and drink" : reportCategoryLabel(section)}
        </option>
      ))}
    </>
  );

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
      behaviour: countBySection("Behaviour"),
      health: countBySection("Health"),
      appointments: countBySection("Appointments"),
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
    const start = reportRangeStart ? new Date(reportRangeStart) : new Date();
    const end = reportRangeEnd ? new Date(reportRangeEnd) : new Date();
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const rangeDays = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1,
    );
    const makeDayKey = (date) =>
      `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
    const dayMap = new Map();
    let expectedMedicationDoses = 0;
    for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      const key = makeDayKey(day);
      expectedMedicationDoses += profileMedicationOptions
        .filter(
          (medicine) =>
            medicine.active !== false &&
            medicine.requiredDaily &&
            isMedicationScheduledForDate(medicine, day),
        )
        .reduce((sum, medicine) => {
          const windows = normaliseMedicationTimeWindows(
            medicine.timeWindows?.length ? medicine.timeWindows : medicine.timeWindow,
          );
          return sum + Math.max(1, windows.length || medicine.times?.length || 0);
        }, 0);
      const medicationExpectedForDay = profileMedicationOptions
        .filter(
          (medicine) =>
            medicine.active !== false &&
            medicine.requiredDaily &&
            isMedicationScheduledForDate(medicine, day),
        )
        .reduce((sum, medicine) => {
          const windows = normaliseMedicationTimeWindows(
            medicine.timeWindows?.length ? medicine.timeWindows : medicine.timeWindow,
          );
          return sum + Math.max(1, windows.length || medicine.times?.length || 0);
        }, 0);
      dayMap.set(key, {
        date: key,
        label: key.slice(0, 5),
        fluidMl: null,
        sleepHours: null,
        medicationLogged: 0,
        medicationExpected: medicationExpectedForDay,
        toiletingCount: null,
        wet: 0,
        soiled: 0,
        hasFluid: false,
        hasSleep: false,
        hasToileting: false,
        accident: 0,
        dry: 0,
        otherToileting: 0,
        morning: 0,
        afternoon: 0,
        evening: 0,
        night: 0,
        behaviourCount: null,
        behaviourSeverityTotal: 0,
        behaviourSeverityCount: 0,
      });
    }

    const getDayKey = (entry) => {
      const parsed =
        parseDisplayDateTime(entry?.date, entry?.time) ||
        parseDisplayDate(entry?.date) ||
        getEntryDateTime(entry);
      return parsed ? makeDayKey(parsed) : "";
    };

    const classifyToileting = (entry) => {
      const text = [
        entry.type,
        entry.category,
        entry.event,
        entry.toiletingType,
        entry.result,
        entry.summary,
        ...(entry.details || []),
        entry.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const isDry = /\bdry\b/.test(text);
      const both = /both|wet\s*&\s*soiled|wet and soiled/.test(text);
      const wet = both || /\b(wet|wee|urine)\b/.test(text);
      const soiled = both || /\b(bowel|poo|stool|soiled|bm)\b/.test(text);
      const accident = /\b(accident|leak|leaked|soiling accident)\b/.test(text);
      const knownType = wet || soiled || accident || isDry;
      return {
        wet: !isDry && wet ? 1 : 0,
        soiled: soiled ? 1 : 0,
        accident: accident ? 1 : 0,
        dry: isDry ? 1 : 0,
        other: knownType ? 0 : 1,
      };
    };

    const getToiletingTimeBucket = (entry) => {
      const parsedHour = Number.parseInt(String(entry.time || "").split(":")[0], 10);
      const date = getEntryDateTime(entry);
      const hour = Number.isFinite(parsedHour)
        ? parsedHour
        : date
          ? date.getHours()
          : null;
      if (!Number.isFinite(hour)) return "";
      if (hour >= 6 && hour < 12) return "morning";
      if (hour >= 12 && hour < 18) return "afternoon";
      if (hour >= 18 && hour < 24) return "evening";
      return "night";
    };

    let totalFluidMl = 0;
    let fluidDays = 0;
    let totalSleepHours = 0;
    let sleepDays = 0;
    let medicationLogged = 0;
    let medicationConcerns = 0;
    let totalToileting = 0;
    let toiletingDays = 0;
    let totalBehaviour = 0;
    let behaviourDays = 0;
    const triggerCounts = new Map();
    const behaviourTypeCounts = new Map();

    recentEntries.forEach((entry) => {
      const key = getDayKey(entry);
      const day = dayMap.get(key);
      if (!day) return;

      if (entry.section === "Food Diary") {
        const drinkMl = getFluidMlFromEntry(entry);
        if (drinkMl > 0) {
          day.fluidMl = (day.fluidMl || 0) + drinkMl;
          if (!day.hasFluid) fluidDays += 1;
          day.hasFluid = true;
          totalFluidMl += drinkMl;
        }
      }

      if (entry.section === "Sleep") {
        const minutes = toFiniteNumber(entry.durationMinutes);
        if (minutes > 0) {
          day.sleepHours = (day.sleepHours || 0) + minutes / 60;
          if (!day.hasSleep) sleepDays += 1;
          day.hasSleep = true;
          totalSleepHours += minutes / 60;
        }
      }

      if (entry.section === "Medication") {
        medicationLogged += 1;
        day.medicationLogged += 1;
        if (
          ["missed", "late", "refused"].includes(
            String(entry.medicationStatus || "").toLowerCase(),
          )
        ) {
          medicationConcerns += 1;
        }
      }

      if (entry.section === "Toileting") {
        const toileting = classifyToileting(entry);
        day.toiletingCount = (day.toiletingCount || 0) + 1;
        if (!day.hasToileting) toiletingDays += 1;
        day.hasToileting = true;
        day.wet += toileting.wet;
        day.soiled += toileting.soiled;
        day.accident += toileting.accident;
        day.dry += toileting.dry;
        day.otherToileting += toileting.other;
        const timeBucket = getToiletingTimeBucket(entry);
        if (timeBucket) day[timeBucket] += 1;
        totalToileting += 1;
      }

      if (entry.section === "Behaviour") {
        day.behaviourCount = (day.behaviourCount || 0) + 1;
        if (day.behaviourCount === 1) behaviourDays += 1;
        totalBehaviour += 1;
        const severity = Number(entry.severity || 0);
        if (severity > 0) {
          day.behaviourSeverityTotal += severity;
          day.behaviourSeverityCount += 1;
        }
        (entry.triggers || []).forEach((trigger) => {
          triggerCounts.set(trigger, (triggerCounts.get(trigger) || 0) + 1);
        });
        if (entry.behaviourType) {
          behaviourTypeCounts.set(
            entry.behaviourType,
            (behaviourTypeCounts.get(entry.behaviourType) || 0) + 1,
          );
        }
      }
    });

    const daily = Array.from(dayMap.values());
    const fluidData = daily.filter((day) => day.hasFluid);
    const sleepData = daily.filter((day) => day.hasSleep);
    const toiletingData = daily.filter((day) => day.hasToileting);
    const avgSleepHours = sleepDays ? totalSleepHours / sleepDays : 0;
    const avgFluidMl = fluidDays ? totalFluidMl / fluidDays : 0;
    const toiletingAvg = toiletingDays ? totalToileting / toiletingDays : 0;
    const behaviourData = daily.filter((day) => day.behaviourCount !== null);
    const behaviourAvg = behaviourDays ? totalBehaviour / behaviourDays : 0;
    const topTrigger = Array.from(triggerCounts.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0];
    const topBehaviourType = Array.from(behaviourTypeCounts.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0];
    const medicationPercent = expectedMedicationDoses
      ? Math.min(100, Math.round((medicationLogged / expectedMedicationDoses) * 100))
      : 0;
    const fluidTargetMl = Math.max(
      0,
      Number.parseInt(childProfile.dailyFluidTargetMl || 0, 10) || 0,
    );

    const metricCards = [
      {
        key: "sleep",
        label: "Average sleep",
        value: sleepDays ? `${roundTo(avgSleepHours)}h` : "Not enough data",
        meta: sleepDays ? `${sleepDays} night${sleepDays === 1 ? "" : "s"} logged` : "No completed sleep entries",
        tone: "indigo",
      },
      {
        key: "fluids",
        label: "Average fluid intake",
        value: fluidDays ? `${Math.round(avgFluidMl)}ml` : "Not enough data",
        meta: fluidDays ? `${fluidDays} day${fluidDays === 1 ? "" : "s"} with fluids` : "No drink entries",
        tone: "sky",
      },
      {
        key: "medication",
        label: "Medication adherence",
        value: expectedMedicationDoses
          ? `${medicationLogged} of ${expectedMedicationDoses}`
          : `${medicationLogged} logged`,
        meta: expectedMedicationDoses ? `${medicationPercent}% of expected doses` : "No required schedule set",
        tone: "rose",
      },
      {
        key: "toileting",
        label: "Toileting average",
        value: toiletingDays ? `${roundTo(toiletingAvg)} / day` : "Not enough data",
        meta: toiletingDays ? `${toiletingDays} day${toiletingDays === 1 ? "" : "s"} logged` : "No toileting entries",
        tone: "cyan",
      },
      {
        key: "behaviour",
        label: "Behaviour entries",
        value: totalBehaviour ? `${totalBehaviour} logged` : "No entries",
        meta: totalBehaviour
          ? `${behaviourDays} day${behaviourDays === 1 ? "" : "s"} with behaviour notes`
          : "No behaviour entries",
        tone: "violet",
      },
    ];

    const insights = [];
    if (fluidTargetMl && fluidDays >= 3) {
      const belowTargetDays = fluidData.filter((day) => Number(day.fluidMl || 0) < fluidTargetMl).length;
      if (belowTargetDays >= Math.ceil(fluidDays * 0.6)) {
        insights.push("Fluid intake is consistently below the daily target on logged days.");
      } else if (belowTargetDays > 0) {
        insights.push("Some logged fluid days fall below the daily target.");
      }
    } else if (fluidDays < 3) {
      insights.push("Not enough fluid data to confirm a clear pattern.");
    }

    if (expectedMedicationDoses) {
      if (medicationLogged < expectedMedicationDoses) {
        insights.push("Medication logging is incomplete across the selected period.");
      } else if (medicationConcerns) {
        insights.push("Medication was logged, with missed, late or refused entries recorded.");
      } else {
        insights.push("Medication logging matches the expected schedule for this period.");
      }
    } else if (medicationLogged) {
      insights.push("Medication entries were logged, but no required daily schedule is set for comparison.");
    }

    if (sleepDays >= 5) {
      const sleepValues = sleepData.map((day) => Number(day.sleepHours || 0));
      const sleepMin = Math.min(...sleepValues);
      const sleepMax = Math.max(...sleepValues);
      if (sleepMax - sleepMin >= 2) {
        insights.push("Sleep data shows inconsistency across the selected period.");
      } else {
        insights.push("Sleep duration appears broadly steady on logged nights.");
      }
    } else {
      insights.push("Not enough completed sleep entries to confirm a clear sleep pattern.");
    }

    if (toiletingDays >= 5) {
      const toiletingValues = toiletingData.map((day) => Number(day.toiletingCount || 0));
      const toiletingMin = Math.min(...toiletingValues);
      const toiletingMax = Math.max(...toiletingValues);
      if (toiletingMax - toiletingMin >= 3) {
        insights.push("Toileting frequency varies significantly day-to-day.");
      } else {
        insights.push("Toileting frequency appears broadly steady on logged days.");
      }
    } else {
      insights.push("Not enough toileting data to confirm a clear pattern.");
    }

    if (totalBehaviour >= 3) {
      insights.push(
        topTrigger
          ? `Behaviour entries most often mention ${topTrigger[0].toLowerCase()} as a trigger.`
          : "Behaviour entries are logged, but triggers are not yet consistent enough to summarise.",
      );
    } else if (totalBehaviour > 0) {
      insights.push("Some behaviour entries were logged, but more data is needed to identify patterns.");
    }

    const dataCompleteness = [
      {
        label: "Sleep logged",
        value: `${sleepDays} of ${rangeDays} days`,
        tone: "indigo",
      },
      {
        label: "Fluids logged",
        value: `${fluidDays} of ${rangeDays} days`,
        tone: "sky",
      },
      {
        label: "Medication doses",
        value: expectedMedicationDoses
          ? `${medicationLogged} of ${expectedMedicationDoses}`
          : `${medicationLogged} logged`,
        tone: "rose",
      },
      {
        label: "Toileting logged",
        value: `${toiletingDays} of ${rangeDays} days`,
        tone: "cyan",
      },
      {
        label: "Behaviour logged",
        value: `${behaviourDays} of ${rangeDays} days`,
        tone: "violet",
      },
    ];

    return {
      rangeDays,
      current: {
        daily,
        avgSleepHours,
        avgFluidMl,
        medicationCount: medicationLogged,
        typicalMedicationCount: expectedMedicationDoses,
        toiletingAvg,
        behaviourAvg,
      },
      summaryStats: metricCards,
      insights: uniqueList(insights).slice(0, 5),
      dataCompleteness,
      fluidTargetMl,
      graphs: {
        fluid: daily.map((day) => ({
          label: day.label,
          value: day.hasFluid ? Math.round(day.fluidMl || 0) : null,
          hasData: day.hasFluid,
          target: fluidTargetMl,
        })),
        medication: {
          percent: medicationPercent,
          logged: medicationLogged,
          typical: expectedMedicationDoses,
          daily: daily.map((day) => ({
            label: day.label,
            value: day.medicationExpected ? day.medicationLogged : null,
            expected: day.medicationExpected,
            hasData: day.medicationExpected > 0 || day.medicationLogged > 0,
          })),
        },
        sleep: daily
          .map((day) => ({
            label: day.label,
            value: day.hasSleep ? roundTo(day.sleepHours || 0) : null,
            hasData: day.hasSleep,
          }))
          .filter((day) => day.hasData),
        toileting: daily.map((day) => ({
          label: day.label,
          wet: day.wet,
          soiled: day.soiled,
          accident: day.accident,
          dry: day.dry,
          other: day.otherToileting,
          morning: day.morning,
          afternoon: day.afternoon,
          evening: day.evening,
          night: day.night,
          value: day.hasToileting ? day.toiletingCount || 0 : null,
          hasData: day.hasToileting,
        })),
        behaviour: {
          total: totalBehaviour,
          days: behaviourDays,
          topTrigger: topTrigger
            ? { label: topTrigger[0], count: topTrigger[1] }
            : null,
          topType: topBehaviourType
            ? { label: topBehaviourType[0], count: topBehaviourType[1] }
            : null,
          daily: behaviourData.map((day) => ({
            label: day.label,
            value: day.behaviourCount || 0,
            averageSeverity: day.behaviourSeverityCount
              ? roundTo(day.behaviourSeverityTotal / day.behaviourSeverityCount)
              : null,
            hasData: true,
          })),
        },
      },
    };
  }, [
    childProfile.dailyFluidTargetMl,
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

  const patternInsights = useMemo(() => {
    const countBySection = (entries, section) =>
      entries.filter((entry) => entry.section === section).length;
    const getAverageSleepHours = (entries) => {
      const durations = entries
        .filter((entry) => entry.section === "Sleep")
        .map((entry) => Number(entry.durationMinutes || 0))
        .filter((minutes) => minutes > 0);
      if (durations.length < 2) return null;
      return (
        durations.reduce((sum, minutes) => sum + minutes / 60, 0) /
        durations.length
      );
    };
    const getAverageFluidMl = (entries) => {
      const byDay = new Map();
      entries
        .filter((entry) => entry.section === "Food Diary")
        .forEach((entry) => {
          const fluidMl = getFluidMlFromEntry(entry);
          if (fluidMl <= 0) return;
          byDay.set(entry.date, (byDay.get(entry.date) || 0) + fluidMl);
        });
      const values = Array.from(byDay.values()).filter((value) => value > 0);
      if (values.length < 2) return null;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    const compareDirection = (current, previous, tolerance = 0) => {
      if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
      const delta = current - previous;
      if (Math.abs(delta) <= tolerance) return { label: "broadly stable", delta };
      return {
        label: delta > 0 ? "higher" : "lower",
        delta,
      };
    };
    const getBehaviourTimeBucket = (entry) => {
      const hour = Number.parseInt(String(entry.time || "").split(":")[0], 10);
      if (!Number.isFinite(hour)) return "";
      if (hour >= 6 && hour < 12) return "morning";
      if (hour >= 12 && hour < 18) return "afternoon";
      if (hour >= 18 && hour < 24) return "evening";
      return "night";
    };

    const insights = [];
    const behaviourEntries = recentEntries.filter(
      (entry) => entry.section === "Behaviour",
    );
    const previousBehaviourEntries = previousReportEntries.filter(
      (entry) => entry.section === "Behaviour",
    );

    if (isModuleEnabled("behaviour") && behaviourEntries.length >= 3) {
      const triggerCounts = new Map();
      behaviourEntries.forEach((entry) => {
        (entry.triggers || []).forEach((trigger) => {
          triggerCounts.set(trigger, (triggerCounts.get(trigger) || 0) + 1);
        });
      });
      const topTrigger = Array.from(triggerCounts.entries()).sort(
        (a, b) => b[1] - a[1],
      )[0];
      if (topTrigger) {
        insights.push({
          id: "behaviour-trigger",
          title: "Possible pattern",
          message: `${topTrigger[0]} is the most common behaviour trigger in this period.`,
          detail: `${topTrigger[1]} of ${behaviourEntries.length} behaviour entries mention this trigger.`,
          section: "Behaviour",
          relatedCount: behaviourEntries.filter((entry) =>
            (entry.triggers || []).includes(topTrigger[0]),
          ).length,
          tone: "border-purple-100 bg-purple-50/80 text-purple-900",
        });
      }

      const bucketCounts = new Map();
      behaviourEntries.forEach((entry) => {
        const bucket = getBehaviourTimeBucket(entry);
        if (bucket) bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
      });
      const topBucket = Array.from(bucketCounts.entries()).sort(
        (a, b) => b[1] - a[1],
      )[0];
      if (topBucket && topBucket[1] >= 2) {
        insights.push({
          id: "behaviour-time",
          title: "Worth noting",
          message: `Behaviour entries happen most often in the ${topBucket[0]}.`,
          detail: `${topBucket[1]} behaviour entr${topBucket[1] === 1 ? "y" : "ies"} were logged in this time window.`,
          section: "Behaviour",
          relatedCount: topBucket[1],
          tone: "border-violet-100 bg-violet-50/80 text-violet-900",
        });
      }
    }

    if (
      isModuleEnabled("behaviour") &&
      behaviourEntries.length >= 2 &&
      previousBehaviourEntries.length >= 2
    ) {
      const direction = compareDirection(
        behaviourEntries.length,
        previousBehaviourEntries.length,
      );
      if (direction && direction.label !== "broadly stable") {
        insights.push({
          id: "behaviour-frequency",
          title: "Worth noting",
          message: `Behaviour frequency is ${direction.label} than the previous matching period.`,
          detail: `${behaviourEntries.length} entries now, compared with ${previousBehaviourEntries.length} previously.`,
          section: "Behaviour",
          relatedCount: behaviourEntries.length,
          tone:
            direction.delta > 0
              ? "border-amber-100 bg-amber-50/80 text-amber-900"
              : "border-emerald-100 bg-emerald-50/80 text-emerald-900",
        });
      }
    }

    if (isModuleEnabled("sleep")) {
      const currentSleep = getAverageSleepHours(recentEntries);
      const previousSleep = getAverageSleepHours(previousReportEntries);
      const direction = compareDirection(currentSleep, previousSleep, 0.25);
      if (direction) {
        insights.push({
          id: "sleep-duration",
          title: "Possible pattern",
          message:
            direction.label === "broadly stable"
              ? "Average sleep looks broadly stable compared with the previous period."
              : `Average sleep is ${direction.label} than the previous period.`,
          detail:
            direction.label === "broadly stable"
              ? "Only completed sleep entries are included."
              : `Change is about ${roundTo(Math.abs(direction.delta))} hours on logged nights.`,
          section: "Sleep",
          relatedCount: countBySection(recentEntries, "Sleep"),
          tone: "border-indigo-100 bg-indigo-50/80 text-indigo-900",
        });
      }
    }

    if (isModuleEnabled("drink") || isModuleEnabled("food")) {
      const currentFluid = getAverageFluidMl(recentEntries);
      const previousFluid = getAverageFluidMl(previousReportEntries);
      const direction = compareDirection(currentFluid, previousFluid, 75);
      if (direction) {
        insights.push({
          id: "fluid-intake",
          title: "Worth noting",
          message:
            direction.label === "broadly stable"
              ? "Fluid intake looks broadly stable on logged days."
              : `Fluid intake is ${direction.label} than the previous period on logged days.`,
          detail:
            direction.label === "broadly stable"
              ? "Missing drink amounts are not counted."
              : `Average difference is about ${Math.round(Math.abs(direction.delta))}ml.`,
          section: "Food Diary",
          relatedCount: recentEntries.filter(
            (entry) => entry.section === "Food Diary" && getFluidMlFromEntry(entry) > 0,
          ).length,
          tone: "border-sky-100 bg-sky-50/80 text-sky-900",
        });
      }
    }

    if (isModuleEnabled("medication")) {
      const medicationEntries = recentEntries.filter(
        (entry) => entry.section === "Medication",
      );
      const statusCounts = medicationEntries.reduce(
        (counts, entry) => {
          const status = String(entry.medicationStatus || "given").toLowerCase();
          if (["missed", "late", "refused"].includes(status)) {
            counts[status] += 1;
          } else {
            counts.given += 1;
          }
          return counts;
        },
        { given: 0, missed: 0, late: 0, refused: 0 },
      );
      const concernCount =
        statusCounts.missed + statusCounts.late + statusCounts.refused;
      if (medicationEntries.length >= 3) {
        insights.push({
          id: "medication-summary",
          title: concernCount ? "Worth noting" : "Possible pattern",
          message: concernCount
            ? "Medication records include missed, late or refused doses."
            : "Medication entries in this period are logged as completed.",
          detail: concernCount
            ? `${statusCounts.missed} missed, ${statusCounts.late} late, ${statusCounts.refused} refused.`
            : `${statusCounts.given} medication entr${statusCounts.given === 1 ? "y" : "ies"} logged as given.`,
          section: "Medication",
          relatedCount: medicationEntries.length,
          tone: concernCount
            ? "border-rose-100 bg-rose-50/80 text-rose-900"
            : "border-emerald-100 bg-emerald-50/80 text-emerald-900",
        });
      }
    }

    return insights.slice(0, 5);
  }, [
    previousReportEntries,
    recentEntries,
    visibleModules,
  ]);

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
        module: "core",
      },
      {
        label: "Add first medication",
        completed: hasMedication,
        action: "medication",
        module: "medication",
      },
      {
        label: "Add first meal",
        completed: sharedLog.some((entry) => entry.section === "Food Diary"),
        action: "food",
        module: "foodDiary",
      },
      {
        label: "Add first sleep entry",
        completed: sharedLog.some((entry) => entry.section === "Sleep"),
        action: "sleep",
        module: "sleep",
      },
      {
        label: "View Care Snapshot",
        completed: hasViewedCareSnapshot,
        action: "snapshot",
        module: "snapshot",
      },
      {
        label: "Generate a report",
        completed: sharedLog.length >= 3,
        action: "reports",
        module: "reports",
      },
    ];

    return items.filter((item) => {
      if (item.module === "core") return true;
      if (item.module === "foodDiary") {
        return isModuleEnabled("food");
      }
      return isModuleEnabled(item.module);
    });
  }, [
    childId,
    hasViewedCareSnapshot,
    profileMedicationOptions.length,
    sharedLog,
    visibleModules,
  ]);

  const showOnboardingChecklist =
    !isGettingStartedDismissed &&
    (sharedLog.length < 6 ||
      onboardingChecklistItems.some((item) => !item.completed));

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
    const emptyTileText = {
      "Food Diary": "No food entries yet - start logging meals to build a daily picture",
      Medication: "No medication records yet - add medication to track consistency",
      Toileting: "No toileting data yet - logging this helps identify patterns",
      Health: "No health notes yet - record concerns, illness or changes here",
      Sleep: "No sleep recorded yet - log your first night to start tracking patterns",
      Reports: "Not enough data yet - log a few days to generate a full report",
      "Growth / Measurements": "No measurements yet - add height or weight when useful",
    };
    if (sectionTitle === "Growth / Measurements") {
      const latest = latestTwoBySection.measurements[0];
      if (!latest) return [emptyTileText[sectionTitle]];
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
      if (!entries.length) return [emptyTileText[sectionTitle] || "No entries yet"];
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
            scheduled_window: medicationForm.scheduledWindow || "",
            scheduled_day: medicationForm.scheduledDay || "",
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

  const saveBehaviourEntryToSupabase = async () => {
    if (!useSaasApi) {
      alert("Behaviour tracking is available in the FamilyTrack account version.");
      return false;
    }

    if (!familyId || !childId) {
      alert("Choose a family and child before saving.");
      return false;
    }

    const logDate = parseDateToIso(behaviourForm.date);
    if (!logDate) {
      alert("Use date format DD/MM/YYYY.");
      return false;
    }

    const behaviourType =
      behaviourForm.behaviourType === "Other"
        ? behaviourForm.otherBehaviourType.trim() || "Other"
        : behaviourForm.behaviourType;
    const location =
      behaviourForm.location === "Other"
        ? behaviourForm.otherLocation.trim()
        : behaviourForm.location;
    const triggers = uniqueList([
      ...behaviourForm.triggers.filter((trigger) => trigger !== "Other"),
      behaviourForm.triggers.includes("Other") ? behaviourForm.otherTrigger : "",
    ]);

    let attachmentInfo = {};
    if (behaviourForm.attachment) {
      const uploaded = await api.uploadFamilyDocument(
        familyId,
        {
          title: `Behaviour attachment - ${behaviourType}`,
          category: "Other",
          childId,
          documentDate: logDate,
          notes: "Attached to a behaviour tracker entry.",
        },
        behaviourForm.attachment,
      );
      attachmentInfo = {
        attachment_document_id: uploaded?.id || "",
        attachment_file_name: uploaded?.fileName || behaviourForm.attachment.name,
      };
    }

    try {
      const saved = await createCareLogWithOfflineQueue({
        childId,
        category: "behaviour",
        logDate,
        logTime: behaviourForm.time,
        data: {
          behaviour_type: behaviourType,
          severity: Number(behaviourForm.severity || 0) || "",
          duration: behaviourForm.duration || "",
          triggers,
          location,
          recovery_time: behaviourForm.recoveryTime || "",
          what_helped: behaviourForm.whatHelped || "",
          ...attachmentInfo,
        },
        notes: behaviourForm.notes || "",
      });

      return saved || true;
    } catch (error) {
      console.error("SaaS behaviour save failed:", error);
      alert(error.message || "Behaviour save failed");
      return false;
    }
  };

  const saveAppointmentEntryToSupabase = async () => {
    if (!useSaasApi) {
      alert("Appointments are available in the FamilyTrack account version.");
      return false;
    }

    if (!familyId || !childId) {
      alert("Choose a family and child before saving.");
      return false;
    }

    const logDate = parseDateToIso(appointmentForm.date);
    if (!logDate) {
      alert("Use date format DD/MM/YYYY.");
      return false;
    }

    try {
      const saved = await createCareLogWithOfflineQueue({
        childId,
        category: "appointment",
        logDate,
        logTime: appointmentForm.time,
        data: {
          title: appointmentForm.title.trim() || "Appointment",
          location: appointmentForm.location || "",
          professional: appointmentForm.professional || "",
          category: appointmentForm.category || "Other",
          outcome: appointmentForm.outcome || "",
        },
        notes: appointmentForm.notes || "",
      });

      return saved || true;
    } catch (error) {
      console.error("SaaS appointment save failed:", error);
      alert(error.message || "Appointment save failed");
      return false;
    }
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

  const resetBehaviourForm = () => {
    setBehaviourForm({
      date: todayValue(),
      time: nowTimeValue(),
      severity: "3",
      duration: "",
      triggers: [],
      otherTrigger: "",
      location: "",
      otherLocation: "",
      behaviourType: "Meltdown",
      otherBehaviourType: "",
      recoveryTime: "",
      whatHelped: "",
      notes: "",
      attachment: null,
    });
  };

  const resetAppointmentForm = () => {
    setAppointmentForm({
      title: "",
      date: todayValue(),
      time: "",
      location: "",
      professional: "",
      category: "Hospital",
      notes: "",
      outcome: "",
    });
  };

  const defaultReportPdfFilename = (variant = "full") => {
    const safeChildName = String(childName || "child")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const safeRange = String(reportRangeLabel || `${effectiveReportDays}-days`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return `familytrack-${variant === "trends" ? "trends-report" : "care-report"}-${safeChildName}-${safeRange}.pdf`;
  };

  const createReportPdf = async ({ variant = "full" } = {}) => {
    const isTrendsPdf = variant === "trends";
    const pdfOrientation = isTrendsPdf ? "p" : "l";
    const pdfWidth = isTrendsPdf ? 210 : 297;
    const pdfHeight = isTrendsPdf ? 297 : 210;
    const margin = 8;
    const gap = 3;
    const usableWidth = pdfWidth - margin * 2;
    const pdf = new jsPDF(pdfOrientation, "mm", "a4");
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
      pdf.addPage("a4", pdfOrientation);
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
      const cardHeight = 22;
      items.forEach((item, index) => {
        const tone = item.tone || tones.slate;
        const column = index % columns;
        if (column === 0) ensureSpace(cardHeight);
        const x = margin + column * (cardWidth + gap);
        const y = cursorY;
        pdf.setFillColor(...tone.fill);
        pdf.setDrawColor(...tone.stroke);
        pdf.roundedRect(x, y, cardWidth, cardHeight, 3, 3, "FD");
        setText(6.5, tone.accent, "bold");
        pdf.text(String(item.label || "").toUpperCase(), x + 5, y + 6);
        setText(11, [15, 23, 42], "bold");
        pdf.text(String(item.value ?? ""), x + 5, y + 15);
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

    const drawSimpleBarChart = ({
      title,
      data,
      valueKey = "value",
      suffix = "",
      tone = tones.sky,
      note = "",
      emptyText = "No data available for this period.",
    }) => {
      const cleanData = data.filter((item) =>
        item?.hasData !== false &&
        item?.[valueKey] !== null &&
        Number.isFinite(Number(item[valueKey] || 0)),
      );
      const chartHeight = 38;
      ensureSpace(chartHeight);
      const x = margin;
      const y = cursorY;
      const width = usableWidth;
      const plotX = x + 8;
      const plotY = y + 13;
      const plotWidth = width - 16;
      const plotHeight = 17;
      const chartData = cleanData;
      const maxValue = Math.max(1, ...chartData.map((item) => Number(item[valueKey] || 0)));
      const barGap = 3;
      const barWidth = chartData.length
        ? Math.max(2.5, (plotWidth - barGap * (chartData.length - 1)) / chartData.length)
        : plotWidth;

      pdf.setFillColor(...tone.fill);
      pdf.setDrawColor(...tone.stroke);
      pdf.roundedRect(x, y, width, chartHeight, 3, 3, "FD");
      setText(7, tone.accent, "bold");
      pdf.text(String(title).toUpperCase(), x + 4, y + 6);
      setText(6.5, [100, 116, 139], "normal");
      pdf.text(note, x + 4, y + 10);
      pdf.setDrawColor(203, 213, 225);
      pdf.line(plotX, plotY + plotHeight, plotX + plotWidth, plotY + plotHeight);

      if (chartData.length) {
        chartData.forEach((item, index) => {
          const value = Number(item[valueKey] || 0);
          const barX = plotX + index * (barWidth + barGap);
          const barHeight = Math.max(value ? 1.2 : 0.4, (value / maxValue) * plotHeight);
          pdf.setFillColor(...tone.accent);
          pdf.roundedRect(barX, plotY + plotHeight - barHeight, barWidth, barHeight, 1, 1, "F");
          setText(5.2, [100, 116, 139], "normal");
          if (index % Math.ceil(chartData.length / 10) === 0 || index === chartData.length - 1) {
            pdf.text(String(item.label || "").slice(0, 5), barX, y + chartHeight - 3);
          }
        });
        const latest = chartData[chartData.length - 1];
        setText(7, [15, 23, 42], "bold");
        pdf.text(`Latest: ${roundTo(latest[valueKey], suffix === "ml" ? 0 : 1)}${suffix}`, x + width - 38, y + 6);
      } else {
        setText(7, [100, 116, 139], "normal");
        pdf.text(emptyText, plotX, plotY + 8);
      }
      cursorY += chartHeight + gap;
    };

    const drawPdfLineChart = ({
      title,
      data,
      valueKey = "value",
      suffix = "",
      tone = tones.indigo,
      note = "",
      axisTitle = "",
      yAxisLabels = [],
      minPoints = 1,
      emptyText = "No data available for this period.",
      yMin = 0,
      yMax,
    }) => {
      const cleanData = data.filter(
        (item) =>
          item?.hasData !== false &&
          item?.[valueKey] !== null &&
          Number.isFinite(Number(item[valueKey])),
      );
      const chartHeight = 46;
      ensureSpace(chartHeight);
      const x = margin;
      const y = cursorY;
      const width = usableWidth;
      const plotX = x + 22;
      const plotY = y + 14;
      const plotWidth = width - 32;
      const plotHeight = 22;

      pdf.setFillColor(...tone.fill);
      pdf.setDrawColor(...tone.stroke);
      pdf.roundedRect(x, y, width, chartHeight, 3, 3, "FD");
      setText(7, tone.accent, "bold");
      pdf.text(String(title).toUpperCase(), x + 4, y + 6);
      setText(6.5, [100, 116, 139], "normal");
      pdf.text(note, x + 4, y + 10);

      if (cleanData.length < minPoints) {
        setText(7, [100, 116, 139], "normal");
        pdf.text(emptyText, plotX, plotY + 10);
        cursorY += chartHeight + gap;
        return;
      }

      const values = cleanData.map((item) => Number(item[valueKey]));
      const maxFromData = Math.max(...values);
      const minFromData = Math.min(...values);
      const maxValue = Number.isFinite(yMax)
        ? Math.max(yMax, maxFromData)
        : Math.max(1, Math.ceil(maxFromData));
      const minValue = Number.isFinite(yMin)
        ? Math.min(yMin, minFromData)
        : Math.floor(minFromData);
      const span = Math.max(1, maxValue - minValue);

      pdf.setDrawColor(203, 213, 225);
      pdf.line(plotX, plotY + plotHeight, plotX + plotWidth, plotY + plotHeight);
      pdf.line(plotX, plotY, plotX, plotY + plotHeight);

      const labelsToDraw = yAxisLabels.length
        ? yAxisLabels
        : [minValue, Math.round((minValue + maxValue) / 2), maxValue];
      labelsToDraw.forEach((labelValue) => {
        const yPos = plotY + plotHeight - ((labelValue - minValue) / span) * plotHeight;
        if (yPos < plotY - 1 || yPos > plotY + plotHeight + 1) return;
        pdf.setDrawColor(226, 232, 240);
        pdf.line(plotX, yPos, plotX + plotWidth, yPos);
        setText(5.5, [100, 116, 139], "normal");
        pdf.text(`${labelValue}${suffix}`, x + 4, yPos + 1.5);
      });

      if (axisTitle) {
        setText(5.8, [71, 85, 105], "bold");
        pdf.text(axisTitle, x + 4, y + chartHeight - 4);
      }

      const points = cleanData.map((item, index) => {
        const pointX =
          cleanData.length === 1
            ? plotX + plotWidth / 2
            : plotX + (index / (cleanData.length - 1)) * plotWidth;
        const pointY =
          plotY + plotHeight - ((Number(item[valueKey]) - minValue) / span) * plotHeight;
        return { ...item, pointX, pointY };
      });

      pdf.setDrawColor(...tone.accent);
      pdf.setLineWidth(0.8);
      points.forEach((point, index) => {
        if (index === 0) return;
        const previous = points[index - 1];
        pdf.line(previous.pointX, previous.pointY, point.pointX, point.pointY);
      });
      points.forEach((point) => {
        pdf.setFillColor(255, 255, 255);
        pdf.setDrawColor(...tone.accent);
        pdf.circle(point.pointX, point.pointY, 1.4, "FD");
      });

      setText(5.5, [100, 116, 139], "normal");
      const labelStep = Math.max(1, Math.ceil(points.length / 8));
      points.forEach((point, index) => {
        if (index % labelStep === 0 || index === points.length - 1) {
          pdf.text(String(point.label || "").slice(0, 5), point.pointX - 2, y + chartHeight - 3);
        }
      });

      const latest = points[points.length - 1];
      setText(7, [15, 23, 42], "bold");
      pdf.text(
        `Latest: ${roundTo(latest[valueKey], suffix === "ml" ? 0 : 1)}${suffix}`,
        x + width - 38,
        y + 6,
      );
      cursorY += chartHeight + gap;
    };

    const drawMedicationConsistencyPdf = () => {
      const graph = reportTrendModel.graphs.medication;
      const chartHeight = 28;
      ensureSpace(chartHeight);
      const x = margin;
      const y = cursorY;
      const width = usableWidth;
      const percent = Math.max(0, Math.min(100, graph.percent));
      pdf.setFillColor(...tones.rose.fill);
      pdf.setDrawColor(...tones.rose.stroke);
      pdf.roundedRect(x, y, width, chartHeight, 3, 3, "FD");
      setText(7, tones.rose.accent, "bold");
      pdf.text("MEDICATION ROUTINE CONSISTENCY", x + 4, y + 6);
      setText(13, [15, 23, 42], "bold");
      pdf.text(`${percent}%`, x + 4, y + 16);
      setText(7, [100, 116, 139], "normal");
      pdf.text(
        graph.typical
          ? `${graph.logged} logged from ${graph.typical} typical doses`
          : `${graph.logged} medication logs`,
        x + 22,
        y + 16,
      );
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(x + 4, y + 21, width - 8, 3, 1.5, 1.5, "F");
      pdf.setFillColor(...tones.rose.accent);
      pdf.roundedRect(x + 4, y + 21, ((width - 8) * percent) / 100, 3, 1.5, 1.5, "F");
      cursorY += chartHeight + gap;
    };

    const drawTrendVisuals = () => {
      drawSimpleBarChart({
        title: "Fluid intake",
        data: reportTrendModel.graphs.fluid,
        suffix: "ml",
        tone: tones.sky,
        note: "Daily fluid intake across the selected period.",
      });
      drawMedicationConsistencyPdf();
      drawPdfLineChart({
        title: "Sleep",
        data: reportTrendModel.graphs.sleep,
        suffix: "h",
        tone: tones.indigo,
        note: "Sleep duration per night based on logged entries.",
        axisTitle: "Hours",
        yAxisLabels: [0, 2, 4, 6, 8, 10, 12],
        yMin: 0,
        yMax: 12,
        minPoints: 1,
        emptyText: "No completed sleep logs available for this period.",
      });
      drawSimpleBarChart({
        title: "Toileting",
        data: reportTrendModel.graphs.toileting,
        suffix: "",
        tone: tones.amber,
        note: "Number of toileting entries recorded per day.",
        emptyText: "No data available for this period.",
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

    const sortPdfEntriesByDate = (entries = []) =>
      [...entries].sort((entryA, entryB) => {
        const dateA = getEntryDateTime(entryA)?.getTime() || 0;
        const dateB = getEntryDateTime(entryB)?.getTime() || 0;
        return dateA - dateB;
      });

    const groupPdfEntriesByDate = (entries = []) => {
      const groups = [];
      sortPdfEntriesByDate(entries).forEach((entry) => {
        const date = entry.date || "Date not set";
        let group = groups.find((item) => item.date === date);
        if (!group) {
          group = {
            date,
            label: date === "Date not set" ? date : formatReportDateLabel(date),
            entries: [],
          };
          groups.push(group);
        }
        group.entries.push(entry);
      });
      return groups;
    };

    const pdfFoodEntries = sortPdfEntriesByDate(groupedReportEntries["Food Diary"] || []);
    const pdfMedicationEntries = sortPdfEntriesByDate(groupedReportEntries.Medication || []);
    const pdfBehaviourEntries = sortPdfEntriesByDate(groupedReportEntries.Behaviour || []);
    const pdfSleepEntries = sortPdfEntriesByDate(groupedReportEntries.Sleep || []);
    const pdfToiletingEntries = sortPdfEntriesByDate(groupedReportEntries.Toileting || []);
    const pdfHealthEntries = sortPdfEntriesByDate(
      (groupedReportEntries.Health || []).filter((entry) => !isMeasurementEntry(entry)),
    );
    const pdfMeasurementEntries = sortPdfEntriesByDate(recentEntries.filter(isMeasurementEntry));
    const pdfAppointmentEntries = sortPdfEntriesByDate(groupedReportEntries.Appointments || []);
    const pdfNotesEntries = sortPdfEntriesByDate(groupedReportEntries["General Notes"] || []);
    const pdfDocumentEntries = sortPdfEntriesByDate(
      (documents || [])
        .filter((document) => !document.childId || document.childId === childId)
        .filter((document) => {
          const documentDate =
            parseIsoDate(document.documentDate) ||
            parseIsoDate(document.createdAt) ||
            null;
          if (!documentDate || !reportRangeStart || !reportRangeEnd) return true;
          return documentDate >= reportRangeStart && documentDate <= reportRangeEnd;
        })
        .map((document) => ({
          id: `document-${document.id}`,
          date:
            document.documentDate ||
            (parseIsoDate(document.createdAt) || new Date()).toISOString().slice(0, 10),
          time: "",
          summary: document.title || document.fileName || "Document",
          details: [
            document.category ? `Category: ${document.category}` : "",
            document.childName ? `Child: ${document.childName}` : "",
            document.fileName ? `File: ${document.fileName}` : "",
            document.notes ? `Notes: ${professionalText(document.notes)}` : "",
          ].filter(Boolean),
        })),
    );

    const drawDetailedPdfSection = ({
      title,
      entries,
      emptyText,
      fill = tones.slate.fill,
      stroke = tones.slate.stroke,
      titleColor = tones.slate.accent,
    }) => {
      addSectionTitle(title);
      const groups = groupPdfEntriesByDate(entries);
      if (!groups.length) {
        drawCard({
          title,
          lines: [emptyText],
          fill,
          stroke,
          titleColor,
        });
        return;
      }

      groups.forEach((group) => {
        const lines = group.entries.map((entry) => `- ${formatEntryLine(entry)}`);
        const chunkSize = 12;
        for (let index = 0; index < lines.length; index += chunkSize) {
          const chunk = lines.slice(index, index + chunkSize);
          drawCard({
            title:
              index === 0
                ? `${group.label} - ${group.entries.length} item${group.entries.length === 1 ? "" : "s"}`
                : `${group.label} continued`,
            lines: chunk,
            fill,
            stroke,
            titleColor,
          });
        }
      });
    };

    pdf.setFillColor(...tones.sky.fill);
    pdf.setDrawColor(...tones.sky.stroke);
    pdf.roundedRect(margin, cursorY, usableWidth, 28, 4, 4, "FD");
    pdf.setFillColor(...tones.sky.accent);
    pdf.roundedRect(margin, cursorY, 3, 28, 1.5, 1.5, "F");
    setText(8, tones.sky.accent, "bold");
    pdf.text(isTrendsPdf ? "TRENDS SUMMARY" : "FULL CARE REPORT", margin + 5, cursorY + 7);
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

    if (!isTrendsPdf && reportNotes.trim()) {
      drawCard({
        title: "Parent/carer notes",
        lines: [reportNotes.trim()],
        fill: tones.sky.fill,
        stroke: tones.sky.stroke,
        titleColor: tones.sky.accent,
      });
    }

    if (isTrendsPdf) {
      addSectionTitle("Key metrics");
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

      addSectionTitle("Insights");
      drawCard({
        title: "Insights",
        lines: reportTrendModel.insights.map((item) => `- ${item}`),
        fill: tones.slate.fill,
        stroke: tones.slate.stroke,
        titleColor: tones.slate.accent,
      });

      if (showReportCharts) {
        addSectionTitle("Visual patterns");
        drawTrendVisuals();
      }

      addSectionTitle("Data completeness");
      drawCard({
        title: "Data Completeness",
        lines: reportTrendModel.dataCompleteness.map(
          (item) => `${item.label}: ${item.value}`,
        ),
      });
    }

    if (!isTrendsPdf && reportImportantEvents.length) {
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

    if (!isTrendsPdf) {
      addSectionTitle("Report summary");
      drawMetricGrid([
        { label: "Total entries", value: recentEntries.length || "None", tone: tones.slate },
        { label: "Sleep", value: quickReportSummary.sleep, tone: tones.indigo },
        { label: "Food & Drink", value: quickReportSummary.food, tone: tones.emerald },
        { label: "Medication", value: quickReportSummary.medication, tone: tones.rose },
        { label: "Toileting", value: quickReportSummary.toileting, tone: tones.sky },
        { label: "Health", value: pdfHealthEntries.length, tone: tones.amber },
        { label: "Measurements", value: pdfMeasurementEntries.length, tone: tones.violet },
        {
          label: "Days with entries",
          value: dailyReportGroups.length || "None",
          tone: tones.slate,
        },
      ]);

      addSectionTitle("Key insights");
      drawCard({
        title: "Key Insights",
        lines: reportTrendModel.insights.length
          ? reportTrendModel.insights.map((item) => `- ${item}`)
          : ["Not enough data yet - log a few days to generate a full report."],
        fill: tones.sky.fill,
        stroke: tones.sky.stroke,
        titleColor: tones.sky.accent,
      });

      if (showReportCharts) {
        addSectionTitle("Key trends");
        drawTrendVisuals();
      }

      addSectionTitle("Detailed report");
      drawDetailedPdfSection({
        title: includeHealthHistory24Months ? "Health history" : "Health",
        entries: pdfHealthEntries,
        emptyText: includeHealthHistory24Months
          ? "No health history entries found for this period."
          : "No health entries found for this period.",
        fill: tones.amber.fill,
        stroke: tones.amber.stroke,
        titleColor: tones.amber.accent,
      });
      drawDetailedPdfSection({
        title: "Medication",
        entries: pdfMedicationEntries,
        emptyText: "No medication records yet - add medication to track consistency.",
        fill: tones.rose.fill,
        stroke: tones.rose.stroke,
        titleColor: tones.rose.accent,
      });
      drawDetailedPdfSection({
        title: "Behaviour",
        entries: pdfBehaviourEntries,
        emptyText: "No behaviour data recorded for this period.",
        fill: tones.violet.fill,
        stroke: tones.violet.stroke,
        titleColor: tones.violet.accent,
      });
      drawDetailedPdfSection({
        title: "Sleep",
        entries: pdfSleepEntries,
        emptyText: "No sleep recorded yet - log your first night to start tracking patterns.",
        fill: tones.indigo.fill,
        stroke: tones.indigo.stroke,
        titleColor: tones.indigo.accent,
      });
      drawDetailedPdfSection({
        title: "Food & Drink",
        entries: pdfFoodEntries,
        emptyText: "No food entries yet - start logging meals to build a daily picture.",
        fill: tones.emerald.fill,
        stroke: tones.emerald.stroke,
        titleColor: tones.emerald.accent,
      });
      drawDetailedPdfSection({
        title: "Toileting",
        entries: pdfToiletingEntries,
        emptyText: "No toileting data yet - logging this helps identify patterns.",
        fill: tones.sky.fill,
        stroke: tones.sky.stroke,
        titleColor: tones.sky.accent,
      });
      if (pdfMeasurementEntries.length) {
        drawDetailedPdfSection({
          title: "Measurements",
          entries: pdfMeasurementEntries,
          emptyText: "No measurements found for this period.",
          fill: tones.violet.fill,
          stroke: tones.violet.stroke,
          titleColor: tones.violet.accent,
        });
      }
      drawDetailedPdfSection({
        title: "Appointments",
        entries: pdfAppointmentEntries,
        emptyText: "No appointments recorded for this period.",
        fill: tones.sky.fill,
        stroke: tones.sky.stroke,
        titleColor: tones.sky.accent,
      });
      if (pdfDocumentEntries.length) {
        drawDetailedPdfSection({
          title: "Documents",
          entries: pdfDocumentEntries,
          emptyText: "No documents found for this period.",
          fill: tones.slate.fill,
          stroke: tones.slate.stroke,
          titleColor: tones.slate.accent,
        });
      }
      if (pdfNotesEntries.length) {
        drawDetailedPdfSection({
          title: "Notes",
          entries: pdfNotesEntries,
          emptyText: "No general notes found for this period.",
          fill: tones.slate.fill,
          stroke: tones.slate.stroke,
          titleColor: tones.slate.accent,
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

  const waitForReportPdfReady = async () => {
    await new Promise((resolve) => setTimeout(resolve, 160));
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
  };

  const handleExportPdf = async (
    variantOrEvent = "full",
    filename,
  ) => {
    const variant =
      typeof variantOrEvent === "string" && ["trends", "full"].includes(variantOrEvent)
        ? variantOrEvent
        : "full";
    try {
      setIsExportingPdf(true);
      await waitForReportPdfReady();
      const pdf = await createReportPdf({ variant });
      pdf.save(filename || defaultReportPdfFilename(variant));
      showToast?.({
        message:
          variant === "trends"
            ? "Report trends PDF generated"
            : "Report PDF generated",
        type: "success",
      });
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
      const attachmentType = reportEmailForm.attachmentType || "trends";
      const filename = defaultReportPdfFilename(attachmentType);
      await waitForReportPdfReady();
      const pdf = await createReportPdf({ variant: attachmentType });
      const pdfBase64 = await blobToBase64(pdf.output("blob"));

      await api.sendReportEmail(familyId, {
        recipientEmail: reportEmailForm.recipientEmail,
        message: reportEmailForm.message,
        childId,
        childName,
        dateRange: reportRangeLabel,
        reportType:
          attachmentType === "trends"
            ? "Report Trends PDF"
            : "Reports PDF",
        filename,
        pdfBase64,
      });

      setIsReportEmailOpen(false);
      setReportEmailForm({
        recipientEmail: "",
        message: "",
        attachmentType,
        confirmed: false,
      });
      showToast?.({ message: "📧 Report sent", type: "success" });
    } catch (error) {
      console.error("Report email failed", error);
      showToast?.({
        message:
          error?.message ||
          "Email sending is not set up yet. You can still download the PDF.",
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
      showToast?.({ message: "Care Snapshot PDF generated", type: "success" });
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
    const savedFoodSuggestions = uniqueList(
      isDrink
        ? [...customDrinkLabels, ...savedFoodOptions.filter(isLikelyDrinkLabel)]
        : [
            ...customFoodLabels,
            ...savedFoodOptions.filter((item) => !isLikelyDrinkLabel(item)),
            ...(useSaasApi ? [] : ["Cottage pie", "Weetabix", "Heinz Fruit Custard"]),
          ],
    );
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
                    setFoodForm({
                      ...foodForm,
                      item,
                      otherItem: item,
                      description: "",
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
            autoComplete="off"
            name={`food-description-${childId || "child"}-${activeSection?.title || "new"}`}
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
            autoComplete="off"
            name={`food-notes-${childId || "child"}-${activeSection?.title || "new"}`}
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
                      category: isDrink ? "drink" : "food",
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
    const hasGivenBy = showOtherGivenBy
      ? !!medicationForm.otherGivenBy.trim()
      : !!medicationForm.givenBy.trim();
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
      hasGivenBy &&
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
            autoComplete="off"
            name={`medication-notes-${childId || "child"}-${selectedMedicine || "new"}`}
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
                  if (onCreateCareOption) {
                    await onCreateCareOption({
                      category: "given_by",
                      label: medicationForm.otherGivenBy,
                      defaultValue: "",
                    });
                  }
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
            autoComplete="off"
            name={`toileting-notes-${childId || "child"}-${activeSection?.title || "new"}`}
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
            autoComplete="off"
            name={`health-happened-${childId || "child"}-${activeSection?.title || "new"}`}
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
            autoComplete="off"
            name={`health-action-${childId || "child"}-${activeSection?.title || "new"}`}
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
            autoComplete="off"
            name={`health-outcome-${childId || "child"}-${activeSection?.title || "new"}`}
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
            autoComplete="off"
            name={`health-notes-${childId || "child"}-${activeSection?.title || "new"}`}
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

  const renderBehaviourForm = () => {
    const selectedBehaviourType =
      behaviourForm.behaviourType === "Other"
        ? behaviourForm.otherBehaviourType.trim()
        : behaviourForm.behaviourType;
    const selectedLocation =
      behaviourForm.location === "Other"
        ? behaviourForm.otherLocation.trim()
        : behaviourForm.location;
    const canSaveBehaviour =
      !!behaviourForm.date.trim() &&
      !!behaviourForm.time.trim() &&
      !!selectedBehaviourType &&
      !activeSaveAction;

    const toggleTrigger = (trigger) => {
      setBehaviourForm((current) => ({
        ...current,
        triggers: current.triggers.includes(trigger)
          ? current.triggers.filter((item) => item !== trigger)
          : [...current.triggers, trigger],
      }));
    };

    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {renderDraftRecoveryPrompt("behaviour")}

        <div className="md:col-span-2 rounded-2xl border border-purple-100 bg-purple-50/80 px-4 py-3 text-sm font-semibold leading-6 text-purple-900 shadow-sm">
          Keep this quick during stressful moments. Add what you know now, and
          use notes later if more detail is needed.
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Date</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="DD/MM/YYYY"
            className={dateTimeInputClass}
            value={behaviourForm.date}
            onChange={(e) =>
              setBehaviourForm({ ...behaviourForm, date: e.target.value })
            }
          />
        </div>

        {renderTimeInput({
          label: "Time",
          value: behaviourForm.time,
          onChange: (time) => setBehaviourForm({ ...behaviourForm, time }),
          onNow: () => setBehaviourForm({ ...behaviourForm, time: nowTimeValue() }),
        })}

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Behaviour type
          </label>
          <select
            className={`${inputClassName} min-h-[48px]`}
            value={behaviourForm.behaviourType}
            onChange={(e) =>
              setBehaviourForm({
                ...behaviourForm,
                behaviourType: e.target.value,
                otherBehaviourType:
                  e.target.value === "Other"
                    ? behaviourForm.otherBehaviourType
                    : "",
              })
            }
          >
            {BEHAVIOUR_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Severity
          </label>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() =>
                  setBehaviourForm({
                    ...behaviourForm,
                    severity: String(level),
                  })
                }
                className={`min-h-[44px] rounded-xl border text-sm font-black transition ${
                  behaviourForm.severity === String(level)
                    ? "border-purple-300 bg-purple-600 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {behaviourForm.behaviourType === "Other" ? (
          <div className={`${cardClassName} md:col-span-2`}>
            <label className="text-sm font-semibold text-slate-700">
              Other behaviour type
            </label>
            <input
              type="text"
              placeholder="Describe behaviour type"
              className={`${inputClassName} min-h-[48px] border-dashed`}
              value={behaviourForm.otherBehaviourType}
              onChange={(e) =>
                setBehaviourForm({
                  ...behaviourForm,
                  otherBehaviourType: e.target.value,
                })
              }
            />
          </div>
        ) : null}

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Possible triggers
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {BEHAVIOUR_TRIGGERS.map((trigger) => {
              const active = behaviourForm.triggers.includes(trigger);
              return (
                <button
                  key={trigger}
                  type="button"
                  onClick={() => toggleTrigger(trigger)}
                  className={`rounded-full border px-3 py-2 text-xs font-black transition ${
                    active
                      ? "border-purple-300 bg-purple-600 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {trigger}
                </button>
              );
            })}
          </div>
          {behaviourForm.triggers.includes("Other") ? (
            <input
              type="text"
              placeholder="Custom trigger"
              className={`${inputClassName} min-h-[48px] border-dashed`}
              value={behaviourForm.otherTrigger}
              onChange={(e) =>
                setBehaviourForm({
                  ...behaviourForm,
                  otherTrigger: e.target.value,
                })
              }
            />
          ) : null}
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Duration
          </label>
          <input
            type="text"
            placeholder="e.g. 12 minutes"
            className={`${inputClassName} min-h-[48px]`}
            value={behaviourForm.duration}
            onChange={(e) =>
              setBehaviourForm({ ...behaviourForm, duration: e.target.value })
            }
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Recovery time
          </label>
          <input
            type="text"
            placeholder="e.g. 30 minutes"
            className={`${inputClassName} min-h-[48px]`}
            value={behaviourForm.recoveryTime}
            onChange={(e) =>
              setBehaviourForm({
                ...behaviourForm,
                recoveryTime: e.target.value,
              })
            }
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Location
          </label>
          <select
            className={`${inputClassName} min-h-[48px]`}
            value={behaviourForm.location}
            onChange={(e) =>
              setBehaviourForm({
                ...behaviourForm,
                location: e.target.value,
                otherLocation:
                  e.target.value === "Other" ? behaviourForm.otherLocation : "",
              })
            }
          >
            <option value="">Select location</option>
            {uniqueList([
              "Home",
              "School",
              "Car",
              "Shop",
              "Appointment",
              ...customLocationOptions.map((option) => option.label || option),
              "Other",
            ]).map((location) => (
              <option key={location} value={location}>
                {location}
              </option>
            ))}
          </select>
        </div>

        {behaviourForm.location === "Other" ? (
          <div className={cardClassName}>
            <label className="text-sm font-semibold text-slate-700">
              Location name
            </label>
            <input
              type="text"
              placeholder="Where did it happen?"
              className={`${inputClassName} min-h-[48px] border-dashed`}
              value={behaviourForm.otherLocation}
              onChange={(e) =>
                setBehaviourForm({
                  ...behaviourForm,
                  otherLocation: e.target.value,
                })
              }
            />
          </div>
        ) : (
          <div className={cardClassName}>
            <label className="text-sm font-semibold text-slate-700">
              Optional attachment/photo
            </label>
            <input
              type="file"
              accept={DOCUMENT_ACCEPT}
              className={`${inputClassName} min-h-[48px]`}
              onChange={(e) =>
                setBehaviourForm({
                  ...behaviourForm,
                  attachment: e.target.files?.[0] || null,
                })
              }
            />
          </div>
        )}

        {behaviourForm.location === "Other" ? (
          <div className={cardClassName}>
            <label className="text-sm font-semibold text-slate-700">
              Optional attachment/photo
            </label>
            <input
              type="file"
              accept={DOCUMENT_ACCEPT}
              className={`${inputClassName} min-h-[48px]`}
              onChange={(e) =>
                setBehaviourForm({
                  ...behaviourForm,
                  attachment: e.target.files?.[0] || null,
                })
              }
            />
          </div>
        ) : null}

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            What helped?
          </label>
          <textarea
            rows={3}
            placeholder="Calming strategy, quiet space, sensory support, communication aid..."
            className={`${inputClassName} min-h-[48px]`}
            autoComplete="off"
            name={`behaviour-helped-${childId || "child"}-${activeSection?.title || "new"}`}
            value={behaviourForm.whatHelped}
            onChange={(e) =>
              setBehaviourForm({
                ...behaviourForm,
                whatHelped: e.target.value,
              })
            }
          />
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Notes</label>
          <textarea
            rows={5}
            placeholder="Anything else important, what happened before or after, who was present..."
            className={`${inputClassName} min-h-[48px]`}
            autoComplete="off"
            name={`behaviour-notes-${childId || "child"}-${activeSection?.title || "new"}`}
            value={behaviourForm.notes}
            onChange={(e) =>
              setBehaviourForm({ ...behaviourForm, notes: e.target.value })
            }
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            disabled={!canSaveBehaviour}
            onClick={() =>
              runLockedSave("behaviour", async () => {
                const saved = await saveBehaviourEntryToSupabase();

                if (!saved) return;

                await loadEntriesFromSupabase();
                toastSavedForChild(saved);
                clearLogDraft("behaviour");
                resetBehaviourForm();
                closeSection();
              })
            }
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {activeSaveAction === "behaviour"
              ? "Saving..."
              : "Save behaviour entry"}
          </button>
        </div>
      </div>
    );
  };

  const renderAppointmentsForm = () => {
    const sortAppointmentEntries = (entries = []) =>
      [...entries].sort((entryA, entryB) => {
        const dateA = getEntryDateTime(entryA)?.getTime() || 0;
        const dateB = getEntryDateTime(entryB)?.getTime() || 0;
        return dateA - dateB;
      });
    const appointmentEntries = sortAppointmentEntries(
      sharedLog.filter((entry) => entry.section === "Appointments"),
    );
    const now = new Date();
    const upcomingAppointments = appointmentEntries.filter((entry) => {
      const date = getEntryDateTime(entry);
      return date && date >= now;
    });
    const pastAppointments = appointmentEntries
      .filter((entry) => {
        const date = getEntryDateTime(entry);
        return date && date < now;
      })
      .reverse();
    const canSaveAppointment =
      !!appointmentForm.title.trim() &&
      !!appointmentForm.date.trim() &&
      !activeSaveAction;

    const renderAppointmentList = (title, entries, emptyText) => (
      <div className={`${cardClassName} md:col-span-2`}>
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-black text-slate-900">{title}</h4>
          <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
            {entries.length}
          </span>
        </div>
        {entries.length ? (
          <div className="mt-3 space-y-2">
            {entries.slice(0, 6).map((entry) => (
              <article
                key={entry.id}
                className="rounded-2xl border border-white bg-white/85 px-3 py-3 shadow-sm"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-black text-slate-950">
                      {entry.appointmentTitle || entry.summary}
                    </p>
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      {entry.date} {entry.time ? `at ${entry.time}` : ""}
                    </p>
                  </div>
                  <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-blue-700">
                    {entry.appointmentCategory || "Other"}
                  </span>
                </div>
                {entry.details?.length ? (
                  <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-slate-600">
                    {entry.details.slice(0, 2).join(" · ")}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-5 text-center text-sm font-semibold text-slate-500">
            {emptyText}
          </p>
        )}
      </div>
    );

    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {renderDraftRecoveryPrompt("appointments")}

        <div className="md:col-span-2 rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-sm font-semibold leading-6 text-blue-900 shadow-sm">
          Use this for upcoming appointments, school meetings, EHCP reviews and
          follow-up notes after the appointment.
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Title</label>
          <input
            type="text"
            placeholder="e.g. Paediatrician appointment"
            className={`${inputClassName} min-h-[48px]`}
            value={appointmentForm.title}
            onChange={(e) =>
              setAppointmentForm({ ...appointmentForm, title: e.target.value })
            }
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Child</label>
          <div className="mt-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800">
            {childName}
          </div>
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Category
          </label>
          <select
            className={`${inputClassName} min-h-[48px]`}
            value={appointmentForm.category}
            onChange={(e) =>
              setAppointmentForm({
                ...appointmentForm,
                category: e.target.value,
              })
            }
          >
            {APPOINTMENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
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
            value={appointmentForm.date}
            onChange={(e) =>
              setAppointmentForm({ ...appointmentForm, date: e.target.value })
            }
          />
        </div>

        {renderTimeInput({
          label: "Time",
          value: appointmentForm.time,
          onChange: (time) => setAppointmentForm({ ...appointmentForm, time }),
          onNow: () => setAppointmentForm({ ...appointmentForm, time: nowTimeValue() }),
        })}

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Location
          </label>
          <input
            type="text"
            placeholder="Hospital, school, clinic, online..."
            className={`${inputClassName} min-h-[48px]`}
            value={appointmentForm.location}
            onChange={(e) =>
              setAppointmentForm({
                ...appointmentForm,
                location: e.target.value,
              })
            }
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Professional/service
          </label>
          <input
            type="text"
            placeholder="e.g. SALT, school SENCO, GP"
            className={`${inputClassName} min-h-[48px]`}
            value={appointmentForm.professional}
            onChange={(e) =>
              setAppointmentForm({
                ...appointmentForm,
                professional: e.target.value,
              })
            }
          />
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Notes</label>
          <textarea
            rows={4}
            placeholder="Questions to ask, things to remember, documents to bring..."
            className={`${inputClassName} min-h-[48px]`}
            autoComplete="off"
            name={`appointment-notes-${childId || "child"}-${activeSection?.title || "new"}`}
            value={appointmentForm.notes}
            onChange={(e) =>
              setAppointmentForm({ ...appointmentForm, notes: e.target.value })
            }
          />
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Outcome / follow-up notes
          </label>
          <textarea
            rows={4}
            placeholder="What was agreed, next steps, follow-up date..."
            className={`${inputClassName} min-h-[48px]`}
            autoComplete="off"
            name={`appointment-outcome-${childId || "child"}-${activeSection?.title || "new"}`}
            value={appointmentForm.outcome}
            onChange={(e) =>
              setAppointmentForm({ ...appointmentForm, outcome: e.target.value })
            }
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            disabled={!canSaveAppointment}
            onClick={() =>
              runLockedSave("appointments", async () => {
                const saved = await saveAppointmentEntryToSupabase();

                if (!saved) return;

                await loadEntriesFromSupabase();
                toastSavedForChild(saved);
                clearLogDraft("appointments");
                resetAppointmentForm();
              })
            }
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {activeSaveAction === "appointments"
              ? "Saving..."
              : "Save appointment"}
          </button>
        </div>

        {renderAppointmentList(
          "Upcoming appointments",
          upcomingAppointments,
          "No upcoming appointments recorded yet.",
        )}
        {renderAppointmentList(
          "Past appointments",
          pastAppointments,
          "Past appointment notes will appear here after dates pass.",
        )}
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
        id: safeRandomId(),
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

  const openRequiredMedicationLog = (medicine) => {
    if (!medicine?.name || medicine.status === "taken") return;

    const medicationSection = sections.find(
      (section) => section.title === "Medication",
    );
    const knownMedicine = medicationOptions.includes(medicine.name);

    setSelectedMedicationShortcut(medicine.name);
    setMedicationValue(knownMedicine ? medicine.name : "Other");
    setMedicationForm((current) => ({
      ...current,
      medicine: knownMedicine ? medicine.name : "",
      otherMedicine: knownMedicine ? "" : medicine.name,
      dose: medicine.dose || getMedicationDefaultDose(medicine.name) || current.dose,
      status: "given",
      date: todayValue(),
      time: nowTimeValue(),
      scheduledWindow: medicine.timeWindow || "",
      scheduledDay: medicationScheduleLabel(medicine),
      givenBy: "",
      otherGivenBy: "",
      notes: "",
    }));

    if (medicationSection) {
      openSection(medicationSection, { reset: false });
    }
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
      notes: "",
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
            autoComplete="off"
            name={`measurement-notes-${childId || "child"}-${activeSection?.title || "new"}`}
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
                autoComplete="off"
                name={`sleep-notes-${childId || "child"}-${sleepEntryId || "new"}`}
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
          No entries match these filters yet. Try a wider date range or log the first entry.
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
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.06em] ${trend.className}`}
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
          <h3 className="text-base font-black text-slate-950">
            Key Changes
          </h3>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">
            Main movements compared with the previous period
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700">
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
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/80 text-xs font-black shadow-sm">
                {item.icon}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-black text-slate-950">
                  {item.title}
                </p>
                <p className="mt-0.5 text-xs font-semibold leading-5 text-slate-600">
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
      <h3 className="text-sm font-black text-slate-950">
        Summary stats
      </h3>
      <div
        className={`mt-3 grid gap-2 ${
          mode === "pdf" ? "grid-cols-5" : "grid-cols-2 lg:grid-cols-5"
        }`}
      >
        {reportTrendModel.summaryStats.map((stat) => (
          <div
            key={stat.key}
            className={`min-w-0 rounded-xl border px-3 py-3 shadow-sm sm:px-4 ${statToneClass(
              stat.tone,
            )}`}
          >
            <p className="break-words text-[10px] font-black uppercase leading-4 tracking-[0.1em] text-slate-500">
              {stat.label}
            </p>
            <p className="mt-1 break-words text-lg font-black leading-6 text-slate-950">
              {stat.value}
            </p>
            <p className="mt-2 break-words text-[11px] font-bold leading-5 text-slate-600">
              {stat.meta}
            </p>
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
    minPoints = 1,
    axisTitle = "",
    yAxisLabels = [],
    yMin,
    yMax,
    note = "",
  }) => {
    const points = data.filter(
      (item) =>
        item?.hasData !== false &&
        item?.value !== null &&
        Number.isFinite(Number(item.value)),
    );
    const hasEnoughPoints = points.length >= minPoints;
    const values = points.map((item) => Number(item.value));
    const min = Number.isFinite(yMin) ? Math.min(yMin, ...values) : values.length ? Math.min(...values) : 0;
    const max = Number.isFinite(yMax) ? Math.max(yMax, ...values) : values.length ? Math.max(...values) : 1;
    const span = Math.max(1, max - min);
    const chartPoints = points.map((item, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = 92 - ((Number(item.value) - min) / span) * 74;
      return { ...item, x, y };
    });
    const polyline = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");

    return (
      <div className="rounded-[1.35rem] border border-slate-100 bg-white/90 p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
              {title}
            </p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">
              {hasEnoughPoints ? `${points.length} plotted point${points.length === 1 ? "" : "s"}` : emptyText}
            </p>
          </div>
          {hasEnoughPoints ? (
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
              {roundTo(values[values.length - 1])}
              {suffix}
            </span>
          ) : null}
        </div>
        <div className="mt-3 h-32">
          {hasEnoughPoints ? (
            <svg viewBox="0 0 120 100" className="h-full w-full overflow-visible">
              <line x1="16" y1="92" x2="118" y2="92" stroke="#e2e8f0" strokeWidth="1" />
              <line x1="16" y1="18" x2="16" y2="92" stroke="#e2e8f0" strokeWidth="1" />
              {yAxisLabels.map((labelValue) => {
                const yPos = 92 - ((Number(labelValue) - min) / span) * 74;
                if (yPos < 16 || yPos > 94) return null;
                return (
                  <g key={`${title}-axis-${labelValue}`}>
                    <line x1="16" y1={yPos} x2="118" y2={yPos} stroke="#e2e8f0" strokeWidth="0.7" />
                    <text x="0" y={yPos + 2.5} className="fill-slate-400 text-[7px] font-bold">
                      {labelValue}
                      {suffix}
                    </text>
                  </g>
                );
              })}
              <polyline
                points={chartPoints.map((point) => `${16 + point.x * 1.02},${point.y}`).join(" ")}
                fill="none"
                stroke={stroke}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {chartPoints.map((point) => (
                <circle
                  key={`${title}-${point.label}-${point.value}`}
                  cx={16 + point.x * 1.02}
                  cy={point.y}
                  r="3.2"
                  fill={markerDrop && point.isDrop ? "#e11d48" : "#ffffff"}
                  stroke={markerDrop && point.isDrop ? "#e11d48" : stroke}
                  strokeWidth="2"
                />
              ))}
              {axisTitle ? (
                <text x="16" y="10" className="fill-slate-500 text-[7px] font-black uppercase tracking-wide">
                  {axisTitle}
                </text>
              ) : null}
            </svg>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 text-center text-xs font-semibold text-slate-500">
              {emptyText}
            </div>
          )}
        </div>
        {hasEnoughPoints ? (
          <div className="mt-2 flex justify-between text-[10px] font-bold text-slate-400">
            <span>{points[0]?.label}</span>
            <span>{points[points.length - 1]?.label}</span>
          </div>
        ) : null}
        {note ? (
          <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-600">
            {note}
          </p>
        ) : null}
      </div>
    );
  };

  const renderFluidBarGraph = () => {
    const data = reportTrendModel.graphs.fluid;
    const target = reportTrendModel.fluidTargetMl || 0;
    const values = data
      .filter((item) => item.hasData && item.value !== null)
      .map((item) => Number(item.value || 0));
    const foodEntriesForRange = recentEntries.filter(
      (entry) => entry.section === "Food Diary",
    );
    const fluidEntriesForRange = foodEntriesForRange.filter(
      (entry) => getFluidMlFromEntry(entry) > 0,
    );
    const totalFluidMl = values.reduce((sum, value) => sum + value, 0);
    const missingFluidAmounts =
      foodEntriesForRange.length > 0 && fluidEntriesForRange.length === 0;
    const max = Math.max(target, ...values, 1);
    const scaleTop = Math.ceil(max / 100) * 100 || 100;
    const scaleMid = Math.round(scaleTop / 2);

    return (
      <div className="rounded-[1.35rem] border border-sky-100 bg-white/90 p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
              Food and fluid trend
            </p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">
              {foodEntriesForRange.length
                ? `${foodEntriesForRange.length} food/drink entr${foodEntriesForRange.length === 1 ? "y" : "ies"} logged.`
                : "No food entries yet - start logging meals to build a daily picture."}
            </p>
          </div>
          {target ? (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700">
              target {target}ml
            </span>
          ) : null}
        </div>
        {target ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {normaliseHydrationCheckpoints(childProfile.hydrationCheckpoints).map(
              (checkpoint) => (
                <span
                  key={`report-hydration-${checkpoint.time}-${checkpoint.percent}`}
                  className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-sky-700"
                >
                  {checkpoint.percent}% by {checkpoint.time}
                </span>
              ),
            )}
          </div>
        ) : null}
        {values.length ? (
          <>
            <div className="mt-3 grid h-36 grid-cols-[38px_minmax(0,1fr)] gap-2">
              <div className="flex flex-col justify-between pb-5 text-right text-[10px] font-bold text-slate-400">
                <span>{scaleTop}ml</span>
                <span>{scaleMid}ml</span>
                <span>0ml</span>
              </div>
              <div className="relative flex min-w-0 items-end gap-1.5 overflow-hidden border-b border-slate-200 pb-5">
                <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-slate-200/80" />
                <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-slate-200/80" />
                {target ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 border-t border-sky-300"
                    style={{
                      bottom: `${20 + Math.min(100, (target / scaleTop) * 100) * 0.72}%`,
                    }}
                  />
                ) : null}
                {data.map((item) => {
                  const hasData = item.hasData && item.value !== null;
                  const height = hasData ? Math.max(8, (item.value / scaleTop) * 100) : 0;
                  const low = target ? hasData && item.value < target : false;
                  return (
                    <div key={`fluid-${item.label}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <div className="flex h-24 w-full items-end rounded-t-xl bg-sky-50 px-1 shadow-inner ring-1 ring-sky-100">
                        {hasData ? (
                          <div
                            className={`w-full max-w-8 rounded-t-lg shadow-sm ${low ? "bg-amber-500" : "bg-sky-500"}`}
                            style={{ height: `${height}%` }}
                          />
                        ) : null}
                      </div>
                      <span className="text-[10px] font-bold text-slate-400">{item.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
              Scale: ml per day
            </p>
            <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs font-semibold leading-5 text-sky-900">
              {Math.round(totalFluidMl)}ml fluid logged across {fluidEntriesForRange.length} drink entr{fluidEntriesForRange.length === 1 ? "y" : "ies"}.
            </p>
          </>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-sky-200 bg-sky-50/70 px-3 py-5 text-center text-xs font-semibold leading-5 text-slate-600">
            {missingFluidAmounts
              ? "Food or drink entries were logged, but fluid amounts have not been recorded yet."
              : "No food or drink records found for this period."}
          </div>
        )}
      </div>
    );
  };

  const renderMedicationConsistencyCard = () => {
    const graph = reportTrendModel.graphs.medication;
    const medicationEntriesForRange = recentEntries.filter(
      (entry) => entry.section === "Medication",
    );
    const statusCounts = medicationEntriesForRange.reduce(
      (counts, entry) => {
        const statusText = [
          entry.medicationStatus,
          entry.status,
          entry.summary,
          ...(entry.details || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (statusText.includes("missed")) counts.missed += 1;
        else if (statusText.includes("skipped") || statusText.includes("refused")) counts.skipped += 1;
        else if (statusText.includes("rescue") || statusText.includes("prn")) counts.prn += 1;
        else counts.given += 1;
        return counts;
      },
      { given: 0, missed: 0, skipped: 0, prn: 0 },
    );
    const width = graph.typical
      ? Math.max(0, Math.min(100, graph.percent))
      : medicationEntriesForRange.length
        ? 100
        : 0;
    const insight = medicationEntriesForRange.length
      ? graph.typical
        ? `${graph.logged} of ${graph.typical} expected doses logged.`
        : "Medication records are shown, but no required daily schedule is set for comparison."
      : "No medication records yet - add medication to track consistency.";

    return (
      <div className="rounded-[1.35rem] border border-rose-100 bg-white/90 p-3 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
          Medication pattern
        </p>
        <p className="mt-0.5 text-xs font-semibold text-slate-500">
          Medication entries over the selected period.
        </p>
        {medicationEntriesForRange.length ? (
          <>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-2xl font-black text-slate-950">
                  {medicationEntriesForRange.length}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-slate-500">
                  medication record{medicationEntriesForRange.length === 1 ? "" : "s"}
                </p>
              </div>
              {graph.typical ? (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                  {width}% logged
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                  schedule not set
                </span>
              )}
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-rose-500"
                style={{ width: `${width}%` }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-600">
              {[
                ["Given", statusCounts.given, "bg-emerald-50 text-emerald-700"],
                ["Missed", statusCounts.missed, "bg-rose-50 text-rose-700"],
                ["Skipped", statusCounts.skipped, "bg-amber-50 text-amber-700"],
                ["PRN/rescue", statusCounts.prn, "bg-violet-50 text-violet-700"],
              ]
                .filter(([, value]) => value > 0)
                .map(([label, value, className]) => (
                  <span key={label} className={`rounded-full px-2 py-1 ${className}`}>
                    {label}: {value}
                  </span>
                ))}
            </div>
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold leading-5 text-rose-900">
              {insight}
            </p>
          </>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-rose-200 bg-rose-50/70 px-3 py-5 text-center text-xs font-semibold text-slate-600">
            No medication records yet - add medication to track consistency.
          </div>
        )}
      </div>
    );
  };

  const renderToiletingPatternCard = () => {
    const data = reportTrendModel.graphs.toileting;
    const daysWithData = data.filter((item) => item.hasData && item.value !== null);
    const dailyChartData = data.map((item) => {
      const wetCount = Number(item.wet || 0);
      const bowelCount = Number(item.soiled || 0);
      const totalCount = item.hasData ? Number(item.value || 0) : 0;
      const otherCount = Math.max(0, totalCount - wetCount - bowelCount);
      const stackCount = Math.max(1, wetCount + bowelCount + otherCount);
      return {
        dateLabel: item.label,
        wetCount,
        bowelCount,
        otherCount,
        stackCount,
        totalCount,
        hasData: Boolean(item.hasData),
      };
    });
    const values = dailyChartData
      .filter((item) => item.hasData)
      .map((item) => item.totalCount);
    const typeTotals = daysWithData.reduce(
      (totals, item) => ({
        wet: totals.wet + Number(item.wet || 0),
        bowel: totals.bowel + Number(item.soiled || 0),
        accident: totals.accident + Number(item.accident || 0),
        dry: totals.dry + Number(item.dry || 0),
        other: totals.other + Number(item.other || 0),
      }),
      { wet: 0, bowel: 0, accident: 0, dry: 0, other: 0 },
    );
    const stackedMax = dailyChartData.reduce(
      (maxValue, item) => Math.max(maxValue, item.totalCount),
      1,
    );
    const totalEvents = values.reduce((sum, value) => sum + value, 0);
    const roundScaleTop = (value) => {
      if (value <= 2) return 2;
      if (value <= 10) return Math.ceil(value / 2) * 2;
      return Math.ceil(value / 5) * 5;
    };
    const scaleTop = roundScaleTop(Math.max(stackedMax, 1));
    const scaleMid = Math.round(scaleTop / 2);
    const busiestDay = daysWithData.length
      ? dailyChartData
          .filter((item) => item.hasData)
          .reduce(
            (busiest, item) =>
              item.totalCount > busiest.totalCount ? item : busiest,
            { dateLabel: "", totalCount: 0 },
          )
      : null;
    const bowelDays = dailyChartData.filter(
      (item) => item.hasData && item.bowelCount > 0,
    ).length;
    const patternInsight =
      daysWithData.length >= 2 && busiestDay?.totalCount
        ? `Most toileting activity recorded on ${busiestDay.dateLabel}. Bowel movements recorded on ${bowelDays} of ${daysWithData.length} logged day${daysWithData.length === 1 ? "" : "s"}.`
        : "Not enough data to identify patterns yet.";
    const timeBuckets = [
      ["Morning", data.reduce((sum, item) => sum + Number(item.morning || 0), 0)],
      ["Afternoon", data.reduce((sum, item) => sum + Number(item.afternoon || 0), 0)],
      ["Evening", data.reduce((sum, item) => sum + Number(item.evening || 0), 0)],
      ["Night", data.reduce((sum, item) => sum + Number(item.night || 0), 0)],
    ].filter(([, value]) => value > 0);
    const typeBadges = [
      ["Wet", typeTotals.wet, "bg-teal-600"],
      ["Bowel", typeTotals.bowel, "bg-orange-500"],
      ["Other", typeTotals.accident + typeTotals.dry + typeTotals.other, "bg-violet-500"],
    ].filter(([, value]) => value > 0);

    return (
      <div className="rounded-[1.35rem] border border-cyan-100 bg-white/90 p-3 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
          Toileting pattern
        </p>
        <p className="mt-0.5 text-xs font-semibold text-slate-500">
          {daysWithData.length
            ? `${totalEvents} toileting event${totalEvents === 1 ? "" : "s"} logged over ${daysWithData.length} day${daysWithData.length === 1 ? "" : "s"}.`
            : "No toileting data yet - logging this helps identify patterns"}
        </p>
        {daysWithData.length ? (
          <>
            <div className="mt-3 grid h-40 grid-cols-[34px_minmax(0,1fr)] gap-3">
              <div className="flex flex-col justify-between pb-5 text-right text-[10px] font-bold text-slate-400">
                <span>{scaleTop}</span>
                <span>{scaleMid}</span>
                <span>0</span>
              </div>
              <div className="relative flex min-w-0 items-end gap-2 overflow-visible border-b border-slate-200 pb-5">
                <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-slate-200/80" />
                <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-slate-200/80" />
                <div className="pointer-events-none absolute inset-x-0 bottom-5 border-t border-slate-200" />
                {dailyChartData.map((item) => {
                  const totalHeight = item.totalCount
                    ? Math.max(8, (item.totalCount / scaleTop) * 96)
                    : 0;
                  const segmentHeight = (count) =>
                    item.totalCount
                      ? Math.max(6, (Number(count || 0) / item.stackCount) * totalHeight)
                      : 0;

                  return (
                    <div
                      key={`toileting-${item.dateLabel}`}
                      className="group relative flex min-w-0 flex-1 flex-col items-center gap-1 outline-none"
                      tabIndex={0}
                      role="img"
                      aria-label={`${item.dateLabel}: ${item.totalCount} toileting events, ${item.wetCount} wet, ${item.bowelCount} bowel`}
                      title={`${item.dateLabel}: ${item.totalCount} total, ${item.wetCount} wet, ${item.bowelCount} bowel`}
                    >
                      <div className="flex h-28 w-full items-end justify-center rounded-t-xl bg-slate-100 px-1 shadow-inner ring-1 ring-slate-200/70">
                        {item.totalCount > 0 ? (
                          <div
                            className="flex w-full max-w-9 flex-col-reverse overflow-hidden rounded-t-lg shadow-md ring-1 ring-slate-900/5"
                            style={{ height: `${totalHeight}px` }}
                          >
                            {item.wetCount > 0 ? (
                              <div
                                className="bg-teal-600"
                                style={{ height: `${segmentHeight(item.wetCount)}px` }}
                              />
                            ) : null}
                            {item.bowelCount > 0 ? (
                              <div
                                className="bg-orange-500"
                                style={{ height: `${segmentHeight(item.bowelCount)}px` }}
                              />
                            ) : null}
                            {item.otherCount > 0 ? (
                              <div
                                className="bg-violet-500"
                                style={{ height: `${segmentHeight(item.otherCount)}px` }}
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <span className="text-[10px] font-bold text-slate-400">{item.dateLabel}</span>
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-36 -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-[11px] font-bold text-slate-700 shadow-lg group-hover:block group-focus:block">
                        <p className="text-slate-950">{item.dateLabel}</p>
                        <p>Total: {item.totalCount}</p>
                        <p>Wet: {item.wetCount}</p>
                        <p>Bowel: {item.bowelCount}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
              Scale: entries per day
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
              {typeBadges.map(([label, value, className]) => (
                <span key={label} className="inline-flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${className}`} /> {label}: {value}
                </span>
              ))}
            </div>
            <p className="mt-3 rounded-xl bg-cyan-50 px-3 py-2 text-xs font-semibold leading-5 text-cyan-900">
              {patternInsight}
            </p>
          </>
        ) : (
          <div className="mt-3 flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 text-center text-xs font-semibold text-slate-500">
            No toileting data yet - logging this helps identify patterns
          </div>
        )}
        {timeBuckets.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {timeBuckets.map(([label, value]) => (
              <span
                key={label}
                className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600"
              >
                {label}: {value}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderReportStreaks = () => (
    <div className="flex flex-wrap gap-1.5">
      {reportTrendModel.streaks.map((streak) => (
        <span
          key={streak.label}
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${streak.tone}`}
        >
          {streak.label}
        </span>
      ))}
    </div>
  );

  const renderReportChartCards = (mode = "screen") => (
    <section
      data-report-pdf-card={mode === "pdf" ? "full" : undefined}
      className={`rounded-2xl border border-slate-200 bg-white ${compactSectionPadding(
        mode,
      )}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-black text-slate-950">
            Graphs and patterns
          </h3>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">
            Simple visual checks for this report range
          </p>
        </div>
      </div>
      <div className={`mt-3 grid gap-3 ${mode === "pdf" ? "grid-cols-2" : "lg:grid-cols-2"}`}>
        {renderFluidBarGraph()}
        {renderMedicationConsistencyCard()}
        {renderLineGraphCard({
          title: "Sleep",
        data: reportTrendModel.graphs.sleep,
        suffix: "h",
        stroke: "#6366f1",
        minPoints: 1,
        emptyText: "No completed sleep logs available",
        axisTitle: "Hours",
        yAxisLabels: [0, 2, 4, 6, 8, 10, 12],
        yMin: 0,
        yMax: 12,
      })}
        {renderToiletingPatternCard()}
      </div>
    </section>
  );

  const renderDataCompletenessSection = (mode = "screen") => (
    <section
      data-report-pdf-card="half"
      className={`rounded-2xl border border-slate-200 bg-white ${compactSectionPadding(
        mode,
      )}`}
    >
      <h3 className="text-base font-black text-slate-950">
        Data Completeness
      </h3>
      <p className="mt-1 text-sm font-semibold text-slate-500">
        This shows how much evidence is available for the selected range.
      </p>
      <div
        className={`mt-3 grid gap-2 ${
          mode === "pdf" ? "grid-cols-4" : "grid-cols-2 lg:grid-cols-4"
        }`}
      >
        {reportTrendModel.dataCompleteness.map((item) => (
          <div
            key={item.label}
            className={`rounded-xl border px-3 py-2 ${statToneClass(item.tone)}`}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
              {item.label}
            </p>
            <p className="mt-1 text-sm font-black text-slate-950">
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );

  const renderShareableCareReport = ({
    mode = "screen",
    forceFull = false,
    detailedOnly = false,
  } = {}) => {
    const isPdf = mode === "pdf";
    const includeFullTimeline = forceFull || reportType === "full";
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
          <div className={`${isPdf ? "mt-2" : "mt-2"} grid gap-1.5 text-sm font-semibold text-slate-700 sm:grid-cols-2`}>
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

        {!detailedOnly ? (
          <>
            {renderReportSummaryStatsRow(mode)}

            <section
              data-report-pdf-card="half"
              className={`rounded-2xl border border-slate-200 bg-white ${compactSectionPadding(mode)}`}
            >
              <h3 className="text-base font-black text-slate-950">
                Insights
              </h3>
              <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-700">
                {reportTrendModel.insights.map((observation) => (
                  <li key={observation} className="rounded-xl bg-slate-50 px-3 py-2">
                    {observation}
                  </li>
                ))}
              </ul>
            </section>
            {showReportCharts ? renderReportChartCards(mode) : null}
            {renderDataCompletenessSection(mode)}
          </>
        ) : null}

        {includeFullTimeline && reportImportantEvents.length ? (
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

        {detailedOnly ? (
          <section
            data-report-pdf-card="half"
            className={`rounded-2xl border border-slate-200 bg-white ${compactSectionPadding(mode)}`}
          >
            <h3 className="text-base font-black text-slate-950">
              Category breakdown
            </h3>
            <div className={`mt-2 grid gap-2 ${isPdf ? "grid-cols-5" : "grid-cols-2 lg:grid-cols-5"}`}>
              {renderSummaryCard("Food", quickReportSummary.food, mode)}
              {renderSummaryCard("Medication", quickReportSummary.medication, mode)}
              {renderSummaryCard("Sleep", quickReportSummary.sleep, mode)}
              {renderSummaryCard("Toileting", quickReportSummary.toileting, mode)}
              {renderSummaryCard("Health", quickReportSummary.health, mode)}
            </div>
          </section>
        ) : null}

        {includeFullTimeline ? (
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
        {renderShareableCareReport({ mode: "pdf", forceFull: true })}
      </div>
    </div>
  );

  const renderReportFilterControls = ({
    reportInputClassName,
    showDetailedOptions = false,
  }) => (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Child</label>
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
            Category
          </label>
          <select
            className={reportInputClassName}
            value={reportCategoryFilter}
            onChange={(event) => setReportCategoryFilter(event.target.value)}
          >
            {renderReportCategoryOptions()}
          </select>
        </div>
        {showDetailedOptions ? (
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
        ) : (
          <label className={`${cardClassName} flex items-center gap-3 text-sm font-bold text-slate-700`}>
            <input
              type="checkbox"
              checked={showReportCharts}
              onChange={(event) => setShowReportCharts(event.target.checked)}
              className="h-4 w-4"
            />
            Show graphs
          </label>
        )}
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
    </>
  );

  const renderTrendsDashboard = ({ reportInputClassName, invalidCustomRange }) => (
    <div className="mt-6 space-y-4">
      <section className="rounded-[1.75rem] border border-sky-100 bg-sky-50 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">
              Reports
            </p>
            <h3 className="mt-1 text-xl font-black text-slate-950">
              Report Trends
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              EHCP-friendly evidence for ongoing patterns, routines and support needs.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setReportView("detailed");
              setReportType("full");
            }}
            className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
          >
            View Reports
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:max-w-xl lg:grid-cols-2">
          <button
            type="button"
            onClick={() => handleExportPdf("trends")}
            disabled={isExportingPdf || invalidCustomRange}
            className="rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm font-black text-sky-700 shadow-sm transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isExportingPdf ? "Exporting..." : "Export Trends PDF"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!useSaasApi) {
                showToast?.({
                  message: "Email sending is not set up yet. You can still download the PDF.",
                  type: "info",
                });
                return;
              }
              setReportEmailForm((current) => ({
                ...current,
                attachmentType: "trends",
              }));
              setIsReportEmailOpen(true);
            }}
            disabled={invalidCustomRange}
            className="rounded-2xl bg-sky-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Email Trends
          </button>
        </div>

        <div className="mt-4">
          {renderReportFilterControls({ reportInputClassName })}
        </div>

        {invalidCustomRange ? (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            End date must be on or after the start date.
          </div>
        ) : null}
      </section>

      {renderReportSummaryStatsRow()}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
          <h3 className="text-base font-black text-slate-950">
            Insights
          </h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              Clear statements are used where the data supports them. Limited data is labelled clearly.
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {reportTrendModel.insights.map((observation) => (
            <div
              key={observation}
              className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-700"
            >
              {observation}
            </div>
          ))}
        </div>
      </section>

      {showReportCharts ? renderReportChartCards() : null}
      {renderDataCompletenessSection()}
    </div>
  );

  const renderReportEmailModal = (reportInputClassName) =>
    isReportEmailOpen ? (
      <div className="fixed inset-0 z-[70] flex items-end bg-slate-950/45 p-3 sm:items-center sm:justify-center">
        <form
          className="w-full rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-2xl sm:max-w-md"
          onSubmit={sendReportByEmail}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-slate-950">
                Email report
              </h3>
              <p className="mt-1 text-sm font-medium text-slate-600">
                Choose which PDF to attach before sending.
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
            Attachment type
            <select
              className={reportInputClassName}
              value={reportEmailForm.attachmentType}
              onChange={(event) =>
                setReportEmailForm((current) => ({
                  ...current,
                  attachmentType: event.target.value,
                }))
              }
            >
          <option value="trends">Report Trends PDF</option>
          <option value="full">Reports PDF</option>
            </select>
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
            Child: {childName}. Range: {reportRangeLabel}. Filter:{" "}
            {reportCategoryFilter}.
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
              {isSendingReportEmail ? "Sending..." : "Send email"}
            </button>
          </div>
        </form>
      </div>
    ) : null;

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

  const snapshotStatToneClass = (tone) => {
    const classes = {
      indigo: "border-indigo-100 bg-indigo-50 text-indigo-900",
      sky: "border-sky-100 bg-sky-50 text-sky-900",
      rose: "border-rose-100 bg-rose-50 text-rose-900",
      cyan: "border-cyan-100 bg-cyan-50 text-cyan-900",
    };
    return classes[tone] || "border-slate-100 bg-slate-50 text-slate-900";
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

        <section
          data-snapshot-pdf-card="full"
          className={`pdf-avoid-break border border-slate-200 bg-white ${
            isPdf ? "rounded-xl p-2.5" : "rounded-2xl p-3"
          }`}
        >
          <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-700">
            Summary Stats
          </h4>
          <div
            className={`mt-2 grid gap-2 ${
              isPdf ? "grid-cols-4" : "grid-cols-2 lg:grid-cols-4"
            }`}
          >
            {snapshotSummaryStats.map((stat) => (
              <div
                key={stat.key}
                className={`rounded-xl border px-2.5 py-2 ${snapshotStatToneClass(
                  stat.tone,
                )}`}
              >
                <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                  {stat.label}
                </p>
                <p className={`${isPdf ? "text-xs" : "text-sm"} mt-1 font-black text-slate-950`}>
                  {stat.value}
                </p>
                <p className="mt-0.5 text-[11px] font-bold leading-4 text-slate-600">
                  {stat.meta}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className={`${isPdf ? "grid grid-cols-2 gap-2" : "grid gap-2 md:grid-cols-2"}`}>
          <div
            data-snapshot-pdf-card="half"
            className={`pdf-avoid-break border border-sky-200 bg-sky-50 ${isPdf ? "rounded-xl p-2.5" : "rounded-2xl p-3"}`}
          >
            <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-sky-800">
              Simple trend summary
            </h4>
            <div className="mt-2 grid gap-2">
              {snapshotTrendSummary.map((item) => (
                <p
                  key={item.label}
                  className="rounded-xl bg-white/85 px-2.5 py-2 text-sm font-semibold text-slate-700"
                >
                  <span className="font-black text-slate-900">{item.label}:</span>{" "}
                  {item.text}
                </p>
              ))}
            </div>
          </div>
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
          {isModuleEnabled("medication") ? (
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
                    {medicine.requiredDaily ? (
                      <p>
                        Required {medicationScheduleLabel(medicine)}
                        {medicine.timeWindow ? ` - ${medicine.timeWindow}` : ""}
                      </p>
                    ) : null}
                    {medicine.notes ? <p>Notes: {medicine.notes}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-700">Not added</p>
            )}
          </div>
          ) : null}
        </section>

        <section className={`${isPdf ? "grid grid-cols-2 gap-2" : "grid gap-2 md:grid-cols-2"}`}>
          {shareSections.medication && isModuleEnabled("medication")
            ? renderSnapshotList(
                "Medication logs",
                snapshotBySection.medication,
                "rose",
                5,
                mode,
              )
            : null}
          {shareSections.food && (isModuleEnabled("food") || isModuleEnabled("drink"))
            ? renderSnapshotList(
                "Food / drink",
                snapshotBySection.food,
                "amber",
                4,
                mode,
              )
            : null}
          {shareSections.sleep && isModuleEnabled("sleep")
            ? renderSnapshotList("Sleep", snapshotBySection.sleep, "indigo", 3, mode)
            : null}
          {shareSections.toileting && isModuleEnabled("toileting")
            ? renderSnapshotList(
                "Toileting",
                snapshotBySection.toileting,
                "sky",
                4,
                mode,
              )
            : null}
          {shareSections.health && isModuleEnabled("health")
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
            {Object.entries(shareSections)
              .filter(([key]) => {
                if (key === "food") {
                  return isModuleEnabled("food") || isModuleEnabled("drink");
                }
                if (["medication", "sleep", "toileting", "health"].includes(key)) {
                  return isModuleEnabled(key);
                }
                return true;
              })
              .map(([key, value]) => (
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

  const openTimelineLinkedSection = (item) => {
    if (item.id === "timeline-care-snapshot") {
      openSection(sections.find((section) => section.title === "Care Snapshot"), {
        reset: false,
      });
      return;
    }
    if (item.id === "timeline-full-report") {
      openSection(sections.find((section) => section.title === "Reports"), {
        reset: false,
      });
      return;
    }

    const targetTitle =
      item.category === "Documents"
        ? "Document Vault"
        : item.category === "Reports / Snapshot"
          ? "Reports"
          : item.category;
    openSection(sections.find((section) => section.title === targetTitle), {
      reset: false,
    });
  };

  const renderUnifiedTimelineForm = () => (
    <div className="mt-6 space-y-4">
      <section className="rounded-[1.75rem] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-700">
              Unified Timeline
            </p>
            <h3 className="mt-1 text-lg font-extrabold text-slate-950">
              Search everything for this family
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              One chronological view for logs, appointments, documents and
              report shortcuts. Results stay family-specific and use the same
              secure app data as the rest of FamilyTrack.
            </p>
          </div>
          <button
            type="button"
            onClick={loadUnifiedTimelineData}
            disabled={isLoadingTimeline}
            className="w-fit rounded-2xl border border-indigo-100 bg-white px-4 py-2.5 text-sm font-black text-indigo-700 shadow-sm disabled:opacity-60"
          >
            {isLoadingTimeline ? "Loading..." : "Refresh timeline"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
          <label className="min-w-0 text-sm font-bold text-slate-700">
            Global search
            <input
              type="search"
              value={timelineFilters.search}
              onChange={(event) =>
                setTimelineFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
              placeholder="Search notes, triggers, documents, medicines..."
              className={inputClassName}
            />
          </label>
          <label className="min-w-0 text-sm font-bold text-slate-700">
            Child
            <select
              value={timelineFilters.childId}
              onChange={(event) =>
                setTimelineFilters((current) => ({
                  ...current,
                  childId: event.target.value,
                }))
              }
              className={inputClassName}
            >
              <option value="all">All children</option>
              {children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.firstName || child.first_name || "Child"}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-sm font-bold text-slate-700">
            Date range
            <select
              value={timelineFilters.range}
              onChange={(event) =>
                setTimelineFilters((current) => ({
                  ...current,
                  range: event.target.value,
                }))
              }
              className={inputClassName}
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="all">All history</option>
            </select>
          </label>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-bold text-slate-700">
            Module / category
            <select
              value={timelineFilters.category}
              onChange={(event) =>
                setTimelineFilters((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
              className={inputClassName}
            >
              {timelineCategoryOptions
                .filter((category) => {
                  if (category === "All" || category === "Reports / Snapshot") {
                    return true;
                  }
                  if (category === "Documents") return isModuleEnabled("documents");
                  return reportCategoryOptions.includes(category);
                })
                .map((category) => (
                  <option key={category} value={category}>
                    {category === "Food Diary" ? "Food and drink" : category}
                  </option>
                ))}
            </select>
          </label>
          <label className="min-w-0 text-sm font-bold text-slate-700">
            Severity / type
            <select
              value={timelineFilters.severity}
              onChange={(event) =>
                setTimelineFilters((current) => ({
                  ...current,
                  severity: event.target.value,
                }))
              }
              className={inputClassName}
            >
              <option value="All">All types</option>
              <option value="high-behaviour">Behaviour severity 4-5</option>
              <option value="meltdown">Meltdown</option>
              <option value="shutdown">Shutdown</option>
              <option value="missed">Missed medication</option>
              <option value="hospital">Hospital</option>
              <option value="school">School</option>
              <option value="ehcp">EHCP</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-base font-black text-slate-950">
              Timeline results
            </h4>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {isLoadingTimeline
                ? "Loading family timeline..."
                : `${unifiedTimelineItems.length} item${
                    unifiedTimelineItems.length === 1 ? "" : "s"
                  } found`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {["Food Diary", "Medication", "Behaviour", "Documents"].map((category) => {
              const theme = getTimelineTheme(category);
              const count = unifiedTimelineItems.filter(
                (item) => item.category === category,
              ).length;
              return (
                <span
                  key={category}
                  className={`rounded-full border bg-white px-3 py-1 text-xs font-black ${theme.text}`}
                >
                  {theme.label}: {count}
                </span>
              );
            })}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {unifiedTimelineItems.length ? (
            unifiedTimelineItems.map((item) => {
              const theme = getTimelineTheme(item.category);
              const itemDate = getTimelineDate(item);
              const isExpanded = expandedTimelineItem === item.id;
              return (
                <article
                  key={item.id}
                  className={`rounded-2xl border p-3 shadow-sm ${theme.card}`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedTimelineItem((current) =>
                        current === item.id ? "" : item.id,
                      )
                    }
                    className="flex w-full min-w-0 items-start gap-3 text-left"
                  >
                    <span className="flex flex-none flex-col items-center gap-1">
                      <span className={`h-3 w-3 rounded-full ${theme.dot}`} />
                      <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-tight text-slate-500">
                        {theme.icon}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`text-[11px] font-black uppercase tracking-[0.16em] ${theme.text}`}>
                          {theme.label}
                        </span>
                        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-slate-500">
                          {item.childName || childName}
                        </span>
                      </span>
                      <span className="mt-1 block break-words text-sm font-black text-slate-950">
                        {item.title}
                      </span>
                      <span className="mt-1 block text-xs font-semibold text-slate-500">
                        {itemDate.toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                    <span className="rounded-full border border-white/80 bg-white/80 px-2 py-1 text-xs font-black text-slate-500">
                      {isExpanded ? "Hide" : "Details"}
                    </span>
                  </button>

                  {isExpanded ? (
                    <div className="mt-3 rounded-xl border border-white/80 bg-white/80 p-3">
                      <p className="text-sm font-semibold leading-6 text-slate-700">
                        {item.summary}
                      </p>
                      {item.details?.length ? (
                        <ul className="mt-2 space-y-1 text-sm font-medium leading-6 text-slate-600">
                          {item.details.map((detail, index) => (
                            <li key={`${item.id}-detail-${index}`}>{detail}</li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openTimelineLinkedSection(item)}
                          className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white shadow-sm"
                        >
                          Open related section
                        </button>
                        {item.kind === "document" && item.document?.downloadUrl ? (
                          <a
                            href={item.document.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm"
                          >
                            View / download document
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm font-black text-slate-800">
                No timeline items match these filters.
              </p>
              <p className="mt-1 text-sm font-medium text-slate-500">
                Try widening the date range or clearing the search term.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
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

  const renderDocumentVaultForm = () => (
    <div className="mt-6 space-y-4">
      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
              Secure storage
            </p>
            <h3 className="mt-1 text-lg font-extrabold text-slate-950">
              Document Vault
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              Store important EHCP, school, hospital, diagnosis and care
              documents privately for this family. Turning this section off only
              hides it; uploaded documents stay safe.
            </p>
          </div>
          <span className="w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-600">
            {documents.length} document{documents.length === 1 ? "" : "s"}
          </span>
        </div>
      </section>

      <form
        onSubmit={handleDocumentUpload}
        className="rounded-[1.75rem] border border-blue-100 bg-blue-50/70 p-4 shadow-sm"
      >
        <h4 className="font-black text-slate-950">Upload document</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-bold text-slate-700">
            Title
            <input
              className={inputClassName}
              value={documentForm.title}
              onChange={(event) =>
                setDocumentForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="e.g. EHCP review letter"
              required
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            Category
            <select
              className={inputClassName}
              value={documentForm.category}
              onChange={(event) =>
                setDocumentForm((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
            >
              {DOCUMENT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold text-slate-700">
            Child
            <select
              className={inputClassName}
              value={documentForm.childId}
              onChange={(event) =>
                setDocumentForm((current) => ({
                  ...current,
                  childId: event.target.value,
                }))
              }
            >
              <option value="">Family document</option>
              {children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.firstName || child.first_name || "Child"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold text-slate-700">
            Document date
            <input
              type="date"
              className={inputClassName}
              value={documentForm.documentDate}
              onChange={(event) =>
                setDocumentForm((current) => ({
                  ...current,
                  documentDate: event.target.value,
                }))
              }
            />
          </label>
          <label className="text-sm font-bold text-slate-700 md:col-span-2">
            File
            <input
              type="file"
              accept={DOCUMENT_ACCEPT}
              className={`${inputClassName} file:mr-3 file:rounded-xl file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-black file:text-white`}
              onChange={(event) =>
                setDocumentForm((current) => ({
                  ...current,
                  file: event.target.files?.[0] || null,
                }))
              }
              required
            />
          </label>
          <label className="text-sm font-bold text-slate-700 md:col-span-2">
            Notes
            <textarea
              className={`${inputClassName} min-h-24`}
              value={documentForm.notes}
              onChange={(event) =>
                setDocumentForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder="Optional notes about this document"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={isUploadingDocument || !documentForm.title.trim() || !documentForm.file}
          className="mt-4 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {isUploadingDocument ? "Uploading..." : "Save document"}
        </button>
      </form>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm font-bold text-slate-700">
            Search
            <input
              className={inputClassName}
              value={documentFilters.search}
              onChange={(event) =>
                setDocumentFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
              placeholder="Search title, file or notes"
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            Child
            <select
              className={inputClassName}
              value={documentFilters.childId}
              onChange={(event) =>
                setDocumentFilters((current) => ({
                  ...current,
                  childId: event.target.value,
                }))
              }
            >
              <option value="">All children/family</option>
              {children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.firstName || child.first_name || "Child"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold text-slate-700">
            Category
            <select
              className={inputClassName}
              value={documentFilters.category}
              onChange={(event) =>
                setDocumentFilters((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
            >
              <option value="All">All categories</option>
              {DOCUMENT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 space-y-3">
          {isLoadingDocuments ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-5 text-center text-sm font-bold text-slate-500">
              Loading documents...
            </div>
          ) : documents.length ? (
            documents.map((document) => (
              <article
                key={document.id}
                className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                        {document.category}
                      </span>
                      {document.childName ? (
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-blue-700">
                          {document.childName}
                        </span>
                      ) : null}
                    </div>
                    <h4 className="mt-2 break-words text-base font-black text-slate-950">
                      {document.title}
                    </h4>
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      {[document.documentDate, document.fileName, formatFileSize(document.fileSizeBytes)]
                        .filter(Boolean)
                        .join(" • ")}
                    </p>
                    {document.notes ? (
                      <p className="mt-2 break-words text-sm leading-6 text-slate-600">
                        {document.notes}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <a
                      href={api.documentDownloadUrl(familyId, document.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white shadow-sm"
                    >
                      View / download
                    </a>
                    {!isReadOnly ? (
                      <button
                        type="button"
                        onClick={() => deleteDocument(document)}
                        className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-700"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
              <p className="font-black text-slate-800">No documents found</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Upload EHCP, diagnosis, hospital, school or care documents here
                when you need one secure place to keep them.
              </p>
            </div>
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
                    {renderReportCategoryOptions()}
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
                    {renderReportCategoryOptions()}
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
                    {renderReportCategoryOptions()}
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

    const sortEntriesByDate = (entries = []) =>
      [...entries].sort((entryA, entryB) => {
        const dateA = getEntryDateTime(entryA)?.getTime() || 0;
        const dateB = getEntryDateTime(entryB)?.getTime() || 0;
        return dateA - dateB;
      });

    const foodEntries = sortEntriesByDate(groupedReportEntries["Food Diary"] || []);
    const medicationEntries = sortEntriesByDate(groupedReportEntries.Medication || []);
    const sleepEntries = sortEntriesByDate(groupedReportEntries.Sleep || []);
    const toiletingEntries = sortEntriesByDate(groupedReportEntries.Toileting || []);
    const behaviourEntries = sortEntriesByDate(groupedReportEntries.Behaviour || []);
    const appointmentEntries = sortEntriesByDate(groupedReportEntries.Appointments || []);
    const healthEntries = sortEntriesByDate(
      (groupedReportEntries.Health || []).filter((entry) => !isMeasurementEntry(entry)),
    );
    const measurementEntries = sortEntriesByDate(recentEntries.filter(isMeasurementEntry));
    const notesEntries = sortEntriesByDate(groupedReportEntries["General Notes"] || []);
    const dataCompleteness = dailyReportGroups.length
      ? `${dailyReportGroups.length} day${dailyReportGroups.length === 1 ? "" : "s"} with entries`
      : "Not enough data yet - log a few days to generate a full report";
    const sleepStat = reportTrendModel.summaryStats.find((item) => item.key === "sleep");
    const medicationStat = reportTrendModel.summaryStats.find((item) => item.key === "medication");
    const incompleteSleepEntries = sleepEntries.filter(
      (entry) => !Number(entry.durationMinutes || 0),
    );
    const completedSleepValues = reportTrendModel.graphs.sleep
      .filter(
        (item) =>
          item?.hasData !== false &&
          item?.value !== null &&
          Number.isFinite(Number(item.value)),
      )
      .map((item) => Number(item.value));
    const maxSleepHours = completedSleepValues.length
      ? Math.max(...completedSleepValues)
      : 0;
    const sleepAxisMax = Math.max(12, Math.ceil(maxSleepHours / 2) * 2);
    const sleepAxisLabels = Array.from(
      { length: Math.floor(sleepAxisMax / 2) + 1 },
      (_, index) => index * 2,
    );
    const sleepInsight =
      completedSleepValues.length >= 2
        ? `Completed sleep entries range from ${roundTo(Math.min(...completedSleepValues))}h to ${roundTo(Math.max(...completedSleepValues))}h.`
        : completedSleepValues.length === 1
          ? "One completed sleep entry is available for this period."
          : "Not enough completed sleep entries to show a trend.";

    const summaryCards = [
      {
        label: "Total entries",
        value: recentEntries.length || "No entries",
        meta: reportCategoryFilter === "All" ? "All categories" : reportCategoryLabel(reportCategoryFilter),
        tone: "border-slate-100 bg-white/90 text-slate-800",
      },
      {
        label: "Date range covered",
        value: reportRangeLabel,
        meta: dataCompleteness,
        tone: "border-sky-100 bg-sky-50/80 text-sky-900",
      },
      {
        label: "Data completeness",
        value: dataCompleteness,
        meta: "Based on days with logged entries",
        tone: "border-indigo-100 bg-indigo-50/80 text-indigo-900",
      },
      {
        label: "Sleep average",
        value: sleepStat?.value || "No sleep data",
        meta: sleepStat?.meta || "No completed sleep entries",
        tone: "border-violet-100 bg-violet-50/80 text-violet-900",
      },
      {
        label: "Medication consistency",
        value: medicationStat?.value || "No medication data",
        meta: medicationStat?.meta || "No medication schedule set",
        tone: "border-rose-100 bg-rose-50/80 text-rose-900",
      },
      {
        label: "Food and fluid",
        value: foodEntries.length || "No entries",
        meta: `${foodEntries.length} food/drink entr${foodEntries.length === 1 ? "y" : "ies"}`,
        tone: "border-emerald-100 bg-emerald-50/80 text-emerald-900",
      },
      {
        label: "Toileting",
        value: toiletingEntries.length || "No entries",
        meta: `${toiletingEntries.length} toileting entr${toiletingEntries.length === 1 ? "y" : "ies"}`,
        tone: "border-cyan-100 bg-cyan-50/80 text-cyan-900",
      },
      {
        label: "Behaviour",
        value: behaviourEntries.length || "No entries",
        meta: `${behaviourEntries.length} behaviour entr${behaviourEntries.length === 1 ? "y" : "ies"}`,
        tone: "border-purple-100 bg-purple-50/80 text-purple-900",
      },
      {
        label: "Appointments",
        value: appointmentEntries.length || "No entries",
        meta: `${appointmentEntries.length} appointment${appointmentEntries.length === 1 ? "" : "s"}`,
        tone: "border-blue-100 bg-blue-50/80 text-blue-900",
      },
      {
        label: "Health",
        value: healthEntries.length || "No entries",
        meta: `${healthEntries.length} health entr${healthEntries.length === 1 ? "y" : "ies"}`,
        tone: "border-amber-100 bg-amber-50/80 text-amber-900",
      },
    ];

    const insightLines = uniqueList([
      sleepEntries.length
        ? `Sleep was logged on ${
            new Set(sleepEntries.map((entry) => entry.date)).size
          } day${new Set(sleepEntries.map((entry) => entry.date)).size === 1 ? "" : "s"}.`
        : "",
      medicationEntries.length
        ? medicationStat?.value?.includes("of")
          ? `Medication records show ${medicationStat.value} expected doses logged.`
          : "Medication entries were logged for this period."
        : "",
      foodEntries.length
        ? `${foodEntries.length} food or fluid entr${foodEntries.length === 1 ? "y was" : "ies were"} logged.`
        : "",
      behaviourEntries.length
        ? `${behaviourEntries.length} behaviour entr${behaviourEntries.length === 1 ? "y was" : "ies were"} logged, including triggers and recovery notes where available.`
        : "",
      appointmentEntries.length
        ? `${appointmentEntries.length} appointment${appointmentEntries.length === 1 ? " was" : "s were"} recorded in this period.`
        : "",
      healthEntries.length
        ? `${healthEntries.length} health entr${healthEntries.length === 1 ? "y was" : "ies were"} logged in this period.`
        : "No health concerns were logged in this period.",
      ...reportTrendModel.insights.filter(
        (insight) => insight && !insight.toLowerCase().startsWith("not enough"),
      ),
    ])
      .filter(Boolean)
      .slice(0, 5);

    const displayInsights = insightLines.length
      ? insightLines
      : ["Not enough data yet - log a few days to generate a full report."];

    const renderTrendInfoCard = ({
      title,
      description,
      value,
      meta,
      tone = "border-slate-100 bg-white/85",
    }) => (
      <div className={`rounded-[1.35rem] border p-4 shadow-sm ${tone}`}>
        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
          {title}
        </p>
        <p className="mt-2 text-lg font-black text-slate-950">
          {value}
        </p>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          {description}
        </p>
        {meta ? (
          <p className="mt-3 rounded-xl bg-white/75 px-3 py-2 text-xs font-bold text-slate-600">
            {meta}
          </p>
        ) : null}
      </div>
    );

    const renderPatternInsightsSection = () => (
      <section className="rounded-[1.75rem] border border-purple-100 bg-gradient-to-br from-purple-50/80 via-white to-sky-50/70 p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-purple-700">
              Pattern Insights
            </p>
            <h3 className="mt-1 text-xl font-black text-slate-950">
              Worth noting from the logs
            </h3>
          </div>
          <p className="text-xs font-bold leading-5 text-slate-500">
            Factual summaries only, not diagnosis.
          </p>
        </div>

        {patternInsights.length ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {patternInsights.map((insight) => (
              <article
                key={insight.id}
                className={`rounded-[1.35rem] border p-4 shadow-sm ${insight.tone}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      {insight.title}
                    </p>
                    <p className="mt-2 text-sm font-black leading-6 text-slate-950">
                      {insight.message}
                    </p>
                    <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
                      {insight.detail}
                    </p>
                  </div>
                  <span className="w-fit shrink-0 rounded-full bg-white/75 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                    {insight.relatedCount} log{insight.relatedCount === 1 ? "" : "s"}
                  </span>
                </div>
                {insight.section ? (
                  <button
                    type="button"
                    onClick={() => setReportCategoryFilter(insight.section)}
                    className="mt-3 rounded-xl border border-white/80 bg-white/85 px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:bg-white"
                  >
                    View related {reportCategoryLabel(insight.section).toLowerCase()} logs
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-[1.35rem] border border-dashed border-purple-200 bg-white/75 px-4 py-6 text-center">
            <p className="text-sm font-black text-slate-800">
              Not enough data to show reliable patterns yet.
            </p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
              Keep logging sleep, fluids, medication and behaviour entries. FamilyTrack will show simple patterns once there is enough to compare.
            </p>
          </div>
        )}
      </section>
    );

    const getEntrySearchText = (entry) =>
      [
        entry.type,
        entry.category,
        entry.event,
        entry.toiletingType,
        entry.result,
        entry.medicationStatus,
        entry.status,
        entry.intakeStatus,
        entry.summary,
        ...(entry.details || []),
        entry.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    const makeEntryBadge = (label, className) => ({ label, className });

    const getEntryBadges = (entry, sectionTitle) => {
      const text = getEntrySearchText(entry);
      const badges = [];

      if (sectionTitle === "Medication") {
        if (text.includes("rescue") || text.includes("prn")) {
          badges.push(makeEntryBadge("PRN / rescue", "bg-violet-100 text-violet-700"));
        }
        if (text.includes("missed")) {
          badges.push(makeEntryBadge("Missed", "bg-rose-100 text-rose-700"));
        } else if (text.includes("skipped") || text.includes("refused")) {
          badges.push(makeEntryBadge("Skipped/refused", "bg-amber-100 text-amber-700"));
        } else {
          badges.push(makeEntryBadge("Logged", "bg-emerald-100 text-emerald-700"));
        }
      }

      if (sectionTitle === "Health") {
        [
          ["seizure", "Seizure"],
          ["illness", "Illness"],
          ["temperature", "Temperature"],
          ["fever", "Temperature"],
          ["pain", "Pain"],
          ["concern", "Concern"],
        ].forEach(([keyword, label]) => {
          if (text.includes(keyword) && !badges.some((badge) => badge.label === label)) {
            badges.push(makeEntryBadge(label, "bg-rose-100 text-rose-700"));
          }
        });
      }

      if (sectionTitle === "Behaviour") {
        if (entry.severity) {
          badges.push(makeEntryBadge(`Severity ${entry.severity}/5`, "bg-purple-100 text-purple-700"));
        }
        if (entry.triggers?.length) {
          badges.push(makeEntryBadge(`${entry.triggers.length} trigger${entry.triggers.length === 1 ? "" : "s"}`, "bg-amber-100 text-amber-700"));
        }
      }

      if (sectionTitle === "Appointments") {
        if (entry.appointmentCategory) {
          badges.push(makeEntryBadge(entry.appointmentCategory, "bg-blue-100 text-blue-700"));
        }
        if (entry.outcome) {
          badges.push(makeEntryBadge("Follow-up noted", "bg-emerald-100 text-emerald-700"));
        }
      }

      if (sectionTitle === "Toileting") {
        const hasWet = /\b(wet|wee|urine)\b/.test(text);
        const hasBowel = /\b(bowel|poo|stool|soiled|bm)\b/.test(text);
        if (hasWet) badges.push(makeEntryBadge("Wet", "bg-cyan-100 text-cyan-700"));
        if (hasBowel) badges.push(makeEntryBadge("Bowel", "bg-orange-100 text-orange-700"));
        if (text.includes("accident") || text.includes("leak")) {
          badges.push(makeEntryBadge("Accident", "bg-rose-100 text-rose-700"));
        }
        if (text.includes("dry")) {
          badges.push(makeEntryBadge("Dry", "bg-emerald-100 text-emerald-700"));
        }
      }

      if (sectionTitle === "Food & Drink") {
        const fluidMl = getFluidMlFromEntry(entry);
        if (fluidMl > 0) {
          badges.push(makeEntryBadge(`${Math.round(fluidMl)}ml`, "bg-sky-100 text-sky-700"));
        }
        if (entry.intakeStatus) {
          badges.push(
            makeEntryBadge(
              String(entry.intakeStatus),
              "bg-emerald-100 text-emerald-700",
            ),
          );
        }
      }

      if (sectionTitle === "Sleep") {
        if (Number(entry.durationMinutes || 0) > 0) {
          badges.push(
            makeEntryBadge(
              formatHoursMinutes(Number(entry.durationMinutes || 0)),
              "bg-indigo-100 text-indigo-700",
            ),
          );
        } else {
          badges.push(makeEntryBadge("Incomplete", "bg-amber-100 text-amber-700"));
        }
        if (entry.quality) {
          badges.push(makeEntryBadge(String(entry.quality), "bg-slate-100 text-slate-700"));
        }
      }

      if (sectionTitle === "Measurements") {
        if (entry.weightKg) {
          badges.push(makeEntryBadge(`${entry.weightKg}kg`, "bg-blue-100 text-blue-700"));
        }
        if (entry.heightCm) {
          badges.push(makeEntryBadge(`${entry.heightCm}cm`, "bg-cyan-100 text-cyan-700"));
        }
      }

      return badges.slice(0, 4);
    };

    const groupEntriesForReport = (entries = []) => {
      const groups = [];
      sortEntriesByDate(entries).forEach((entry) => {
        const date = entry.date || "Date not set";
        let group = groups.find((item) => item.date === date);
        if (!group) {
          group = {
            date,
            label: date === "Date not set" ? date : formatReportDateLabel(date),
            entries: [],
          };
          groups.push(group);
        }
        group.entries.push(entry);
      });
      return groups;
    };

    const renderDetailedEntry = (entry, sectionTitle) => {
      const badges = getEntryBadges(entry, sectionTitle);

      return (
        <article
          key={entry.id}
          className="break-inside-avoid rounded-[1.2rem] border border-white/80 bg-white/90 px-3 py-3 shadow-sm"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                  {entry.time || "Time not set"}
                </span>
                {badges.map((badge) => (
                  <span
                    key={`${entry.id}-${badge.label}`}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
              <p className="mt-2 break-words text-sm font-black leading-5 text-slate-950">
                {entry.summary || sectionTitle}
              </p>
            </div>
          </div>
          {entry.details?.length ? (
            <div className="mt-2 space-y-1 rounded-xl bg-slate-50/80 px-3 py-2 text-[13px] font-semibold leading-5 text-slate-600">
              {entry.details.slice(0, 5).map((detail, detailIndex) => (
                <p key={`${entry.id}-detail-${detailIndex}`} className="break-words">
                  {detail}
                </p>
              ))}
              {entry.details.length > 5 ? (
                <p className="text-xs font-bold text-slate-400">
                  + {entry.details.length - 5} more note{entry.details.length - 5 === 1 ? "" : "s"}
                </p>
              ) : null}
            </div>
          ) : null}
        </article>
      );
    };

    const renderDetailedReportSection = ({
      title,
      entries,
      summary,
      emptyText,
      tone,
    }) => {
      const groups = groupEntriesForReport(entries);

      return (
        <section className={`break-inside-avoid rounded-[1.65rem] border p-4 shadow-sm ${tone}`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                {title}
              </p>
              <h4 className="mt-1 text-lg font-black text-slate-950">
                {entries.length} entr{entries.length === 1 ? "y" : "ies"}
              </h4>
            </div>
            <p className="rounded-full bg-white/75 px-3 py-1.5 text-xs font-bold leading-5 text-slate-600">
              {summary}
            </p>
          </div>

          {groups.length ? (
            <div className="mt-3 space-y-3">
              {groups.map((group) => (
                <div key={`${title}-${group.date}`} className="rounded-[1.35rem] border border-white/70 bg-white/45 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h5 className="text-sm font-black text-slate-900">{group.label}</h5>
                    <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                      {group.entries.length} item{group.entries.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="grid gap-2 lg:grid-cols-2">
                    {group.entries.map((entry) => renderDetailedEntry(entry, title))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-[1.25rem] border border-dashed border-slate-200 bg-white/65 px-4 py-5 text-center text-sm font-semibold leading-6 text-slate-500">
              {emptyText}
            </div>
          )}
        </section>
      );
    };

    const detailedReportSections = [
      {
        title: "Sleep",
        module: "sleep",
        entries: sleepEntries,
        summary: sleepStat?.value || "No average yet",
        emptyText: "No sleep recorded yet - log your first night to start tracking patterns.",
        tone: "border-indigo-100 bg-indigo-50/70",
      },
      {
        title: "Food & Drink",
        module: "foodDiary",
        entries: foodEntries,
        summary: `${foodEntries.length} logged`,
        emptyText: "No food entries yet - start logging meals to build a daily picture.",
        tone: "border-emerald-100 bg-emerald-50/70",
      },
      {
        title: "Medication",
        module: "medication",
        entries: medicationEntries,
        summary: medicationStat?.value || "No medication data",
        emptyText: "No medication records yet - add medication to track consistency.",
        tone: "border-rose-100 bg-rose-50/70",
      },
      {
        title: "Toileting",
        module: "toileting",
        entries: toiletingEntries,
        summary: `${toiletingEntries.length} logged`,
        emptyText: "No toileting data yet - logging this helps identify patterns.",
        tone: "border-cyan-100 bg-cyan-50/70",
      },
      {
        title: "Behaviour",
        module: "behaviour",
        entries: behaviourEntries,
        summary: reportTrendModel.graphs.behaviour?.total
          ? `${reportTrendModel.graphs.behaviour.total} logged`
          : "No behaviour data",
        emptyText: "No behaviour data recorded for this period.",
        tone: "border-purple-100 bg-purple-50/70",
      },
      {
        title: "Appointments",
        module: "appointments",
        entries: appointmentEntries,
        summary: `${appointmentEntries.length} recorded`,
        emptyText: "No appointments recorded for this period.",
        tone: "border-blue-100 bg-blue-50/70",
      },
      {
        title: "Health",
        module: "health",
        entries: healthEntries,
        summary: `${healthEntries.length} logged`,
        emptyText: "No health entries found for this period.",
        tone: "border-amber-100 bg-amber-50/70",
      },
      ...(measurementEntries.length
        ? [
            {
              title: "Measurements",
              module: "measurements",
              entries: measurementEntries,
              summary: `${measurementEntries.length} logged`,
              emptyText: "No measurements found for this period.",
              tone: "border-blue-100 bg-blue-50/70",
            },
          ]
        : []),
    ].filter((section) => {
      if (section.module === "foodDiary") {
        return isModuleEnabled("food");
      }
      return isModuleEnabled(section.module);
    });

    const rangeOptions = ["7", "14", "30", "custom"];

    return (
      <>
        {renderPdfExportArea()}

        <div className="mt-6 space-y-4">
          <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
            <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-sky-900 p-4 text-white sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-sky-200">
                    Reports
                  </p>
                  <h3 className="mt-2 text-2xl font-black tracking-tight">
                    Full Care Report
                  </h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-sky-50/90">
                    A clear summary of care logs, trends, and detailed records
                    for the selected period.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-100">
                    <span className="rounded-full bg-white/15 px-3 py-1.5">
                      Child: {childName}
                    </span>
                    <span className="rounded-full bg-white/15 px-3 py-1.5">
                      {reportRangeLabel}
                    </span>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[22rem]">
                  <button
                    type="button"
                    onClick={() => handleExportPdf("full")}
                    disabled={isExportingPdf || invalidCustomRange}
                    className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-900 shadow-sm transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isExportingPdf ? "Exporting..." : "Export PDF"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!useSaasApi) {
                        showToast?.({
                          message: "Email sending is not set up yet. You can still download the PDF.",
                          type: "info",
                        });
                        return;
                      }
                      setReportEmailForm((current) => ({
                        ...current,
                        attachmentType: "full",
                      }));
                      setIsReportEmailOpen(true);
                    }}
                    disabled={invalidCustomRange}
                    className="rounded-2xl border border-white/30 bg-white/10 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Email Report
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-sm font-bold text-slate-700">
                  Child
                </label>
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700">
                  {childName}
                </div>
              </div>
              <div>
                <label className="text-sm font-bold text-slate-700">
                  Date range
                </label>
                <select
                  className={reportInputClassName}
                  value={reportDays}
                  onChange={(event) => setReportDays(event.target.value)}
                >
                  {!rangeOptions.includes(reportDays) ? (
                    <option value={reportDays}>{reportRangeLabel}</option>
                  ) : null}
                  <option value="7">Last 7 days</option>
                  <option value="14">Last 14 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="custom">Custom range</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-bold text-slate-700">
                  Category
                </label>
                <select
                  className={reportInputClassName}
                  value={reportCategoryFilter}
                  onChange={(event) => setReportCategoryFilter(event.target.value)}
                >
                  {renderReportCategoryOptions()}
                </select>
              </div>
              <div>
                <label className="text-sm font-bold text-slate-700">
                  Notes for report
                </label>
                <input
                  className={reportInputClassName}
                  value={reportNotes}
                  onChange={(event) => setReportNotes(event.target.value)}
                  placeholder="Optional note"
                />
              </div>
            </div>

            {reportDays === "custom" ? (
              <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-bold text-slate-700">
                    Start date
                  </label>
                  <input
                    type="date"
                    className={reportInputClassName}
                    value={reportStartDate}
                    onChange={(event) => setReportStartDate(event.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-slate-700">
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

            {isModuleEnabled("health") ? (
              <div className="border-t border-slate-100 px-4 pb-4">
                <label className="flex items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-900">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                    checked={includeHealthHistory24Months}
                    onChange={(event) =>
                      setIncludeHealthHistory24Months(event.target.checked)
                    }
                  />
                  <span>
                    Include health history from last 24 months
                    <span className="mt-1 block text-xs font-semibold leading-5 text-amber-800/80">
                      Only Health entries are extended. Other report sections keep
                      the selected date range.
                    </span>
                  </span>
                </label>
              </div>
            ) : null}

            {invalidCustomRange ? (
              <div className="mx-4 mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                End date must be on or after the start date.
              </div>
            ) : null}
          </section>

          <section className="rounded-[1.75rem] border border-sky-100 bg-gradient-to-br from-sky-50/80 via-white to-indigo-50/70 p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-700">
                  Report Summary
                </p>
                <h3 className="mt-1 text-xl font-black text-slate-950">
                  Period overview
                </h3>
              </div>
              <p className="text-xs font-bold text-slate-500 sm:text-sm">
                Generated {new Date().toLocaleDateString("en-GB")}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {summaryCards.map((card) => (
                <div
                  key={card.label}
                  className={`flex min-h-[8.25rem] min-w-0 flex-col justify-between rounded-[1.35rem] border px-4 py-4 shadow-sm sm:px-5 ${card.tone}`}
                >
                  <div className="min-w-0">
                    <p className="break-words text-[10px] font-black uppercase leading-4 tracking-[0.16em] text-slate-500">
                      {card.label}
                    </p>
                    <p className="mt-2 break-words text-2xl font-black leading-tight text-slate-950">
                      {card.value}
                    </p>
                  </div>
                  <p className="mt-3 text-xs font-semibold leading-5 text-slate-600">
                    {card.meta}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-indigo-100 bg-gradient-to-br from-white via-indigo-50/70 to-sky-50/70 p-4 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-700">
              Key Insights
            </p>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {displayInsights.map((insight) => (
                <div
                  key={insight}
                  className="rounded-[1.35rem] border border-white/80 bg-white/85 px-3 py-3 text-sm font-semibold leading-6 text-slate-700 shadow-sm"
                >
                  {insight}
                </div>
              ))}
            </div>
          </section>

          {renderPatternInsightsSection()}

          <section className="rounded-[1.75rem] border border-slate-100 bg-gradient-to-br from-slate-50 via-white to-sky-50/70 p-4 shadow-sm">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">
                Key Trends
              </p>
              <h3 className="mt-1 text-xl font-black text-slate-950">
                Patterns in the selected period
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Simple charts where enough data exists, with clear empty states
                where more logs are needed.
              </p>
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {showReportCharts ? (
                <>
                  {renderLineGraphCard({
                    title: "Sleep trend",
                    data: reportTrendModel.graphs.sleep,
                    suffix: "h",
                    stroke: "#6366f1",
                    minPoints: 1,
                    emptyText: "No completed sleep logs available yet",
                    axisTitle: "Hours",
                    yAxisLabels: sleepAxisLabels,
                    yMin: 0,
                    yMax: sleepAxisMax,
                    note: [
                      sleepInsight,
                      incompleteSleepEntries.length
                        ? `${incompleteSleepEntries.length} incomplete sleep entr${
                            incompleteSleepEntries.length === 1 ? "y was" : "ies were"
                          } not included in the graph.`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" "),
                  })}
                  {renderFluidBarGraph()}
                  {renderMedicationConsistencyCard()}
                  {renderToiletingPatternCard()}
                  {isModuleEnabled("behaviour")
                    ? renderTrendInfoCard({
                        title: "Behaviour pattern",
                        value: reportTrendModel.graphs.behaviour?.total
                          ? `${reportTrendModel.graphs.behaviour.total} logged`
                          : "No behaviour entries",
                        description: reportTrendModel.graphs.behaviour?.total
                          ? [
                              reportTrendModel.graphs.behaviour.topType
                                ? `Most common type: ${reportTrendModel.graphs.behaviour.topType.label}.`
                                : "",
                              reportTrendModel.graphs.behaviour.topTrigger
                                ? `Most common trigger: ${reportTrendModel.graphs.behaviour.topTrigger.label}.`
                                : "Triggers will appear here when they are logged.",
                            ]
                              .filter(Boolean)
                              .join(" ")
                          : "Behaviour frequency, triggers and severity will appear when entries are logged.",
                        meta: reportTrendModel.graphs.behaviour?.daily?.length
                          ? `${reportTrendModel.graphs.behaviour.daily.length} day${reportTrendModel.graphs.behaviour.daily.length === 1 ? "" : "s"} with behaviour logs`
                          : "",
                        tone: "border-purple-100 bg-purple-50/70",
                      })
                    : null}
                </>
              ) : (
                renderTrendInfoCard({
                  title: "Charts hidden",
                  value: "Graphs are turned off",
                  description: "Turn charts back on from report options if you want visual trend cards.",
                })
              )}
              {renderTrendInfoCard({
                title: "Health notes pattern",
                value: healthEntries.length ? `${healthEntries.length} logged` : "No health notes",
                description: healthEntries.length
                  ? "Health entries are included in the detailed report below."
                  : "No health concerns were logged in this report range.",
                tone: "border-amber-100 bg-amber-50/70",
              })}
              {renderTrendInfoCard({
                title: "Measurements / weight trend",
                value: measurementEntries.length ? `${measurementEntries.length} logged` : "No measurements",
                description: measurementEntries.length
                  ? "Measurement entries are shown as their own detailed section."
                  : "Weight or height trends will appear here when measurements are logged.",
                tone: "border-blue-100 bg-blue-50/70",
              })}
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-slate-100 bg-gradient-to-br from-white via-slate-50 to-sky-50/60 p-4 shadow-sm">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">
                Detailed Report
              </p>
              <h3 className="mt-1 text-xl font-black text-slate-950">
                Entries by category
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Detailed logs grouped by date for the selected range, using the
                same entries shown in the summary above.
              </p>
            </div>
            <div className="mt-4 space-y-3">
              {detailedReportSections.map((section) => (
                <div key={section.title}>
                  {renderDetailedReportSection(section)}
                </div>
              ))}
            </div>
          </section>

        </div>
        {renderReportEmailModal(reportInputClassName)}

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
      case "Behaviour":
        return renderBehaviourForm();
      case "Growth / Measurements":
        return renderMeasurementsForm();
      case "Sleep":
        return renderSleepForm();
      case "Reports":
        return renderShareableReportsForm();
      case "Care Snapshot":
        return renderCareSnapshotForm();
      case "Document Vault":
        return renderDocumentVaultForm();
      case "Appointments":
        return renderAppointmentsForm();
      case "Timeline":
        return renderUnifiedTimelineForm();
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

  const isReportsOpen = ["Reports", "Care Snapshot", "Document Vault", "Timeline", "Calendar"].includes(
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
        <div
          className={`mb-3 overflow-hidden rounded-2xl border px-4 text-sm font-semibold transition-all duration-200 md:hidden ${
            refreshStatus === "idle"
              ? "max-h-0 border-transparent py-0 opacity-0"
              : "max-h-20 border-sky-200 bg-gradient-to-r from-sky-50 to-indigo-50 py-2.5 opacity-100 shadow-sm"
          }`}
          style={{
            transform:
              refreshStatus === "pulling" || refreshStatus === "ready"
                ? `translateY(${Math.min(14, Math.round(pullDistance / 10))}px)`
                : "translateY(0)",
          }}
        >
          <div className="flex items-center justify-center gap-2 text-sky-800">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border border-sky-200 bg-white text-xs shadow-sm ${
                refreshStatus === "refreshing" ? "animate-spin" : ""
              }`}
            >
              {refreshStatus === "done" ? "✓" : "↻"}
            </span>
            <span>
              {refreshStatus === "ready"
                ? "Release to refresh"
                : refreshStatus === "refreshing"
                  ? "Refreshing..."
                  : refreshStatus === "done"
                    ? "Diary updated"
                    : "Pull to refresh"}
            </span>
          </div>
        </div>

        {showOnboardingChecklist ? (
          <section className="relative mb-4 rounded-[1.5rem] border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-4 pr-12 shadow-sm">
            <button
              type="button"
              onClick={dismissGettingStarted}
              className="absolute right-3 top-3 rounded-full border border-indigo-100 bg-white/90 px-2 py-1 text-xs font-black text-indigo-700 shadow-sm"
              aria-label="Hide getting started checklist"
            >
              ×
            </button>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">
                  Getting started
                </p>
                <h2 className="mt-1 text-base font-black text-slate-950">
                  Build your first useful care record
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  A few quick steps make Snapshot and Reports much more useful.
                </p>
              </div>
              <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-bold text-indigo-700 shadow-sm">
                {onboardingChecklistItems.filter((item) => item.completed).length}/
                {onboardingChecklistItems.length} done
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {onboardingChecklistItems.map((item) => (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => openOnboardingItem(item.action)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-bold transition ${
                    item.completed
                      ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                      : "border-indigo-100 bg-white/90 text-slate-700 shadow-sm hover:border-indigo-200 hover:bg-white"
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

        {!isCareSnapshotPromptDismissed && isModuleEnabled("snapshot") ? (
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

        {(isModuleEnabled("drink") || isModuleEnabled("medication")) ? (
        <section className="mb-5 rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                Today
              </p>
              <h2 className="text-lg font-black text-slate-950">
                Fluids and required medication
              </h2>
            </div>
            <p className="text-xs font-bold text-slate-500">
              {todayDashboard.medicationRequired
                ? `${todayDashboard.medicationTaken}/${todayDashboard.medicationRequired} medication doses logged`
                : "No required medication set"}
            </p>
          </div>

          <div
            className={`mt-3 grid gap-3 ${
              isModuleEnabled("drink") && isModuleEnabled("medication")
                ? "lg:grid-cols-[0.85fr_1.15fr]"
                : "lg:grid-cols-1"
            }`}
          >
            {isModuleEnabled("drink") ? (
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-sky-700">
                      Fluids today
                    </p>
                    <p className="mt-0.5 text-sm font-bold text-slate-700">
                      {todayDashboard.fluidTargetMl
                        ? `${Math.round(todayDashboard.fluidMl)}ml / ${todayDashboard.fluidTargetMl}ml`
                        : `${Math.round(todayDashboard.fluidMl)}ml logged`}
                    </p>
                  </div>
                  {todayDashboard.fluidTargetMl ? (
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-sky-700">
                      {todayDashboard.fluidPercent}%
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-sky-500 transition-all"
                    style={{
                      width: `${todayDashboard.fluidTargetMl ? todayDashboard.fluidPercent : 0}%`,
                    }}
                  />
                </div>
                {todayDashboard.fluidTargetMl &&
                todayDashboard.nextHydrationCheckpoint ? (
                  <div className="mt-3 rounded-xl border border-sky-100 bg-white/80 px-3 py-2">
                    <p className="text-[11px] font-black uppercase tracking-[0.12em] text-sky-700">
                      Next checkpoint
                    </p>
                    <p className="mt-1 text-xs font-bold leading-5 text-slate-600">
                      {todayDashboard.nextHydrationCheckpoint.percent}% by{" "}
                      {todayDashboard.nextHydrationCheckpoint.time} · about{" "}
                      {todayDashboard.nextHydrationCheckpoint.expectedMl}ml
                    </p>
                  </div>
                ) : null}
                {todayDashboard.fluidTargetMl ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {todayDashboard.hydrationCheckpoints.map((checkpoint) => (
                      <span
                        key={`${checkpoint.time}-${checkpoint.percent}`}
                        className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] ${
                          checkpoint.met
                            ? "bg-emerald-100 text-emerald-700"
                            : checkpoint.isPast
                              ? "bg-amber-100 text-amber-800"
                              : "bg-white text-sky-700"
                        }`}
                      >
                        {checkpoint.percent}% {checkpoint.time}:{" "}
                        {checkpoint.statusLabel}
                      </span>
                    ))}
                  </div>
                ) : null}
                {!todayDashboard.fluidTargetMl ? (
                  <button
                    type="button"
                    onClick={onOpenChildSetup}
                    className="mt-3 w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-black text-sky-700"
                  >
                    Set a daily fluid target in Care Profile
                  </button>
                ) : null}
              </div>
            ) : null}

            {isModuleEnabled("medication") ? (
            <div>
            {todayDashboard.requiredMedication.length ? (
              <div
                className={`rounded-2xl border p-3 ${
                  todayDashboard.requiredMedication.some(
                    (medicine) => medicine.status === "due" || medicine.status === "missed",
                  )
                    ? "border-rose-100 bg-rose-50"
                    : "border-sky-100 bg-sky-50"
                }`}
              >
                <p
                  className={`text-xs font-black uppercase tracking-[0.14em] ${
                    todayDashboard.requiredMedication.some(
                      (medicine) => medicine.status === "due" || medicine.status === "missed",
                    )
                      ? "text-rose-700"
                      : "text-sky-700"
                  }`}
                >
                  Required medication today
                </p>
                <div className="mt-2 space-y-2">
                  {todayDashboard.requiredMedication.map((medicine) => (
                    <button
                      type="button"
                      key={medicine.id}
                      onClick={() =>
                        !isReadOnly &&
                        medicine.status !== "upcoming" &&
                        openRequiredMedicationLog(medicine)
                      }
                      disabled={isReadOnly || medicine.status === "upcoming"}
                      className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left disabled:cursor-not-allowed ${
                        medicine.status === "upcoming"
                          ? "bg-white/70 opacity-85"
                          : "bg-white"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-900">
                          {medicine.name}
                        </p>
                        <p className="truncate text-xs font-bold text-slate-500">
                          {[
                            medicine.dose,
                            formatTimeWindowLabel(medicine.timeWindow),
                            medicationScheduleLabel(medicine) === "Every day"
                              ? ""
                              : medicationScheduleLabel(medicine),
                          ]
                            .filter(Boolean)
                            .join(" - ") ||
                            "Daily medication"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] ${
                            medicine.status === "taken"
                              ? "bg-emerald-100 text-emerald-700"
                              : medicine.status === "missed"
                                ? "bg-rose-100 text-rose-700"
                                : medicine.status === "upcoming"
                                  ? "bg-sky-100 text-sky-700"
                                  : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {medicine.statusLabel}
                        </span>
                        {medicine.status !== "taken" &&
                        medicine.status !== "upcoming" &&
                        !isReadOnly ? (
                          <span className="rounded-full bg-rose-600 px-3 py-1.5 text-xs font-black text-white">
                            Log
                          </span>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                  Required medication today
                </p>
                <p className="mt-1 text-sm font-bold text-emerald-900">
                  {todayDashboard.medicationRequired
                    ? "All required medication doses have been logged today."
                    : "No required daily medication is set for this child."}
                </p>
                {!todayDashboard.medicationRequired ? (
                  <button
                    type="button"
                    onClick={onOpenChildSetup}
                    className="mt-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-700"
                  >
                    Set required medication
                  </button>
                ) : null}
              </div>
            )}

            {todayDashboard.alerts.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {todayDashboard.alerts.slice(0, 4).map((alert) => (
                  <span
                    key={alert}
                    className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800"
                  >
                    {alert}
                  </span>
                ))}
              </div>
            ) : null}
            </div>
            ) : null}
          </div>
        </section>
        ) : null}

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
                  : ["Not enough data yet - log a few days to generate a full report"];

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
                    {["Reports", "Care Snapshot", "Document Vault", "Timeline", "Calendar"].includes(section.title)
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

                  {!["Reports", "Care Snapshot", "Document Vault", "Timeline", "Calendar"].includes(section.title) ? (
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

      {quickAddItems.length ? (
      <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 md:hidden">
        {quickAddOpen ? (
          <div className="w-[min(18rem,calc(100vw-2rem))] rounded-[1.5rem] border border-sky-100 bg-white p-3 shadow-2xl">
            <div className="rounded-2xl border border-sky-100 bg-sky-50 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-700">
                Adding for
              </p>
              <p className="mt-0.5 truncate text-sm font-black text-slate-900">
                {childName}
              </p>
            </div>
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
              ["Behaviour", "Behaviour", "", "BT"],
              ["Appointment", "Appointments", "", "AP"],
            ].map(([label, title, preset, icon]) => {
              const moduleKey =
                label === "Food"
                  ? "food"
                  : label === "Drink"
                    ? "drink"
                    : label === "Medication"
                      ? "medication"
                      : label === "Sleep"
                        ? "sleep"
                        : label === "Toileting"
                          ? "toileting"
                          : label === "Health"
                            ? "health"
                            : label === "Behaviour"
                              ? "behaviour"
                              : label === "Appointment"
                                ? "appointments"
                              : "";
              if (moduleKey && !isModuleEnabled(moduleKey)) return null;
              return (
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
              );
            })}
            </div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setQuickAddOpen((current) => !current)}
          className="flex min-h-14 items-center gap-2 rounded-full bg-slate-950 px-4 py-3 text-sm font-black leading-none text-white shadow-xl"
          aria-label="Quick add"
        >
          <span className="text-2xl font-light">{quickAddOpen ? "×" : "+"}</span>
          <span>{quickAddOpen ? "Close" : "Add"}</span>
        </button>
      </div>
      ) : null}

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



