import pg from "pg";
import {
  createRequestFingerprint,
  PostgresFakeRefundProvider,
  PostgresOperationStore
} from "@writeguard/core";
import { z } from "zod";

const environment = z.object({
  DATABASE_URL: z.string().min(1),
  CRASH_NAMESPACE: z.string().min(1),
  CRASH_OPERATION_KEY: z.string().min(1),
  CRASH_PAYMENT_INTENT_ID: z.string().min(1),
  CRASH_CLAIM_TTL_MS: z.coerce.number().int().positive().default(50)
}).parse(process.env);
const { Pool } = pg;
const pool = new Pool({ connectionString: environment.DATABASE_URL });
const store = new PostgresOperationStore(pool);
const provider = new PostgresFakeRefundProvider(pool);
const workerId = `child-worker-${process.pid}`;
const action = {
  name: "refund.create",
  provider: "fake-payments",
  effectType: "reversible_write" as const
};
const materialInput = {
  paymentIntentId: environment.CRASH_PAYMENT_INTENT_ID,
  amount: 100,
  currency: "usd"
};
const decision = await store.claim({
  namespace: environment.CRASH_NAMESPACE,
  operationKey: environment.CRASH_OPERATION_KEY,
  action,
  requestFingerprint: createRequestFingerprint({ action, materialInput }),
  metadata: materialInput,
  workerId,
  claimTtlMs: environment.CRASH_CLAIM_TTL_MS
});
if (decision.kind !== "execute") throw new Error(`Child expected execute, received ${decision.kind}`);
await store.markSubmitted(decision.operation.id, workerId);
await provider.createRefund({
  operationId: decision.operation.id,
  paymentIntentId: environment.CRASH_PAYMENT_INTENT_ID,
  amount: 100,
  currency: "usd"
});
console.log("external effect committed; terminating child before local confirmation");
process.exit(17);
