import pg from "pg";
import type { ExecutionReceipt, ShadowReceipt, WriteGuardClient } from "@closure/writeguard";
import { PilotFakeRefundProvider, type PilotRefund } from "./provider.js";

type Pool = pg.Pool;

export type PilotRefundRequest = {
  caseId: string;
  tenantId: string;
  orderId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  frameworkToolCallId: string;
};

export function pilotOperationKey(
  request: Pick<PilotRefundRequest, "tenantId" | "orderId" | "amount" | "currency">
): string {
  return `${request.tenantId}:${request.orderId}:refund:${request.currency.toLowerCase()}:${request.amount}`;
}

export async function ensurePilotSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pilot_support_cases (
      id text PRIMARY KEY,
      status text NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
      refund_status text NOT NULL CHECK (
        refund_status IN ('NOT_REQUESTED', 'PENDING', 'CONFIRMED', 'NEEDS_REVIEW')
      ),
      operation_key text,
      receipt_id text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function seedPilotCase(pool: Pool, caseId: string): Promise<void> {
  await pool.query(
    `INSERT INTO pilot_support_cases (id, status, refund_status)
     VALUES ($1, 'OPEN', 'NOT_REQUESTED')
     ON CONFLICT (id) DO UPDATE SET
       status = 'OPEN', refund_status = 'NOT_REQUESTED', operation_key = NULL,
       receipt_id = NULL, updated_at = now()`,
    [caseId]
  );
}

export async function readPilotCase(pool: Pool, caseId: string): Promise<{
  status: string;
  refundStatus: string;
  hasReceipt: boolean;
}> {
  const result = await pool.query(
    "SELECT status, refund_status, receipt_id FROM pilot_support_cases WHERE id = $1",
    [caseId]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("Pilot support case was not found");
  return {
    status: String(row.status),
    refundStatus: String(row.refund_status),
    hasReceipt: typeof row.receipt_id === "string"
  };
}

export async function runUnsafeRefund(
  provider: PilotFakeRefundProvider,
  request: PilotRefundRequest
): Promise<PilotRefund> {
  return provider.createRefund({
    operationId: request.frameworkToolCallId,
    businessKey: pilotOperationKey(request),
    paymentIntentId: request.paymentIntentId,
    amount: request.amount,
    currency: request.currency
  });
}

export class PilotRefundWorkflow {
  constructor(
    private readonly pool: Pool,
    private readonly writeGuard: WriteGuardClient,
    private readonly provider: PilotFakeRefundProvider,
    private readonly sensitiveFieldPolicy: "omit" | "redact"
  ) {}

  private metadata(request: PilotRefundRequest): Record<string, unknown> {
    if (this.sensitiveFieldPolicy === "omit") return { workflow: "pilot_sandbox" };
    return {
      workflow: "pilot_sandbox",
      tenantId: request.tenantId,
      orderId: request.orderId,
      paymentIntentId: request.paymentIntentId
    };
  }

  async enforce(request: PilotRefundRequest): Promise<ExecutionReceipt> {
    const key = pilotOperationKey(request);
    await this.pool.query(
      `UPDATE pilot_support_cases
       SET refund_status = 'PENDING', operation_key = $2, updated_at = now()
       WHERE id = $1`,
      [request.caseId, key]
    );
    const receipt = await this.writeGuard.execute({
      key,
      action: { name: "refund_order", provider: "fake-payments", effectType: "irreversible_write" },
      fingerprint: {
        tenantId: request.tenantId,
        orderId: request.orderId,
        paymentIntentId: request.paymentIntentId,
        amount: request.amount,
        currency: request.currency.toLowerCase()
      },
      metadata: this.metadata(request),
      sensitiveFields: ["tenantId", "orderId", "paymentIntentId"],
      invocation: {
        framework: "mcp",
        toolName: "refund_order",
        toolCallId: request.frameworkToolCallId
      },
      execute: (context) =>
        this.provider.createRefund({
          operationId: context.operationId,
          businessKey: key,
          paymentIntentId: request.paymentIntentId,
          amount: request.amount,
          currency: request.currency
        }),
      reconcile: (context) =>
        this.provider.reconcileByOperationId(context.operationId, request.paymentIntentId),
      verify: async (refund, context) =>
        refund.status === "succeeded" &&
        refund.operationId === context.operationId &&
        refund.businessKey === key &&
        refund.amount === request.amount &&
        refund.currency === request.currency.toLowerCase(),
      getProviderReference: (refund) => refund.id,
      getVerificationEvidence: (refund, context) => ({
        provider: "fake-payments",
        operationMetadataMatches: refund.operationId === context.operationId,
        amountMatches: refund.amount === request.amount,
        currencyMatches: refund.currency === request.currency.toLowerCase()
      })
    });
    if (receipt.status === "CONFIRMED") {
      await this.pool.query(
        `UPDATE pilot_support_cases
         SET status = 'RESOLVED', refund_status = 'CONFIRMED', receipt_id = $2, updated_at = now()
         WHERE id = $1`,
        [request.caseId, receipt.id]
      );
    } else {
      await this.pool.query(
        `UPDATE pilot_support_cases
         SET refund_status = 'NEEDS_REVIEW', receipt_id = $2, updated_at = now()
         WHERE id = $1`,
        [request.caseId, receipt.id]
      );
    }
    return receipt;
  }

  observe(request: PilotRefundRequest): Promise<ShadowReceipt> {
    const key = pilotOperationKey(request);
    return this.writeGuard.observe({
      key,
      action: { name: "refund_order", provider: "fake-payments", effectType: "irreversible_write" },
      fingerprint: {
        tenantId: request.tenantId,
        orderId: request.orderId,
        paymentIntentId: request.paymentIntentId,
        amount: request.amount,
        currency: request.currency.toLowerCase()
      },
      metadata: this.metadata(request),
      sensitiveFields: ["tenantId", "orderId", "paymentIntentId"],
      reportedInvocation: {
        framework: "mcp",
        toolName: "refund_order",
        toolCallId: request.frameworkToolCallId
      },
      reconcile: () => this.provider.reconcileByBusinessKey(key),
      verify: async (refund) =>
        refund.status === "succeeded" &&
        refund.businessKey === key &&
        refund.amount === request.amount &&
        refund.currency === request.currency.toLowerCase(),
      getProviderReference: (refund) => refund.id
    });
  }
}
