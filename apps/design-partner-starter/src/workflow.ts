import pg from "pg";
import {
  type ExecutionReceipt,
  type ShadowReceipt,
  type WriteGuardClient
} from "@closure/writeguard";
import { SandboxRefundProvider, type SandboxRefund } from "./provider.js";

type PoolType = pg.Pool;

export type StarterRefundRequest = {
  caseId: string;
  tenantId: string;
  orderId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  frameworkToolCallId: string;
};

export type StarterSupportCase = {
  id: string;
  status: "OPEN" | "RESOLVED";
  refundStatus: "NOT_REQUESTED" | "PENDING" | "CONFIRMED" | "NEEDS_REVIEW";
  operationKey: string | null;
  receiptId: string | null;
};

function caseFromRow(row: Record<string, unknown>): StarterSupportCase {
  return {
    id: row.id as string,
    status: row.status as StarterSupportCase["status"],
    refundStatus: row.refund_status as StarterSupportCase["refundStatus"],
    operationKey: (row.operation_key as string | null) ?? null,
    receiptId: (row.receipt_id as string | null) ?? null
  };
}

export function starterOperationKey(
  request: Pick<StarterRefundRequest, "tenantId" | "orderId" | "amount" | "currency">
): string {
  return `${request.tenantId}:${request.orderId}:refund:${request.currency.toLowerCase()}:${request.amount}`;
}

