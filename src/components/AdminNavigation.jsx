const sections = [
  { label: "Overview", description: "Account health, attention items and recent activity.", tabs: [["overview", "Summary"], ["stats", "Statistics"]] },
  { label: "Families", description: "Find a family, manage members or create an account.", tabs: [["families", "Families"], ["accounts", "User accounts"], ["create", "Create family"]] },
  { label: "Billing", description: "Revenue and subscriptions. Open a family to see its email and billing history.", tabs: [["revenue", "Revenue & subscriptions"]] },
  { label: "Support", description: "Review reported issues and track their progress.", tabs: [["issues", "Reported issues"]] },
  { label: "Settings", description: "Platform configuration, Stripe setup and document storage.", tabs: [["billing", "Billing & website setup"], ["storage", "Document storage"]] },
];

export default function AdminNavigation({ activeTab, onSelect }) {
  const active = sections.find(section => section.tabs.some(([id]) => id === activeTab)) || sections[0];
  const selectTab = (id) => {
    onSelect(id);
    if (id === "stats") window.history.pushState({}, "", "/admin/stats");
    else if (window.location.pathname.replace(/\/$/, "") === "/admin/stats") window.history.pushState({}, "", "/");
  };
  return (
    <nav aria-label="Owner platform sections" className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {sections.map(section => (
          <button key={section.label} type="button" aria-current={active === section ? "page" : undefined}
            onClick={() => selectTab(section.tabs[0][0])}
            className={`rounded-xl px-4 py-3 text-sm font-bold transition ${active === section ? "bg-indigo-600 text-white" : "bg-slate-50 text-slate-700 hover:bg-indigo-50"}`}>
            {section.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-500">{active.description}</p>
      {active.tabs.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-label={`${active.label} pages`}>
          {active.tabs.map(([id, label]) => (
            <button key={id} type="button" aria-current={activeTab === id ? "page" : undefined}
              onClick={() => selectTab(id)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${activeTab === id ? "bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200" : "text-slate-600 hover:bg-slate-50"}`}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
