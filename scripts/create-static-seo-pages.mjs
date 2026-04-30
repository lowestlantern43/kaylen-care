import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const distDir = join(projectRoot, "dist");
const productionUrl = "https://familytrack.care";

const pages = [
  {
    path: "/autism-daily-tracker-app",
    title: "Autism Daily Tracker App for Parents | FamilyTrack",
    description:
      "Track food, sleep, medication, toileting and health in one simple app built for busy parents and carers.",
    image: `${productionUrl}/screenshots/dashboard.png`,
  },
  {
    path: "/special-needs-child-diary-app",
    title: "Special Needs Child Diary App | FamilyTrack",
    description:
      "A simple child diary app for SEN families to log daily care, routines, health notes and reports in one place.",
    image: `${productionUrl}/screenshots/logging-food.png`,
  },
  {
    path: "/ehcp-report-tracker",
    title: "EHCP Report Tracker for Parents | FamilyTrack",
    description:
      "Turn daily care notes into clearer reports for EHCP reviews, school meetings, doctors and appointments.",
    image: `${productionUrl}/screenshots/reports-page.png`,
  },
  {
    path: "/child-medication-tracker",
    title: "Child Medication Tracker App | FamilyTrack",
    description:
      "Log medication, doses, timings and notes for your child, then include them in simple care reports.",
    image: `${productionUrl}/screenshots/medication-log.png`,
  },
  {
    path: "/care-report-app",
    title: "Care Report App for Parents | FamilyTrack",
    description:
      "Create useful care reports from food, sleep, medication, toileting and health logs for appointments and reviews.",
    image: `${productionUrl}/screenshots/pdf-report.png`,
  },
];

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const replaceMeta = (html, page) => {
  const canonical = `${productionUrl}${page.path}`;
  return html
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(page.title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content=".*?"\s*\/>/s,
      `<meta name="description" content="${escapeHtml(page.description)}" />`,
    )
    .replace(
      /<link\s+rel="canonical"\s+href=".*?"\s*\/>/s,
      `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    )
    .replace(
      /<meta\s+property="og:title"\s+content=".*?"\s*\/>/s,
      `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    )
    .replace(
      /<meta\s+property="og:description"\s+content=".*?"\s*\/>/s,
      `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    )
    .replace(
      /<meta\s+property="og:url"\s+content=".*?"\s*\/>/s,
      `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    )
    .replace(
      /<meta\s+property="og:image"\s+content=".*?"\s*\/>/s,
      `<meta property="og:image" content="${escapeHtml(page.image)}" />`,
    );
};

const indexHtml = await readFile(join(distDir, "index.html"), "utf8");

for (const page of pages) {
  const routeDir = join(distDir, page.path.replace(/^\//, ""));
  await mkdir(routeDir, { recursive: true });
  await writeFile(join(routeDir, "index.html"), replaceMeta(indexHtml, page));
}

await writeFile(join(distDir, "404.html"), indexHtml);

console.log(`Created ${pages.length} static SEO route files.`);
