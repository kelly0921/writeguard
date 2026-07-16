import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  classifyError,
  ConfirmedExecutionFailure,
  OperationKeyConflictError,
  OperationInProgressError,
  PreSubmissionFailure,
  ReconciliationFailure,
  UnknownExecutionOutcome,
  VerificationFailure
} from "../../core/src/errors.js";
import { createRequestFingerprint, redactMetadata } from "../../core/src/security.js";
import type {
  EffectType,
  ExecutionReceipt,
  ReconciliationOutcome,
  ShadowClassification
} from "../../core/src/models.js";
import type { OperationStore } from "../../core/src/store.js";
import type { PilotTelemetrySink } from "./telemetry.js";

export type ExecutionContext = {
  operationId: string;
  operationKey: string;
  namespace: string;
  attemptNumber: number;
};

export type ReconciliationContext = ExecutionContext;
export type VerificationContext = ExecutionContext & { source: "execution" | "reconciliation" };
export type CompensationContext = VerificationContext;

export type WriteGuardExecutionOptions<TExecuteResult, TReconcileResult = TExecuteResult> = {
  key: string;
  action: {
    name: string;
    provider?: string;
    effectType?: EffectType;
  };
  execute: (context: ExecutionContext) => Promise<TExecuteResult>;
  reconcile: (context: ReconciliationContext) => Promise<ReconciliationOutcome<TReconcileResult>>;
  verify: (
    result: TExecuteResult | TReconcileResult,
    context: VerificationContext
  ) => Promise<boolean>;
  compensate?: (
    result: TExecuteResult | TReconcileResult,
    context: CompensationContext
  ) => Promise<void>;
  metadata?: Record<string, unknown>;
  sensitiveFields?: string[];
  invocation?: {
    framework: string;
    toolName: string;
    toolCallId: string;
    metadata?: Record<string, unknown>;
  };
  fingerprint?: unknown;
  faults?: {
    throwAfterExternalSuccess?: boolean;
  };
  getProviderReference?: (result: TExecuteResult | TReconcileResult) => string | null;
  getVerificationEvidence?: (
    result: TExecuteResult | TReconcileResult,
    context: VerificationContext
  ) => Record<string, unknown>;
};

export type ReportedInvocation = {
  framework: string;
  toolName: string;
  toolCallId: string;
  metadata?: Record<string, unknown>;
};

export type ShadowVerificationContext = {
  observationId: string;
  operationKey: string;
  namespace: string;
  invocationCount: number;
};

export type WriteGuardObservationOptions<TReconcileResult> = {
  key: string;
  action: {
    name: string;
    provider?: string;
    effectType?: EffectType;
  };
  reportedInvocation?: ReportedInvocation;
  reconcile?: (
    context: ShadowVerificationContext
  ) => Promise<ReconciliationOutcome<TReconcileResult>>;
  verify?: (
    result: TReconcileResult,
    context: ShadowVerificationContext
  ) => Promise<boolean>;
  metadata?: Record<string, unknown>;
  sensitiveFields?: string[];
  fingerprint?: unknown;
  getProviderReference?: (result: TReconcileResult) => string | null;
};

export type ShadowReceipt = {
  observationId: string;
  operationKey: string;
  action: string;
  mode: "shadow";
  observational: true;
  invocationCount: number;
  duplicateInvocationObserved: boolean;
  wouldSuppressDuplicate: boolean;
  classification: ShadowClassification;
  reconciliationAttempted: boolean;
  reconciliationOutcome:
    | "not_configured"
    | "found"
    | "not_found"
    | "ambiguous"
    | "unavailable";
  verified: boolean | null;
  providerReference: string | null;
  observedAt: Date;
};

export type GuardedToolInvocation = {
  framework: string;
  toolCallId: string;
  metadata?: Record<string, unknown>;
};

