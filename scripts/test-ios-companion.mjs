import assert from "node:assert/strict";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let moduleId = 0;
async function load(entry, mode, native) {
  globalThis.__native = native;
  globalThis.__React = React;
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, format: "esm",
    define: { "import.meta.env": JSON.stringify({ MODE: mode, VITE_API_BASE_URL: "https://example.test/api" }) },
    plugins: [{ name: "device-double", setup(b) {
      b.onResolve({ filter: /^(@capacitor\/core|react)$/ }, args => ({ path: args.path, namespace: "test" }));
      b.onLoad({ filter: /.*/, namespace: "test" }, args => ({ contents: args.path === "react"
        ? "export default globalThis.__React;"
        : `export const Capacitor = { isNativePlatform: () => globalThis.__native };
           export const CapacitorHttp = { request: (...args) => globalThis.__http(...args) };` }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + `\n// ${moduleId++}`).toString("base64")}`);
}

const originalFetch = globalThis.fetch;
try {
  for (const [mode, native] of [["ios", true], ["ios", false], ["production", true], ["production", false]]) {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ data: { user: { id: "test-user" } } }) };
    };
    globalThis.__http = async options => {
      calls.push({ url: options.url, options });
      return { status: 200, data: { data: { user: { id: "test-user" } } } };
    };
    const { api } = await load("src/api/client.js", mode, native);
    for (const action of [() => api.createCheckoutSession("family"),
      () => api.createDocumentVaultCheckoutSession("family", { tierId: "tier" }),
      () => api.createBillingPortalSession("family")]) {
      if (mode === "ios" || native) await assert.rejects(action, /Purchases are not available/);
      else await action();
    }
    assert.equal(calls.length, mode === "ios" || native ? 0 : 3, "Companion payments must never reach the server");
    calls.length = 0;
    await api.login({ email: "test@example.test", password: "test-only" });
    assert.equal((await api.me()).user.id, "test-user");
    await api.logout();
    assert.deepEqual(calls.map(c => c.url.split("/api")[1]), ["/auth/login", "/auth/me", "/auth/logout"]);
    if (native) assert.deepEqual(calls[0].options.data, { email: "test@example.test", password: "test-only" });
    else assert.equal(calls[0].options.credentials, "include");
    globalThis.__http = async () => ({ status: 401, data: { error: { code: "unauthorized", message: "Invalid login" } } });
    if (native) await assert.rejects(api.me(), error => error.status === 401 && error.message === "Invalid login");
    globalThis.__http = async () => { throw new Error("offline"); };
    globalThis.fetch = globalThis.__http;
    await assert.rejects(api.me(), /could not connect/);
    console.log(`PASS: ${mode}, native=${native}: billing, login/session/logout transport and errors`);
  }
  const { default: AccessScreen } = await load("src/CompanionAccessScreen.jsx", "ios", false);
  const html = renderToStaticMarkup(React.createElement(AccessScreen, { error: "Offline", busy: true }));
  assert.match(html, /Checking access/);
  assert.match(html, /disabled/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Log out/);
  assert.doesNotMatch(html, /checkout|stripe|subscribe|upgrade|https:\/\//i);
  console.log("PASS: inactive account screen has no purchase link or promotion");
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__native;
  delete globalThis.__http;
  delete globalThis.__React;
}
