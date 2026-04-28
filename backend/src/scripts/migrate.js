import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { buildPostgresConnectionOptions } from "../db/connection.js";

dotenv.config();

const { Client } = pg;
const currentFile = fileURLToPath(import.meta.url);
const backendRoot = path.resolve(path.dirname(currentFile), "../..");
const projectRoot = path.resolve(backendRoot, "..");
const migrationsDir = path.join(projectRoot, "database", "migrations");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Add it to backend/.env first.");
  process.exit(1);
}

const client = new Client(buildPostgresConnectionOptions(process.env.DATABASE_URL));

try {
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  await client.connect();

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await client.query(sql);
    console.log(`Applied ${file}`);
  }

  console.log("Migrations applied successfully.");
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => null);
}
