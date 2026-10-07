import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
const origin = "https://familytrack.care";
const sitemap = await readFile("dist/sitemap.xml", "utf8");
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
assert.equal(urls.length, 6);
const titles = new Set();
for (const url of urls) {
  const path = new URL(url).pathname;
  const html = await readFile(join("dist", path.slice(1), "index.html"), "utf8");
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1, `${path}: meaningful server-rendered heading`);
  assert.ok(html.includes('href="https://familytrack.care/'), `${path}: crawlable canonical`);
  assert.ok(html.includes(`rel="canonical" href="${url}"`));
  assert.ok(!html.includes("noindex"));
  assert.ok(!html.includes('src="/src/'), `${path}: no development assets`);
  assert.ok(!html.includes("Add real FamilyTrack screenshot"));
  assert.ok(html.includes('name="google-site-verification"'));
  assert.ok(html.includes('name="twitter:card"'));
  const title = html.match(/<title>(.*?)<\/title>/)[1];
  assert.ok(!titles.has(title)); titles.add(title);
  const schema = JSON.parse(html.match(/<script id="familytrack-jsonld" type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(schema["@context"], "https://schema.org");
  assert.ok(!JSON.stringify(schema).includes('"price":"0"'), "Do not advertise a paid subscription as free");
  for (const [,src] of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    if (src.startsWith("/")) await access(join("dist",src.slice(1)));
  }
  for (const [,href] of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    if (urls.includes(origin + href)) await access(join("dist",href.slice(1),"index.html"));
  }
}
for (const path of ["billing/success/index.html", "billing/cancelled/index.html", "404.html"]) {
  assert.ok((await readFile(join("dist",path),"utf8")).includes('content="noindex, follow"'));
}
console.log(`SEO checks passed: ${urls.length} rendered pages, metadata, schema, assets, sitemap and utility-page indexing.`);
