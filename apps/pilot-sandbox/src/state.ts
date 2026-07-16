import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import pg from "pg";
import { migratePostgresStorage } from "@closure/writeguard";
import type { PilotConfig } from "./config.js";
import { ensurePilotSchema } from "./workflow.js";

const { Pool } = pg;

export async function setupPilotState(config: PilotConfig): Promise<void> {
  await migratePostgresStorage({ connectionString: config.databaseUrl });
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    await ensurePilotSchema(pool);
  } finally {
    await pool.end();
  }
}

export async function resetPilotState(config: PilotConfig): Promise<void> {
  await setupPilotState(config);
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    await pool.query(`
      TRUNCATE
        pilot_support_cases,
        writeguard_shadow_invocations,
        writeguard_shadow_observations,
        writeguard_execution_receipts,
        writeguard_operation_events,
        writeguard_operation_attempts,
        writeguard_operations
      CASCADE
    `);
  } finally {
    await pool.end();
  }
  const outputDirectory = dirname(config.telemetryFile);
  await Promise.all([
    rm(config.telemetryFile, { force: true }),
    rm(join(outputDirectory, "pilot-export.json"), { force: true }),
    rm(join(outputDirectory, "pilot-report.md"), { force: true })
  ]);
}
