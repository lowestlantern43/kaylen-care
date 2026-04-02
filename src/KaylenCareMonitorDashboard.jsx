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

const formatDateInput = (value) => {
  const digits = (value || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
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

const dateTimeInputClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

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
    report: "border-green-200 bg-green-50",
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
    default:
      return "";
  }
};

export default function KaylenCareMonitorDashboard() {
  const APP_PASSWORD = "030920";

  const saveLockRef = useRef(false);
  const lastPullStartY = useRef(null);

  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);

  const [activeSection, setActiveSection] = useState(null);
  const [medicationValue, setMedicationValue] = useState("");
  const [foodValue, setFoodValue] = useState("");
  const [reportDays, setReportDays] = useState("7");
  const [customReportDays, setCustomReportDays] = useState("7");
  const [reportLayout, setReportLayout] = useState("timeline");
  const [reportCategoryFilter, setReportCategoryFilter] = useState("All");
  const [reportFiltersOpen, setReportFiltersOpen] = useState(false);
  const [sharedLog, setSharedLog] = useState([]);
  const [shareCopied, setShareCopied] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isSavingEntry, setIsSavingEntry] = useState(false);

  const [savedFoodOptions, setSavedFoodOptions] = useState([]);
  const [savedMedicationOptions, setSavedMedicationOptions] = useState([]);
  const [savedGivenByOptions, setSavedGivenByOptions] = useState([]);
  const [saveFoodForFuture, setSaveFoodForFuture] = useState(false);
  const [saveMedicationForFuture, setSaveMedicationForFuture] =
    useState(false);
  const [saveGivenByForFuture, setSaveGivenByForFuture] = useState(false);

  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
    weightLb: "",
    heightCm: "",
    heightFt: "",
    heightIn: "",
  });

  const [sleepLog, setSleepLog] = useState({
    date: todayValue(),
    bedtime: nowTimeValue(),
  });

  const [wakeLog, setWakeLog] = useState({
    date: todayValue(),
    wakeTime: "",
  });

  const sections = [
    {
      title: "Food Diary",
      subtitle: "What and how much was eaten or drunk",
      button: "Open Log",
      emoji: "🍽️",
      color: "from-amber-400 to-orange-500",
      soft: "bg-amber-50 border-amber-300",
    },
    {
      title: "Medication",
      subtitle: "What was given, dose, and who gave it",
      button: "Open Log",
      emoji: "💊",
      color: "from-rose-400 to-pink-500",
      soft: "bg-rose-50 border-rose-300",
    },
    {
      title: "Toileting",
      subtitle: "Nappies, toilet use, and notes",
      button: "Open Log",
      emoji: "🚽",
      color: "from-sky-400 to-blue-500",
      soft: "bg-sky-50 border-sky-300",
    },
    {
      title: "Health",
      subtitle: "Symptoms, weight, height, and notes",
      button: "Open Log",
      emoji: "🩺",
      color: "from-emerald-400 to-green-500",
      soft: "bg-emerald-50 border-emerald-300",
    },
    {
      title: "Sleep",
      subtitle: "Sleep log and wake log",
      button: "Open Log",
      emoji: "🌙",
      color: "from-indigo-400 to-purple-500",
      soft: "bg-indigo-50 border-indigo-300",
    },
    {
      title: "Reports",
      subtitle: "Recent entries, filters, and PDF export",
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
    "Calcichew",
    "Other",
  ];

  const medicationOptions = [
    ...defaultMedicationOptions.slice(0, -1),
    ...[...savedMedicationOptions].sort((a, b) => a.localeCompare(b)),
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
    ...[...savedFoodOptions].sort((a, b) => a.localeCompare(b)),
    "Other",
  ];

  const defaultGivenByOptions = ["Martin", "Rachel", "Other"];

  const givenByOptions = [
    ...defaultGivenByOptions.slice(0, -1),
    ...[...savedGivenByOptions].sort((a, b) => a.localeCompare(b)),
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
      weightLb: "",
      heightCm: "",
      heightFt: "",
      heightIn: "",
    });
  };

  const resetSleepLog = () => {
    setSleepLog({
      date: todayValue(),
      bedtime: nowTimeValue(),
    });
  };

  const resetWakeLog = () => {
    setWakeLog({
      date: todayValue(),
      wakeTime: "",
    });
  };

  const parseNotesValue = (text, label) => {
    const parts = (text || "").split(" | ");
    const found = parts.find((part) => part.startsWith(`${label}: `));
    return found ? found.replace(`${label}: `, "") : "";
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
      const entryType = parseNotesValue(row.notes, "Entry type") || "Sleep log";
      const date = parseNotesValue(row.notes, "Date") || todayValue();

      if (entryType === "Wake log") {
        return {
          id: `sleep-${row.id}`,
          createdAt: row.time || new Date().toISOString(),
          section: "Sleep",
          date,
          time: row.wake_time || "",
          summary: `Wake log · ${row.wake_time || "Time not set"}`,
          details: [`Date: ${date}`],
        };
      }

      return {
        id: `sleep-${row.id}`,
        createdAt: row.time || new Date().toISOString(),
        section: "Sleep",
        date,
        time: row.bedtime || "",
        summary: `Sleep log · ${row.bedtime || "Time not set"}`,
        details: [`Date: ${date}`],
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
        row.weight_lb ? `Weight (lb): ${row.weight_lb}` : null,
        row.height_cm ? `Height (cm): ${row.height_cm}` : null,
        row.height_ft || row.height_in
          ? `Height (ft/in): ${row.height_ft || 0}ft ${row.height_in || 0}in`
          : null,
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

  useEffect(() => {
    if (isUnlocked) {
      loadEntriesFromSupabase();
    }
  }, [isUnlocked]);

  const sectionHelpText = useMemo(() => {
    if (!activeSection) return "";

    switch (activeSection.title) {
      case "Food Diary":
        return "Food saves into the same shared log as everything else.";
      case "Medication":
        return "Log one medication at a time with dose, time, and notes.";
      case "Toileting":
        return "Quick combined toileting entry and notes.";
      case "Health":
        return "Record seizures, symptoms, actions, weight, and height.";
      case "Sleep":
        return "Log bedtime and wake time separately.";
      case "Reports":
        return "View recent entries and export a proper PDF.";
      default:
        return "Form preview";
    }
  }, [activeSection]);

  const recentEntries = useMemo(() => {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (effectiveReportDays - 1));

    return sharedLog.filter((entry) => {
      if (!entry.date) return false;
      const [day, month, year] = entry.date.split("/");
      const entryDate = new Date(`${year}-${month}-${day}T00:00:00`);

      if (Number.isNaN(entryDate.getTime()) || entryDate < cutoff) return false;

      if (
        reportCategoryFilter !== "All" &&
        entry.section !== reportCategoryFilter
      ) {
        return false;
      }

      return true;
    });
  }, [effectiveReportDays, reportCategoryFilter, sharedLog]);

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
    if (reportLayout === "timeline") {
      return [
        `Kaylen's Diary Report - Last ${effectiveReportDays} days`,
        `Timeline view${
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
      `Category view${
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

  const isRecentDuplicate = ({ section, summary, details = [] }) => {
    const now = Date.now();

    return sharedLog.some((entry) => {
      if (entry.section !== section) return false;
      if (entry.summary !== summary) return false;

      const existingDetails = (entry.details || []).join(" | ");
      const incomingDetails = details.join(" | ");
      if (existingDetails !== incomingDetails) return false;

      const createdTime = new Date(entry.createdAt).getTime();
      if (Number.isNaN(createdTime)) return false;

      return now - createdTime < 15000;
    });
  };

  const withSaveProtection = async (buildDuplicateSignature, saveFn, afterSave) => {
    if (saveLockRef.current || isSavingEntry) return;

    const duplicateSignature = buildDuplicateSignature?.();
    if (duplicateSignature && isRecentDuplicate(duplicateSignature)) {
      alert("That looks like a duplicate entry just saved.");
      return;
    }

    try {
      saveLockRef.current = true;
      setIsSavingEntry(true);

      const saved = await saveFn();
      if (!saved) return;

      await loadEntriesFromSupabase();
      if (afterSave) {
        await afterSave();
      }
    } finally {
      saveLockRef.current = false;
      setIsSavingEntry(false);
    }
  };

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

  const saveSleepEntryToSupabase = async ({ entryType, date, timeValue }) => {
    const isWakeLog = entryType === "Wake log";

    const payload = {
      quality: "",
      bedtime: isWakeLog ? "" : timeValue,
      wake_time: isWakeLog ? timeValue : "",
      night_wakings: "",
      nap: "",
      time: new Date().toISOString(),
      notes: [`Entry type: ${entryType}`, `Date: ${date}`]
        .filter(Boolean)
        .join(" | "),
    };

    const { error } = await supabase.from("sleep_logs").insert([payload]);

    if (error) {
      console.error("Supabase sleep save failed:", error);
      alert("Sleep save failed - check console");
      return false;
    }

    return true;
  };

  const saveHealthEntryToSupabase = async () => {
    const payload = {
      event: healthForm.event || "Health",
      duration: healthForm.duration || "",
      time: new Date().toISOString(),
      happened: healthForm.happened || "",
      action: healthForm.action || "",
      weight_kg: healthForm.weightKg || "",
      weight_lb: healthForm.weightLb || "",
      height_cm: healthForm.heightCm || "",
      height_ft: healthForm.heightFt || "",
      height_in: healthForm.heightIn || "",
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

      await new Promise((resolve) => setTimeout(resolve, 150));

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
        windowWidth: 1200,
        windowHeight: exportNode.scrollHeight,
        scrollX: 0,
        scrollY: 0,
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

      pdf.addImage(
        imgData,
        "PNG",
        margin,
        position,
        imgWidth,
        imgHeight,
        undefined,
        "FAST",
      );
      heightLeft -= usableHeight;

      while (heightLeft > 0) {
        position = margin - (imgHeight - heightLeft);
        pdf.addPage("a4", "l");
        pdf.addImage(
          imgData,
          "PNG",
          margin,
          position,
          imgWidth,
          imgHeight,
          undefined,
          "FAST",
        );
        heightLeft -= usableHeight;
      }

      pdf.save(
        `kaylens-diary-report-${effectiveReportDays}-days-${reportLayout.toLowerCase()}-landscape.pdf`,
      );
    } catch (error) {
      console.error("PDF export failed", error);
      alert("PDF export failed - check console");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const renderDateInput = ({
    label,
    value,
    onChange,
    placeholder = "DD/MM/YYYY",
  }) => (
    <div className={cardClassName}>
      <label className="text-sm font-semibold text-slate-700">{label}</label>
      <input
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        className={dateTimeInputClass}
        value={value}
        onChange={(e) => onChange(formatDateInput(e.target.value))}
      />
    </div>
  );

  const renderTimeInput = ({
    label,
    value,
    onChange,
    onNow,
    placeholder = "HH:MM",
  }) => (
    <div className={cardClassName}>
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-semibold text-slate-700">{label}</label>
        <button
          type="button"
          onClick={onNow}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
        >
          Refresh time
        </button>
      </div>

      <input
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        className={`${dateTimeInputClass} mt-3`}
        value={value}
        onChange={(e) => onChange(formatTimeInput(e.target.value))}
      />
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

    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {renderDateInput({
          label: "Date",
          value: foodForm.date,
          onChange: (date) => setFoodForm({ ...foodForm, date }),
        })}

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
            disabled={isSavingEntry}
            onClick={async () => {
              await withSaveProtection(
                () => ({
                  section: "Food Diary",
                  summary: `${selectedFood || (isMilk ? "Milk" : "Food entry")} · ${
                    isMilk ? `${foodForm.amount || 0}oz` : foodForm.amount || "No amount"
                  }`,
                  details: [
                    `Location: ${selectedLocation}`,
                    foodForm.notes ? `Notes: ${foodForm.notes}` : null,
                  ].filter(Boolean),
                }),
                () =>
                  saveFoodEntryToSupabase({
                    selectedFood,
                    selectedLocation,
                    isMilk,
                  }),
                async () => {
                  if (showOtherFood && saveFoodForFuture) {
                    setSavedFoodOptions((current) =>
                      dedupeAppend(current, foodForm.otherItem),
                    );
                  }

                  resetFoodForm();
                  closeSection();
                },
              );
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-60 ${activeSection.color}`}
          >
            {isSavingEntry ? "Saving..." : "Save food entry"}
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

    const showOtherGivenBy = medicationForm.givenBy === "Other";
    const selectedGivenBy = showOtherGivenBy
      ? medicationForm.otherGivenBy || "Other"
      : medicationForm.givenBy || "";

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

        {renderDateInput({
          label: "Date",
          value: medicationForm.date,
          onChange: (date) =>
            setMedicationForm({ ...medicationForm, date }),
        })}

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
            Notes{isMelatonin ? " *" : ""}
          </label>
          <textarea
            placeholder={
              isMelatonin ? "Notes required for Melatonin" : "Optional notes"
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
            disabled={isSavingEntry}
            onClick={async () => {
              if (selectedMedicine === "Melatonin" && !medicationForm.notes.trim()) {
                alert("Notes are required for Melatonin");
                return;
              }

              await withSaveProtection(
                () => ({
                  section: "Medication",
                  summary: `${selectedMedicine || "Medication"} · ${
                    medicationForm.dose || "No dose"
                  }`,
                  details: [
                    `Given by: ${selectedGivenBy || "Not set"}`,
                    medicationForm.notes ? `Notes: ${medicationForm.notes}` : null,
                  ].filter(Boolean),
                }),
                () =>
                  saveMedicationEntryToSupabase({
                    selectedMedicine,
                    selectedGivenBy,
                  }),
                async () => {
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
                },
              );
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-60 ${activeSection.color}`}
          >
            {isSavingEntry ? "Saving..." : "Save medication entry"}
          </button>
        </div>
      </div>
    );
  };

  const renderToiletingForm = () => {
    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {renderDateInput({
          label: "Date",
          value: toiletingForm.date,
          onChange: (date) => setToiletingForm({ ...toiletingForm, date }),
        })}

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
            disabled={isSavingEntry}
            onClick={async () => {
              await withSaveProtection(
                () => ({
                  section: "Toileting",
                  summary: toiletingForm.entry || "Toileting entry",
                  details: [
                    toiletingForm.notes ? `Notes: ${toiletingForm.notes}` : null,
                  ].filter(Boolean),
                }),
                saveToiletingEntryToSupabase,
                async () => {
                  resetToiletingForm();
                  closeSection();
                },
              );
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-60 ${activeSection.color}`}
          >
            {isSavingEntry ? "Saving..." : "Save toileting entry"}
          </button>
        </div>
      </div>
    );
  };

  const renderHealthForm = () => {
    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {renderDateInput({
          label: "Date",
          value: healthForm.date,
          onChange: (date) => setHealthForm({ ...healthForm, date }),
        })}

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
          <label className="text-sm font-semibold text-slate-700">Weight</label>
          <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Metric (kg)
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
                Imperial (lb)
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="e.g. 40.6"
                className={`${inputClassName} mt-1 min-h-[48px]`}
                value={healthForm.weightLb}
                onChange={(e) =>
                  setHealthForm({ ...healthForm, weightLb: e.target.value })
                }
              />
            </div>
          </div>
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Height</label>
          <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Metric (cm)
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
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Imperial (ft / in)
              </label>
              <div className="mt-1 grid grid-cols-2 gap-3">
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="ft"
                  className={`${inputClassName} mt-0 min-h-[48px]`}
                  value={healthForm.heightFt}
                  onChange={(e) =>
                    setHealthForm({ ...healthForm, heightFt: e.target.value })
                  }
                />
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="in"
                  className={`${inputClassName} mt-0 min-h-[48px]`}
                  value={healthForm.heightIn}
                  onChange={(e) =>
                    setHealthForm({ ...healthForm, heightIn: e.target.value })
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            disabled={isSavingEntry}
            onClick={async () => {
              await withSaveProtection(
                () => ({
                  section: "Health",
                  summary: `${healthForm.event || "Health"} · ${
                    healthForm.duration || "No duration"
                  }`,
                  details: [
                    healthForm.happened ? `What happened: ${healthForm.happened}` : null,
                    healthForm.action ? `Action taken: ${healthForm.action}` : null,
                    healthForm.notes ? `Notes: ${healthForm.notes}` : null,
                  ].filter(Boolean),
                }),
                saveHealthEntryToSupabase,
                async () => {
                  resetHealthForm();
                  closeSection();
                },
              );
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-60 ${activeSection.color}`}
          >
            {isSavingEntry ? "Saving..." : "Save health entry"}
          </button>
        </div>
      </div>
    );
  };

  const renderSleepForm = () => {
    return (
      <div className="mt-6 space-y-6">
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 space-y-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-700">
            Sleep log
          </p>

          {renderDateInput({
            label: "Date",
            value: sleepLog.date,
            onChange: (date) => setSleepLog({ ...sleepLog, date }),
          })}

          {renderTimeInput({
            label: "Bedtime",
            value: sleepLog.bedtime,
            onChange: (bedtime) => setSleepLog({ ...sleepLog, bedtime }),
            onNow: () =>
              setSleepLog({ ...sleepLog, bedtime: nowTimeValue() }),
          })}

          <button
            type="button"
            disabled={isSavingEntry}
            onClick={async () => {
              await withSaveProtection(
                () => ({
                  section: "Sleep",
                  summary: `Sleep log · ${sleepLog.bedtime || "Time not set"}`,
                  details: [`Date: ${sleepLog.date}`],
                }),
                () =>
                  saveSleepEntryToSupabase({
                    entryType: "Sleep log",
                    date: sleepLog.date,
                    timeValue: sleepLog.bedtime,
                  }),
                async () => {
                  resetSleepLog();
                },
              );
            }}
            className={`w-full rounded-2xl px-5 py-3 font-semibold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-60 bg-gradient-to-r ${activeSection.color}`}
          >
            {isSavingEntry ? "Saving..." : "Save sleep log"}
          </button>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
            Wake log
          </p>

          {renderDateInput({
            label: "Date",
            value: wakeLog.date,
            onChange: (date) => setWakeLog({ ...wakeLog, date }),
          })}

          {renderTimeInput({
            label: "Wake time",
            value: wakeLog.wakeTime,
            onChange: (wakeTime) => setWakeLog({ ...wakeLog, wakeTime }),
            onNow: () =>
              setWakeLog({ ...wakeLog, wakeTime: nowTimeValue() }),
          })}

          <button
            type="button"
            disabled={isSavingEntry || !wakeLog.wakeTime}
            onClick={async () => {
              await withSaveProtection(
                () => ({
                  section: "Sleep",
                  summary: `Wake log · ${wakeLog.wakeTime || "Time not set"}`,
                  details: [`Date: ${wakeLog.date}`],
                }),
                () =>
                  saveSleepEntryToSupabase({
                    entryType: "Wake log",
                    date: wakeLog.date,
                    timeValue: wakeLog.wakeTime,
                  }),
                async () => {
                  resetWakeLog();
                },
              );
            }}
            className={`w-full rounded-2xl px-5 py-3 font-semibold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-60 bg-gradient-to-r ${activeSection.color}`}
          >
            {isSavingEntry ? "Saving..." : "Save wake log"}
          </button>
        </div>
      </div>
    );
  };

  const renderReportEntries = ({ mode = "screen" }) => {
    const isPdf = mode === "pdf";

    const compactCardClass = isPdf
      ? "break-inside-avoid rounded-xl border px-3 py-2.5 text-[12px] leading-5 text-slate-700"
      : "rounded-xl border px-3 py-2.5 text-sm leading-5 text-slate-700 md:px-3.5 md:py-3";

    const sectionHeaderClass = isPdf
      ? "report-section-title rounded-xl border px-3 py-2"
      : "report-section-title rounded-xl border px-3 py-2.5";

    if (!recentEntries.length) {
      return (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm font-medium text-slate-500">
          Nothing logged yet for these filters.
        </div>
      );
    }

    if (reportLayout === "timeline") {
      return (
        <div className={isPdf ? "space-y-2.5" : "space-y-2"}>
          <div className={`${sectionHeaderClass} border-slate-800 bg-slate-800`}>
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-xs font-bold uppercase tracking-[0.16em] text-white md:text-sm">
                Timeline
              </h4>
              <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                {recentEntries.length} item{recentEntries.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {timelineGroups.map((group) => (
            <div key={group.date} className="space-y-2">
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600">
                  {group.label}
                </p>
              </div>

              <div className={isPdf ? "grid grid-cols-2 gap-2.5" : "space-y-2"}>
                {group.entries.map((entry) => {
                  const theme = sectionTheme[entry.section] || {
                    report: "border-slate-200 bg-slate-50",
                  };

                  return (
                    <div
                      key={entry.id}
                      className={`${compactCardClass} ${theme.report}`}
                    >
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 inline-flex rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
                            {entry.section}
                          </div>
                          <p className="font-bold leading-5 text-slate-900">
                            {entry.summary}
                          </p>
                        </div>

                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 sm:whitespace-nowrap sm:text-right">
                          {entry.time || "Time not set"}
                        </span>
                      </div>

                      {entry.details?.length ? (
                        <div className="mt-1.5 space-y-0.5 break-words text-[12px] leading-5 text-slate-600">
                          {entry.details.map((detail, index) => (
                            <p key={index}>{detail}</p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      );
    }

    const orderedSections = [
      "Food Diary",
      "Medication",
      "Toileting",
      "Health",
      "Sleep",
    ];

    return (
      <div className={isPdf ? "space-y-3" : "space-y-2"}>
        {orderedSections.map((section) => {
          const entries = groupedReportEntries[section] || [];
          if (!entries.length) return null;

          const theme = sectionTheme[section] || {
            report: "border-slate-200 bg-slate-50",
            solidHeader: "bg-slate-700 text-white border-slate-800",
          };

          return (
            <div key={section} className="space-y-2">
              <div className={`${sectionHeaderClass} ${theme.solidHeader}`}>
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-xs font-bold uppercase tracking-[0.16em] text-white md:text-sm">
                    {section}
                  </h4>
                  <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                    {entries.length} item{entries.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              <div className={isPdf ? "grid grid-cols-2 gap-2.5" : "space-y-2"}>
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`${compactCardClass} ${theme.report}`}
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <span className="font-bold leading-5 text-slate-900">
                        {entry.summary}
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 sm:whitespace-nowrap sm:text-right">
                        {entry.date}
                        {entry.time ? ` · ${entry.time}` : ""}
                      </span>
                    </div>

                    {entry.details?.length ? (
                      <div className="mt-1.5 space-y-0.5 break-words text-[12px] leading-5 text-slate-600">
                        {entry.details.map((detail, index) => (
                          <p key={index}>{detail}</p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
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
        className="w-[1200px] bg-white px-8 py-6 text-slate-900"
      >
        <div className="rounded-2xl bg-slate-800 px-6 py-4">
          <h1 className="text-center text-2xl font-bold uppercase tracking-[0.18em] text-white">
            Kaylen’s Diary
          </h1>
        </div>

        <div className="mt-4 grid grid-cols-[1.5fr_1fr] gap-4">
          <div className="rounded-2xl border border-slate-300 bg-slate-50 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
              Report summary
            </p>
            <h2 className="mt-2 text-xl font-bold text-slate-900">
              {reportLayout === "timeline" ? "Timeline" : "By category"}
              {reportCategoryFilter !== "All" ? ` · ${reportCategoryFilter}` : ""}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Compact export view with colour-coded sections.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-300 bg-slate-50 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
              Snapshot
            </p>
            <div className="mt-2 space-y-1 text-sm font-semibold text-slate-700">
              <p>
                Last {effectiveReportDays} day{effectiveReportDays === 1 ? "" : "s"}
              </p>
              <p>
                {recentEntries.length} entr{recentEntries.length === 1 ? "y" : "ies"}
              </p>
              <p>
                {reportCategoryFilter === "All"
                  ? "All categories"
                  : reportCategoryFilter}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4">{renderReportEntries({ mode: "pdf" })}</div>
      </div>
    </div>
  );

  const renderReportsForm = () => {
    const filtersLabel =
      reportCategoryFilter === "All"
        ? "All categories"
        : reportCategoryFilter;

    const layoutLabel =
      reportLayout === "timeline" ? "Timeline" : "By category";

    const categoryOptions = [
      "All",
      "Food Diary",
      "Medication",
      "Toileting",
      "Health",
      "Sleep",
    ];

    return (
      <>
        {renderPdfExportArea()}

        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-slate-300 bg-slate-50/80 p-3 shadow-sm md:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">
                    Quick range
                  </label>
                  <select
                    className={`${inputClassName} min-h-[46px]`}
                    value={reportDays}
                    onChange={(e) => setReportDays(e.target.value)}
                  >
                    <option value="7">7 days</option>
                    <option value="14">14 days</option>
                    <option value="30">30 days</option>
                    <option value="60">60 days</option>
                    <option value="90">90 days</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">
                    View
                  </label>
                  <select
                    className={`${inputClassName} min-h-[46px]`}
                    value={reportLayout}
                    onChange={(e) => setReportLayout(e.target.value)}
                  >
                    <option value="timeline">Timeline</option>
                    <option value="category">By category</option>
                  </select>
                </div>

                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">
                    Category
                  </label>
                  <select
                    className={`${inputClassName} min-h-[46px]`}
                    value={reportCategoryFilter}
                    onChange={(e) => setReportCategoryFilter(e.target.value)}
                  >
                    {categoryOptions.map((option) => (
                      <option key={option} value={option}>
                        {option === "All" ? "All categories" : option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={cardClassName}>
                  <label className="text-sm font-semibold text-slate-700">
                    Active range
                  </label>
                  <div className="mt-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                    Last {effectiveReportDays} day
                    {effectiveReportDays === 1 ? "" : "s"}
                  </div>
                </div>
              </div>

              <div className="flex w-full gap-2 lg:w-auto">
                <button
                  type="button"
                  onClick={() => setReportFiltersOpen((current) => !current)}
                  className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 lg:min-w-[180px]"
                >
                  {reportFiltersOpen ? "Hide advanced" : "Show advanced"}
                </button>
              </div>
            </div>

            {reportFiltersOpen ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 md:p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className={cardClassName}>
                    <label className="text-sm font-semibold text-slate-700">
                      Custom number of days
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Enter number of days"
                      className={`${inputClassName} min-h-[46px]`}
                      value={customReportDays}
                      onChange={(e) => setCustomReportDays(e.target.value)}
                      disabled={reportDays !== "custom"}
                    />
                  </div>

                  <div className={cardClassName}>
                    <label className="text-sm font-semibold text-slate-700">
                      Current layout
                    </label>
                    <div className="mt-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                      {layoutLabel}
                    </div>
                  </div>

                  <div className={cardClassName}>
                    <label className="text-sm font-semibold text-slate-700">
                      Current filter
                    </label>
                    <div className="mt-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                      {filtersLabel}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-300 bg-slate-50/80 p-3 shadow-sm md:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <label className="text-sm font-semibold text-slate-700">
                  Report view
                </label>
                <p className="mt-1 text-sm text-slate-500">
                  {reportLayout === "timeline"
                    ? "Showing entries in time order."
                    : "Grouped by category with matching colours."}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                  {layoutLabel}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                  {filtersLabel}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                  Last {effectiveReportDays} days
                </span>
              </div>
            </div>

            <div className="mt-3">{renderReportEntries({ mode: "screen" })}</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
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

            <button
              type="button"
              onClick={loadEntriesFromSupabase}
              className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Refresh entries
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

  const handleTouchStart = (e) => {
    if (activeSection) return;
    if (window.scrollY > 0) return;
    lastPullStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e) => {
    if (activeSection) return;
    if (lastPullStartY.current === null) return;

    const currentY = e.touches[0].clientY;
    const distance = currentY - lastPullStartY.current;

    if (distance > 0) {
      setPullDistance(Math.min(distance, 120));
    }
  };

  const handleTouchEnd = async () => {
    if (activeSection) {
      lastPullStartY.current = null;
      setPullDistance(0);
      return;
    }

    if (pullDistance > 80 && !isRefreshing) {
      try {
        setIsRefreshing(true);
        await loadEntriesFromSupabase();
      } finally {
        setTimeout(() => {
          setIsRefreshing(false);
          setPullDistance(0);
        }, 450);
      }
    } else {
      setPullDistance(0);
    }

    lastPullStartY.current = null;
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

              <div className="mt-6 w-full rounded-2xl bg-slate-800 px-6 py-4 shadow-md">
                <h1 className="text-center text-xl font-bold uppercase tracking-[0.18em] text-white md:text-2xl">
                  Kaylen’s Diary
                </h1>
              </div>

              <p className="mt-3 text-sm font-medium leading-6 text-slate-600">
                Enter PIN to access the diary.
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
    <div
      className="min-h-screen bg-gradient-to-br from-white to-slate-100 text-slate-900"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="sticky top-0 z-20 pointer-events-none">
        {(pullDistance > 0 || isRefreshing) && !activeSection ? (
          <div className="flex justify-center pt-2">
            <div className="pointer-events-auto rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-sm">
              {isRefreshing
                ? "Refreshing..."
                : pullDistance > 80
                  ? "Release to refresh"
                  : "Pull to refresh"}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-5 md:px-6 md:py-8">
        <header className="mb-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div className="hidden sm:block" />

            <div className="w-full rounded-2xl bg-slate-800 px-5 py-4 shadow-md">
              <h1 className="text-center text-xl font-bold uppercase tracking-[0.18em] text-white md:text-2xl">
                Kaylen’s Diary
              </h1>
            </div>

            <div className="flex justify-center sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsUnlocked(false);
                  setPasswordInput("");
                  setPasswordError("");
                  setActiveSection(null);
                }}
                className="shrink-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Lock
              </button>
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
                className={`group flex min-h-[15.5rem] flex-col rounded-[2rem] border p-4 shadow-md transition duration-200 hover:-translate-y-1 hover:shadow-lg sm:p-5 ${section.soft}`}
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