DO $$ BEGIN
  CREATE TYPE writeguard_operation_status AS ENUM (
    'PLANNED', 'CLAIMED', 'SUBMITTED', 'UNKNOWN', 'RECONCILING',
    'CONFIRMED', 'FAILED', 'COMPENSATING', 'COMPENSATED', 'NEEDS_REVIEW'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE writeguard_effect_type AS ENUM (
    'reversible_write', 'conditionally_reversible', 'irreversible_write'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE writeguard_attempt_kind AS ENUM ('EXECUTION', 'RECONCILIATION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS writeguard_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace text NOT NULL,
  operation_key text NOT NULL,
  action_name text NOT NULL,
  provider text,
  effect_type writeguard_effect_type NOT NULL,
  status writeguard_operation_status NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  request_fingerprint varchar(64) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  claim_owner text,
  claim_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT writeguard_operations_namespace_key_uq UNIQUE (namespace, operation_key)
);

CREATE INDEX IF NOT EXISTS writeguard_operations_status_idx ON writeguard_operations(status);
CREATE INDEX IF NOT EXISTS writeguard_operations_claim_expiry_idx ON writeguard_operations(claim_expires_at);

CREATE TABLE IF NOT EXISTS writeguard_operation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES writeguard_operations(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  kind writeguard_attempt_kind NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text NOT NULL DEFAULT 'RUNNING',
  error_type text,
  error_message text,
  provider_reference text,
  CONSTRAINT writeguard_attempts_operation_number_uq UNIQUE (operation_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS writeguard_attempts_operation_idx ON writeguard_operation_attempts(operation_id);

CREATE TABLE IF NOT EXISTS writeguard_operation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sequence bigserial NOT NULL,
  operation_id uuid NOT NULL REFERENCES writeguard_operations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_status writeguard_operation_status,
  new_status writeguard_operation_status NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS writeguard_events_operation_created_idx
  ON writeguard_operation_events(operation_id, created_at);
CREATE INDEX IF NOT EXISTS writeguard_events_operation_sequence_idx
  ON writeguard_operation_events(operation_id, event_sequence);

CREATE TABLE IF NOT EXISTS writeguard_execution_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL UNIQUE REFERENCES writeguard_operations(id) ON DELETE CASCADE,
  final_status writeguard_operation_status NOT NULL,
  verified boolean NOT NULL,
  provider_reference text,
  resolution text NOT NULL,
  duplicate_execution_prevented boolean NOT NULL DEFAULT false,
  verification_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  unresolved_effects jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS writeguard_receipts_status_idx ON writeguard_execution_receipts(final_status);
