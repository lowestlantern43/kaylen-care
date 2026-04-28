import pg from "pg";
import { config } from "../config.js";
import { buildPostgresConnectionOptions } from "./connection.js";

const { Pool } = pg;

export const pool = new Pool(buildPostgresConnectionOptions(config.databaseUrl));

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
