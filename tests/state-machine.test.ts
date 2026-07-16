import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  IllegalStateTransitionError,
  legalTransitions,
  operationStatuses
} from "@writeguard/core";

describe("operation state machine", () => {
  it("defines every persisted state", () => {
    expect(Object.keys(legalTransitions).sort()).toEqual([...operationStatuses].sort());
  });

  it("allows the unknown outcome to be reconciled before confirmation", () => {
    expect(canTransition("SUBMITTED", "UNKNOWN")).toBe(true);
    expect(canTransition("UNKNOWN", "RECONCILING")).toBe(true);
    expect(canTransition("RECONCILING", "CONFIRMED")).toBe(true);
  });

  it("rejects terminal-state reuse and unsafe shortcuts", () => {
    expect(() => assertTransition("UNKNOWN", "CONFIRMED")).toThrow(IllegalStateTransitionError);
    expect(() => assertTransition("CONFIRMED", "SUBMITTED")).toThrow(IllegalStateTransitionError);
    expect(() => assertTransition("FAILED", "CLAIMED")).toThrow(IllegalStateTransitionError);
  });
});
