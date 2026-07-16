import type { ReconciliationOutcome } from "@closure/writeguard";

export type PilotRefund = {
  id: string;
  operationId: string;
  businessKey: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  status: "succeeded";
};

export type FakeProviderScenario = "success" | "timeout_after_success" | "ambiguous" | "unavailable";

export class PilotFakeRefundProvider {
  private readonly refunds: PilotRefund[] = [];
  private nextId = 1;

  constructor(private readonly scenario: FakeProviderScenario = "success") {}

  async ping(): Promise<boolean> {
    return true;
  }

  async createRefund(input: Omit<PilotRefund, "id" | "status">): Promise<PilotRefund> {
    const refund: PilotRefund = {
      id: `fake_refund_${String(this.nextId++).padStart(4, "0")}`,
      ...input,
      currency: input.currency.toLowerCase(),
      status: "succeeded"
    };
    this.refunds.push(refund);
    if (this.scenario === "ambiguous") {
      this.refunds.push({ ...refund, id: `${refund.id}_duplicate` });
    }
    if (this.scenario === "timeout_after_success") {
      throw new Error("Fake provider committed the refund but lost the acknowledgement");
    }
    return structuredClone(refund);
  }

  async reconcileByOperationId(
    operationId: string,
    paymentIntentId: string
  ): Promise<ReconciliationOutcome<PilotRefund>> {
    return this.classify(
      this.refunds.filter(
        (refund) => refund.operationId === operationId && refund.paymentIntentId === paymentIntentId
      )
    );
  }

  async reconcileByBusinessKey(businessKey: string): Promise<ReconciliationOutcome<PilotRefund>> {
    return this.classify(this.refunds.filter((refund) => refund.businessKey === businessKey));
  }

  countRefunds(): number {
    return this.refunds.length;
  }

  private classify(matches: PilotRefund[]): ReconciliationOutcome<PilotRefund> {
    if (this.scenario === "unavailable") {
      return { kind: "unavailable", reason: "Fake provider lookup unavailable", evidence: {} };
    }
    if (matches.length === 0) return { kind: "not_found", evidence: { matchCount: 0 } };
    if (matches.length > 1) {
      return {
        kind: "ambiguous",
        providerReferences: matches.map((refund) => refund.id),
        evidence: { matchCount: matches.length }
      };
    }
    return { kind: "found", result: structuredClone(matches[0]!), evidence: { matchCount: 1 } };
  }
}
