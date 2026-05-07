import { createApp } from "./app.js";
import { config, requireConfig } from "./config.js";
import { runDueReminderScan } from "./services/pushNotifications.js";

requireConfig();

const app = createApp();

app.listen(config.port, () => {
  console.log(`FamilyTrack API listening on http://localhost:${config.port}`);
});

if (config.notificationSchedulerEnabled) {
  let isRunningReminderScan = false;
  const runScan = async () => {
    if (isRunningReminderScan) return;
    isRunningReminderScan = true;
    try {
      const result = await runDueReminderScan();
      if (result.medication || result.appointments) {
        console.log("FamilyTrack reminders sent", result);
      }
    } catch (error) {
      console.error("FamilyTrack reminder scan failed", error);
    } finally {
      isRunningReminderScan = false;
    }
  };

  setInterval(runScan, 5 * 60 * 1000);
  setTimeout(runScan, 30 * 1000);
}
