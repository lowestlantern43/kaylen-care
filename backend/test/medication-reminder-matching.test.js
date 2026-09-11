import { test } from "node:test";
import assert from "node:assert/strict";
import { hasResolvedDose } from "../src/services/medicationReminderMatching.js";

const medicine = { name: "Test medicine", times: ["08:00", "18:00"] };
const log = (status = "given", time = "07:55:00", extra = {}) => ({ log_time: time, data: { medicine: " TEST  medicine ", status, ...extra } });
test("given and skipped doses suppress only their matching dose", () => {
  for (const status of ["given", "skipped"]) {
    assert.equal(hasResolvedDose(medicine, "08:00", [log(status)]), true);
    assert.equal(hasResolvedDose(medicine, "18:00", [log(status)]), false);
  }
});
test("other medicines, unresolved statuses and ambiguous logs preserve reminders", () => {
  for (const entry of [log("pending"), log("given", "08:00", { medicine: "Other" }), log("given", null), log("given", "13:00")]) {
    assert.equal(hasResolvedDose(medicine, "08:00", [entry]), false);
  }
  const closeDoses = { ...medicine, times: ["08:00", "10:00"] };
  assert.equal(hasResolvedDose(closeDoses, "08:00", [log("given", "09:00")]), false);
  assert.equal(hasResolvedDose(closeDoses, "10:00", [log("given", "08:10")]), false);
});
test("an explicit scheduled window can identify a late dose without hiding another dose", () => {
  const entry = log("skipped", "14:00", { scheduled_window: "morning" });
  assert.equal(hasResolvedDose(medicine, "08:00", [entry]), true);
  assert.equal(hasResolvedDose(medicine, "18:00", [entry]), false);
});
test("multiple doses in the same window still require an unambiguous time", () => {
  const doses = { ...medicine, times: ["08:00", "10:00"] };
  const entry = log("given", "08:10", { scheduled_window: "morning" });
  assert.equal(hasResolvedDose(doses, "08:00", [entry]), true);
  assert.equal(hasResolvedDose(doses, "10:00", [entry]), false);
});
