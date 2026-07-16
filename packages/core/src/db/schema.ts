import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";
import { effectTypes, operationStatuses } from "../models.js";

export const operationStatusEnum = pgEnum("writeguard_operation_status", operationStatuses);
export const effectTypeEnum = pgEnum("writeguard_effect_type", effectTypes);
export const attemptKindEnum = pgEnum("writeguard_attempt_kind", ["EXECUTION", "RECONCILIATION"]);

export const operations = pgTable(
  "writeguard_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    namespace: text("namespace").notNull(),
    operationKey: text("operation_key").notNull(),
    actionName: text("action_name").notNull(),
    provider: text("provider"),
    effectType: effectTypeEnum("effect_type").notNull(),
    status: operationStatusEnum("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    claimOwner: text("claim_owner"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("writeguard_operations_namespace_key_uq").on(table.namespace, table.operationKey),
    index("writeguard_operations_status_idx").on(table.status),
    index("writeguard_operations_claim_expiry_idx").on(table.claimExpiresAt)
  ]
);

export const operationAttempts = pgTable(
  "writeguard_operation_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    kind: attemptKindEnum("kind").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: text("outcome").notNull().default("RUNNING"),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    providerReference: text("provider_reference")
  },
  (table) => [
    uniqueIndex("writeguard_attempts_operation_number_uq").on(table.operationId, table.attemptNumber),
    index("writeguard_attempts_operation_idx").on(table.operationId)
  ]
);

export const operationEvents = pgTable(
  "writeguard_operation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventSequence: bigserial("event_sequence", { mode: "number" }).notNull(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    previousStatus: operationStatusEnum("previous_status"),
    newStatus: operationStatusEnum("new_status").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("writeguard_events_operation_created_idx").on(table.operationId, table.createdAt),
    index("writeguard_events_operation_sequence_idx").on(table.operationId, table.eventSequence)
  ]
);

export const executionReceipts = pgTable(
  "writeguard_execution_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operationId: uuid("operation_id")
      .notNull()
      .unique()
      .references(() => operations.id, { onDelete: "cascade" }),
    finalStatus: operationStatusEnum("final_status").notNull(),
    verified: boolean("verified").notNull(),
    providerReference: text("provider_reference"),
    resolution: text("resolution").notNull(),
    duplicateExecutionPrevented: boolean("duplicate_execution_prevented").notNull().default(false),
    verificationEvidence: jsonb("verification_evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    unresolvedEffects: jsonb("unresolved_effects")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("writeguard_receipts_status_idx").on(table.finalStatus)]
);

export const fakeRefunds = pgTable(
  "fake_provider_refunds",
  {
    id: text("id").primaryKey(),
    operationId: uuid("operation_id").notNull(),
    paymentIntentId: text("payment_intent_id").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    reconciliationVisibleAt: timestamp("reconciliation_visible_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("fake_refunds_operation_idx").on(table.operationId),
    index("fake_refunds_payment_intent_idx").on(table.paymentIntentId)
  ]
);