export type GuardToolOptions<TInput, TExecuteResult, TReconcileResult = TExecuteResult> = {
  name: string;
  description?: string;
  provider?: string;
  effectType?: EffectType;
  getOperationKey: (input: TInput) => string;
  getFingerprint?: (input: TInput) => unknown;
  getMetadata?: (input: TInput) => Record<string, unknown>;
  sensitiveFields?: string[];
  execute: (input: TInput, context: ExecutionContext) => Promise<TExecuteResult>;
  reconcile: (
    input: TInput,
    context: ReconciliationContext
  ) => Promise<ReconciliationOutcome<TReconcileResult>>;
  verify: (
    result: TExecuteResult | TReconcileResult,
    input: TInput,
    context: VerificationContext
  ) => Promise<boolean>;
  compensate?: (
    result: TExecuteResult | TReconcileResult,
    input: TInput,
    context: CompensationContext
  ) => Promise<void>;
  faults?: { throwAfterExternalSuccess?: boolean };
  getProviderReference?: (result: TExecuteResult | TReconcileResult) => string | null;
  getVerificationEvidence?: (
    result: TExecuteResult | TReconcileResult,
    input: TInput,
    context: VerificationContext
  ) => Record<string, unknown>;
};

export type GuardedTool<TInput> = {
  name: string;
  description: string | undefined;
  invoke: (input: TInput, invocation: GuardedToolInvocation) => Promise<ExecutionReceipt>;
};

export type WriteGuardConfig = {
  store: OperationStore;
  namespace?: string;
  claimTtlMs?: number;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  workerIdFactory?: () => string;
  telemetry?: PilotTelemetrySink;
};

const optionEnvelopeSchema = z.object({
  key: z.string().min(1).max(512),
  action: z.object({
    name: z.string().min(1).max(200),
    provider: z.string().min(1).max(100).optional(),
    effectType: z
      .enum(["reversible_write", "conditionally_reversible", "irreversible_write"])
      .optional()
  }),
  invocation: z
    .object({
      framework: z.string().min(1).max(100),
      toolName: z.string().min(1).max(200),
      toolCallId: z.string().min(1).max(512),
      metadata: z.record(z.unknown()).optional()
    })
    .optional()
});

