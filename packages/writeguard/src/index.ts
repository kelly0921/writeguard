import { readFile } from "node:fs/promises";
import pg from "pg";
import { InMemoryOperationStore } from "../../core/src/memory-store.js";
import { PostgresOperationStore } from "../../core/src/postgres-store.js";
import type { OperationStore } from "../../core/src/store.js";
import {
  LocalPilotTelemetry,
  WriteGuard as InternalWriteGuard,
  type GuardedTool,
  type GuardToolOptions,
  type PilotSummary,
  type PilotTelemetryPeriod,
  type PilotTelemetrySink,
  type ShadowReceipt,
  type WriteGuardExecutionOptions,
  type WriteGuardObservationOptions
} from "../../sdk/src/index.js";
import type { ExecutionReceipt } from "../../core/src/models.js";

const { Pool } = pg;
type PoolType = InstanceType<typeof Pool>;

export const WRITEGUARD_VERSION = "0.8.0" as const;

export type StorageAdapter = "postgresql" | "unsafe-in-memory";

export interface WriteGuardStorage {
  readonly adapter: StorageAdapter;
  close(): Promise<void>;
}

class StorageHandle implements WriteGuardStorage {
  constructor(
    readonly adapter: StorageAdapter,
    readonly internalStore: OperationStore,
    private readonly closeStorage: () => Promise<void>
  ) {}

  close(): Promise<void> {
    return this.closeStorage();
  }
}

function unwrapStorage(storage: WriteGuardStorage): OperationStore {
  if (!(storage instanceof StorageHandle)) {
    throw new Error("storage must be created by @closure/writeguard");
  }
  return storage.internalStore;
}

export type CreateWriteGuardOptions = {
  storage: WriteGuardStorage;
  namespace?: string;
  claimTtlMs?: number;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  telemetry?: PilotTelemetrySink;
};

export class WriteGuardClient {
  constructor(private readonly internal: InternalWriteGuard) {}

  execute<TExecuteResult, TReconcileResult = TExecuteResult>(
    options: WriteGuardExecutionOptions<TExecuteResult, TReconcileResult>
  ): Promise<ExecutionReceipt> {
    return this.internal.execute(options);
  }

  observe<TReconcileResult>(
    options: WriteGuardObservationOptions<TReconcileResult>
  ): Promise<ShadowReceipt> {
    return this.internal.observe(options);
  }

  guardTool<TInput, TExecuteResult, TReconcileResult = TExecuteResult>(
    options: GuardToolOptions<TInput, TExecuteResult, TReconcileResult>
  ): GuardedTool<TInput> {
    return this.internal.guardTool(options);
  }
}

export function createWriteGuard(options: CreateWriteGuardOptions): WriteGuardClient {
  return new WriteGuardClient(
    new InternalWriteGuard({
      store: unwrapStorage(options.storage),
      ...(options.namespace ? { namespace: options.namespace } : {}),
      ...(options.claimTtlMs !== undefined ? { claimTtlMs: options.claimTtlMs } : {}),
      ...(options.waitTimeoutMs !== undefined ? { waitTimeoutMs: options.waitTimeoutMs } : {}),
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      ...(options.telemetry ? { telemetry: options.telemetry } : {})
    })
  );
}

export function createUnsafeInMemoryStorage(): WriteGuardStorage {
  return new StorageHandle("unsafe-in-memory", new InMemoryOperationStore(), async () => undefined);
}

export type PostgresStorageOptions = {
  connectionString: string;
};

export function createPostgresStorage(options: PostgresStorageOptions): WriteGuardStorage {
  const store = new PostgresOperationStore(options.connectionString);
  return new StorageHandle("postgresql", store, () => store.close());
}

const publicMigrationNames = [
  "0000_initial",
  "0001_ordered_events",
  "0004_shadow_observations"
] as const;

export async function migratePostgresStorage(options: PostgresStorageOptions): Promise<void> {
  const pool: PoolType = new Pool({ connectionString: options.connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS writeguard_schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const migrationName of publicMigrationNames) {
      const existing = await client.query(
        "SELECT name FROM writeguard_schema_migrations WHERE name = $1",
        [migrationName]
      );
      if (existing.rowCount === 0) {
        const migrationUrl = new URL(`../../../migrations/${migrationName}.sql`, import.meta.url);
        await client.query(await readFile(migrationUrl, "utf8"));
        await client.query(
          "INSERT INTO writeguard_schema_migrations(name) VALUES ($1)",
          [migrationName]
        );
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
}

export type LocalPilotTelemetryOptions = {
  filePath: string;
};

export class PilotTelemetry implements PilotTelemetrySink {
  private readonly telemetry: LocalPilotTelemetry;

  constructor(options: LocalPilotTelemetryOptions) {
    this.telemetry = new LocalPilotTelemetry(options.filePath);
  }

  record(event: Parameters<PilotTelemetrySink["record"]>[0]): Promise<void> {
    return this.telemetry.record(event);
  }

  summary(period: PilotTelemetryPeriod = {}): Promise<PilotSummary> {
    return this.telemetry.summary(period);
  }
}

export function createLocalPilotTelemetry(options: LocalPilotTelemetryOptions): PilotTelemetry {
  return new PilotTelemetry(options);
}

export function isUnknownExecutionOutcome(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "UnknownExecutionOutcome" || error.constructor.name === "UnknownExecutionOutcome")
  );
}

export {
  ConfirmedExecutionFailure,
  IllegalStateTransitionError,
  OperationKeyConflictError,
  OperationInProgressError,
  PreSubmissionFailure,
  ReconciliationFailure,
  UnknownExecutionOutcome,
  VerificationFailure,
  WriteGuardError
} from "../../sdk/src/index.js";

export type {
  CompensationContext,
  EffectType,
  ExecutionContext,
  ExecutionReceipt,
  GuardedTool,
  GuardedToolInvocation,
  GuardToolOptions,
  LatencySummary,
  PilotMetricName,
  PilotSummary,
  PilotTelemetryPeriod,
  PilotTelemetryRecord,
  PilotTelemetrySink,
  ReconciliationContext,
  ReconciliationOutcome,
  ReportedInvocation,
  ShadowClassification,
  ShadowReceipt,
  ShadowVerificationContext,
  VerificationContext,
  WriteGuardExecutionOptions,
  WriteGuardObservationOptions,
  WriteGuardErrorCode
} from "../../sdk/src/index.js";
