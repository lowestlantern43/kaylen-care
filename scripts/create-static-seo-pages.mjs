import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const origin = "https://familytrack.care";
const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const jsonScript = value => JSON.stringify(value).replaceAll("<", "\\u003c");
const template = await readFile(join(dist, "index.html"), "utf8");

function documentFor(page, body, structuredData, noindex = false) {
  const image = page.ogImage || `${origin}${page.screenshot || "/screenshots/dashboard.png"}`;
  let html = template
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(page.title)}</title>`)
    .replace(/<meta\s+(?:name="description"|property="og:[^"]+")[^>]*>/gs, "")
    .replace(/<link\s+rel="canonical"[^>]*>/g, "");
  const meta = [
    ["name", "description", page.description],
    ["name", "robots", noindex ? "noindex, follow" : "index, follow, max-image-preview:large"],
    ["property", "og:type", "website"], ["property", "og:locale", "en_GB"],
    ["property", "og:site_name", "FamilyTrack"], ["property", "og:title", page.title],
    ["property", "og:description", page.description], ["property", "og:url", page.canonical],
    ["property", "og:image", image], ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", page.title], ["name", "twitter:description", page.description],
    ["name", "twitter:image", image],
  ].map(([attribute, key, value]) => `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`).join("\n");
  const schema = structuredData ? `<script id="familytrack-jsonld" type="application/ld+json">${jsonScript(structuredData)}</script>` : "";
  html = html.replace("</head>", `${meta}\n<link rel="canonical" href="${escapeHtml(page.canonical)}" />\n${schema}\n</head>`);
  return html.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

// Render only public marketing components. No browser session, private API or user data is read.
// Vite handles JSX and asset imports; the generated HTML uses the regular production bundle.
const server = await createServer({ root, server: { middlewareMode: true }, appType: "custom" });
try {
  const { LandingPage, SeoLandingPage, publicPages, seoLandingContent, publicStructuredData } = await server.ssrLoadModule("/src/SaasApp.jsx");
  for (const [path, page] of Object.entries(publicPages)) {
    const body = renderToStaticMarkup(React.createElement(path === "/" ? LandingPage : SeoLandingPage, { page }));
    const html = documentFor(page, body, publicStructuredData(page, seoLandingContent[path]?.faqs || []));
    const directory = join(dist, path.replace(/^\//, ""));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.html"), html);
  }
  // Transaction and fallback pages must not become duplicate marketing search results.
  for (const [path, title] of [["/billing/success", "Billing confirmation"], ["/billing/cancelled", "Billing cancelled"]]) {
    const directory = join(dist, path.slice(1));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.html"), documentFor({title: `${title} | FamilyTrack`, description: title, canonical: `${origin}${path}`}, "", null, true));
  }
  await writeFile(join(dist, "404.html"), documentFor({ title: "FamilyTrack", description: "FamilyTrack care diary", canonical: `${origin}/` }, "", null, true));
  // Derive the sitemap from the same public route list, not a separately maintained copy.
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Object.values(publicPages).map(page => `  <url><loc>${escapeHtml(page.canonical)}</loc></url>`).join("\n")}\n</urlset>\n`;
  await writeFile(join(dist, "sitemap.xml"), sitemap);
  console.log(`Prerendered ${Object.keys(publicPages).length} public pages, sitemap and noindex utility pages.`);
} finally {
  await server.close();
}
