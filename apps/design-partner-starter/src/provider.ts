import { randomUUID } from "node:crypto";
import type { ReconciliationOutcome } from "@closure/writeguard";

export type SandboxRefund = {
  id: string;
  operationId: string;
  businessKey: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  status: "succeeded";
};

export type SandboxProviderScenario =
  | "success"
  | "timeout_after_success"
  | "ambiguous_matches"
  | "reconciliation_unavailable";

export class SandboxRefundProvider {
  private readonly refunds: SandboxRefund[] = [];

  constructor(private readonly scenario: SandboxProviderScenario = "success") {}

  async createRefund(request: Omit<SandboxRefund, "id" | "status">): Promise<SandboxRefund> {
    const refund: SandboxRefund = {
      id: `starter_refund_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      ...request,
      currency: request.currency.toLowerCase(),
      status: "succeeded"
    };
    this.refunds.push(refund);
    if (this.scenario === "ambiguous_matches") {
      this.refunds.push({ ...refund, id: `${refund.id}_duplicate` });
    }
    if (this.scenario === "timeout_after_success") {
      throw new Error("Sandbox provider committed the refund but lost the acknowledgement");
    }
    return structuredClone(refund);
  }

  async reconcileByOperationId(
    operationId: string,
    paymentIntentId: string
  ): Promise<ReconciliationOutcome<SandboxRefund>> {
    if (this.scenario === "reconciliation_unavailable") {
      return {
        kind: "unavailable",
        reason: "Sandbox provider lookup is unavailable",
        evidence: { lookup: "operation_id" }
      };
    }
    return this.classify(
      this.refunds.filter(
        (refund) => refund.operationId === operationId && refund.paymentIntentId === paymentIntentId
      )
    );
  }

  async reconcileByBusinessKey(
    businessKey: string
  ): Promise<ReconciliationOutcome<SandboxRefund>> {
    if (this.scenario === "reconciliation_unavailable") {
      return {
        kind: "unavailable",
        reason: "Sandbox provider lookup is unavailable",
        evidence: { lookup: "business_key" }
      };
    }
    return this.classify(this.refunds.filter((refund) => refund.businessKey === businessKey));
  }

  private classify(matches: SandboxRefund[]): ReconciliationOutcome<SandboxRefund> {
    if (matches.length === 0) {
      return { kind: "not_found", evidence: { matchCount: 0 } };
    }
    if (matches.length > 1) {
      return {
        kind: "ambiguous",
        providerReferences: matches.map((refund) => refund.id),
        evidence: { matchCount: matches.length }
      };
    }
    return {
      kind: "found",
      result: structuredClone(matches[0]!),
      evidence: { matchCount: 1 }
    };
  }

  async countRefunds(businessKey?: string): Promise<number> {
    return businessKey
      ? this.refunds.filter((refund) => refund.businessKey === businessKey).length
      : this.refunds.length;
  }
}
