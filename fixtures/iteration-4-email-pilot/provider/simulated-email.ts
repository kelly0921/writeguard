import { UnknownExecutionOutcome } from "@closure/writeguard";
import type {
  ExecutionContext,
  ReconciliationContext,
  VerificationContext
} from "@closure/writeguard";
import type { ToolInput } from "../src/input.js";
import type { ProviderBoundary } from "../src/provider.js";

export type SimulatedEmailResult = {
  providerMessageId: string;
  operationKey: string;
};

export class SimulatedEmailProvider implements ProviderBoundary<SimulatedEmailResult> {
  private readonly records = new Map<string, SimulatedEmailResult>();
  private effects = 0;
  private timeoutExposed = false;

  constructor(private readonly mode: "success" | "timeout_after_success" = "success") {}

  unsafeSend(): SimulatedEmailResult {
    this.effects += 1;
    return { providerMessageId: "sim-message-" + this.effects, operationKey: "unsafe-" + this.effects };
  }

  async execute(_input: ToolInput, context: ExecutionContext): Promise<SimulatedEmailResult> {
    this.effects += 1;
    const result = {
      providerMessageId: "sim-message-" + this.effects,
      operationKey: context.operationKey
    };
    this.records.set(context.operationKey, result);
    if (this.mode === "timeout_after_success" && !this.timeoutExposed) {
      this.timeoutExposed = true;
      throw new UnknownExecutionOutcome("simulated acknowledgement loss after email send");
    }
    return result;
  }

  async reconcile(_input: ToolInput, context: ReconciliationContext) {
    const result = this.records.get(context.operationKey);
    return result
      ? { kind: "found" as const, result, evidence: { simulated: true } }
      : { kind: "not_found" as const, evidence: { simulated: true } };
  }

  async verify(
    result: SimulatedEmailResult,
    _input: ToolInput,
    context: VerificationContext
  ): Promise<boolean> {
    return result.operationKey === context.operationKey;
  }

  getProviderReference(result: SimulatedEmailResult): string {
    return result.providerMessageId;
  }

  effectCount(): number {
    return this.effects;
  }
}
