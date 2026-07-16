import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  ConfirmedExecutionFailure,
  PreSubmissionFailure,
  UnknownExecutionOutcome
} from "./errors.js";
import type { ReconciliationOutcome } from "./models.js";

const { Pool } = pg;
type PoolType = InstanceType<typeof Pool>;

export const fakeProviderScenarios = [
  "success",
  "confirmed_failure",
  "timeout_before_submission",
  "timeout_after_success",
  "delayed_reconciliation",
  "conflicting_results"
] as const;

export type FakeProviderScenario = (typeof fakeProviderScenarios)[number];

export type FakeRefundRequest = {
  operationId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
};

export type FakeRefund = {
  id: string;
  operationId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  status: "succeeded" | "failed";
  metadata: Record<string, string>;
  createdAt: Date;
};

export type FakeProviderOptions = {
  scenario?: FakeProviderScenario;
  reconciliationDelayMs?: number;
};

export interface FakeRefundProviderContract {
  createRefund(request: FakeRefundRequest): Promise<FakeRefund>;
  reconcile(operationId: string, paymentIntentId: string): Promise<ReconciliationOutcome<FakeRefund>>;
  countRefunds(paymentIntentId: string): Promise<number>;
  listRefunds(paymentIntentId: string): Promise<FakeRefund[]>;
}

