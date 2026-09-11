import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

export const hasNativePush = () => Capacitor.getPlatform() === "ios";
const storageKey = "familytrack-native-push";
let registration;

export function savedNativePush() {
  try { return JSON.parse(localStorage.getItem(storageKey) || "null"); } catch { return null; }
}

export async function nativePermission() {
  return (await PushNotifications.checkPermissions()).receive;
}

// Register on every authenticated launch: Apple can rotate a device token.
export async function registerNativePush(api, userId, ask = false) {
  if (registration) return registration;
  registration = (async () => {
    let permission = await nativePermission();
    if (ask && permission === "prompt") permission = (await PushNotifications.requestPermissions()).receive;
    if (permission !== "granted") {
      if (ask) throw new Error("Allow FamilyTrack notifications in iPhone Settings, then try again.");
      return null;
    }
    const handles = [];
    let timer;
    try {
      const token = await new Promise((resolve, reject) => {
        (async () => {
          handles.push(await PushNotifications.addListener("registration", ({ value }) => resolve(value)));
          handles.push(await PushNotifications.addListener("registrationError", () => reject(new Error("iPhone registration failed. A signed build with Apple push enabled is required."))));
          timer = setTimeout(() => reject(new Error("iPhone notification registration timed out. Try again when connected.")), 20000);
          await PushNotifications.register();
        })().catch(reject);
      });
      const saved = await api.savePushSubscription({ subscription: { platform: "ios", token }, deviceLabel: "iPhone / iPad app" });
      localStorage.setItem(storageKey, JSON.stringify({ endpoint: saved.endpoint, userId }));
      return saved.endpoint;
    } finally {
      clearTimeout(timer);
      await Promise.all(handles.map((handle) => handle.remove()));
    }
  })();
  try { return await registration; } finally { registration = null; }
}

export async function disableNativePush(api) {
  if (registration) await registration.catch(() => null);
  const saved = savedNativePush();
  if (saved?.endpoint) await api.disablePushSubscription(saved.endpoint);
  if (Capacitor.isPluginAvailable("PushNotifications")) {
    await PushNotifications.unregister();
    await PushNotifications.removeAllDeliveredNotifications();
  }
  localStorage.removeItem(storageKey);
}

export async function currentPushEndpoint() {
  if (hasNativePush()) return savedNativePush()?.endpoint;
  const worker = await navigator.serviceWorker?.getRegistration("/");
  return (await worker?.pushManager?.getSubscription())?.endpoint;
}

export function listenForPushTap() {
  return PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
    // Only navigate inside this app, never to a supplied external destination.
    const path = notification.data?.url;
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return;
    const base = new URL(window.location.href || window.location.origin);
    const url = new URL(path, base);
    if (url.protocol === base.protocol && url.host === base.host) window.location.assign(url.pathname + url.search + url.hash);
  });
}