export async function ensureStarterSchema(pool: PoolType): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS design_partner_support_cases (
      id text PRIMARY KEY,
      tenant_id text NOT NULL,
      order_id text NOT NULL,
      status text NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
      refund_status text NOT NULL CHECK (
        refund_status IN ('NOT_REQUESTED', 'PENDING', 'CONFIRMED', 'NEEDS_REVIEW')
      ),
      operation_key text,
      receipt_id text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS design_partner_manual_refund_operations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      operation_key text NOT NULL UNIQUE,
      status text NOT NULL CHECK (status IN ('PLANNED', 'SUBMITTED', 'UNKNOWN', 'CONFIRMED', 'NEEDS_REVIEW')),
      provider_reference text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function resetStarterSchema(pool: PoolType): Promise<void> {
  await pool.query(
    "TRUNCATE design_partner_support_cases, design_partner_manual_refund_operations"
  );
}

export async function seedStarterCase(
  pool: PoolType,
  input: Pick<StarterRefundRequest, "caseId" | "tenantId" | "orderId">
): Promise<StarterSupportCase> {
  const result = await pool.query(
    `INSERT INTO design_partner_support_cases
      (id, tenant_id, order_id, status, refund_status)
     VALUES ($1, $2, $3, 'OPEN', 'NOT_REQUESTED')
     ON CONFLICT (id) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id,
       order_id = EXCLUDED.order_id,
       status = 'OPEN',
       refund_status = 'NOT_REQUESTED',
       operation_key = NULL,
       receipt_id = NULL,
       updated_at = now()
     RETURNING *`,
    [input.caseId, input.tenantId, input.orderId]
  );
  return caseFromRow(result.rows[0] as Record<string, unknown>);
}

export async function getStarterCase(
  pool: PoolType,
  caseId: string
): Promise<StarterSupportCase | null> {
  const result = await pool.query("SELECT * FROM design_partner_support_cases WHERE id = $1", [caseId]);
  return result.rowCount === 1 ? caseFromRow(result.rows[0] as Record<string, unknown>) : null;
}

function domainInput(request: StarterRefundRequest) {
  return {
    tenantId: request.tenantId,
    orderId: request.orderId,
    paymentIntentId: request.paymentIntentId,
    amount: request.amount,
    currency: request.currency.toLowerCase()
  };
}

export async function runUnsafeRefund(
  provider: SandboxRefundProvider,
  request: StarterRefundRequest
): Promise<SandboxRefund> {
  return provider.createRefund({
    operationId: request.frameworkToolCallId,
    businessKey: starterOperationKey(request),
    paymentIntentId: request.paymentIntentId,
    amount: request.amount,
    currency: request.currency
  });
}

export async function runManualRefund(
  pool: PoolType,
  provider: SandboxRefundProvider,
  request: StarterRefundRequest
): Promise<{ status: "CONFIRMED" | "NEEDS_REVIEW"; providerReference: string | null }> {
  const key = starterOperationKey(request);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO design_partner_manual_refund_operations (operation_key, status)
     VALUES ($1, 'PLANNED')
     ON CONFLICT (operation_key) DO NOTHING
     RETURNING id`,
    [key]
  );
  const selected = await pool.query<{ id: string; status: string; provider_reference: string | null }>(
    "SELECT id, status, provider_reference FROM design_partner_manual_refund_operations WHERE operation_key = $1",
    [key]
  );
  const operation = selected.rows[0]!;
  if (inserted.rowCount === 1) {
    await pool.query(
      "UPDATE design_partner_manual_refund_operations SET status = 'SUBMITTED', updated_at = now() WHERE id = $1",
      [operation.id]
    );
    try {
      const refund = await provider.createRefund({
        operationId: operation.id,
        businessKey: key,
        paymentIntentId: request.paymentIntentId,
        amount: request.amount,
        currency: request.currency
      });
      await pool.query(
        `UPDATE design_partner_manual_refund_operations
         SET status = 'CONFIRMED', provider_reference = $2, updated_at = now() WHERE id = $1`,
        [operation.id, refund.id]
      );
      return { status: "CONFIRMED", providerReference: refund.id };
    } catch (error) {
      await pool.query(
        "UPDATE design_partner_manual_refund_operations SET status = 'UNKNOWN', updated_at = now() WHERE id = $1",
        [operation.id]
      );
      throw error;
    }
  }
  if (operation.status === "CONFIRMED") {
    return { status: "CONFIRMED", providerReference: operation.provider_reference };
  }
  const outcome = await provider.reconcileByOperationId(operation.id, request.paymentIntentId);
  if (outcome.kind !== "found" || outcome.result.status !== "succeeded") {
    await pool.query(
      "UPDATE design_partner_manual_refund_operations SET status = 'NEEDS_REVIEW', updated_at = now() WHERE id = $1",
      [operation.id]
    );
    return { status: "NEEDS_REVIEW", providerReference: null };
  }
  await pool.query(
    `UPDATE design_partner_manual_refund_operations
     SET status = 'CONFIRMED', provider_reference = $2, updated_at = now() WHERE id = $1`,
    [operation.id, outcome.result.id]
  );
  return { status: "CONFIRMED", providerReference: outcome.result.id };
}

export class StarterRefundWorkflow {
  constructor(
    private readonly pool: PoolType,
    private readonly writeGuard: WriteGuardClient,
    private readonly provider: SandboxRefundProvider
  ) {}

  private guardedTool() {
    return this.writeGuard.guardTool<ReturnType<typeof domainInput>, SandboxRefund>({
      name: "refund_order",
      provider: "sandbox-payments",
      effectType: "irreversible_write",
      getOperationKey: starterOperationKey,
      getFingerprint: (input) => input,
      getMetadata: ({ tenantId, orderId, paymentIntentId, amount, currency }) => ({
        tenantId,
        orderId,
        paymentIntentId,
        amount,
        currency
      }),
      execute: (input, context) =>
        this.provider.createRefund({
          operationId: context.operationId,
          businessKey: starterOperationKey(input),
          paymentIntentId: input.paymentIntentId,
          amount: input.amount,
          currency: input.currency
        }),
      reconcile: (input, context) =>
        this.provider.reconcileByOperationId(context.operationId, input.paymentIntentId),
      verify: async (refund, input, context) =>
        refund.status === "succeeded" &&
        refund.operationId === context.operationId &&
        refund.businessKey === starterOperationKey(input) &&
        refund.amount === input.amount &&
        refund.currency === input.currency,
      getProviderReference: (refund) => refund.id,
      getVerificationEvidence: (refund, input, context) => ({
        provider: "sandbox-payments",
        refundId: refund.id,
        operationMetadataMatches: refund.operationId === context.operationId,
        amountMatches: refund.amount === input.amount,
        currencyMatches: refund.currency === input.currency
      })
    });
  }

  async enforce(request: StarterRefundRequest): Promise<ExecutionReceipt> {
    const key = starterOperationKey(request);
    await this.pool.query(
      `UPDATE design_partner_support_cases
       SET refund_status = 'PENDING', operation_key = $2, updated_at = now()
       WHERE id = $1`,
      [request.caseId, key]
    );
    const receipt = await this.guardedTool().invoke(domainInput(request), {
      framework: "mcp",
      toolCallId: request.frameworkToolCallId,
      metadata: { workflow: "design_partner_starter" }
    });
    if (receipt.status !== "CONFIRMED") {
      await this.pool.query(
        `UPDATE design_partner_support_cases
         SET refund_status = 'NEEDS_REVIEW', receipt_id = $2, updated_at = now()
         WHERE id = $1`,
        [request.caseId, receipt.id]
      );
      return receipt;
    }
    await this.pool.query(
      `UPDATE design_partner_support_cases
       SET status = 'RESOLVED', refund_status = 'CONFIRMED', receipt_id = $2, updated_at = now()
       WHERE id = $1`,
      [request.caseId, receipt.id]
    );
    return receipt;
  }

  observe(request: StarterRefundRequest): Promise<ShadowReceipt> {
    const key = starterOperationKey(request);
    return this.writeGuard.observe({
      key,
      action: {
        name: "refund_order",
        provider: "sandbox-payments",
        effectType: "irreversible_write"
      },
      fingerprint: domainInput(request),
      metadata: {
        tenantId: request.tenantId,
        orderId: request.orderId,
        amount: request.amount,
        currency: request.currency.toLowerCase()
      },
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
