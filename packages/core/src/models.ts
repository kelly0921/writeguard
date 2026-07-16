export const operationStatuses = [
  "PLANNED",
  "CLAIMED",
  "SUBMITTED",
  "UNKNOWN",
  "RECONCILING",
  "CONFIRMED",
  "FAILED",
  "COMPENSATING",
  "COMPENSATED",
  "NEEDS_REVIEW"
] as const;

export type OperationStatus = (typeof operationStatuses)[number];

export const terminalStatuses = ["CONFIRMED", "FAILED", "COMPENSATED", "NEEDS_REVIEW"] as const;
export type TerminalStatus = (typeof terminalStatuses)[number];

export const effectTypes = [
  "reversible_write",
  "conditionally_reversible",
  "irreversible_write"
] as const;

export type EffectType = (typeof effectTypes)[number];

export const shadowClassifications = [
  "not_evaluated",
  "no_match_visible",
  "verified_external_effect",
  "external_match_unverified",
  "verification_failed",
  "ambiguous_matches",
  "reconciliation_unavailable"
] as const;

export type ShadowClassification = (typeof shadowClassifications)[number];

export type ActionDescriptor = {
  name: string;
  provider: string | null;
  effectType: EffectType;
};

export type OperationRecord = {
  id: string;
  namespace: string;
  operationKey: string;
  actionName: string;
  provider: string | null;
  effectType: EffectType;
  status: OperationStatus;
  attemptCount: number;
  requestFingerprint: string;
  metadata: Record<string, unknown>;
  claimOwner: string | null;
  claimExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  claimedAt: Date | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  completedAt: Date | null;
};

export type AttemptOutcome =
  | "RUNNING"
  | "CONFIRMED"
  | "CONFIRMED_FAILURE"
  | "PRE_SUBMISSION_FAILURE"
  | "UNKNOWN"
  | "RECONCILED"
  | "RECONCILIATION_UNAVAILABLE"
  | "NEEDS_REVIEW"
  | "COMPENSATED"
  | "COMPENSATION_FAILED";

export type OperationAttemptRecord = {
  id: string;
  operationId: string;
  attemptNumber: number;
  kind: "EXECUTION" | "RECONCILIATION";
  startedAt: Date;
  finishedAt: Date | null;
  outcome: AttemptOutcome;
  errorType: string | null;
  errorMessage: string | null;
  providerReference: string | null;
};

export type OperationEventRecord = {
  id: string;
  operationId: string;
  eventType: string;
  previousStatus: OperationStatus | null;
  newStatus: OperationStatus;
  details: Record<string, unknown>;
  createdAt: Date;
};

export type ExecutionReceipt = {
  id: string;
  operationId: string;
  operationKey: string;
  action: string;
  status: TerminalStatus;
  verified: boolean;
  providerReference: string | null;
  attempts: number;
  resolution: string;
  duplicateExecutionPrevented: boolean;
  verificationEvidence: Record<string, unknown>;
  unresolvedEffects: Array<Record<string, unknown>>;
  createdAt: Date;
  completedAt: Date;
};

export type OperationTimeline = {
  operation: OperationRecord;
  attempts: OperationAttemptRecord[];
  events: OperationEventRecord[];
  receipt: ExecutionReceipt | null;
};

export type ClaimRequest = {
  namespace: string;
  operationKey: string;
  action: ActionDescriptor;
  requestFingerprint: string;
  metadata: Record<string, unknown>;
  workerId: string;
  claimTtlMs: number;
  invocationMetadata?: Record<string, unknown>;
};

export type ClaimDecision =
  | { kind: "execute"; operation: OperationRecord }
  | { kind: "reconcile"; operation: OperationRecord; attempt: OperationAttemptRecord }
  | { kind: "terminal"; operation: OperationRecord; receipt: ExecutionReceipt }
  | { kind: "in_progress"; operation: OperationRecord };

export type FinalizeConfirmedInput = {
  operationId: string;
  attemptId: string;
  providerReference: string | null;
  resolution: string;
  duplicateExecutionPrevented: boolean;
  verificationEvidence: Record<string, unknown>;
};

export type FinalizeFailedInput = {
  operationId: string;
  attemptId: string;
  errorType: string;
  errorMessage: string;
  resolution: string;
};

export type FinalizeNeedsReviewInput = {
  operationId: string;
  attemptId: string;
  reason: string;
  providerReference: string | null;
  verificationEvidence: Record<string, unknown>;
  unresolvedEffects: Array<Record<string, unknown>>;
};

export type CompensationInput = {
  operationId: string;
  attemptId: string;
  providerReference: string | null;
  evidence: Record<string, unknown>;
};

export type ReconciliationOutcome<T> =
  | { kind: "found"; result: T; evidence: Record<string, unknown> }
  | { kind: "not_found"; evidence: Record<string, unknown> }
  | { kind: "ambiguous"; providerReferences: string[]; evidence: Record<string, unknown> }
  | { kind: "unavailable"; reason: string; evidence: Record<string, unknown> };

export type ShadowObservationRecord = {
  id: string;
  namespace: string;
  operationKey: string;
  actionName: string;
  provider: string | null;
  effectType: EffectType;
  requestFingerprint: string;
  metadata: Record<string, unknown>;
  invocationCount: number;
  reconciliationAttemptCount: number;
  latestClassification: ShadowClassification;
  latestVerified: boolean | null;
  latestProviderReference: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastObservedAt: Date;
};

export type ShadowObservationRequest = {
  namespace: string;
  operationKey: string;
  action: ActionDescriptor;
  requestFingerprint: string;
  metadata: Record<string, unknown>;
  invocationMetadata?: Record<string, unknown>;
};

export type FinalizeShadowObservationInput = {
  observationId: string;
  classification: ShadowClassification;
  reconciliationAttempted: boolean;
  verified: boolean | null;
  providerReference: string | null;
};
