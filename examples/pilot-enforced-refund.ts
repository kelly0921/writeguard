import type {
  GuardedTool,
  ReconciliationOutcome,
  WriteGuardClient
} from "@closure/writeguard";

type RefundInput = {
  tenantId: string;
  orderId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
};

type RefundRecord = {
  id: string;
  operationId: string;
  businessKey: string;
  amount: number;
  currency: string;
  status: "succeeded" | "failed";
};

export type RefundProvider = {
  createRefund(input: {
    operationId: string;
    businessKey: string;
    paymentIntentId: string;
    amount: number;
    currency: string;
  }): Promise<RefundRecord>;
  reconcileByOperationId(
    operationId: string,
    paymentIntentId: string
  ): Promise<ReconciliationOutcome<RefundRecord>>;
};

function refundOperationKey(input: RefundInput): string {
  return `${input.tenantId}:${input.orderId}:refund:${input.currency.toLowerCase()}:${input.amount}`;
}

/** Build this tool only after the same workflow has passed shadow observation. */
export function createGuardedRefundTool(
  writeGuard: WriteGuardClient,
  provider: RefundProvider
): GuardedTool<RefundInput> {
  return writeGuard.guardTool<RefundInput, RefundRecord>({
    name: "refund_order",
    provider: "payments",
    effectType: "irreversible_write",
    getOperationKey: refundOperationKey,
    getFingerprint: (input) => input,
    getMetadata: () => ({ workflow: "refund_order" }),
    execute: (input, context) =>
      provider.createRefund({
        operationId: context.operationId,
        businessKey: refundOperationKey(input),
        paymentIntentId: input.paymentIntentId,
        amount: input.amount,
        currency: input.currency
      }),
    reconcile: (input, context) =>
      provider.reconcileByOperationId(context.operationId, input.paymentIntentId),
    verify: async (refund, input, context) =>
      refund.status === "succeeded" &&
      refund.operationId === context.operationId &&
      refund.businessKey === refundOperationKey(input) &&
      refund.amount === input.amount &&
      refund.currency === input.currency.toLowerCase(),
    getProviderReference: (refund) => refund.id,
    getVerificationEvidence: (refund, input, context) => ({
      operationMetadataMatches: refund.operationId === context.operationId,
      amountMatches: refund.amount === input.amount,
      currencyMatches: refund.currency === input.currency.toLowerCase()
    })
  });
}
