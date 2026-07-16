import pg from "pg";
import {
  type ExecutionReceipt,
  type FakeRefund,
  type FakeRefundProviderContract,
  UnknownExecutionOutcome
} from "@writeguard/core";
import { WriteGuard } from "@writeguard/sdk";

export type SupportCase = {
  id: string;
  tenantId: string;
  orderId: string;
  status: "OPEN" | "RESOLVED";
  refundStatus: "NOT_REQUESTED" | "PENDING" | "CONFIRMED" | "NEEDS_REVIEW";
  refundOperationKey: string | null;
  refundReceiptId: string | null;
  lastFrameworkToolCallId: string | null;
  closedAt: Date | null;
};

export type SupportRefundRequest = {
  caseId: string;
  tenantId: string;
  orderId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  frameworkToolCallId: string;
};

type PoolType = pg.Pool;

function supportCaseFromRow(row: Record<string, unknown>): SupportCase {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    orderId: row.order_id as string,
    status: row.status as SupportCase["status"],
    refundStatus: row.refund_status as SupportCase["refundStatus"],
    refundOperationKey: (row.refund_operation_key as string | null) ?? null,
    refundReceiptId: (row.refund_receipt_id as string | null) ?? null,
    lastFrameworkToolCallId: (row.last_framework_tool_call_id as string | null) ?? null,
    closedAt: (row.closed_at as Date | null) ?? null
  };
}

export function supportRefundOperationKey(input: Pick<SupportRefundRequest, "tenantId" | "orderId" | "amount" | "currency">): string {
  return `${input.tenantId}:${input.orderId}:refund:${input.currency.toLowerCase()}:${input.amount}`;
}

export class SupportRefundWorkflow {
  constructor(
    private readonly pool: PoolType,
    private readonly writeGuard: WriteGuard,
    private readonly provider: FakeRefundProviderContract
  ) {}

  async seedCase(input: { id: string; tenantId: string; orderId: string }): Promise<SupportCase> {
    const result = await this.pool.query(
      `INSERT INTO support_cases
        (id, tenant_id, order_id, status, refund_status)
       VALUES ($1, $2, $3, 'OPEN', 'NOT_REQUESTED')
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         order_id = EXCLUDED.order_id,
         status = 'OPEN',
         refund_status = 'NOT_REQUESTED',
         refund_operation_key = NULL,
         refund_receipt_id = NULL,
         last_framework_tool_call_id = NULL,
         closed_at = NULL,
         updated_at = now()
       RETURNING *`,
      [input.id, input.tenantId, input.orderId]
    );
    return supportCaseFromRow(result.rows[0] as Record<string, unknown>);
  }

  async getCase(caseId: string): Promise<SupportCase | null> {
    const result = await this.pool.query("SELECT * FROM support_cases WHERE id = $1", [caseId]);
    return result.rowCount === 1
      ? supportCaseFromRow(result.rows[0] as Record<string, unknown>)
      : null;
  }

  async run(request: SupportRefundRequest): Promise<{ supportCase: SupportCase; receipt: ExecutionReceipt }> {
    const operationKey = supportRefundOperationKey(request);
    await this.pool.query(
      `UPDATE support_cases
       SET refund_status = 'PENDING',
           refund_operation_key = $2,
           last_framework_tool_call_id = $3,
           updated_at = now()
       WHERE id = $1 AND status = 'OPEN'`,
      [request.caseId, operationKey, request.frameworkToolCallId]
    );

    const guardedRefund = this.writeGuard.guardTool<Omit<SupportRefundRequest, "caseId" | "frameworkToolCallId">, FakeRefund>({
      name: "support.refund_order",
      provider: "fake-payments",
      effectType: "irreversible_write",
      getOperationKey: supportRefundOperationKey,
      getFingerprint: ({ tenantId, orderId, paymentIntentId, amount, currency }) => ({
        tenantId,
        orderId,
        paymentIntentId,
        amount,
        currency: currency.toLowerCase()
      }),
      getMetadata: ({ tenantId, orderId, paymentIntentId, amount, currency }) => ({
        tenantId,
        orderId,
        paymentIntentId,
        amount,
        currency: currency.toLowerCase()
      }),
      execute: (input, context) =>
        this.provider.createRefund({
          operationId: context.operationId,
          paymentIntentId: input.paymentIntentId,
          amount: input.amount,
          currency: input.currency.toLowerCase()
        }),
      reconcile: (input, context) => this.provider.reconcile(context.operationId, input.paymentIntentId),
      verify: async (refund, input, context) =>
        refund.status === "succeeded" &&
        refund.operationId === context.operationId &&
        refund.paymentIntentId === input.paymentIntentId &&
        refund.amount === input.amount,
      getProviderReference: (refund) => refund.id,
      getVerificationEvidence: (refund) => ({
        refundId: refund.id,
        status: refund.status,
        amount: refund.amount,
        currency: refund.currency
      })
    });

    let receipt: ExecutionReceipt;
    try {
      const { caseId: _caseId, frameworkToolCallId: _toolCallId, ...domainInput } = request;
      receipt = await guardedRefund.invoke(domainInput, {
        framework: "support-agent",
        toolCallId: request.frameworkToolCallId,
        metadata: { supportCaseId: request.caseId }
      });
    } catch (error) {
      if (error instanceof UnknownExecutionOutcome) throw error;
      await this.pool.query(
        `UPDATE support_cases
         SET refund_status = 'NEEDS_REVIEW', updated_at = now()
         WHERE id = $1`,
        [request.caseId]
      );
      throw error;
    }

    if (receipt.status !== "CONFIRMED") {
      await this.pool.query(
        `UPDATE support_cases
         SET refund_status = 'NEEDS_REVIEW', refund_receipt_id = $2, updated_at = now()
         WHERE id = $1`,
        [request.caseId, receipt.id]
      );
      throw new Error(`Refund operation ended in ${receipt.status}; support case requires review`);
    }

    const result = await this.pool.query(
      `UPDATE support_cases
       SET refund_status = 'CONFIRMED',
           refund_receipt_id = $2,
           status = 'RESOLVED',
           closed_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [request.caseId, receipt.id]
    );
    return {
      supportCase: supportCaseFromRow(result.rows[0] as Record<string, unknown>),
      receipt
    };
  }
}
