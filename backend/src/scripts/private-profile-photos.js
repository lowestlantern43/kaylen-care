// Run in the deployed backend environment. Dry run unless --apply is supplied.
import { query, pool } from "../db/pool.js";
import { createSignedAclUrl, getProfilePhotoObjectKeyFromPublicUrl } from "../services/spaces.js";
const apply = process.argv.includes("--apply");
let failures = 0;
try {
  const { rows } = await query("SELECT DISTINCT avatar_url FROM children WHERE avatar_url IS NOT NULL");
  console.log(`${rows.length} stored photo references; mode: ${apply ? "apply" : "dry run"}`);
  for (const row of rows) {
    const key = getProfilePhotoObjectKeyFromPublicUrl(row.avatar_url);
    if (!key) { failures++; continue; }
    if (!apply) continue;
    const response = await fetch(createSignedAclUrl({ objectKey: key }), {
      method: "PUT", headers: { "x-amz-acl": "private" },
    });
    if (!response.ok) { failures++; continue; }
    const anonymous = await fetch(row.avatar_url, { method: "HEAD", redirect: "manual" });
    if (![403, 404].includes(anonymous.status)) failures++;
  }
  console.log(`Unresolved references/access checks: ${failures}. Review bucket/CDN policy and purge cached public images before release.`);
  if (failures) process.exitCode = 1;
} finally { await pool.end(); }
