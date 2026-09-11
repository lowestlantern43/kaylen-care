import assert from "node:assert/strict";
import { build } from "esbuild";

const storage = new Map();
globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
let permission = "granted";
let askCount = 0;
const listeners = new Map();
let fail = false;
let unregistered = false;
globalThis.__push = {
  checkPermissions: async () => ({ receive: permission }),
  requestPermissions: async () => { askCount++; return { receive: permission }; },
  addListener: async (name, callback) => { listeners.set(name, callback); return { remove: async () => listeners.delete(name) }; },
  register: async () => { fail ? listeners.get("registrationError")({}) : listeners.get("registration")({ value: "ab".repeat(32) }); },
  unregister: async () => { unregistered = true; },
  removeAllDeliveredNotifications: async () => {},
};
const output = await build({ entryPoints: ["src/nativePush.js"], bundle: true, write: false, format: "esm", plugins: [{ name: "native-double", setup(b) {
  b.onResolve({ filter: /^@capacitor\// }, args => ({ path: args.path, namespace: "test" }));
  b.onLoad({ filter: /.*/, namespace: "test" }, args => ({ contents: args.path.endsWith("core")
    ? 'export const Capacitor = { getPlatform: () => "ios", isPluginAvailable: () => true };'
    : 'export const PushNotifications = globalThis.__push;' }));
} }] });
const push = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
const calls = [];
const api = {
  savePushSubscription: async (payload) => { calls.push(payload); return { endpoint: `apns:${payload.subscription.token}` }; },
  disablePushSubscription: async (endpoint) => calls.push({ disabled: endpoint }),
};
permission = "denied";
assert.equal(await push.registerNativePush(api, "user"), null);
await assert.rejects(push.registerNativePush(api, "user", true), /iPhone Settings/);
assert.equal(calls.length, 0);
assert.equal(askCount, 0);
permission = "granted";
await push.registerNativePush(api, "user", true);
assert.equal(calls[0].subscription.platform, "ios");
assert.equal(push.savedNativePush().userId, "user");
assert.equal(listeners.size, 0);
fail = true;
await assert.rejects(push.registerNativePush(api, "user"), /signed build/);
assert.equal(listeners.size, 0);
fail = false;
await push.disableNativePush(api);
assert.equal(unregistered, true);
assert.equal(push.savedNativePush(), null);
assert.ok(calls.at(-1).disabled.startsWith("apns:"));
const navigations = [];
globalThis.window = { location: { origin: "capacitor://localhost", assign: (path) => navigations.push(path) } };
await push.listenForPushTap();
for (const url of ["https://evil.test", "//evil.test", "/?section=medication"]) listeners.get("pushNotificationActionPerformed")({ notification: { data: { url } } });
assert.deepEqual(navigations, ["/?section=medication"]);
console.log("PASS: iPhone permission, registration, cleanup, logout and safe notification taps");
