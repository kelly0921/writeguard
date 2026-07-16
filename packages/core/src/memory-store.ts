import { randomUUID } from "node:crypto";
import { OperationKeyConflictError } from "./errors.js";
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
  OperationEventRecord,
  OperationRecord,
  OperationStatus,
  OperationTimeline,
  ShadowObservationRecord,
  ShadowObservationRequest,
  TerminalStatus
} from "./models.js";
import { terminalStatuses } from "./models.js";
import { assertTransition } from "./state-machine.js";
import type { OperationStore } from "./store.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryOperationStore implements OperationStore {
  private readonly operations = new Map<string, OperationRecord>();
  private readonly operationIdsByKey = new Map<string, string>();
  private readonly attempts = new Map<string, OperationAttemptRecord[]>();
  private readonly events = new Map<string, OperationEventRecord[]>();
  private readonly receipts = new Map<string, ExecutionReceipt>();
  private readonly shadowObservations = new Map<string, ShadowObservationRecord>();
  private readonly shadowObservationIdsByKey = new Map<string, string>();
  private lockTail: Promise<void> = Promise.resolve();

  private async locked<T>(fn: () => T | Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.lockTail;
    this.lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private key(namespace: string, operationKey: string): string {
    return `${namespace}\u0000${operationKey}`;
  }

  private getOperation(operationId: string): OperationRecord {
    const operation = this.operations.get(operationId);
    if (!operation) throw new Error(`Operation ${operationId} not found`);
    return operation;
  }

  private getAttempt(operationId: string, attemptId: string): OperationAttemptRecord {
    const attempt = this.attempts.get(operationId)?.find((candidate) => candidate.id === attemptId);
    if (!attempt) throw new Error(`Attempt ${attemptId} not found for operation ${operationId}`);
    return attempt;
  }

  private appendEvent(
    operation: OperationRecord,
    eventType: string,
    previousStatus: OperationStatus | null,
    newStatus: OperationStatus,
    details: Record<string, unknown> = {}
  ): void {
    const events = this.events.get(operation.id) ?? [];
    events.push({
      id: randomUUID(),
      operationId: operation.id,
      eventType,
      previousStatus,
      newStatus,
      details,
      createdAt: new Date()
    });
    this.events.set(operation.id, events);
  }

  private transition(
    operation: OperationRecord,
    to: OperationStatus,
    eventType: string,
    details: Record<string, unknown> = {}
  ): void {
    const from = operation.status;
    assertTransition(from, to);
    operation.status = to;
    operation.updatedAt = new Date();
    this.appendEvent(operation, eventType, from, to, details);
  }

  private startReconciliation(operation: OperationRecord, request: ClaimRequest): ClaimDecision {
    this.transition(operation, "RECONCILING", "RECONCILIATION_STARTED");
    operation.claimOwner = request.workerId;
    operation.claimedAt = new Date();
    operation.claimExpiresAt = new Date(Date.now() + request.claimTtlMs);
    operation.attemptCount += 1;
    const attempt: OperationAttemptRecord = {
      id: randomUUID(),
      operationId: operation.id,
      attemptNumber: operation.attemptCount,
      kind: "RECONCILIATION",
      startedAt: new Date(),
      finishedAt: null,
      outcome: "RUNNING",
      errorType: null,
      errorMessage: null,
      providerReference: null
    };
    const attempts = this.attempts.get(operation.id) ?? [];
    attempts.push(attempt);
    this.attempts.set(operation.id, attempts);
    return { kind: "reconcile", operation: clone(operation), attempt: clone(attempt) };
  }

  async claim(request: ClaimRequest): Promise<ClaimDecision> {
    return this.locked(() => {
      const lookupKey = this.key(request.namespace, request.operationKey);
      const existingId = this.operationIdsByKey.get(lookupKey);
      if (!existingId) {
        const now = new Date();
        const operation: OperationRecord = {
          id: randomUUID(),
          namespace: request.namespace,
          operationKey: request.operationKey,
          actionName: request.action.name,
          provider: request.action.provider,
          effectType: request.action.effectType,
          status: "PLANNED",
          attemptCount: 0,
          requestFingerprint: request.requestFingerprint,
          metadata: clone(request.metadata),
          claimOwner: request.workerId,
          claimExpiresAt: new Date(Date.now() + request.claimTtlMs),
          createdAt: now,
          updatedAt: now,
          claimedAt: now,
          submittedAt: null,
          confirmedAt: null,
          completedAt: null
        };
        this.operations.set(operation.id, operation);
        this.operationIdsByKey.set(lookupKey, operation.id);
        this.attempts.set(operation.id, []);
        this.events.set(operation.id, []);
        this.appendEvent(operation, "OPERATION_PLANNED", null, "PLANNED", {
          action: operation.actionName
        });
        if (request.invocationMetadata) {
          this.appendEvent(operation, "INVOCATION_RECEIVED", "PLANNED", "PLANNED", request.invocationMetadata);
        }
        this.transition(operation, "CLAIMED", "OPERATION_CLAIMED", { workerId: request.workerId });
        return { kind: "execute", operation: clone(operation) };
      }

      const operation = this.getOperation(existingId);
      if (operation.requestFingerprint !== request.requestFingerprint) {
        throw new OperationKeyConflictError(request.namespace, request.operationKey);
      }

      if (request.invocationMetadata) {
        this.appendEvent(
          operation,
          "INVOCATION_RECEIVED",
          operation.status,
          operation.status,
          request.invocationMetadata
        );
      }

      if ((terminalStatuses as readonly string[]).includes(operation.status)) {
        const receipt = this.receipts.get(operation.id);
        if (!receipt) throw new Error(`Terminal operation ${operation.id} has no receipt`);
        return { kind: "terminal", operation: clone(operation), receipt: clone(receipt) };
      }

      const leaseActive = operation.claimExpiresAt !== null && operation.claimExpiresAt.getTime() > Date.now();
      if (["CLAIMED", "SUBMITTED", "RECONCILING"].includes(operation.status) && leaseActive) {
        return { kind: "in_progress", operation: clone(operation) };
      }

      if (operation.status === "CLAIMED") {
        operation.claimOwner = request.workerId;
        operation.claimedAt = new Date();
        operation.claimExpiresAt = new Date(Date.now() + request.claimTtlMs);
        operation.updatedAt = new Date();
        this.appendEvent(operation, "STALE_CLAIM_RECLAIMED", "CLAIMED", "CLAIMED", {
          workerId: request.workerId
        });
        return { kind: "execute", operation: clone(operation) };
      }

      if (operation.status === "SUBMITTED") {
        const runningAttempt = [...(this.attempts.get(operation.id) ?? [])]
          .reverse()
          .find((attempt) => attempt.outcome === "RUNNING");
        if (runningAttempt) {
          runningAttempt.outcome = "UNKNOWN";
          runningAttempt.finishedAt = new Date();
          runningAttempt.errorType = "STALE_SUBMITTED_CLAIM";
          runningAttempt.errorMessage = "Submission lease expired before a final result was recorded";
        }
        this.transition(operation, "UNKNOWN", "STALE_SUBMISSION_BECAME_UNKNOWN");
      } else if (operation.status === "RECONCILING") {
        const runningAttempt = [...(this.attempts.get(operation.id) ?? [])]
          .reverse()
          .find((attempt) => attempt.outcome === "RUNNING");
        if (runningAttempt) {
          runningAttempt.outcome = "RECONCILIATION_UNAVAILABLE";
          runningAttempt.finishedAt = new Date();
          runningAttempt.errorType = "STALE_RECONCILIATION_CLAIM";
          runningAttempt.errorMessage = "Reconciliation lease expired";
        }
        this.transition(operation, "UNKNOWN", "STALE_RECONCILIATION_RELEASED");
      }

      if (operation.status === "UNKNOWN") {
        return this.startReconciliation(operation, request);
      }

      throw new Error(`Unhandled claim state ${operation.status}`);
    });
  }

  async markSubmitted(operationId: string, workerId: string): Promise<OperationAttemptRecord> {
    return this.locked(() => {
      const operation = this.getOperation(operationId);
      if (operation.claimOwner !== workerId) {
        throw new Error(`Worker ${workerId} does not own operation ${operationId}`);
      }
      this.transition(operation, "SUBMITTED", "EXECUTION_SUBMITTED");
      operation.submittedAt = new Date();
      operation.attemptCount += 1;
      const attempt: OperationAttemptRecord = {
        id: randomUUID(),
        operationId,
        attemptNumber: operation.attemptCount,
        kind: "EXECUTION",
        startedAt: new Date(),
        finishedAt: null,
        outcome: "RUNNING",
        errorType: null,
        errorMessage: null,
        providerReference: null
      };
      const attempts = this.attempts.get(operationId) ?? [];
      attempts.push(attempt);
      this.attempts.set(operationId, attempts);
      return clone(attempt);
    });
  }

  async markUnknown(
    operationId: string,
    attemptId: string,
    errorType: string,
    errorMessage: string
  ): Promise<void> {
    await this.locked(() => {
      const operation = this.getOperation(operationId);
      const attempt = this.getAttempt(operationId, attemptId);
      attempt.outcome = "UNKNOWN";
      attempt.errorType = errorType;
      attempt.errorMessage = errorMessage;
      attempt.finishedAt = new Date();
      this.transition(operation, "UNKNOWN", "EXECUTION_OUTCOME_UNKNOWN", { errorType });
      operation.claimOwner = null;
      operation.claimExpiresAt = null;
    });
  }

  private createReceipt(
    operation: OperationRecord,
    status: TerminalStatus,
    verified: boolean,
    providerReference: string | null,
    resolution: string,
    duplicateExecutionPrevented: boolean,
    verificationEvidence: Record<string, unknown>,
    unresolvedEffects: Array<Record<string, unknown>>
  ): ExecutionReceipt {
    const now = new Date();
    operation.completedAt = now;
    operation.claimOwner = null;
    operation.claimExpiresAt = null;
    const receipt: ExecutionReceipt = {
      id: randomUUID(),
      operationId: operation.id,
      operationKey: operation.operationKey,
      action: operation.actionName,
      status,
      verified,
      providerReference,
      attempts: operation.attemptCount,
      resolution,
      duplicateExecutionPrevented,
      verificationEvidence: clone(verificationEvidence),
      unresolvedEffects: clone(unresolvedEffects),
      createdAt: now,
      completedAt: now
    };
    this.receipts.set(operation.id, receipt);
    return clone(receipt);
  }

  async finalizeConfirmed(input: FinalizeConfirmedInput): Promise<ExecutionReceipt> {
    return this.locked(() => {
      const operation = this.getOperation(input.operationId);
      const attempt = this.getAttempt(input.operationId, input.attemptId);
      const reconciled = operation.status === "RECONCILING";
      attempt.outcome = reconciled ? "RECONCILED" : "CONFIRMED";
      attempt.providerReference = input.providerReference;
      attempt.finishedAt = new Date();
      this.transition(operation, "CONFIRMED", "POSTCONDITION_CONFIRMED", {
        resolution: input.resolution,
        providerReference: input.providerReference
      });
      operation.confirmedAt = new Date();
      return this.createReceipt(
        operation,
        "CONFIRMED",
        true,
        input.providerReference,
        input.resolution,
        input.duplicateExecutionPrevented,
        input.verificationEvidence,
        []
      );
    });
  }

  async finalizeFailed(input: FinalizeFailedInput): Promise<ExecutionReceipt> {
    return this.locked(() => {
      const operation = this.getOperation(input.operationId);
      const attempt = this.getAttempt(input.operationId, input.attemptId);
      attempt.outcome = input.errorType === "PRE_SUBMISSION_FAILURE" ? "PRE_SUBMISSION_FAILURE" : "CONFIRMED_FAILURE";
      attempt.errorType = input.errorType;
      attempt.errorMessage = input.errorMessage;
      attempt.finishedAt = new Date();
      this.transition(operation, "FAILED", "EXECUTION_CONFIRMED_FAILED", { errorType: input.errorType });
      return this.createReceipt(operation, "FAILED", false, null, input.resolution, false, {}, []);
    });
  }

  async finalizeNeedsReview(input: FinalizeNeedsReviewInput): Promise<ExecutionReceipt> {
    return this.locked(() => {
      const operation = this.getOperation(input.operationId);
      const attempt = this.getAttempt(input.operationId, input.attemptId);
      attempt.outcome = "NEEDS_REVIEW";
      attempt.providerReference = input.providerReference;
      attempt.errorType = "NEEDS_REVIEW";
      attempt.errorMessage = input.reason;
      attempt.finishedAt = new Date();
      this.transition(operation, "NEEDS_REVIEW", "HUMAN_REVIEW_REQUIRED", { reason: input.reason });
      return this.createReceipt(
        operation,
        "NEEDS_REVIEW",
        false,
        input.providerReference,
        input.reason,
        true,
        input.verificationEvidence,
        input.unresolvedEffects
      );
    });
  }

  async markReconciliationUnavailable(
    operationId: string,
    attemptId: string,
    errorType: string,
    errorMessage: string
  ): Promise<void> {
    await this.locked(() => {
      const operation = this.getOperation(operationId);
      const attempt = this.getAttempt(operationId, attemptId);
      attempt.outcome = "RECONCILIATION_UNAVAILABLE";
      attempt.errorType = errorType;
      attempt.errorMessage = errorMessage;
      attempt.finishedAt = new Date();
      this.transition(operation, "UNKNOWN", "RECONCILIATION_UNAVAILABLE", { errorType });
      operation.claimOwner = null;
      operation.claimExpiresAt = null;
    });
  }

  async markCompensating(input: CompensationInput): Promise<void> {
    await this.locked(() => {
      const operation = this.getOperation(input.operationId);
      this.transition(operation, "COMPENSATING", "COMPENSATION_STARTED", {
        providerReference: input.providerReference
      });
    });
  }

  async finalizeCompensated(input: CompensationInput): Promise<ExecutionReceipt> {
    return this.locked(() => {
      const operation = this.getOperation(input.operationId);
      const attempt = this.getAttempt(input.operationId, input.attemptId);
      attempt.outcome = "COMPENSATED";
      attempt.providerReference = input.providerReference;
      attempt.finishedAt = new Date();
      this.transition(operation, "COMPENSATED", "COMPENSATION_CONFIRMED");
      return this.createReceipt(
        operation,
        "COMPENSATED",
        false,
        input.providerReference,
        "compensated_after_verification_failure",
        false,
        input.evidence,
        []
      );
    });
  }

  async finalizeCompensationFailed(
    input: CompensationInput & { errorType: string; errorMessage: string }
  ): Promise<ExecutionReceipt> {
    return this.locked(() => {
      const operation = this.getOperation(input.operationId);
      const attempt = this.getAttempt(input.operationId, input.attemptId);
      attempt.outcome = "COMPENSATION_FAILED";
      attempt.errorType = input.errorType;
      attempt.errorMessage = input.errorMessage;
      attempt.providerReference = input.providerReference;
      attempt.finishedAt = new Date();
      this.transition(operation, "NEEDS_REVIEW", "COMPENSATION_FAILED", { errorType: input.errorType });
      return this.createReceipt(
        operation,
        "NEEDS_REVIEW",
        false,
        input.providerReference,
        "compensation_failed",
        false,
        input.evidence,
        [{ type: "unresolved_external_effect", providerReference: input.providerReference }]
      );
    });
  }

  async recordShadowObservation(
    request: ShadowObservationRequest
  ): Promise<ShadowObservationRecord> {
    return this.locked(() => {
      const lookupKey = this.key(request.namespace, request.operationKey);
      const existingId = this.shadowObservationIdsByKey.get(lookupKey);
      if (existingId) {
        const existing = this.shadowObservations.get(existingId);
        if (!existing) throw new Error(`Shadow observation ${existingId} not found`);
        if (existing.requestFingerprint !== request.requestFingerprint) {
          throw new OperationKeyConflictError(request.namespace, request.operationKey);
        }
        existing.invocationCount += 1;
        existing.updatedAt = new Date();
        existing.lastObservedAt = existing.updatedAt;
        return clone(existing);
      }

      const now = new Date();
      const observation: ShadowObservationRecord = {
        id: randomUUID(),
        namespace: request.namespace,
        operationKey: request.operationKey,
        actionName: request.action.name,
        provider: request.action.provider,
        effectType: request.action.effectType,
        requestFingerprint: request.requestFingerprint,
        metadata: clone(request.metadata),
        invocationCount: 1,
        reconciliationAttemptCount: 0,
        latestClassification: "not_evaluated",
        latestVerified: null,
        latestProviderReference: null,
        createdAt: now,
        updatedAt: now,
        lastObservedAt: now
      };
      this.shadowObservations.set(observation.id, observation);
      this.shadowObservationIdsByKey.set(lookupKey, observation.id);
      return clone(observation);
    });
  }

  async finalizeShadowObservation(
    input: FinalizeShadowObservationInput
  ): Promise<ShadowObservationRecord> {
    return this.locked(() => {
      const observation = this.shadowObservations.get(input.observationId);
      if (!observation) throw new Error(`Shadow observation ${input.observationId} not found`);
      observation.latestClassification = input.classification;
      observation.latestVerified = input.verified;
      observation.latestProviderReference = input.providerReference;
      if (input.reconciliationAttempted) observation.reconciliationAttemptCount += 1;
      observation.updatedAt = new Date();
      return clone(observation);
    });
  }

  async getShadowObservation(
    namespace: string,
    operationKey: string
  ): Promise<ShadowObservationRecord | null> {
    return this.locked(() => {
      const observationId = this.shadowObservationIdsByKey.get(this.key(namespace, operationKey));
      if (!observationId) return null;
      const observation = this.shadowObservations.get(observationId);
      return observation ? clone(observation) : null;
    });
  }

  async getTimeline(namespace: string, operationKey: string): Promise<OperationTimeline | null> {
    return this.locked(() => {
      const operationId = this.operationIdsByKey.get(this.key(namespace, operationKey));
      if (!operationId) return null;
      const operation = this.getOperation(operationId);
      return clone({
        operation,
        attempts: this.attempts.get(operationId) ?? [],
        events: this.events.get(operationId) ?? [],
        receipt: this.receipts.get(operationId) ?? null
      });
    });
  }
}
