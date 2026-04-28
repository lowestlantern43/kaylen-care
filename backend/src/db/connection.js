export function buildPostgresConnectionOptions(databaseUrl) {
  const needsSsl =
    databaseUrl.includes("sslmode=require") ||
    databaseUrl.includes("ondigitalocean.com");

  const url = new URL(databaseUrl);
  url.searchParams.delete("sslmode");

  return {
    connectionString: url.toString(),
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
  };
}
