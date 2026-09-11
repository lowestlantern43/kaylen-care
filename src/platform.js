import { Capacitor } from "@capacitor/core";

// Build-time detection also keeps simulator/browser previews in companion mode.
export const IS_NATIVE_APP =
  import.meta.env?.MODE === "ios" || Capacitor.isNativePlatform();

export function requireWebBilling() {
  if (IS_NATIVE_APP) {
    throw new Error("Purchases are not available in this app.");
  }
}
