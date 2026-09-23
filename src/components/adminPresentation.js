export function activityLabel(action) {
  const labels = {
    platform_family_soft_deleted: "Family archived",
    platform_plan_updated: "Subscription plan updated",
    platform_family_archive_warning_sent: "Archive warning email sent",
    platform_user_updated: "User account updated",
    platform_family_updated: "Family account updated",
    platform_family_created: "Family account created",
    platform_user_password_reset: "Password reset requested",
  };
  const text = labels[action] || String(action || "Activity recorded").replace(/^platform_/, "").replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function upcomingEvents(families, now = new Date()) {
  const end = new Date(now); end.setDate(end.getDate() + 7);
  const events = [];
  const add = (family, date, label, estimated = false) => {
    if (Number.isFinite(date.getTime()) && date >= now && date < end)
      events.push({ familyId: family.id, familyName: family.name, date, label, estimated });
  };
  for (const family of families) {
    if (["trialing", "inactive"].includes(family.subscriptionStatus) && family.trialEndsAt) {
      const trial = new Date(family.trialEndsAt);
      add(family, trial, "Trial ends");
      for (const days of [3, 1]) {
        const date = new Date(trial); date.setDate(date.getDate() - days); date.setHours(0, 0, 0, 0);
        add(family, date, `${days}-day trial reminder`, true);
      }
    }
    if (family.subscriptionStatus === "active" && family.currentPeriodEnd && !family.cancelAtPeriodEnd)
      add(family, new Date(family.currentPeriodEnd), "Subscription period ends");
  }
  return events.sort((a, b) => a.date - b.date);
}

export function matchesHistory(event, filter) {
  const type = String(event.eventType || "");
  if (filter === "emails") return type.includes("email");
  if (filter === "failed") return type.includes("email") && event.metadata?.deliveryStatus === "failed";
  if (filter === "payments") return /payment|refund|dispute|fraud/.test(type);
  if (filter === "subscriptions") return /subscription|trial/.test(type) && !type.includes("email");
  return true;
}
