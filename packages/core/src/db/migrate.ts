import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://closure:closure@localhost:54327/closure";
const migrations = [
  "0000_initial",
  "0001_ordered_events",
  "0002_support_cases",
  "0003_support_case_cardinality",
  "0004_shadow_observations",
  "0005_fake_provider_test_schema"
] as const;

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS writeguard_schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  for (const migrationName of migrations) {
    const existing = await client.query<{ name: string }>(
      "SELECT name FROM writeguard_schema_migrations WHERE name = $1",
      [migrationName]
    );
    if (existing.rowCount === 0) {
      const sqlPath = new URL(`../../drizzle/${migrationName}.sql`, import.meta.url);
      await client.query(await readFile(sqlPath, "utf8"));
      await client.query("INSERT INTO writeguard_schema_migrations(name) VALUES ($1)", [migrationName]);
      console.log(`Applied migration ${migrationName}`);
    } else {
      console.log(`Migration ${migrationName} already applied`);
    }
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
