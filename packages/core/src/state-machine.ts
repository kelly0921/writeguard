import type { OperationStatus } from "./models.js";
import { IllegalStateTransitionError } from "./errors.js";

export const legalTransitions: Readonly<Record<OperationStatus, readonly OperationStatus[]>> = {
  PLANNED: ["CLAIMED"],
  CLAIMED: ["SUBMITTED", "FAILED"],
  SUBMITTED: ["CONFIRMED", "FAILED", "UNKNOWN", "COMPENSATING", "NEEDS_REVIEW"],
  UNKNOWN: ["RECONCILING", "NEEDS_REVIEW"],
  RECONCILING: ["CONFIRMED", "FAILED", "UNKNOWN", "COMPENSATING", "NEEDS_REVIEW"],
  CONFIRMED: ["COMPENSATING"],
  FAILED: [],
  COMPENSATING: ["COMPENSATED", "NEEDS_REVIEW"],
  COMPENSATED: [],
  NEEDS_REVIEW: []
};

export function canTransition(from: OperationStatus, to: OperationStatus): boolean {
  return legalTransitions[from].includes(to);
}

export function assertTransition(from: OperationStatus, to: OperationStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalStateTransitionError(from, to);
  }
}
