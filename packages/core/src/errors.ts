import type { OperationStatus } from "./models.js";

export type WriteGuardErrorCode =
  | "ILLEGAL_STATE_TRANSITION"
  | "OPERATION_KEY_CONFLICT"
  | "OPERATION_IN_PROGRESS"
  | "PRE_SUBMISSION_FAILURE"
  | "CONFIRMED_EXECUTION_FAILURE"
  | "UNKNOWN_EXECUTION_OUTCOME"
  | "RECONCILIATION_FAILURE"
  | "VERIFICATION_FAILURE";

export class WriteGuardError extends Error {
  readonly code: WriteGuardErrorCode;

  constructor(code: WriteGuardErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class IllegalStateTransitionError extends WriteGuardError {
  constructor(from: OperationStatus, to: OperationStatus) {
    super("ILLEGAL_STATE_TRANSITION", `Illegal WriteGuard transition: ${from} -> ${to}`);
  }
}

export class OperationKeyConflictError extends WriteGuardError {
  constructor(namespace: string, operationKey: string) {
    super(
      "OPERATION_KEY_CONFLICT",
      `Operation key ${namespace}:${operationKey} was reused with different material input`
    );
  }
}

export class OperationInProgressError extends WriteGuardError {
  constructor(operationId: string) {
    super("OPERATION_IN_PROGRESS", `Operation ${operationId} is still in progress`);
  }
}

export class PreSubmissionFailure extends WriteGuardError {
  constructor(message: string, options?: ErrorOptions) {
    super("PRE_SUBMISSION_FAILURE", message, options);
  }
}

export class ConfirmedExecutionFailure extends WriteGuardError {
  constructor(message: string, options?: ErrorOptions) {
    super("CONFIRMED_EXECUTION_FAILURE", message, options);
  }
}

export class UnknownExecutionOutcome extends WriteGuardError {
  constructor(message: string, options?: ErrorOptions) {
    super("UNKNOWN_EXECUTION_OUTCOME", message, options);
  }
}

export class ReconciliationFailure extends WriteGuardError {
  constructor(message: string, options?: ErrorOptions) {
    super("RECONCILIATION_FAILURE", message, options);
  }
}

export class VerificationFailure extends WriteGuardError {
  constructor(message: string, options?: ErrorOptions) {
    super("VERIFICATION_FAILURE", message, options);
  }
}

export function classifyError(error: unknown): { type: string; message: string } {
  if (error instanceof WriteGuardError) {
    return { type: error.code, message: redactSecretsInText(error.message) };
  }

  if (error instanceof Error) {
    return { type: error.name || "Error", message: redactSecretsInText(error.message) };
  }

  return { type: "UnknownError", message: redactSecretsInText(String(error)) };
}

export function redactSecretsInText(input: string): string {
  return input
    .replace(/\b(sk_(?:test|live)_[A-Za-z0-9_-]+)\b/g, "[REDACTED_STRIPE_KEY]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED]")
    .slice(0, 1_000);
}
