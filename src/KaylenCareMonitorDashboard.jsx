import { useEffect, useMemo, useState } from "react";
import { supabase } from "./Superbase";

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

const dateTimeInputClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

const parseEntryDateTime = (dateStr, timeStr = "00:00") => {
  if (!dateStr) return new Date(0);

  const [day, month, year] = (dateStr || "").split("/");
  if (!day || !month || !year) return new Date(0);

  const [hours = "00", minutes = "00"] = (timeStr || "00:00").split(":");
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    0,
    0,
  );

  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
};

export default function KaylenCareMonitorDashboard() {
  const APP_PASSWORD = "Kaylen0309!";

  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);

  const [activeSection, setActiveSection] = useState(null);
  const [medicationValue, setMedicationValue] = useState("");
  const [foodValue, setFoodValue] = useState("");
  const [reportDays, setReportDays] = useState("7");
  const [sharedLog, setSharedLog] = useState([]);
  const [shareCopied, setShareCopied] = useState(false);
  const [isLoadingLog, setIsLoadingLog] = useState(false);
  const [isSavingEntry, setIsSavingEntry] = useState(false);
  const [logError, setLogError] = useState("");

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
    weightKg: "",
    weightLb: "",
    heightCm: "",
    heightFt: "",
    heightIn: "",
  });

  const [sleepForm, setSleepForm] = useState({
    date: todayValue(),
    quality: "",
    bedtime: nowTimeValue(),
    wakeTime: "",
    nightWakings: "",
    nap: "",
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

  const fetchSharedLog = async () => {
    setIsLoadingLog(true);
    setLogError("");

    const { data, error } = await supabase
      .from("shared_log")
      .select("*")
      .order("logged_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load log:", error);
      setLogError("Could not load the shared log.");
      setSharedLog([]);
      setIsLoadingLog(false);
      return;
    }

    const mapped = (data || []).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      section: row.section,
      date: row.entry_date,
      time: row.entry_time,
      summary: row.summary,
      details: Array.isArray(row.details) ? row.details : [],
    }));

    setSharedLog(mapped);
    setIsLoadingLog(false);
  };

  useEffect(() => {
    if (isUnlocked) {
      fetchSharedLog();
    }
  }, [isUnlocked]);

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

  const addLogEntry = async (entry) => {
    setIsSavingEntry(true);
    setLogError("");

    const rowToInsert = {
      id: makeId(),
      section: entry.section,
      entry_date: entry.date || "",
      entry_time: entry.time || "",
      summary: entry.summary || "",
      details: entry.details || [],
      logged_at: parseEntryDateTime(entry.date, entry.time).toISOString(),
    };

    const { data, error } = await supabase
      .from("shared_log")
      .insert([rowToInsert])
      .select()
      .single();

    if (error) {
      console.error("Failed to save entry:", error);
      setLogError("Failed to save entry.");
      setIsSavingEntry(false);
      return false;
    }

    const savedEntry = {
      id: data.id,
      createdAt: data.created_at,
      section: data.section,
      date: data.entry_date,
      time: data.entry_time,
      summary: data.summary,
      details: Array.isArray(data.details) ? data.details : [],
    };

    setSharedLog((current) => [savedEntry, ...current]);
    closeSection();
    setIsSavingEntry(false);
    return true;
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
      quality: "",
      bedtime: nowTimeValue(),
      wakeTime: "",
      nightWakings: "",
      nap: "",
      notes: "",
    });
  };

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
        return "View recent entries and share the report.";
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
      const entryDate = parseEntryDateTime(entry.date, entry.time);
      return entryDate >= cutoff;
    });
  }, [reportDays, sharedLog]);

  const latestBySection = useMemo(() => {
    const findLatest = (sectionTitle) =>
      sharedLog.find((entry) => entry.section === sectionTitle) || null;

    return {
      food: findLatest("Food Diary"),
      medication: findLatest("Medication"),
      toileting: findLatest("Toileting"),
      health: findLatest("Health"),
      sleep: findLatest("Sleep"),
    };
  }, [sharedLog]);

  const tileStatusText = (sectionTitle) => {
    const formatLatest = (entry) => {
      if (!entry) return "Nothing logged yet";
      return `${entry.summary}${entry.time ? ` · ${entry.time}` : ""}`;
    };

    switch (sectionTitle) {
      case "Food Diary":
        return formatLatest(latestBySection.food);
      case "Medication":
        return formatLatest(latestBySection.medication);
      case "Toileting":
        return formatLatest(latestBySection.toileting);
      case "Health":
        return formatLatest(latestBySection.health);
      case "Sleep":
        return formatLatest(latestBySection.sleep);
      default:
        return "";
    }
  };

  const renderFoodForm = () => {
    const showOtherFood = foodValue === "Other";
    const showOtherLocation = foodForm.location === "Other";
    const selectedFood = showOtherFood
      ? foodForm.otherItem
      : foodForm.item || foodValue;
    const isMilk = selectedFood?.toLowerCase() === "milk";

    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={`${cardClassName} min-w-0`}>
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

        <div className={`${cardClassName} min-w-0`}>
          <label className="text-sm font-semibold text-slate-700">Time</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            className={dateTimeInputClass}
            value={foodForm.time}
            onChange={(e) => setFoodForm({ ...foodForm, time: e.target.value })}
          />
        </div>

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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
          <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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
            <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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
            <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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
              const amountText = isMilk
                ? `${foodForm.amount || 0}oz`
                : foodForm.amount || "No amount";

              const saved = await addLogEntry({
                section: "Food Diary",
                date: foodForm.date,
                time: foodForm.time,
                summary: `${
                  showOtherFood
                    ? foodForm.otherItem || "Food entry"
                    : foodForm.item || "Food entry"
                } · ${amountText}`,
                details: [
                  `Location: ${
                    showOtherLocation
                      ? foodForm.otherLocation || "Other"
                      : foodForm.location || "Not set"
                  }`,
                  foodForm.notes ? `Notes: ${foodForm.notes}` : null,
                ].filter(Boolean),
              });

              if (!saved) return;

              if (showOtherFood && saveFoodForFuture) {
                setSavedFoodOptions((current) =>
                  dedupeAppend(current, foodForm.otherItem),
                );
              }

              resetFoodForm();
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} ${
              isSavingEntry ? "opacity-70 cursor-not-allowed" : ""
            }`}
          >
            {isSavingEntry ? "Saving..." : "Save food entry"}
          </button>
        </div>
      </div>
    );
  };

  const renderMedicationForm = () => {
    const showOtherMedication = medicationValue === "Other";

    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Medicine
          </label>
          <select
            value={medicationValue}
            onChange={(e) => {
              const value = e.target.value;
              setMedicationValue(value);
              setMedicationForm({
                ...medicationForm,
                medicine: value,
                otherMedicine:
                  value === "Other" ? medicationForm.otherMedicine : "",
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
            <div className={`${cardClassName} min-w-0 md:col-span-2`}>
              <label className="text-sm font-semibold text-slate-700">
                Other medicine
              </label>
              <input
                type="text"
                placeholder="Type medicine name if not in dropdown"
                className={`${inputClassName} min-h-[48px] border-dashed`}
                value={medicationForm.otherMedicine}
                onChange={(e) =>
                  setMedicationForm({
                    ...medicationForm,
                    otherMedicine: e.target.value,
                  })
                }
              />
            </div>
            <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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

        <div className={`${cardClassName} min-w-0`}>
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

        <div className={`${cardClassName} min-w-0`}>
          <label className="text-sm font-semibold text-slate-700">Time</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            className={dateTimeInputClass}
            value={medicationForm.time}
            onChange={(e) =>
              setMedicationForm({ ...medicationForm, time: e.target.value })
            }
          />
        </div>

        <div className={`${cardClassName} min-w-0`}>
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

        <div className={`${cardClassName} min-w-0`}>
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

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Notes</label>
          <textarea
            placeholder="Optional notes"
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
              const saved = await addLogEntry({
                section: "Medication",
                date: medicationForm.date,
                time: medicationForm.time,
                summary: `${
                  showOtherMedication
                    ? medicationForm.otherMedicine || "Other medicine"
                    : medicationForm.medicine || "Medication"
                } · ${medicationForm.dose || "No dose"}`,
                details: [
                  `Given by: ${medicationForm.givenBy || "Not set"}`,
                  medicationForm.notes ? `Notes: ${medicationForm.notes}` : null,
                ].filter(Boolean),
              });

              if (!saved) return;

              if (showOtherMedication && saveMedicationForFuture) {
                setSavedMedicationOptions((current) =>
                  dedupeAppend(current, medicationForm.otherMedicine),
                );
              }

              resetMedicationForm();
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} ${
              isSavingEntry ? "opacity-70 cursor-not-allowed" : ""
            }`}
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
        <div className={`${cardClassName} min-w-0`}>
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

        <div className={`${cardClassName} min-w-0`}>
          <label className="text-sm font-semibold text-slate-700">Time</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            className={dateTimeInputClass}
            value={toiletingForm.time}
            onChange={(e) =>
              setToiletingForm({ ...toiletingForm, time: e.target.value })
            }
          />
        </div>

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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
              const saved = await addLogEntry({
                section: "Toileting",
                date: toiletingForm.date,
                time: toiletingForm.time,
                summary: toiletingForm.entry || "Toileting entry",
                details: [
                  toiletingForm.notes ? `Notes: ${toiletingForm.notes}` : null,
                ].filter(Boolean),
              });

              if (!saved) return;
              resetToiletingForm();
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} ${
              isSavingEntry ? "opacity-70 cursor-not-allowed" : ""
            }`}
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
        <div className={`${cardClassName} min-w-0`}>
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

        <div className={`${cardClassName} min-w-0`}>
          <label className="text-sm font-semibold text-slate-700">Time</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            className={dateTimeInputClass}
            value={healthForm.time}
            onChange={(e) =>
              setHealthForm({ ...healthForm, time: e.target.value })
            }
          />
        </div>

        <div className={`${cardClassName} min-w-0`}>
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

        <div className={`${cardClassName} min-w-0`}>
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

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Weight</label>
          <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="min-w-0">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Metric (kg)
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="e.g. 18.4"
                className={`${inputClassName} min-h-[48px] mt-1`}
                value={healthForm.weightKg}
                onChange={(e) =>
                  setHealthForm({ ...healthForm, weightKg: e.target.value })
                }
              />
            </div>
            <div className="min-w-0">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Imperial (lb)
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="e.g. 40.6"
                className={`${inputClassName} min-h-[48px] mt-1`}
                value={healthForm.weightLb}
                onChange={(e) =>
                  setHealthForm({ ...healthForm, weightLb: e.target.value })
                }
              />
            </div>
          </div>
        </div>

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Height</label>
          <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="min-w-0">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Metric (cm)
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="e.g. 105.5"
                className={`${inputClassName} min-h-[48px] mt-1`}
                value={healthForm.heightCm}
                onChange={(e) =>
                  setHealthForm({ ...healthForm, heightCm: e.target.value })
                }
              />
            </div>
            <div className="min-w-0">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Imperial (ft / in)
              </label>
              <div className="mt-1 grid grid-cols-2 gap-3">
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="ft"
                  className={`${inputClassName} min-h-[48px] mt-0`}
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
                  className={`${inputClassName} min-h-[48px] mt-0`}
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
              const saved = await addLogEntry({
                section: "Health",
                date: healthForm.date,
                time: healthForm.time,
                summary: `${healthForm.event || "Health"} · ${
                  healthForm.duration || "No duration"
                }`,
                details: [
                  healthForm.happened
                    ? `What happened: ${healthForm.happened}`
                    : null,
                  healthForm.action
                    ? `Action taken: ${healthForm.action}`
                    : null,
                  healthForm.weightKg
                    ? `Weight (kg): ${healthForm.weightKg}`
                    : null,
                  healthForm.weightLb
                    ? `Weight (lb): ${healthForm.weightLb}`
                    : null,
                  healthForm.heightCm
                    ? `Height (cm): ${healthForm.heightCm}`
                    : null,
                  healthForm.heightFt || healthForm.heightIn
                    ? `Height (ft/in): ${healthForm.heightFt || 0}ft ${
                        healthForm.heightIn || 0
                      }in`
                    : null,
                ].filter(Boolean),
              });

              if (!saved) return;
              resetHealthForm();
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} ${
              isSavingEntry ? "opacity-70 cursor-not-allowed" : ""
            }`}
          >
            {isSavingEntry ? "Saving..." : "Save health entry"}
          </button>
        </div>
      </div>
    );
  };

  const renderSleepForm = () => {
    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={`${cardClassName} min-w-0`}>
          <label className="text-sm font-semibold text-slate-700">Date</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="DD/MM/YYYY"
            className={dateTimeInputClass}
            value={sleepForm.date}
            onChange={(e) => setSleepForm({ ...sleepForm, date: e.target.value })}
          />
        </div>

        <div className={`${cardClassName} min-w-0`}>
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

        <div className={`${cardClassName} min-w-0`}>
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
              setSleepForm({ ...sleepForm, bedtime: e.target.value })
            }
          />
        </div>

        <div className={`${cardClassName} min-w-0`}>
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
              setSleepForm({ ...sleepForm, wakeTime: e.target.value })
            }
          />
        </div>

        <div className={`${cardClassName} min-w-0`}>
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

        <div className={`${cardClassName} min-w-0`}>
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

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
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
            disabled={isSavingEntry}
            onClick={async () => {
              const saved = await addLogEntry({
                section: "Sleep",
                date: sleepForm.date,
                time: sleepForm.bedtime,
                summary: `${sleepForm.quality || "Sleep"} · wake ${
                  sleepForm.wakeTime || "Not set"
                }`,
                details: [
                  `Night wakings: ${sleepForm.nightWakings || "0"}`,
                  `Daytime nap: ${sleepForm.nap || "Not set"}`,
                  sleepForm.notes ? `Notes: ${sleepForm.notes}` : null,
                ].filter(Boolean),
              });

              if (!saved) return;
              resetSleepForm();
            }}
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color} ${
              isSavingEntry ? "opacity-70 cursor-not-allowed" : ""
            }`}
          >
            {isSavingEntry ? "Saving..." : "Save sleep entry"}
          </button>
        </div>
      </div>
    );
  };

  const renderReportsForm = () => {
    const reportText = [
      `Kaylen's Diary Report - Last ${reportDays} days`,
      "",
      ...(
        recentEntries.length
          ? recentEntries.flatMap((entry) => [
              `${entry.section} | ${entry.date}${
                entry.time ? ` ${entry.time}` : ""
              }`,
              entry.summary,
              ...(entry.details?.length ? entry.details : []),
              "",
            ])
          : ["No entries found for this date range."]
      ),
    ].join("\n");

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
        <div className={`${cardClassName} min-w-0`}>
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

        <div className={`${cardClassName} min-w-0`}>
          <label className="text-sm font-semibold text-slate-700">
            Entries found
          </label>
          <div className="mt-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
            {isLoadingLog ? "Loading..." : `${recentEntries.length} entries in shared log`}
          </div>
        </div>

        <div className={`${cardClassName} min-w-0 md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">
            Shared log
          </label>
          <div className="mt-3 space-y-3">
            {isLoadingLog ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm font-medium text-slate-500">
                Loading entries...
              </div>
            ) : recentEntries.length ? (
              recentEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-bold text-slate-900">
                      {entry.section}
                    </span>
                    <span className="break-words text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 sm:text-right">
                      {entry.date}
                      {entry.time ? ` · ${entry.time}` : ""}
                    </span>
                  </div>
                  <p className="mt-2 break-words font-medium text-slate-800">
                    {entry.summary}
                  </p>
                  {entry.details?.length ? (
                    <div className="mt-2 space-y-1 break-words text-slate-600">
                      {entry.details.map((detail, index) => (
                        <p key={index}>{detail}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm font-medium text-slate-500">
                Nothing logged yet. Save entries from Food, Medication,
                Toileting, Health, or Sleep.
              </div>
            )}
          </div>
        </div>

        <div className="md:col-span-2 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={fetchSharedLog}
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
              <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900">
                Kaylen’s Diary
              </h1>
              <p className="mt-3 text-sm font-medium leading-6 text-slate-600">
                Enter the password to access the diary.
              </p>
            </div>

            <div className="mt-8">
              <label className="text-sm font-semibold text-slate-700">
                Password
              </label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  if (passwordError) setPasswordError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (passwordInput === APP_PASSWORD) {
                      setIsUnlocked(true);
                      setPasswordError("");
                    } else {
                      setPasswordError("Incorrect password");
                    }
                  }
                }}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                placeholder="Enter password"
              />
              {passwordError ? (
                <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  {passwordError}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => {
                if (passwordInput === APP_PASSWORD) {
                  setIsUnlocked(true);
                  setPasswordError("");
                } else {
                  setPasswordError("Incorrect password");
                }
              }}
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
            <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
              Kaylen’s Diary
            </h1>
            <div className="rounded-full border border-slate-300 bg-slate-100 px-5 py-2 text-sm font-semibold text-slate-700">
              12 month logs
            </div>
            {logError ? (
              <div className="w-full max-w-2xl rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {logError}
              </div>
            ) : null}
          </div>
        </header>

        <section className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => (
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
                  <p className="mt-1 break-words text-sm font-semibold leading-5 text-slate-700">
                    {section.title !== "Reports"
                      ? tileStatusText(section.title)
                      : sharedLog.length
                        ? `${sharedLog[0].summary}${
                            sharedLog[0].time ? ` · ${sharedLog[0].time}` : ""
                          }`
                        : "Nothing logged yet"}
                  </p>
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
          ))}
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
              Storage
            </p>
            <p className="mt-2 text-4xl font-bold">12m</p>
          </div>
          <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5 text-center shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Shared log
            </p>
            <p className="mt-2 text-4xl font-bold">
              {isLoadingLog ? "..." : sharedLog.length}
            </p>
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

              {logError ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  {logError}
                </div>
              ) : null}

              {renderActiveForm()}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}