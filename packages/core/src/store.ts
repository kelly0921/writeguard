import type {
  ClaimDecision,
  ClaimRequest,
  CompensationInput,
  ExecutionReceipt,
  FinalizeConfirmedInput,
  FinalizeFailedInput,
  FinalizeNeedsReviewInput,
  FinalizeShadowObservationInput,
  OperationAttemptRecord,
  OperationTimeline,
  ShadowObservationRecord,
  ShadowObservationRequest
} from "./models.js";

export interface OperationStore {
  claim(request: ClaimRequest): Promise<ClaimDecision>;
  markSubmitted(operationId: string, workerId: string): Promise<OperationAttemptRecord>;
  markUnknown(
    operationId: string,
    attemptId: string,
    errorType: string,
    errorMessage: string
  ): Promise<void>;
  finalizeConfirmed(input: FinalizeConfirmedInput): Promise<ExecutionReceipt>;
  finalizeFailed(input: FinalizeFailedInput): Promise<ExecutionReceipt>;
  finalizeNeedsReview(input: FinalizeNeedsReviewInput): Promise<ExecutionReceipt>;
  markReconciliationUnavailable(
    operationId: string,
    attemptId: string,
    errorType: string,
    errorMessage: string
  ): Promise<void>;
  markCompensating(input: CompensationInput): Promise<void>;
  finalizeCompensated(input: CompensationInput): Promise<ExecutionReceipt>;
  finalizeCompensationFailed(
    input: CompensationInput & { errorType: string; errorMessage: string }
  ): Promise<ExecutionReceipt>;
  recordShadowObservation(request: ShadowObservationRequest): Promise<ShadowObservationRecord>;
  finalizeShadowObservation(input: FinalizeShadowObservationInput): Promise<ShadowObservationRecord>;
  getShadowObservation(
    namespace: string,
    operationKey: string
  ): Promise<ShadowObservationRecord | null>;
  getTimeline(namespace: string, operationKey: string): Promise<OperationTimeline | null>;
}
