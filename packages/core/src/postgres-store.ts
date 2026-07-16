import pg from "pg";
import { OperationKeyConflictError } from "./errors.js";
import type {
  AttemptOutcome,
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

const { Pool } = pg;
type PoolType = InstanceType<typeof Pool>;
type Client = pg.PoolClient;
type Row = Record<string, unknown>;

function operationFromRow(row: Row): OperationRecord {
  return {
    id: row.id as string,
    namespace: row.namespace as string,
    operationKey: row.operation_key as string,
    actionName: row.action_name as string,
    provider: (row.provider as string | null) ?? null,
    effectType: row.effect_type as OperationRecord["effectType"],
    status: row.status as OperationStatus,
    attemptCount: row.attempt_count as number,
    requestFingerprint: row.request_fingerprint as string,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    claimOwner: (row.claim_owner as string | null) ?? null,
    claimExpiresAt: (row.claim_expires_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    claimedAt: (row.claimed_at as Date | null) ?? null,
    submittedAt: (row.submitted_at as Date | null) ?? null,
    confirmedAt: (row.confirmed_at as Date | null) ?? null,
    completedAt: (row.completed_at as Date | null) ?? null
  };
}

function attemptFromRow(row: Row): OperationAttemptRecord {
  return {
    id: row.id as string,
    operationId: row.operation_id as string,
    attemptNumber: row.attempt_number as number,
    kind: row.kind as OperationAttemptRecord["kind"],
    startedAt: row.started_at as Date,
    finishedAt: (row.finished_at as Date | null) ?? null,
    outcome: row.outcome as AttemptOutcome,
    errorType: (row.error_type as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    providerReference: (row.provider_reference as string | null) ?? null
  };
}

function eventFromRow(row: Row): OperationEventRecord {
  return {
    id: row.id as string,
    operationId: row.operation_id as string,
    eventType: row.event_type as string,
    previousStatus: (row.previous_status as OperationStatus | null) ?? null,
    newStatus: row.new_status as OperationStatus,
    details: (row.details as Record<string, unknown>) ?? {},
    createdAt: row.created_at as Date
  };
}

function receiptFromRow(row: Row, operation: OperationRecord): ExecutionReceipt {
  const createdAt = row.created_at as Date;
  return {
    id: row.id as string,
    operationId: row.operation_id as string,
    operationKey: operation.operationKey,
    action: operation.actionName,
    status: row.final_status as TerminalStatus,
    verified: row.verified as boolean,
    providerReference: (row.provider_reference as string | null) ?? null,
    attempts: operation.attemptCount,
    resolution: row.resolution as string,
    duplicateExecutionPrevented: row.duplicate_execution_prevented as boolean,
    verificationEvidence: (row.verification_evidence as Record<string, unknown>) ?? {},
    unresolvedEffects: (row.unresolved_effects as Array<Record<string, unknown>>) ?? [],
    createdAt,
    completedAt: operation.completedAt ?? createdAt
  };
}

function shadowObservationFromRow(row: Row): ShadowObservationRecord {
  return {
    id: row.id as string,
    namespace: row.namespace as string,
    operationKey: row.operation_key as string,
    actionName: row.action_name as string,
    provider: (row.provider as string | null) ?? null,
    effectType: row.effect_type as ShadowObservationRecord["effectType"],
    requestFingerprint: row.request_fingerprint as string,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    invocationCount: row.invocation_count as number,
    reconciliationAttemptCount: row.reconciliation_attempt_count as number,
    latestClassification: row.latest_classification as ShadowObservationRecord["latestClassification"],
    latestVerified: (row.latest_verified as boolean | null) ?? null,
    latestProviderReference: (row.latest_provider_reference as string | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    lastObservedAt: row.last_observed_at as Date
  };
}

export class PostgresOperationStore implements OperationStore {
  private readonly pool: PoolType;
  private readonly ownsPool: boolean;

  constructor(poolOrUrl: PoolType | string) {
    if (typeof poolOrUrl === "string") {
      this.pool = new Pool({ connectionString: poolOrUrl });
      this.ownsPool = true;
    } else {
      this.pool = poolOrUrl;
      this.ownsPool = false;
    }
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }

  private async transaction<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockedOperation(client: Client, operationId: string): Promise<OperationRecord> {
    const result = await client.query("SELECT * FROM writeguard_operations WHERE id = $1 FOR UPDATE", [
      operationId
    ]);
    if (result.rowCount !== 1) throw new Error(`Operation ${operationId} not found`);
    return operationFromRow(result.rows[0] as Row);
  }

  private async transition(
    client: Client,
    operation: OperationRecord,
    to: OperationStatus,
    eventType: string,
    details: Record<string, unknown> = {}
  ): Promise<void> {
    const from = operation.status;
    assertTransition(from, to);
    const updated = await client.query(
      "UPDATE writeguard_operations SET status = $2, updated_at = now() WHERE id = $1 RETURNING updated_at",
      [operation.id, to]
    );
    await client.query(
      `INSERT INTO writeguard_operation_events
        (operation_id, event_type, previous_status, new_status, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [operation.id, eventType, from, to, JSON.stringify(details)]
    );
    operation.status = to;
    operation.updatedAt = updated.rows[0]?.updated_at as Date;
  }

  private async appendSameStateEvent(
    client: Client,
    operation: OperationRecord,
    eventType: string,
    details: Record<string, unknown>
  ): Promise<void> {
    await client.query(
      `INSERT INTO writeguard_operation_events
        (operation_id, event_type, previous_status, new_status, details)
       VALUES ($1, $2, $3, $3, $4::jsonb)`,
      [operation.id, eventType, operation.status, JSON.stringify(details)]
    );
  }

  private async startReconciliation(
    client: Client,
    operation: OperationRecord,
    request: ClaimRequest
  ): Promise<ClaimDecision> {
    await this.transition(client, operation, "RECONCILING", "RECONCILIATION_STARTED");
    const updated = await client.query(
      `UPDATE writeguard_operations
         SET claim_owner = $2,
             claim_expires_at = now() + ($3 * interval '1 millisecond'),
             claimed_at = now(),
             attempt_count = attempt_count + 1,
             updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [operation.id, request.workerId, request.claimTtlMs]
    );
    const current = operationFromRow(updated.rows[0] as Row);
    const attemptResult = await client.query(
      `INSERT INTO writeguard_operation_attempts
        (operation_id, attempt_number, kind, outcome)
       VALUES ($1, $2, 'RECONCILIATION', 'RUNNING')
       RETURNING *`,
      [current.id, current.attemptCount]
    );
    return {
      kind: "reconcile",
      operation: current,
      attempt: attemptFromRow(attemptResult.rows[0] as Row)
    };
  }

  async claim(request: ClaimRequest): Promise<ClaimDecision> {
    return this.transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO writeguard_operations
          (namespace, operation_key, action_name, provider, effect_type, status,
           request_fingerprint, metadata, claim_owner, claim_expires_at, claimed_at)
         VALUES ($1, $2, $3, $4, $5, 'PLANNED', $6, $7::jsonb, $8,
                 now() + ($9 * interval '1 millisecond'), now())
         ON CONFLICT (namespace, operation_key) DO NOTHING
         RETURNING id`,
        [
          request.namespace,
          request.operationKey,
          request.action.name,
          request.action.provider,
          request.action.effectType,
          request.requestFingerprint,
          JSON.stringify(request.metadata),
          request.workerId,
          request.claimTtlMs
        ]
      );

      const selected = await client.query(
        `SELECT * FROM writeguard_operations
         WHERE namespace = $1 AND operation_key = $2
         FOR UPDATE`,
        [request.namespace, request.operationKey]
      );
      if (selected.rowCount !== 1) throw new Error("Operation insert/select race did not resolve");
      let operation = operationFromRow(selected.rows[0] as Row);

      if (operation.requestFingerprint !== request.requestFingerprint) {
        throw new OperationKeyConflictError(request.namespace, request.operationKey);
      }

      if (inserted.rowCount === 1) {
        await client.query(
          `INSERT INTO writeguard_operation_events
            (operation_id, event_type, previous_status, new_status, details)
           VALUES ($1, 'OPERATION_PLANNED', NULL, 'PLANNED', $2::jsonb)`,
          [operation.id, JSON.stringify({ action: operation.actionName })]
        );
        if (request.invocationMetadata) {
          await this.appendSameStateEvent(
            client,
            operation,
            "INVOCATION_RECEIVED",
            request.invocationMetadata
          );
        }
        await this.transition(client, operation, "CLAIMED", "OPERATION_CLAIMED", {
          workerId: request.workerId
        });
        return { kind: "execute", operation };
      }

      if (request.invocationMetadata) {
        await this.appendSameStateEvent(
          client,
          operation,
          "INVOCATION_RECEIVED",
          request.invocationMetadata
        );
      }

      if ((terminalStatuses as readonly string[]).includes(operation.status)) {
        const receiptResult = await client.query(
          "SELECT * FROM writeguard_execution_receipts WHERE operation_id = $1",
          [operation.id]
        );
        if (receiptResult.rowCount !== 1) throw new Error(`Terminal operation ${operation.id} has no receipt`);
        return {
          kind: "terminal",
          operation,
          receipt: receiptFromRow(receiptResult.rows[0] as Row, operation)
        };
      }

      const leaseActive = operation.claimExpiresAt !== null && operation.claimExpiresAt.getTime() > Date.now();
      if (["CLAIMED", "SUBMITTED", "RECONCILING"].includes(operation.status) && leaseActive) {
        return { kind: "in_progress", operation };
      }

      if (operation.status === "CLAIMED") {
        const updated = await client.query(
          `UPDATE writeguard_operations
             SET claim_owner = $2,
                 claim_expires_at = now() + ($3 * interval '1 millisecond'),
                 claimed_at = now(),
                 updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [operation.id, request.workerId, request.claimTtlMs]
        );
        operation = operationFromRow(updated.rows[0] as Row);
        await this.appendSameStateEvent(client, operation, "STALE_CLAIM_RECLAIMED", {
          workerId: request.workerId
        });
        return { kind: "execute", operation };
      }

      if (operation.status === "SUBMITTED") {
        await client.query(
          `UPDATE writeguard_operation_attempts
             SET outcome = 'UNKNOWN', finished_at = now(),
                 error_type = 'STALE_SUBMITTED_CLAIM',
                 error_message = 'Submission lease expired before a final result was recorded'
           WHERE id = (
             SELECT id FROM writeguard_operation_attempts
             WHERE operation_id = $1 AND outcome = 'RUNNING'
             ORDER BY attempt_number DESC LIMIT 1
           )`,
          [operation.id]
        );
        await this.transition(client, operation, "UNKNOWN", "STALE_SUBMISSION_BECAME_UNKNOWN");
      } else if (operation.status === "RECONCILING") {
        await client.query(
          `UPDATE writeguard_operation_attempts
             SET outcome = 'RECONCILIATION_UNAVAILABLE', finished_at = now(),
                 error_type = 'STALE_RECONCILIATION_CLAIM',
                 error_message = 'Reconciliation lease expired'
           WHERE id = (
             SELECT id FROM writeguard_operation_attempts
             WHERE operation_id = $1 AND outcome = 'RUNNING'
             ORDER BY attempt_number DESC LIMIT 1
           )`,
          [operation.id]
        );
        await this.transition(client, operation, "UNKNOWN", "STALE_RECONCILIATION_RELEASED");
      }

      if (operation.status === "UNKNOWN") {
        return this.startReconciliation(client, operation, request);
      }

      throw new Error(`Unhandled claim state ${operation.status}`);
    });
  }

  async markSubmitted(operationId: string, workerId: string): Promise<OperationAttemptRecord> {
    return this.transaction(async (client) => {
      const operation = await this.lockedOperation(client, operationId);
      if (operation.claimOwner !== workerId) {
        throw new Error(`Worker ${workerId} does not own operation ${operationId}`);
      }
      await this.transition(client, operation, "SUBMITTED", "EXECUTION_SUBMITTED");
      const updated = await client.query(
        `UPDATE writeguard_operations
         SET submitted_at = now(), attempt_count = attempt_count + 1, updated_at = now()
         WHERE id = $1 RETURNING attempt_count`,
        [operationId]
      );
      const attemptResult = await client.query(
        `INSERT INTO writeguard_operation_attempts
          (operation_id, attempt_number, kind, outcome)
         VALUES ($1, $2, 'EXECUTION', 'RUNNING')
         RETURNING *`,
        [operationId, updated.rows[0]?.attempt_count]
      );
      return attemptFromRow(attemptResult.rows[0] as Row);
    });
  }

  async markUnknown(
    operationId: string,
    attemptId: string,
    errorType: string,
    errorMessage: string
  ): Promise<void> {
    await this.transaction(async (client) => {
      const operation = await this.lockedOperation(client, operationId);
      await client.query(
        `UPDATE writeguard_operation_attempts
         SET outcome = 'UNKNOWN', error_type = $3, error_message = $4, finished_at = now()
         WHERE id = $2 AND operation_id = $1`,
        [operationId, attemptId, errorType, errorMessage]
      );
      await this.transition(client, operation, "UNKNOWN", "EXECUTION_OUTCOME_UNKNOWN", { errorType });
      await client.query(
        "UPDATE writeguard_operations SET claim_owner = NULL, claim_expires_at = NULL WHERE id = $1",
        [operationId]
      );
    });
  }

  private async insertReceipt(
    client: Client,
    operation: OperationRecord,
    status: TerminalStatus,
    verified: boolean,
    providerReference: string | null,
    resolution: string,
    duplicateExecutionPrevented: boolean,
    verificationEvidence: Record<string, unknown>,
    unresolvedEffects: Array<Record<string, unknown>>
  ): Promise<ExecutionReceipt> {
    const operationResult = await client.query(
      `UPDATE writeguard_operations
       SET completed_at = now(), claim_owner = NULL, claim_expires_at = NULL, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [operation.id]
    );
    const updatedOperation = operationFromRow(operationResult.rows[0] as Row);
    const receiptResult = await client.query(
      `INSERT INTO writeguard_execution_receipts
        (operation_id, final_status, verified, provider_reference, resolution,
         duplicate_execution_prevented, verification_evidence, unresolved_effects)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       RETURNING *`,
      [
        operation.id,
        status,
        verified,
        providerReference,
        resolution,
        duplicateExecutionPrevented,
        JSON.stringify(verificationEvidence),
        JSON.stringify(unresolvedEffects)
      ]
    );
    return receiptFromRow(receiptResult.rows[0] as Row, updatedOperation);
  }

  async finalizeConfirmed(input: FinalizeConfirmedInput): Promise<ExecutionReceipt> {
    return this.transaction(async (client) => {
      const operation = await this.lockedOperation(client, input.operationId);
      const reconciled = operation.status === "RECONCILING";
      await client.query(
        `UPDATE writeguard_operation_attempts
         SET outcome = $3, provider_reference = $4, finished_at = now()
         WHERE id = $2 AND operation_id = $1`,
        [input.operationId, input.attemptId, reconciled ? "RECONCILED" : "CONFIRMED", input.providerReference]
      );
      await this.transition(client, operation, "CONFIRMED", "POSTCONDITION_CONFIRMED", {
        resolution: input.resolution,
        providerReference: input.providerReference
      });
      await client.query("UPDATE writeguard_operations SET confirmed_at = now() WHERE id = $1", [
        input.operationId
      ]);
      return this.insertReceipt(
        client,
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
    return this.transaction(async (client) => {
      const operation = await this.lockedOperation(client, input.operationId);
      const outcome = input.errorType === "PRE_SUBMISSION_FAILURE" ? "PRE_SUBMISSION_FAILURE" : "CONFIRMED_FAILURE";
      await client.query(
        `UPDATE writeguard_operation_attempts
         SET outcome = $3, error_type = $4, error_message = $5, finished_at = now()
         WHERE id = $2 AND operation_id = $1`,
        [input.operationId, input.attemptId, outcome, input.errorType, input.errorMessage]
      );
      await this.transition(client, operation, "FAILED", "EXECUTION_CONFIRMED_FAILED", {
        errorType: input.errorType
      });
      return this.insertReceipt(client, operation, "FAILED", false, null, input.resolution, false, {}, []);
    });
  }

  async finalizeNeedsReview(input: FinalizeNeedsReviewInput): Promise<ExecutionReceipt> {
    return this.transaction(async (client) => {
      const operation = await this.lockedOperation(client, input.operationId);
      await client.query(
        `UPDATE writeguard_operation_attempts
         SET outcome = 'NEEDS_REVIEW', error_type = 'NEEDS_REVIEW', error_message = $3,
             provider_reference = $4, finished_at = now()
         WHERE id = $2 AND operation_id = $1`,
        [input.operationId, input.attemptId, input.reason, input.providerReference]
      );
      await this.transition(client, operation, "NEEDS_REVIEW", "HUMAN_REVIEW_REQUIRED", {
        reason: input.reason
      });
      return this.insertReceipt(
        client,
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
    await this.transaction(async (client) => {
      const operation = await this.lockedOperation(client, operationId);
      await client.query(
        `UPDATE writeguard_operation_attempts
         SET outcome = 'RECONCILIATION_UNAVAILABLE', error_type = $3,
             error_message = $4, finished_at = now()
         WHERE id = $2 AND operation_id = $1`,
        [operationId, attemptId, errorType, errorMessage]
      );
      await this.transition(client, operation, "UNKNOWN", "RECONCILIATION_UNAVAILABLE", { errorType });
      await client.query(
        "UPDATE writeguard_operations SET claim_owner = NULL, claim_expires_at = NULL WHERE id = $1",
        [operationId]
      );
    });
  }

  async markCompensating(input: CompensationInput): Promise<void> {
    await this.transaction(async (client) => {
      const operation = await this.lockedOperation(client, input.operationId);
      await this.transition(client, operation, "COMPENSATING", "COMPENSATION_STARTED", {
        providerReference: input.providerReference
      });
    });
  }

  async finalizeCompensated(input: CompensationInput): Promise<ExecutionReceipt> {
    return this.transaction(async (client) => {
      const operation = await this.lockedOperation(client, input.operationId);
      await client.query(
        `UPDATE writeguard_operation_attempts
         SET outcome = 'COMPENSATED', provider_reference = $3, finished_at = now()
         WHERE id = $2 AND operation_id = $1`,
        [input.operationId, input.attemptId, input.providerReference]
      );
      await this.transition(client, operation, "COMPENSATED", "COMPENSATION_CONFIRMED");
      return this.insertReceipt(
        client,
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
    return this.transaction(async (client) => {
      const operation = await this.lockedOperation(client, input.operationId);
      await client.query(
        `UPDATE writeguard_operation_attempts
         SET outcome = 'COMPENSATION_FAILED', provider_reference = $3,
             error_type = $4, error_message = $5, finished_at = now()
         WHERE id = $2 AND operation_id = $1`,
        [input.operationId, input.attemptId, input.providerReference, input.errorType, input.errorMessage]
      );
      await this.transition(client, operation, "NEEDS_REVIEW", "COMPENSATION_FAILED", {
        errorType: input.errorType
      });
      return this.insertReceipt(
        client,
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
    return this.transaction(async (client) => {
      await client.query(
        `INSERT INTO writeguard_shadow_observations
          (namespace, operation_key, action_name, provider, effect_type,
           request_fingerprint, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (namespace, operation_key) DO NOTHING`,
        [
          request.namespace,
          request.operationKey,
          request.action.name,
          request.action.provider,
          request.action.effectType,
          request.requestFingerprint,
          JSON.stringify(request.metadata)
        ]
      );
      const selected = await client.query(
        `SELECT * FROM writeguard_shadow_observations
         WHERE namespace = $1 AND operation_key = $2
         FOR UPDATE`,
        [request.namespace, request.operationKey]
      );
      if (selected.rowCount !== 1) throw new Error("Shadow observation insert/select race did not resolve");
      const existing = shadowObservationFromRow(selected.rows[0] as Row);
      if (existing.requestFingerprint !== request.requestFingerprint) {
        throw new OperationKeyConflictError(request.namespace, request.operationKey);
      }
      const updated = await client.query(
        `UPDATE writeguard_shadow_observations
         SET invocation_count = invocation_count + 1,
             updated_at = now(),
             last_observed_at = now()
         WHERE id = $1
         RETURNING *`,
        [existing.id]
      );
      const observation = shadowObservationFromRow(updated.rows[0] as Row);
      await client.query(
        `INSERT INTO writeguard_shadow_invocations
          (shadow_observation_id, invocation_number, details)
         VALUES ($1, $2, $3::jsonb)`,
        [
          observation.id,
          observation.invocationCount,
          JSON.stringify(request.invocationMetadata ?? {})
        ]
      );
      return observation;
    });
  }

  async finalizeShadowObservation(
    input: FinalizeShadowObservationInput
  ): Promise<ShadowObservationRecord> {
    const result = await this.pool.query(
      `UPDATE writeguard_shadow_observations
       SET latest_classification = $2,
           latest_verified = $3,
           latest_provider_reference = $4,
           reconciliation_attempt_count = reconciliation_attempt_count + CASE WHEN $5 THEN 1 ELSE 0 END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        input.observationId,
        input.classification,
        input.verified,
        input.providerReference,
        input.reconciliationAttempted
      ]
    );
    if (result.rowCount !== 1) throw new Error(`Shadow observation ${input.observationId} not found`);
    return shadowObservationFromRow(result.rows[0] as Row);
  }

  async getShadowObservation(
    namespace: string,
    operationKey: string
  ): Promise<ShadowObservationRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM writeguard_shadow_observations
       WHERE namespace = $1 AND operation_key = $2`,
      [namespace, operationKey]
    );
    return result.rowCount === 1 ? shadowObservationFromRow(result.rows[0] as Row) : null;
  }

  async getTimeline(namespace: string, operationKey: string): Promise<OperationTimeline | null> {
    const operationResult = await this.pool.query(
      "SELECT * FROM writeguard_operations WHERE namespace = $1 AND operation_key = $2",
      [namespace, operationKey]
    );
    if (operationResult.rowCount === 0) return null;
    const operation = operationFromRow(operationResult.rows[0] as Row);
    const [attempts, events, receipt] = await Promise.all([
      this.pool.query(
        "SELECT * FROM writeguard_operation_attempts WHERE operation_id = $1 ORDER BY attempt_number",
        [operation.id]
      ),
      this.pool.query(
        "SELECT * FROM writeguard_operation_events WHERE operation_id = $1 ORDER BY event_sequence",
        [operation.id]
      ),
      this.pool.query("SELECT * FROM writeguard_execution_receipts WHERE operation_id = $1", [operation.id])
    ]);
    return {
      operation,
      attempts: attempts.rows.map((row) => attemptFromRow(row as Row)),
      events: events.rows.map((row) => eventFromRow(row as Row)),
      receipt: receipt.rowCount === 1 ? receiptFromRow(receipt.rows[0] as Row, operation) : null
    };
  }
}
