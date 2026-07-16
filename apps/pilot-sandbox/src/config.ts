import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const environmentSchema = z.object({
  PILOT_MODE: z.enum(["shadow", "enforced"]).default("shadow"),
  PILOT_NAMESPACE: z.string().min(1).max(100).regex(/^[a-zA-Z0-9:_-]+$/).default("writeguard-pilot"),
  PILOT_DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
      message: "PILOT_DATABASE_URL must use postgresql:// or postgres://"
    })
    .default("postgresql://writeguard:writeguard@127.0.0.1:54328/writeguard_pilot"),
  PILOT_STORAGE: z.literal("postgresql").default("postgresql"),
  PILOT_PROVIDER: z.enum(["fake", "stripe-test"]).default("fake"),
  PILOT_TELEMETRY_ENABLED: booleanString.default("true"),
  PILOT_TELEMETRY_FILE: z.string().min(1).default(".writeguard/pilot-telemetry.jsonl"),
  PILOT_RECONCILIATION_ENABLED: booleanString.default("true"),
  PILOT_RECEIPT_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  PILOT_SENSITIVE_FIELD_POLICY: z.enum(["omit", "redact"]).default("omit"),
  PILOT_FAIL_CLOSED_ON_STORAGE_ERROR: booleanString.default("true"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PAYMENT_INTENT_ID: z.string().optional(),
  STRIPE_PAYMENT_INTENT_AMOUNT: z.coerce.number().int().positive().default(500),
  STRIPE_REFUND_AMOUNT: z.coerce.number().int().positive().default(100),
  STRIPE_CURRENCY: z.string().length(3).default("usd")
});

export type PilotMode = "shadow" | "enforced";
export type PilotProvider = "fake" | "stripe-test";

export type PilotConfig = {
  mode: PilotMode;
  namespace: string;
  databaseUrl: string;
  storage: "postgresql";
  provider: PilotProvider;
  telemetryEnabled: boolean;
  telemetryFile: string;
  reconciliationEnabled: boolean;
  receiptRetentionDays: number;
  sensitiveFieldPolicy: "omit" | "redact";
  failClosedOnStorageError: true;
  stripe: {
    secretKey?: string;
    paymentIntentId?: string;
    paymentIntentAmount: number;
    refundAmount: number;
    currency: string;
  };
};

export function isLocalDatabaseUrl(value: string): boolean {
  const host = new URL(value).hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function assertNoLiveStripeKey(value: string | undefined): void {
  if (value?.startsWith("sk_live_")) {
    throw new Error("Live Stripe credentials are rejected. Pilot validation accepts test mode only.");
  }
}

export function parsePilotConfig(
  input: NodeJS.ProcessEnv | Record<string, string | undefined>,
  options: { cwd?: string; requireLocalDatabase?: boolean } = {}
): PilotConfig {
  const parsed = environmentSchema.parse(input);
  assertNoLiveStripeKey(parsed.STRIPE_SECRET_KEY);
  if (!parsed.PILOT_FAIL_CLOSED_ON_STORAGE_ERROR) {
    throw new Error("PILOT_FAIL_CLOSED_ON_STORAGE_ERROR must remain true during pilots.");
  }
  if (!parsed.PILOT_RECONCILIATION_ENABLED) {
    throw new Error("PILOT_RECONCILIATION_ENABLED must remain true during pilots.");
  }
  if (options.requireLocalDatabase && !isLocalDatabaseUrl(parsed.PILOT_DATABASE_URL)) {
    throw new Error("The local pilot sandbox only accepts a localhost PostgreSQL URL.");
  }
  if (parsed.PILOT_PROVIDER === "stripe-test") {
    if (!parsed.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
      throw new Error("PILOT_PROVIDER=stripe-test requires a test-mode sk_test_ credential.");
    }
    if (parsed.PILOT_MODE !== "enforced") {
      throw new Error("Stripe test validation requires PILOT_MODE=enforced.");
    }
  }
  const cwd = options.cwd ?? process.cwd();
  return {
    mode: parsed.PILOT_MODE,
    namespace: parsed.PILOT_NAMESPACE,
    databaseUrl: parsed.PILOT_DATABASE_URL,
    storage: parsed.PILOT_STORAGE,
    provider: parsed.PILOT_PROVIDER,
    telemetryEnabled: parsed.PILOT_TELEMETRY_ENABLED,
    telemetryFile: resolve(cwd, parsed.PILOT_TELEMETRY_FILE),
    reconciliationEnabled: parsed.PILOT_RECONCILIATION_ENABLED,
    receiptRetentionDays: parsed.PILOT_RECEIPT_RETENTION_DAYS,
    sensitiveFieldPolicy: parsed.PILOT_SENSITIVE_FIELD_POLICY,
    failClosedOnStorageError: true,
    stripe: {
      ...(parsed.STRIPE_SECRET_KEY ? { secretKey: parsed.STRIPE_SECRET_KEY } : {}),
      ...(parsed.STRIPE_PAYMENT_INTENT_ID
        ? { paymentIntentId: parsed.STRIPE_PAYMENT_INTENT_ID }
        : {}),
      paymentIntentAmount: parsed.STRIPE_PAYMENT_INTENT_AMOUNT,
      refundAmount: parsed.STRIPE_REFUND_AMOUNT,
      currency: parsed.STRIPE_CURRENCY.toLowerCase()
    }
  };
}

export function loadPilotConfig(options: { cwd?: string; requireLocalDatabase?: boolean } = {}): PilotConfig {
  const cwd = options.cwd ?? process.cwd();
  loadDotEnv({ path: resolve(cwd, ".env.pilot"), quiet: true });
  return parsePilotConfig(process.env, {
    cwd,
    ...(options.requireLocalDatabase !== undefined
      ? { requireLocalDatabase: options.requireLocalDatabase }
      : {})
  });
}
