import { UnknownExecutionOutcome } from "@closure/writeguard";
import type {
  ExecutionContext,
  ReconciliationContext,
  VerificationContext
} from "@closure/writeguard";
import type { ToolInput } from "../src/input.js";
import type { ProviderBoundary } from "../src/provider.js";

export type SimulatedRefundResult = {
  refundId: string;
  operationKey: string;
};

export class SimulatedRefundProvider implements ProviderBoundary<SimulatedRefundResult> {
  private readonly records = new Map<string, SimulatedRefundResult>();
  private effects = 0;
  private timeoutExposed = false;

  constructor(private readonly mode: "success" | "timeout_after_success" = "success") {}

  unsafeRefund(): SimulatedRefundResult {
    this.effects += 1;
    return { refundId: `sim-refund-${this.effects}`, operationKey: `unsafe-${this.effects}` };
  }

  async execute(_input: ToolInput, context: ExecutionContext): Promise<SimulatedRefundResult> {
    this.effects += 1;
    const result = {
      refundId: `sim-refund-${this.effects}`,
      operationKey: context.operationKey
    };
    this.records.set(context.operationKey, result);
    if (this.mode === "timeout_after_success" && !this.timeoutExposed) {
      this.timeoutExposed = true;
      throw new UnknownExecutionOutcome(
        "simulated acknowledgement loss after the external refund effect"
      );
    }
    return result;
  }

  async reconcile(_input: ToolInput, context: ReconciliationContext) {
    const result = this.records.get(context.operationKey);
    return result
      ? { kind: "found" as const, result, evidence: { environment: "simulated" } }
      : { kind: "not_found" as const, evidence: { environment: "simulated" } };
  }

  async verify(
    result: SimulatedRefundResult,
    _input: ToolInput,
    context: VerificationContext
  ): Promise<boolean> {
    return result.operationKey === context.operationKey;
  }

  getProviderReference(result: SimulatedRefundResult): string {
    return result.refundId;
  }

  effectCount(): number {
    return this.effects;
  }
}