function createRefundRecord(request: FakeRefundRequest): FakeRefund {
  return {
    id: `fref_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    operationId: request.operationId,
    paymentIntentId: request.paymentIntentId,
    amount: request.amount,
    currency: request.currency,
    status: "succeeded",
    metadata: { write_guard_operation_id: request.operationId },
    createdAt: new Date()
  };
}

export class InMemoryFakeRefundProvider implements FakeRefundProviderContract {
  private readonly refunds: FakeRefund[] = [];
  private readonly scenario: FakeProviderScenario;
  private readonly reconciliationDelayMs: number;
  private readonly visibleAtByRefund = new Map<string, number>();

  constructor(options: FakeProviderOptions = {}) {
    this.scenario = options.scenario ?? "success";
    this.reconciliationDelayMs = options.reconciliationDelayMs ?? 50;
  }

  async createRefund(request: FakeRefundRequest): Promise<FakeRefund> {
    if (this.scenario === "timeout_before_submission") {
      throw new PreSubmissionFailure("Fake provider timed out before accepting the refund request");
    }
    if (this.scenario === "confirmed_failure") {
      throw new ConfirmedExecutionFailure("Fake provider explicitly rejected the refund request");
    }

    const refund = createRefundRecord(request);
    this.refunds.push(refund);
    this.visibleAtByRefund.set(
      refund.id,
      Date.now() + (this.scenario === "delayed_reconciliation" ? this.reconciliationDelayMs : 0)
    );

    if (this.scenario === "conflicting_results") {
      const conflict = createRefundRecord(request);
      this.refunds.push(conflict);
      this.visibleAtByRefund.set(conflict.id, Date.now());
    }

    if (this.scenario === "timeout_after_success") {
      throw new UnknownExecutionOutcome("Fake provider committed the refund but the response timed out");
    }

    return structuredClone(refund);
  }

  async reconcile(
    operationId: string,
    paymentIntentId: string
  ): Promise<ReconciliationOutcome<FakeRefund>> {
    const allMatches = this.refunds.filter(
      (refund) => refund.operationId === operationId && refund.paymentIntentId === paymentIntentId
    );
    const visibleMatches = allMatches.filter(
      (refund) => (this.visibleAtByRefund.get(refund.id) ?? 0) <= Date.now()
    );

    if (allMatches.length > 0 && visibleMatches.length === 0) {
      return {
        kind: "unavailable",
        reason: "Fake provider has not made the committed refund visible to reconciliation yet",
        evidence: { operationId, paymentIntentId, knownMatchCount: allMatches.length }
      };
    }
    if (visibleMatches.length === 0) {
      return { kind: "not_found", evidence: { operationId, paymentIntentId, matchCount: 0 } };
    }
    if (visibleMatches.length > 1) {
      return {
        kind: "ambiguous",
        providerReferences: visibleMatches.map((refund) => refund.id),
        evidence: { operationId, paymentIntentId, matchCount: visibleMatches.length }
      };
    }
    return {
      kind: "found",
      result: structuredClone(visibleMatches[0]!),
      evidence: { operationId, paymentIntentId, matchCount: 1 }
    };
  }

  async countRefunds(paymentIntentId: string): Promise<number> {
    return this.refunds.filter((refund) => refund.paymentIntentId === paymentIntentId).length;
  }

  async listRefunds(paymentIntentId: string): Promise<FakeRefund[]> {
    return structuredClone(this.refunds.filter((refund) => refund.paymentIntentId === paymentIntentId));
  }
}

type FakeRefundRow = {
  id: string;
  operation_id: string;
  payment_intent_id: string;
  amount: number;
  currency: string;
  status: "succeeded" | "failed";
  metadata: Record<string, string>;
  created_at: Date;
};

function fakeRefundFromRow(row: FakeRefundRow): FakeRefund {
  return {
    id: row.id,
    operationId: row.operation_id,
    paymentIntentId: row.payment_intent_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}

export class PostgresFakeRefundProvider implements FakeRefundProviderContract {
  private readonly scenario: FakeProviderScenario;
  private readonly reconciliationDelayMs: number;

  constructor(
    private readonly pool: PoolType,
    options: FakeProviderOptions = {}
  ) {
    this.scenario = options.scenario ?? "success";
    this.reconciliationDelayMs = options.reconciliationDelayMs ?? 250;
  }

  async createRefund(request: FakeRefundRequest): Promise<FakeRefund> {
    if (this.scenario === "timeout_before_submission") {
      throw new PreSubmissionFailure("Fake provider timed out before accepting the refund request");
    }
    if (this.scenario === "confirmed_failure") {
      throw new ConfirmedExecutionFailure("Fake provider explicitly rejected the refund request");
    }

    const refund = createRefundRecord(request);
    const delay = this.scenario === "delayed_reconciliation" ? this.reconciliationDelayMs : 0;
    await this.pool.query(
      `INSERT INTO fake_provider_refunds
        (id, operation_id, payment_intent_id, amount, currency, status, metadata,
         reconciliation_visible_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb,
               now() + ($8 * interval '1 millisecond'))`,
      [
        refund.id,
        refund.operationId,
        refund.paymentIntentId,
        refund.amount,
        refund.currency,
        refund.status,
        JSON.stringify(refund.metadata),
        delay
      ]
    );

    if (this.scenario === "conflicting_results") {
      const conflict = createRefundRecord(request);
      await this.pool.query(
        `INSERT INTO fake_provider_refunds
          (id, operation_id, payment_intent_id, amount, currency, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          conflict.id,
          conflict.operationId,
          conflict.paymentIntentId,
          conflict.amount,
          conflict.currency,
          conflict.status,
          JSON.stringify(conflict.metadata)
        ]
      );
    }

    if (this.scenario === "timeout_after_success") {
      throw new UnknownExecutionOutcome("Fake provider committed the refund but the response timed out");
    }

    return refund;
  }

  async reconcile(
    operationId: string,
    paymentIntentId: string
  ): Promise<ReconciliationOutcome<FakeRefund>> {
    const result = await this.pool.query<FakeRefundRow & { visible: boolean }>(
      `SELECT *, reconciliation_visible_at <= now() AS visible
       FROM fake_provider_refunds
       WHERE operation_id = $1 AND payment_intent_id = $2
       ORDER BY created_at`,
      [operationId, paymentIntentId]
    );
    const visible = result.rows.filter((row) => row.visible);
    if (result.rows.length > 0 && visible.length === 0) {
      return {
        kind: "unavailable",
        reason: "Fake provider has not made the committed refund visible to reconciliation yet",
        evidence: { operationId, paymentIntentId, knownMatchCount: result.rows.length }
      };
    }
    if (visible.length === 0) {
      return { kind: "not_found", evidence: { operationId, paymentIntentId, matchCount: 0 } };
    }
    if (visible.length > 1) {
      return {
        kind: "ambiguous",
        providerReferences: visible.map((row) => row.id),
        evidence: { operationId, paymentIntentId, matchCount: visible.length }
      };
    }
    return {
      kind: "found",
      result: fakeRefundFromRow(visible[0]!),
      evidence: { operationId, paymentIntentId, matchCount: 1 }
    };
  }

  async countRefunds(paymentIntentId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM fake_provider_refunds WHERE payment_intent_id = $1",
      [paymentIntentId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async listRefunds(paymentIntentId: string): Promise<FakeRefund[]> {
    const result = await this.pool.query<FakeRefundRow>(
      "SELECT * FROM fake_provider_refunds WHERE payment_intent_id = $1 ORDER BY created_at",
      [paymentIntentId]
    );
    return result.rows.map(fakeRefundFromRow);
  }
}
