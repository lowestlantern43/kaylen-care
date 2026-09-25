const sectionIcons = {
  Overview: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  Families: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5" /></>,
  Billing: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h3" /></>,
  Support: <><path d="M4 13v-1a8 8 0 0 1 16 0v5a4 4 0 0 1-4 4h-4" /><rect x="2" y="11" width="4" height="7" rx="2" /><rect x="18" y="11" width="4" height="7" rx="2" /></>,
  Settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" fill="currentColor" /><circle cx="16" cy="12" r="2" fill="currentColor" /><circle cx="10" cy="18" r="2" fill="currentColor" /></>,
};
const sections = [
  { label: "Overview", description: "Account health, attention items and recent activity.", tabs: [["overview", "Summary"], ["stats", "Statistics"], ["service-health", "Service health"]] },
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
    <nav aria-label="Owner platform sections" className="admin-navigation mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {sections.map(section => (
          <button key={section.label} type="button" aria-current={active === section ? "page" : undefined}
            onClick={() => selectTab(section.tabs[0][0])}
            className={`admin-nav-primary px-4 py-3 text-sm font-bold transition ${active === section ? "bg-indigo-600 text-white" : "bg-slate-50 text-slate-700 hover:bg-indigo-50"}`}>
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{sectionIcons[section.label]}</svg>
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
