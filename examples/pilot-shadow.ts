import type {
  ReconciliationOutcome,
  ShadowReceipt,
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
  businessKey: string;
  amount: number;
  currency: string;
  status: "succeeded" | "failed";
};

export type ExistingRefundLookup = {
  reconcileByBusinessKey(key: string): Promise<ReconciliationOutcome<RefundRecord>>;
};

function refundOperationKey(input: RefundInput): string {
  return `${input.tenantId}:${input.orderId}:refund:${input.currency.toLowerCase()}:${input.amount}`;
}

/**
 * Call this beside the application's existing write path. Shadow mode records and
 * reconciles observations only; it never executes or suppresses the refund.
 */
export async function observeExistingRefundAttempt(options: {
  writeGuard: WriteGuardClient;
  provider: ExistingRefundLookup;
  input: RefundInput;
  frameworkToolCallId: string;
}): Promise<ShadowReceipt> {
  const key = refundOperationKey(options.input);
  return options.writeGuard.observe({
    key,
    action: { name: "refund_order", provider: "payments", effectType: "irreversible_write" },
    fingerprint: options.input,
    metadata: { workflow: "refund_order" },
    reportedInvocation: {
      framework: "mcp",
      toolName: "refund_order",
      toolCallId: options.frameworkToolCallId
    },
    reconcile: () => options.provider.reconcileByBusinessKey(key),
    verify: async (refund) =>
      refund.status === "succeeded" &&
      refund.businessKey === key &&
      refund.amount === options.input.amount &&
      refund.currency === options.input.currency.toLowerCase(),
    getProviderReference: (refund) => refund.id
  });
}
