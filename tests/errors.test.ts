import { describe, expect, it } from "vitest";
import {
  classifyError,
  ConfirmedExecutionFailure,
  PreSubmissionFailure,
  UnknownExecutionOutcome
} from "@writeguard/core";

describe("typed error classification", () => {
  it.each([
    [new PreSubmissionFailure("request never left the process"), "PRE_SUBMISSION_FAILURE"],
    [new ConfirmedExecutionFailure("provider rejected it"), "CONFIRMED_EXECUTION_FAILURE"],
    [new UnknownExecutionOutcome("provider may have committed"), "UNKNOWN_EXECUTION_OUTCOME"]
  ])("preserves the operational category for %s", (error, expectedType) => {
    expect(classifyError(error)).toMatchObject({ type: expectedType });
  });

  it("redacts credentials before an error reaches the durable ledger", () => {
    expect(classifyError(new Error("authorization Bearer secret.token and sk_test_dontstoreme"))).toEqual({
      type: "Error",
      message: "authorization Bearer [REDACTED] and [REDACTED_STRIPE_KEY]"
    });
  });
});
