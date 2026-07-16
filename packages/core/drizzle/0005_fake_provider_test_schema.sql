-- Internal deterministic test-provider storage. This migration is not packaged for adopters.
CREATE TABLE IF NOT EXISTS fake_provider_refunds (
  id text PRIMARY KEY,
  operation_id uuid NOT NULL,
  payment_intent_id text NOT NULL,
  amount integer NOT NULL,
  currency text NOT NULL,
  status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation_visible_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fake_refunds_operation_idx ON fake_provider_refunds(operation_id);
CREATE INDEX IF NOT EXISTS fake_refunds_payment_intent_idx ON fake_provider_refunds(payment_intent_id);