const observationEnvelopeSchema = z.object({
  key: z.string().min(1).max(512),
  action: z.object({
    name: z.string().min(1).max(200),
    provider: z.string().min(1).max(100).optional(),
    effectType: z
      .enum(["reversible_write", "conditionally_reversible", "irreversible_write"])
      .optional()
  }),
  reportedInvocation: z
    .object({
      framework: z.string().min(1).max(100),
      toolName: z.string().min(1).max(200),
      toolCallId: z.string().min(1).max(512),
      metadata: z.record(z.unknown()).optional()
    })
    .optional()
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultProviderReference(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidate = record.id ?? record.providerReference ?? record.reference;
  return typeof candidate === "string" ? candidate : null;
}

export class WriteGuard {
  private readonly store: OperationStore;
  private readonly namespace: string;
  private readonly claimTtlMs: number;
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly workerIdFactory: () => string;
  private readonly telemetry: PilotTelemetrySink | undefined;

  constructor(config: WriteGuardConfig) {
    this.store = config.store;
    this.namespace = config.namespace ?? "default";
    this.claimTtlMs = config.claimTtlMs ?? 120_000;
    this.waitTimeoutMs = config.waitTimeoutMs ?? 10_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 25;
    this.workerIdFactory = config.workerIdFactory ?? (() => `worker_${randomUUID()}`);
    this.telemetry = config.telemetry;
  }

  private async emitTelemetry(
    name: Parameters<PilotTelemetrySink["record"]>[0]["name"],
    durationMs?: number
  ): Promise<void> {
    if (!this.telemetry) return;
    try {
      await this.telemetry.record({ name, ...(durationMs !== undefined ? { durationMs } : {}) });
    } catch {
      // Pilot telemetry is deliberately non-critical and must never control an external write.
    }
  }

  private async storageCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof OperationKeyConflictError)) {
        await this.emitTelemetry("storage_error");
      }
      throw error;
    }
  }

  async observe<TReconcileResult>(
    options: WriteGuardObservationOptions<TReconcileResult>
  ): Promise<ShadowReceipt> {
    observationEnvelopeSchema.parse(options);
    const metadata = redactMetadata(options.metadata, options.sensitiveFields);
    const requestFingerprint = createRequestFingerprint({
      action: options.action,
      materialInput: options.fingerprint ?? options.metadata ?? {}
    });
    const invocationMetadata = options.reportedInvocation
      ? redactMetadata(
          {
            framework: options.reportedInvocation.framework,
            toolName: options.reportedInvocation.toolName,
            toolCallId: options.reportedInvocation.toolCallId,
            ...(options.reportedInvocation.metadata ?? {})
          },
          options.sensitiveFields
        )
      : undefined;
    const observation = await this.storageCall(() =>
      this.store.recordShadowObservation({
        namespace: this.namespace,
        operationKey: options.key,
        action: {
          name: options.action.name,
          provider: options.action.provider ?? null,
          effectType: options.action.effectType ?? "conditionally_reversible"
        },
        requestFingerprint,
        metadata,
        ...(invocationMetadata ? { invocationMetadata } : {})
      })
    );
    if (observation.invocationCount === 1) {
      await this.emitTelemetry("observed_operation");
    } else {
      await this.emitTelemetry("duplicate_invocation");
    }

    const context: ShadowVerificationContext = {
      observationId: observation.id,
      operationKey: observation.operationKey,
      namespace: observation.namespace,
      invocationCount: observation.invocationCount
    };
    let classification: ShadowClassification = "not_evaluated";
    let reconciliationOutcome: ShadowReceipt["reconciliationOutcome"] = "not_configured";
    let verified: boolean | null = null;
    let providerReference: string | null = null;
    const reconciliationAttempted = options.reconcile !== undefined;

    if (options.reconcile) {
      const startedAt = Date.now();
      try {
        const outcome = await options.reconcile(context);
        reconciliationOutcome = outcome.kind;
        if (outcome.kind === "unavailable") {
          classification = "reconciliation_unavailable";
        } else if (outcome.kind === "not_found") {
          classification = "no_match_visible";
        } else if (outcome.kind === "ambiguous") {
          classification = "ambiguous_matches";
          await this.emitTelemetry("ambiguous_reconciliation");
        } else {
          providerReference = options.getProviderReference?.(outcome.result) ?? defaultProviderReference(outcome.result);
          if (!options.verify) {
            classification = "external_match_unverified";
          } else {
            try {
              verified = await options.verify(outcome.result, context);
              classification = verified ? "verified_external_effect" : "verification_failed";
              if (verified) await this.emitTelemetry("successful_reconciliation");
            } catch {
              verified = false;
              classification = "verification_failed";
            }
          }
        }
      } catch {
        reconciliationOutcome = "unavailable";
        classification = "reconciliation_unavailable";
      } finally {
        await this.emitTelemetry("reconciliation_latency", Date.now() - startedAt);
      }
    }

    const finalized = await this.storageCall(() =>
      this.store.finalizeShadowObservation({
        observationId: observation.id,
        classification,
        reconciliationAttempted,
        verified,
        providerReference
      })
    );
    return {
      observationId: finalized.id,
      operationKey: finalized.operationKey,
      action: finalized.actionName,
      mode: "shadow",
      observational: true,
      invocationCount: finalized.invocationCount,
      duplicateInvocationObserved: finalized.invocationCount > 1,
      wouldSuppressDuplicate: finalized.invocationCount > 1,
      classification,
      reconciliationAttempted,
      reconciliationOutcome,
      verified,
      providerReference,
      observedAt: finalized.lastObservedAt
    };
  }

  guardTool<TInput, TExecuteResult, TReconcileResult = TExecuteResult>(
    options: GuardToolOptions<TInput, TExecuteResult, TReconcileResult>
  ): GuardedTool<TInput> {
    return {
      name: options.name,
      description: options.description,
      invoke: async (input, invocation) => {
        const executionOptions: WriteGuardExecutionOptions<TExecuteResult, TReconcileResult> = {
          key: options.getOperationKey(input),
          action: {
            name: options.name,
            ...(options.provider ? { provider: options.provider } : {}),
            ...(options.effectType ? { effectType: options.effectType } : {})
          },
          fingerprint: options.getFingerprint?.(input) ?? input,
          metadata: options.getMetadata?.(input) ?? { toolName: options.name },
          invocation: {
            framework: invocation.framework,
            toolName: options.name,
            toolCallId: invocation.toolCallId,
            ...(invocation.metadata ? { metadata: invocation.metadata } : {})
          },
          execute: (context) => options.execute(input, context),
          reconcile: (context) => options.reconcile(input, context),
          verify: (result, context) => options.verify(result, input, context),
          ...(options.sensitiveFields ? { sensitiveFields: options.sensitiveFields } : {}),
          ...(options.compensate
            ? { compensate: (result, context) => options.compensate!(result, input, context) }
            : {}),
          ...(options.faults ? { faults: options.faults } : {}),
          ...(options.getProviderReference
            ? { getProviderReference: options.getProviderReference }
            : {}),
          ...(options.getVerificationEvidence
            ? {
                getVerificationEvidence: (result, context) =>
                  options.getVerificationEvidence!(result, input, context)
              }
            : {})
        };
        return this.execute(executionOptions);
      }
    };
  }

  async execute<TExecuteResult, TReconcileResult = TExecuteResult>(
    options: WriteGuardExecutionOptions<TExecuteResult, TReconcileResult>
  ): Promise<ExecutionReceipt> {
    optionEnvelopeSchema.parse(options);
    const workerId = this.workerIdFactory();
    const metadata = redactMetadata(options.metadata, options.sensitiveFields);
    const requestFingerprint = createRequestFingerprint({
      action: options.action,
      materialInput: options.fingerprint ?? options.metadata ?? {}
    });
    const claimStartedAt = Date.now();
    let firstClaimDecision = true;
    let invocationMetadata = options.invocation
      ? redactMetadata(
          {
            framework: options.invocation.framework,
            toolName: options.invocation.toolName,
            toolCallId: options.invocation.toolCallId,
            ...(options.invocation.metadata ?? {})
          },
          options.sensitiveFields
        )
      : undefined;

    while (true) {
      const decision = await this.storageCall(() =>
        this.store.claim({
          namespace: this.namespace,
          operationKey: options.key,
          action: {
            name: options.action.name,
            provider: options.action.provider ?? null,
            effectType: options.action.effectType ?? "conditionally_reversible"
          },
          requestFingerprint,
          metadata,
          workerId,
          claimTtlMs: this.claimTtlMs,
          ...(invocationMetadata ? { invocationMetadata } : {})
        })
      );
      invocationMetadata = undefined;

      if (firstClaimDecision) {
        if (decision.kind === "execute") {
          await this.emitTelemetry("guarded_operation");
        } else {
          await this.emitTelemetry("duplicate_invocation");
          await this.emitTelemetry("suppressed_execution");
        }
        firstClaimDecision = false;
      }

      if (decision.kind === "terminal") return decision.receipt;
      if (decision.kind === "in_progress") {
        if (Date.now() - claimStartedAt >= this.waitTimeoutMs) {
          throw new OperationInProgressError(decision.operation.id);
        }
        await sleep(this.pollIntervalMs);
        continue;
      }
      if (decision.kind === "reconcile") {
        return this.reconcile(options, decision.operation.id, decision.operation.operationKey, decision.attempt.id, decision.attempt.attemptNumber);
      }

      const attempt = await this.storageCall(() =>
        this.store.markSubmitted(decision.operation.id, workerId)
      );
      const context: ExecutionContext = {
        operationId: decision.operation.id,
        operationKey: decision.operation.operationKey,
        namespace: decision.operation.namespace,
        attemptNumber: attempt.attemptNumber
      };

      let result: TExecuteResult;
      const executionStartedAt = Date.now();
      try {
        result = await options.execute(context);
        if (options.faults?.throwAfterExternalSuccess) {
          throw new UnknownExecutionOutcome(
            "Injected fault after the provider committed but before local success was recorded"
          );
        }
      } catch (error) {
        const classified = classifyError(error);
        if (error instanceof PreSubmissionFailure || error instanceof ConfirmedExecutionFailure) {
          return this.storageCall(() =>
            this.store.finalizeFailed({
              operationId: decision.operation.id,
              attemptId: attempt.id,
              errorType: classified.type,
              errorMessage: classified.message,
              resolution:
                error instanceof PreSubmissionFailure
                  ? "confirmed_not_submitted"
                  : "provider_confirmed_failure"
            })
          );
        }

        await this.storageCall(() =>
          this.store.markUnknown(
            decision.operation.id,
            attempt.id,
            classified.type,
            classified.message
          )
        );
        await this.emitTelemetry("unknown_outcome");
        if (error instanceof UnknownExecutionOutcome) throw error;
        throw new UnknownExecutionOutcome(
          "The provider request may have committed; reconcile before retrying",
          { cause: error }
        );
      } finally {
        await this.emitTelemetry("execution_latency", Date.now() - executionStartedAt);
      }

      return this.verifyAndFinalize(options, result, context, attempt.id, "execution", false, {});
    }
  }

  private async reconcile<TExecuteResult, TReconcileResult>(
    options: WriteGuardExecutionOptions<TExecuteResult, TReconcileResult>,
    operationId: string,
    operationKey: string,
    attemptId: string,
    attemptNumber: number
  ): Promise<ExecutionReceipt> {
    const context: ReconciliationContext = {
      operationId,
      operationKey,
      namespace: this.namespace,
      attemptNumber
    };

    let outcome: ReconciliationOutcome<TReconcileResult>;
    const reconciliationStartedAt = Date.now();
    try {
      outcome = await options.reconcile(context);
    } catch (error) {
      const classified = classifyError(error);
      await this.storageCall(() =>
        this.store.markReconciliationUnavailable(
          operationId,
          attemptId,
          classified.type,
          classified.message
        )
      );
      throw new ReconciliationFailure("Reconciliation failed; operation remains UNKNOWN", {
        cause: error
      });
    } finally {
      await this.emitTelemetry("reconciliation_latency", Date.now() - reconciliationStartedAt);
    }

    if (outcome.kind === "unavailable") {
      await this.storageCall(() =>
        this.store.markReconciliationUnavailable(
          operationId,
          attemptId,
          "RECONCILIATION_UNAVAILABLE",
          outcome.reason
        )
      );
      throw new ReconciliationFailure(`${outcome.reason}; operation remains UNKNOWN`);
    }

    if (outcome.kind === "not_found") {
      await this.emitTelemetry("needs_review");
      return this.storageCall(() =>
        this.store.finalizeNeedsReview({
          operationId,
          attemptId,
          reason: "reconciliation_found_no_matching_external_effect",
          providerReference: null,
          verificationEvidence: outcome.evidence,
          unresolvedEffects: [
            {
              type: "unknown_external_effect",
              reason: "No match was visible, but absence is not proof that submission never occurred"
            }
          ]
        })
      );
    }

    if (outcome.kind === "ambiguous") {
      await this.emitTelemetry("ambiguous_reconciliation");
      await this.emitTelemetry("needs_review");
      return this.storageCall(() =>
        this.store.finalizeNeedsReview({
          operationId,
          attemptId,
          reason: "reconciliation_found_multiple_matching_external_effects",
          providerReference: null,
          verificationEvidence: outcome.evidence,
          unresolvedEffects: outcome.providerReferences.map((providerReference) => ({
            type: "ambiguous_external_effect",
            providerReference
          }))
        })
      );
    }

    const receipt = await this.verifyAndFinalize(
      options,
      outcome.result,
      context,
      attemptId,
      "reconciliation",
      true,
      outcome.evidence
    );
    if (receipt.status === "CONFIRMED") await this.emitTelemetry("successful_reconciliation");
    return receipt;
  }

  private async verifyAndFinalize<TExecuteResult, TReconcileResult>(
    options: WriteGuardExecutionOptions<TExecuteResult, TReconcileResult>,
    result: TExecuteResult | TReconcileResult,
    context: ExecutionContext,
    attemptId: string,
    source: "execution" | "reconciliation",
    duplicateExecutionPrevented: boolean,
    reconciliationEvidence: Record<string, unknown>
  ): Promise<ExecutionReceipt> {
    const verificationContext: VerificationContext = { ...context, source };
    const providerReference = options.getProviderReference?.(result) ?? defaultProviderReference(result);
    let verified: boolean;
    try {
      verified = await options.verify(result, verificationContext);
    } catch (error) {
      const classified = classifyError(error);
      await this.emitTelemetry("needs_review");
      return this.storageCall(() =>
        this.store.finalizeNeedsReview({
          operationId: context.operationId,
          attemptId,
          reason: "verification_hook_failed",
          providerReference,
          verificationEvidence: {
            ...reconciliationEvidence,
            errorType: classified.type,
            errorMessage: classified.message
          },
          unresolvedEffects: [{ type: "unverified_external_effect", providerReference }]
        })
      );
    }

    const verificationEvidence = {
      ...reconciliationEvidence,
      ...(options.getVerificationEvidence?.(result, verificationContext) ?? {
        source: "application_verify_hook",
        verified
      })
    };

    if (verified) {
      return this.storageCall(() =>
        this.store.finalizeConfirmed({
          operationId: context.operationId,
          attemptId,
          providerReference,
          resolution: source === "reconciliation" ? "reconciled_after_unknown_outcome" : "executed_and_verified",
          duplicateExecutionPrevented,
          verificationEvidence
        })
      );
    }

    if (!options.compensate) {
      await this.emitTelemetry("needs_review");
      return this.storageCall(() =>
        this.store.finalizeNeedsReview({
          operationId: context.operationId,
          attemptId,
          reason: "postcondition_verification_failed",
          providerReference,
          verificationEvidence,
          unresolvedEffects: [{ type: "unverified_external_effect", providerReference }]
        })
      );
    }

    await this.storageCall(() =>
      this.store.markCompensating({
        operationId: context.operationId,
        attemptId,
        providerReference,
        evidence: verificationEvidence
      })
    );
    try {
      await options.compensate(result, verificationContext);
      return this.storageCall(() =>
        this.store.finalizeCompensated({
          operationId: context.operationId,
          attemptId,
          providerReference,
          evidence: verificationEvidence
        })
      );
    } catch (error) {
      const classified = classifyError(error);
      await this.emitTelemetry("needs_review");
      return this.storageCall(() =>
        this.store.finalizeCompensationFailed({
          operationId: context.operationId,
          attemptId,
          providerReference,
          evidence: verificationEvidence,
          errorType: classified.type,
          errorMessage: classified.message
        })
      );
    }
  }
}

export {
  ConfirmedExecutionFailure,
  IllegalStateTransitionError,
  OperationKeyConflictError,
  OperationInProgressError,
  PreSubmissionFailure,
  ReconciliationFailure,
  UnknownExecutionOutcome,
  VerificationFailure,
  WriteGuardError
} from "../../core/src/errors.js";
export type { WriteGuardErrorCode } from "../../core/src/errors.js";
export type {
  EffectType,
  ExecutionReceipt,
  ReconciliationOutcome,
  ShadowClassification
} from "../../core/src/models.js";
export {
  LocalPilotTelemetry,
  pilotMetricNames,
  summarizePilotTelemetry
} from "./telemetry.js";
export type {
  LatencySummary,
  PilotMetricName,
  PilotSummary,
  PilotTelemetryEvent,
  PilotTelemetryPeriod,
  PilotTelemetryRecord,
  PilotTelemetrySink
} from "./telemetry.js";
