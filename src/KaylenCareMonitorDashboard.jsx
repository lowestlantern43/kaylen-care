import { useMemo, useState } from "react";
import { supabase } from "./supabase";

const todayValue = () => new Date().toISOString().split("T")[0];
const nowTimeValue = () => new Date().toTimeString().slice(0, 5);
const makeId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

export default function KaylenCareMonitorDashboard() {
  const [activeSection, setActiveSection] = useState(null);
  const [medicationValue, setMedicationValue] = useState("");
  const [foodValue, setFoodValue] = useState("");
  const [reportDays, setReportDays] = useState("7");
  const [sharedLog, setSharedLog] = useState([]);

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
  });

  const [sleepForm, setSleepForm] = useState({
    date: todayValue(),
    quality: "",
    bedtime: "",
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
      button: "Open Log",
      emoji: "🚽",
      color: "from-sky-400 to-blue-500",
      soft: "bg-sky-50 border-sky-300",
    },
    {
      title: "Health",
      button: "Open Log",
      emoji: "🩺",
      color: "from-emerald-400 to-green-500",
      soft: "bg-emerald-50 border-emerald-300",
    },
    {
      title: "Sleep",
      button: "Open Log",
      emoji: "🌙",
      color: "from-indigo-400 to-purple-500",
      soft: "bg-indigo-50 border-indigo-300",
    },
    {
      title: "Reports",
      button: "View Reports",
      emoji: "📊",
      color: "from-fuchsia-400 to-pink-500",
      soft: "bg-fuchsia-50 border-fuchsia-300",
    },
  ];

  const medicationOptions = [
    "Kepra (Levetiracetam)",
    "Chlorphenamine Maleate",
    "Calpol",
    "Ibuprofen",
    "Vitamin D",
    "Calcichew",
    "Other",
  ];

  const foodOptions = [
    "Cottage pie",
    "Weetabix",
    "Heinz Fruit Custard",
    "Milk",
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
  };

  const closeSection = () => {
    setActiveSection(null);
    setMedicationValue("");
    setFoodValue("");
  };

  const addLogEntry = (entry) => {
    setSharedLog((current) => [
      {
        id: makeId(),
        createdAt: new Date().toISOString(),
        ...entry,
      },
      ...current,
    ]);
    closeSection();
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
    });
  };

  const resetSleepForm = () => {
    setSleepForm({
      date: todayValue(),
      quality: "",
      bedtime: "",
      wakeTime: "",
      nightWakings: "",
      nap: "",
      notes: "",
    });
  };

  const saveFoodEntry = async () => {
    const showOtherFood = foodValue === "Other";
    const showOtherLocation = foodForm.location === "Other";

    const itemToSave = showOtherFood
      ? foodForm.otherItem || ""
      : foodForm.item || "";

    const locationToSave = showOtherLocation
      ? foodForm.otherLocation || ""
      : foodForm.location || "";

    const { error } = await supabase.from("food_logs").insert([
      {
        entry_date: foodForm.date,
        entry_time: foodForm.time,
        food_or_drink: itemToSave,
        amount: foodForm.amount,
        notes: foodForm.notes,
        location: locationToSave,
      },
    ]);

    if (error) {
      console.error("Supabase save error:", error);
      alert("Failed to save food entry");
      return;
    }

    addLogEntry({
      section: "Food Diary",
      date: foodForm.date,
      time: foodForm.time,
      summary: `${itemToSave || "Food entry"} · ${foodForm.amount || "No amount"}`,
      details: [
        `Location: ${locationToSave || "Not set"}`,
        foodForm.notes ? `Notes: ${foodForm.notes}` : null,
      ].filter(Boolean),
    });

    resetFoodForm();
    alert("Food entry saved");
  };

  const sectionHelpText = useMemo(() => {
    if (!activeSection) return "";

    switch (activeSection.title) {
      case "Food Diary":
        return "Food saves into the same shared log as everything else";
      case "Medication":
        return "Regular medication dropdown with an add another option";
      case "Toileting":
        return "Record toilet use, nappy changes, accidents, and notes";
      case "Health":
        return "Log seizures, symptoms, illness, and actions taken";
      case "Sleep":
        return "Track sleep times, naps, wake ups, and overall sleep quality";
      case "Reports":
        return "View the same shared log across all diary sections";
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
      const entryDate = new Date(`${entry.date || todayValue()}T00:00:00`);
      return entryDate >= cutoff;
    });
  }, [reportDays, sharedLog]);

  const renderFoodForm = () => {
    const showOtherFood = foodValue === "Other";
    const showOtherLocation = foodForm.location === "Other";

    return (
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Date</label>
          <input
            type="date"
            className={inputClassName}
            value={foodForm.date}
            onChange={(e) => setFoodForm({ ...foodForm, date: e.target.value })}
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Time</label>
          <input
            type="time"
            className={inputClassName}
            value={foodForm.time}
            onChange={(e) => setFoodForm({ ...foodForm, time: e.target.value })}
          />
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Location</label>
          <select
            className={inputClassName}
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
            <option>Home</option>
            <option>School</option>
            <option>Grandparents</option>
            <option>Other</option>
          </select>
        </div>

        {showOtherLocation ? (
          <div className={`${cardClassName} md:col-span-2`}>
            <label className="text-sm font-semibold text-slate-700">Other location</label>
            <input
              type="text"
              placeholder="Type location"
              className={`${inputClassName} border-dashed`}
              value={foodForm.otherLocation}
              onChange={(e) => setFoodForm({ ...foodForm, otherLocation: e.target.value })}
            />
          </div>
        ) : null}

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Food or drink</label>
          <select
            className={inputClassName}
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
          <div className={`${cardClassName} md:col-span-2`}>
            <label className="text-sm font-semibold text-slate-700">Other food or drink</label>
            <input
              type="text"
              placeholder="Type another food or drink"
              className={`${inputClassName} border-dashed`}
              value={foodForm.otherItem}
              onChange={(e) => setFoodForm({ ...foodForm, otherItem: e.target.value })}
            />
          </div>
        ) : null}

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Amount</label>
          <select
            className={inputClassName}
            value={foodForm.amount}
            onChange={(e) => setFoodForm({ ...foodForm, amount: e.target.value })}
          >
            <option value="">Select amount</option>
            <option>All</option>
            <option>Most</option>
            <option>Half</option>
            <option>A little</option>
            <option>Tasted only</option>
            <option>Refused</option>
          </select>
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Notes</label>
          <textarea
            rows={4}
            placeholder="Texture, brand, where eaten, who helped, anything important"
            className={inputClassName}
            value={foodForm.notes}
            onChange={(e) => setFoodForm({ ...foodForm, notes: e.target.value })}
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            onClick={saveFoodEntry}
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

    return (
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Medicine</label>
          <select
            value={medicationValue}
            onChange={(e) => {
              const value = e.target.value;
              setMedicationValue(value);
              setMedicationForm({
                ...medicationForm,
                medicine: value,
                otherMedicine: value === "Other" ? medicationForm.otherMedicine : "",
              });
            }}
            className={inputClassName}
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
          <div className={`${cardClassName} md:col-span-2`}>
            <label className="text-sm font-semibold text-slate-700">Other medicine</label>
            <input
              type="text"
              placeholder="Type medicine name if not in dropdown"
              className={`${inputClassName} border-dashed`}
              value={medicationForm.otherMedicine}
              onChange={(e) =>
                setMedicationForm({ ...medicationForm, otherMedicine: e.target.value })
              }
            />
          </div>
        ) : null}

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Dose</label>
          <input
            type="text"
            placeholder="e.g. 5ml / 1 tablet"
            className={inputClassName}
            value={medicationForm.dose}
            onChange={(e) => setMedicationForm({ ...medicationForm, dose: e.target.value })}
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Time</label>
          <input
            type="time"
            className={inputClassName}
            value={medicationForm.time}
            onChange={(e) => setMedicationForm({ ...medicationForm, time: e.target.value })}
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Given by</label>
          <input
            type="text"
            placeholder="Name of person giving medication"
            className={inputClassName}
            value={medicationForm.givenBy}
            onChange={(e) => setMedicationForm({ ...medicationForm, givenBy: e.target.value })}
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Date</label>
          <input
            type="date"
            className={inputClassName}
            value={medicationForm.date}
            onChange={(e) => setMedicationForm({ ...medicationForm, date: e.target.value })}
          />
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Notes</label>
          <textarea
            placeholder="Optional notes"
            rows={4}
            className={inputClassName}
            value={medicationForm.notes}
            onChange={(e) => setMedicationForm({ ...medicationForm, notes: e.target.value })}
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            onClick={() => {
              addLogEntry({
                section: "Medication",
                date: medicationForm.date,
                time: medicationForm.time,
                summary: `${showOtherMedication ? medicationForm.otherMedicine || "Other medicine" : medicationForm.medicine || "Medication"} · ${medicationForm.dose || "No dose"}`,
                details: [
                  `Given by: ${medicationForm.givenBy || "Not set"}`,
                  medicationForm.notes ? `Notes: ${medicationForm.notes}` : null,
                ].filter(Boolean),
              });
              resetMedicationForm();
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
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Date</label>
          <input
            type="date"
            className={inputClassName}
            value={toiletingForm.date}
            onChange={(e) => setToiletingForm({ ...toiletingForm, date: e.target.value })}
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Time</label>
          <input
            type="time"
            className={inputClassName}
            value={toiletingForm.time}
            onChange={(e) => setToiletingForm({ ...toiletingForm, time: e.target.value })}
          />
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Toileting entry</label>
          <select
            className={inputClassName}
            value={toiletingForm.entry}
            onChange={(e) => setToiletingForm({ ...toiletingForm, entry: e.target.value })}
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
            rows={4}
            placeholder="Any patterns, concerns, or extra detail"
            className={inputClassName}
            value={toiletingForm.notes}
            onChange={(e) => setToiletingForm({ ...toiletingForm, notes: e.target.value })}
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            onClick={() => {
              addLogEntry({
                section: "Toileting",
                date: toiletingForm.date,
                time: toiletingForm.time,
                summary: toiletingForm.entry || "Toileting entry",
                details: [toiletingForm.notes ? `Notes: ${toiletingForm.notes}` : null].filter(Boolean),
              });
              resetToiletingForm();
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
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Date</label>
          <input
            type="date"
            className={inputClassName}
            value={healthForm.date}
            onChange={(e) => setHealthForm({ ...healthForm, date: e.target.value })}
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Time</label>
          <input
            type="time"
            className={inputClassName}
            value={healthForm.time}
            onChange={(e) => setHealthForm({ ...healthForm, time: e.target.value })}
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Health event</label>
          <select
            className={inputClassName}
            value={healthForm.event}
            onChange={(e) => setHealthForm({ ...healthForm, event: e.target.value })}
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
          <label className="text-sm font-semibold text-slate-700">Duration</label>
          <input
            type="text"
            placeholder="e.g. 2 minutes"
            className={inputClassName}
            value={healthForm.duration}
            onChange={(e) => setHealthForm({ ...healthForm, duration: e.target.value })}
          />
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">What happened</label>
          <textarea
            rows={4}
            placeholder="Describe symptoms or what was observed"
            className={inputClassName}
            value={healthForm.happened}
            onChange={(e) => setHealthForm({ ...healthForm, happened: e.target.value })}
          />
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Action taken</label>
          <textarea
            rows={3}
            placeholder="First aid, rescue medication, call to school, etc"
            className={inputClassName}
            value={healthForm.action}
            onChange={(e) => setHealthForm({ ...healthForm, action: e.target.value })}
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            onClick={() => {
              addLogEntry({
                section: "Health",
                date: healthForm.date,
                time: healthForm.time,
                summary: `${healthForm.event || "Health"} · ${healthForm.duration || "No duration"}`,
                details: [
                  healthForm.happened ? `What happened: ${healthForm.happened}` : null,
                  healthForm.action ? `Action taken: ${healthForm.action}` : null,
                ].filter(Boolean),
              });
              resetHealthForm();
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
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Date</label>
          <input
            type="date"
            className={inputClassName}
            value={sleepForm.date}
            onChange={(e) => setSleepForm({ ...sleepForm, date: e.target.value })}
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Sleep quality</label>
          <select
            className={inputClassName}
            value={sleepForm.quality}
            onChange={(e) => setSleepForm({ ...sleepForm, quality: e.target.value })}
          >
            <option value="">Select quality</option>
            <option>Good</option>
            <option>Broken</option>
            <option>Poor</option>
          </select>
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Bedtime</label>
          <input
            type="time"
            className={inputClassName}
            value={sleepForm.bedtime}
            onChange={(e) => setSleepForm({ ...sleepForm, bedtime: e.target.value })}
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Wake time</label>
          <input
            type="time"
            className={inputClassName}
            value={sleepForm.wakeTime}
            onChange={(e) => setSleepForm({ ...sleepForm, wakeTime: e.target.value })}
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Night wakings</label>
          <input
            type="number"
            min="0"
            placeholder="0"
            className={inputClassName}
            value={sleepForm.nightWakings}
            onChange={(e) => setSleepForm({ ...sleepForm, nightWakings: e.target.value })}
          />
        </div>

        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Daytime nap</label>
          <select
            className={inputClassName}
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
            rows={4}
            placeholder="Anything unusual about sleep"
            className={inputClassName}
            value={sleepForm.notes}
            onChange={(e) => setSleepForm({ ...sleepForm, notes: e.target.value })}
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            onClick={() => {
              addLogEntry({
                section: "Sleep",
                date: sleepForm.date,
                time: sleepForm.bedtime,
                summary: `${sleepForm.quality || "Sleep"} · wake ${sleepForm.wakeTime || "Not set"}`,
                details: [
                  `Night wakings: ${sleepForm.nightWakings || "0"}`,
                  `Daytime nap: ${sleepForm.nap || "Not set"}`,
                  sleepForm.notes ? `Notes: ${sleepForm.notes}` : null,
                ].filter(Boolean),
              });
              resetSleepForm();
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
    return (
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className={cardClassName}>
          <label className="text-sm font-semibold text-slate-700">Quick range</label>
          <select
            className={inputClassName}
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
          <label className="text-sm font-semibold text-slate-700">Entries found</label>
          <div className="mt-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
            {recentEntries.length} entries in shared log
          </div>
        </div>

        <div className={`${cardClassName} md:col-span-2`}>
          <label className="text-sm font-semibold text-slate-700">Shared log</label>
          <div className="mt-3 space-y-3">
            {recentEntries.length ? (
              recentEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">{entry.section}</span>
                    <span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
                      {entry.date} {entry.time ? `· ${entry.time}` : ""}
                    </span>
                  </div>
                  <p className="mt-2 font-medium text-slate-800">{entry.summary}</p>
                  {entry.details?.length ? (
                    <div className="mt-2 space-y-1 text-slate-600">
                      {entry.details.map((detail, index) => (
                        <p key={index}>{detail}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm font-medium text-slate-500">
                Nothing logged yet. Save entries from Food, Medication, Toileting, Health, or Sleep.
              </div>
            )}
          </div>
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            className={`w-full rounded-2xl bg-gradient-to-r px-5 py-4 text-base font-semibold text-white shadow-md ${activeSection.color}`}
          >
            Run report
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-white to-slate-100 text-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-10 md:py-14">
        <header className="rounded-[2rem] border border-slate-300 bg-white p-10 shadow-md md:p-12">
          <div className="flex flex-col items-center gap-5 text-center">
            <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
              Kaylen’s Diary
            </h1>
            <div className="rounded-full border border-slate-300 bg-slate-100 px-5 py-2 text-sm font-semibold text-slate-700">
              12 month logs
            </div>
          </div>
        </header>

        <section className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => (
            <div
              key={section.title}
              className={`group flex min-h-[17rem] flex-col rounded-[2rem] border p-6 shadow-md transition duration-200 hover:-translate-y-1 hover:shadow-lg ${section.soft}`}
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
                <h2 className="text-[1.9rem] font-bold leading-tight tracking-tight">
                  {section.title}
                </h2>
                {section.subtitle ? (
                  <p className="mt-2 min-h-[2.5rem] text-sm font-medium leading-5 text-slate-600">
                    {section.subtitle}
                  </p>
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
            <p className="mt-2 text-4xl font-bold">{sharedLog.length}</p>
          </div>
        </section>
      </div>

      {activeSection ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl md:p-8">
            <button
              type="button"
              onClick={closeSection}
              className="absolute right-4 top-4 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm"
            >
              Close
            </button>

            <div className="flex items-start gap-3 pr-16">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-2xl text-white shadow-md ${activeSection.color}`}
              >
                {activeSection.emoji}
              </div>
              <div className="min-w-0">
                <h3 className="text-2xl font-bold tracking-tight text-slate-900">
                  {activeSection.title}
                </h3>
                <p className="text-sm font-medium text-slate-600">{sectionHelpText}</p>
              </div>
            </div>

            {renderActiveForm()}
          </div>
        </div>
      ) : null}
    </div>
  );
}