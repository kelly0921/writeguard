import "dotenv/config";
import pg from "pg";
import {
  PostgresFakeRefundProvider,
  PostgresOperationStore,
  UnknownExecutionOutcome
} from "@writeguard/core";
import { WriteGuard } from "@writeguard/sdk";
import { SupportRefundWorkflow, supportRefundOperationKey } from "./workflow.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://closure:closure@localhost:54327/closure";
const pool = new Pool({ connectionString: databaseUrl });
const store = new PostgresOperationStore(pool);
const provider = new PostgresFakeRefundProvider(pool, { scenario: "timeout_after_success" });
const guard = new WriteGuard({ store, namespace: "support-refund-demo", pollIntervalMs: 10 });
const workflow = new SupportRefundWorkflow(pool, guard, provider);
const caseId = `case-781-${Date.now()}`;
const baseRequest = {
  caseId,
  tenantId: "demo-tenant",
  orderId: "order-781",
  paymentIntentId: `pi_support_${Date.now()}`,
  amount: 100,
  currency: "usd"
};

try {
  await workflow.seedCase({ id: caseId, tenantId: baseRequest.tenantId, orderId: baseRequest.orderId });
  try {
    await workflow.run({ ...baseRequest, frameworkToolCallId: "call_A" });
  } catch (error) {
    if (!(error instanceof UnknownExecutionOutcome)) throw error;
  }
  const afterLostAcknowledgement = await workflow.getCase(caseId);
  const final = await workflow.run({ ...baseRequest, frameworkToolCallId: "call_B" });
  const timeline = await store.getTimeline("support-refund-demo", supportRefundOperationKey(baseRequest));

  console.log("Support refund workflow validation");
  console.log(JSON.stringify({
    afterLostAcknowledgement,
    finalSupportCase: final.supportCase,
    receipt: final.receipt,
    externalRefunds: await provider.countRefunds(baseRequest.paymentIntentId),
    operationStates: timeline?.events.map((event) => event.newStatus)
  }, null, 2));
} finally {
  await pool.end();
}
