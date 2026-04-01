import { useEffect, useMemo, useState } from "react";
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

const makeId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

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

const dateTimeInputClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

const sectionTheme = {
  "Food Diary": {
    report: "border-emerald-200 bg-emerald-50",
    badge: "bg-emerald-100 text-emerald-700",
  },
  Medication: {
    report: "border-rose-200 bg-rose-50",
    badge: "bg-rose-100 text-rose-700",
  },
  Toileting: {
    report: "border-sky-200 bg-sky-50",
    badge: "bg-sky-100 text-sky-700",
  },
  Health: {
    report: "border-emerald-200 bg-green-50",
    badge: "bg-green-100 text-green-700",
  },
  Sleep: {
    report: "border-indigo-200 bg-indigo-50",
    badge: "bg-indigo-100 text-indigo-700",
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

  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);

  const [activeSection, setActiveSection] = useState(null);
  const [medicationValue, setMedicationValue] = useState("");
  const [foodValue, setFoodValue] = useState("");
  const [reportDays, setReportDays] = useState("7");
  const [sharedLog, setSharedLog] = useState([]);
  const [shareCopied, setShareCopied] = useState(false);

  const [savedFoodOptions, setSavedFoodOptions] = useState([]);
  const [savedMedicationOptions, setSavedMedicationOptions] = useState([]);
  const [saveFoodForFuture, setSaveFoodForFuture] = useState(false);
  const [saveMedicationForFuture, setSaveMedicationForFuture] =
    useState(false);

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

  const [sleepForm, setSleepForm] = useState({
    date: todayValue(),
    quality: "Good",
    bedtime: nowTimeValue(),
    wakeTime: "",
    nightWakings: "",
    nap: "No",
    notes: "",
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
      subtitle: "Dropdown + other option",
      button: "Open Log",
      emoji: "💊",
      color: "from-rose-400 to-pink-500",
      soft: "bg-rose-50 border-rose-300",
    },
    {
      title: "Toileting",
      subtitle: "Quick combined entry logging",
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
      subtitle: "Night sleep and nap tracking",
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
    "Calcichew",
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

  const inputClassName =
    "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

  const cardClassName =
    "rounded-2xl border border-slate-300 bg-slate-50/80 p-4 shadow-sm";

  const openSection = (section) => {
    setActiveSection(section);
    if (section.title !== "Medication") setMedicationValue("");
    if (section.title !== "Food Diary") setFoodValue("");
    setShareCopied(false);
  };

  const closeSection = () => {
    setActiveSection(null);
    setMedicationValue("");
    setFoodValue("");
    setShareCopied(false);
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
      date: todayValue(),
      notes: "",
    });
    setMedicationValue("");
    setSaveMedicationForFuture(false);
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

    const mappedSleepEntries = (sleepData || []).map((row) => ({
      id: `sleep-${row.id}`,
      createdAt: row.time || new Date().toISOString(),
      section: "Sleep",
      date: parseNotesValue(row.notes, "Date") || todayValue(),
      time: row.bedtime || "",
      summary: `${row.quality || "Sleep"} · wake ${
        row.wake_time || "Not set"
      }`,
      details: [
        `Night wakings: ${row.night_wakings || "0"}`,
        `Daytime nap: ${row.nap || "Not set"}`,
        parseNotesValue(row.notes, "Notes")
          ? `Notes: ${parseNotesValue(row.notes, "Notes")}`
          : null,
      ].filter(Boolean),
    }));

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
        return "Track bedtime, wake time, and sleep quality.";
      case "Reports":
        return "View recent entries and share or export the report.";
      default:
        return "Form preview";
    }
  }, [activeSection]);

  const recentEntries = useMemo(() => {
    const days = Number(reportDays) || 7;
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (days - 1));

    return sharedLog.filter((entry) => {
      if (!entry.date) return false;
      const [day, month, year] = entry.date.split("/");
      const entryDate = new Date(`${year}-${month}-${day}T00:00:00`);
      return !Number.isNaN(entryDate.getTime()) && entryDate >= cutoff;
    });
  }, [reportDays, sharedLog]);

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

  const saveMedicationEntryToSupabase = async ({ selectedMedicine }) => {
    const payload = {
      medicine: selectedMedicine || "Medication",
      dose: medicationForm.dose || "",
      time: new Date().toISOString(),
      notes: [
        `Date: ${medicationForm.date}`,
        `Time: ${medicationForm.time}`,
        `Given by: ${medicationForm.givenBy || "Not set"}`,
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

  const saveSleepEntryToSupabase = async () => {
    const payload = {
      quality: sleepForm.quality || "",
      bedtime: sleepForm.bedtime || "",
      wake_time: sleepForm.wakeTime || "",
      night_wakings: sleepForm.nightWakings || "0",
      nap: sleepForm.nap || "",
      time: new Date().toISOString(),
      notes: [
        `Date: ${sleepForm.date}`,
        sleepForm.notes ? `Notes: ${sleepForm.notes}` : null,
      ]
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

  const reportText = useMemo(() => {
    const order = ["Food Diary", "Medication", "Toileting", "Health", "Sleep"];

    return [
      `Kaylen's Diary Report - Last ${reportDays} days`,
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
  }, [groupedReportEntries, recentEntries.length, reportDays]);

  const handleExportPdf = () => {
    window.print();
  };

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

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Time</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            className={dateTimeInputClass}
            value={foodForm.time}
            onChange={(e) =>
              setFoodForm({ ...foodForm, time: formatTimeInput(e.target.value) })
            }
          />
        </div>

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
            onClick={async () => {
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
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color}`}
          >
            Save food entry
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

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Time</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            className={dateTimeInputClass}
            value={medicationForm.time}
            onChange={(e) =>
              setMedicationForm({
                ...medicationForm,
                time: formatTimeInput(e.target.value),
              })
            }
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Given by
          </label>
          <input
            type="text"
            placeholder="Name of person giving medication"
            className={`${inputClassName} min-h-[48px]`}
            value={medicationForm.givenBy}
            onChange={(e) =>
              setMedicationForm({ ...medicationForm, givenBy: e.target.value })
            }
          />
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
            onClick={async () => {
              if (selectedMedicine === "Melatonin" && !medicationForm.notes.trim()) {
                alert("Notes are required for Melatonin");
                return;
              }

              const saved = await saveMedicationEntryToSupabase({
                selectedMedicine,
              });

              if (!saved) return;

              await loadEntriesFromSupabase();

              if (showOtherMedication && saveMedicationForFuture) {
                setSavedMedicationOptions((current) =>
                  dedupeAppend(current, medicationForm.otherMedicine),
                );
              }

              resetMedicationForm();
              closeSection();
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color}`}
          >
            Save medication entry
          </button>
        </div>
      </div>
    );
  };

  const renderToiletingForm = () => {
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

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Time</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            className={dateTimeInputClass}
            value={toiletingForm.time}
            onChange={(e) =>
              setToiletingForm({
                ...toiletingForm,
                time: formatTimeInput(e.target.value),
              })
            }
          />
        </div>

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
            onClick={async () => {
              const saved = await saveToiletingEntryToSupabase();

              if (!saved) return;

              await loadEntriesFromSupabase();
              resetToiletingForm();
              closeSection();
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color}`}
          >
            Save toileting entry
          </button>
        </div>
      </div>
    );
  };

  const renderHealthForm = () => {
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

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Time</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            className={dateTimeInputClass}
            value={healthForm.time}
            onChange={(e) =>
              setHealthForm({
                ...healthForm,
                time: formatTimeInput(e.target.value),
              })
            }
          />
        </div>

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
            onClick={async () => {
              const saved = await saveHealthEntryToSupabase();

              if (!saved) return;

              await loadEntriesFromSupabase();
              resetHealthForm();
              closeSection();
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color}`}
          >
            Save health entry
          </button>
        </div>
      </div>
    );
  };

  const renderSleepForm = () => {
    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Date</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="DD/MM/YYYY"
            className={dateTimeInputClass}
            value={sleepForm.date}
            onChange={(e) =>
              setSleepForm({ ...sleepForm, date: e.target.value })
            }
          />
        </div>

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
            Bedtime
          </label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            className={dateTimeInputClass}
            value={sleepForm.bedtime}
            onChange={(e) =>
              setSleepForm({
                ...sleepForm,
                bedtime: formatTimeInput(e.target.value),
              })
            }
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Wake time
          </label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            className={dateTimeInputClass}
            value={sleepForm.wakeTime}
            onChange={(e) =>
              setSleepForm({
                ...sleepForm,
                wakeTime: formatTimeInput(e.target.value),
              })
            }
          />
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
            onChange={(e) => setSleepForm({ ...sleepForm, nap: e.target.value })}
          >
            <option value="">Select option</option>
            <option>No</option>
            <option>Yes</option>
          </select>
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Notes</label>
          <textarea
            rows={5}
            placeholder="Anything unusual about sleep"
            className={`${inputClassName} min-h-[48px]`}
            value={sleepForm.notes}
            onChange={(e) => setSleepForm({ ...sleepForm, notes: e.target.value })}
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            onClick={async () => {
              const saved = await saveSleepEntryToSupabase();

              if (!saved) return;

              await loadEntriesFromSupabase();
              resetSleepForm();
              closeSection();
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color}`}
          >
            Save sleep entry
          </button>
        </div>
      </div>
    );
  };

  const renderReportsForm = () => {
    const orderedSections = [
      "Food Diary",
      "Medication",
      "Toileting",
      "Health",
      "Sleep",
    ];

    const handleShareReport = async () => {
      try {
        if (typeof navigator !== "undefined" && navigator.share) {
          await navigator.share({
            title: `Kaylen's Diary Report - Last ${reportDays} days`,
            text: reportText,
          });
          return;
        }

        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(reportText);
          setShareCopied(true);
          setTimeout(() => setShareCopied(false), 2000);
          return;
        }

        const textArea = document.createElement("textarea");
        textArea.value = reportText;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      } catch (error) {
        console.error("Share failed", error);
      }
    };

    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Quick range
          </label>
          <select
            className={`${inputClassName} min-h-[48px]`}
            value={reportDays}
            onChange={(e) => setReportDays(e.target.value)}
          >
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">
            Entries found
          </label>
          <div className="mt-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
            {recentEntries.length} entries in shared log
          </div>
        </div>

        <div id="report-print-area" className={`${cardClassName} md:col-span-2`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <label className="text-sm font-semibold text-slate-700">
                Report view
              </label>
              <p className="mt-1 text-sm text-slate-500">
                Grouped by category with matching colours.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
              Last {reportDays} days
            </span>
          </div>

          <div className="mt-4 space-y-5">
            {recentEntries.length ? (
              orderedSections.map((section) => {
                const entries = groupedReportEntries[section] || [];
                if (!entries.length) return null;

                const theme = sectionTheme[section] || {
                  report: "border-slate-200 bg-slate-50",
                  badge: "bg-slate-100 text-slate-700",
                };

                return (
                  <div key={section} className="space-y-3">
                    <div
                      className={`rounded-2xl border px-4 py-3 ${theme.report}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-base font-bold text-slate-900">
                          {section}
                        </h4>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${theme.badge}`}
                        >
                          {entries.length} item{entries.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>

                    {entries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`rounded-xl border px-4 py-3 text-sm text-slate-700 ${theme.report}`}
                      >
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <span className="font-bold text-slate-900">
                            {entry.summary}
                          </span>
                          <span className="break-words text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 sm:text-right">
                            {entry.date}
                            {entry.time ? ` · ${entry.time}` : ""}
                          </span>
                        </div>
                        {entry.details?.length ? (
                          <div className="mt-2 space-y-1 break-words text-slate-600">
                            {entry.details.map((detail, index) => (
                              <p key={index}>{detail}</p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm font-medium text-slate-500">
                Nothing logged yet. Save entries from Food, Medication,
                Toileting, Health, or Sleep.
              </div>
            )}
          </div>
        </div>

        <div className="md:col-span-2 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color}`}
          >
            Run report
          </button>
          <button
            type="button"
            onClick={handleShareReport}
            className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            {shareCopied ? "Report copied" : "Share report"}
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Export PDF
          </button>
        </div>
      </div>
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
              <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-700">
                Kaylen’s diary
              </h1>
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-white to-slate-100 text-slate-900">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #report-print-area, #report-print-area * {
            visibility: visible;
          }
          #report-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white;
            padding: 24px;
          }
        }
      `}</style>

      <div className="mx-auto max-w-6xl px-6 py-10 md:py-14">
        <header className="rounded-[2rem] border border-slate-300 bg-white p-10 shadow-md md:p-12">
          <div className="flex flex-col items-center gap-5 text-center">
            <button
              type="button"
              onClick={() => {
                setIsUnlocked(false);
                setPasswordInput("");
                setPasswordError("");
                setActiveSection(null);
              }}
              className="self-end rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              Lock
            </button>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-600 md:text-5xl">
              Kaylen’s diary
            </h1>
          </div>
        </header>

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

        <section className="mt-8 grid gap-5 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5 text-center shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Sections
            </p>
            <p className="mt-2 text-4xl font-bold">6</p>
          </div>
          <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5 text-center shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Recent range
            </p>
            <p className="mt-2 text-4xl font-bold">{reportDays}d</p>
          </div>
          <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5 text-center shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Shared log
            </p>
            <p className="mt-2 text-4xl font-bold">{sharedLog.length}</p>
          </div>
        </section>
      </div>

      {activeSection ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 p-3 backdrop-blur-sm md:p-4">
          <div className="flex min-h-full items-start justify-center py-2 md:items-center md:py-4">
            <div className="relative my-auto w-full max-w-2xl rounded-[2rem] border border-slate-200 bg-white p-4 shadow-2xl sm:p-5 md:p-8">
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