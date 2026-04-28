import { createApp } from "./app.js";
import { config, requireConfig } from "./config.js";

requireConfig();

const app = createApp();

app.listen(config.port, () => {
  console.log(`FamilyTrack API listening on http://localhost:${config.port}`);
});
