import { Capacitor, CapacitorHttp, CapacitorCookies } from "@capacitor/core";

export async function clearNativeSessionCookie(url) {
  if (Capacitor.isNativePlatform()) {
    await CapacitorCookies.deleteCookie({ url, key: "kaylens_diary_session" });
  }
}

// JSON API calls use iOS's HTTP stack and cookie store directly. The website
// continues using browser fetch. File uploads retain the patched fetch path.
export async function fetchJson(url, options) {
  if (!Capacitor.isNativePlatform()) return fetch(url, options);

  const response = await CapacitorHttp.request({
    url,
    method: options.method || "GET",
    headers: options.headers,
    ...(options.body ? { data: JSON.parse(options.body) } : {}),
    responseType: "json",
    connectTimeout: 15000,
    readTimeout: 30000,
  });
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: "",
    json: async () => typeof response.data === "string"
      ? JSON.parse(response.data) : response.data,
  };
}
