CREATE TABLE IF NOT EXISTS writeguard_shadow_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace text NOT NULL,
  operation_key text NOT NULL,
  action_name text NOT NULL,
  provider text,
  effect_type writeguard_effect_type NOT NULL,
  request_fingerprint varchar(64) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  invocation_count integer NOT NULL DEFAULT 0,
  reconciliation_attempt_count integer NOT NULL DEFAULT 0,
  latest_classification text NOT NULL DEFAULT 'not_evaluated' CHECK (
    latest_classification IN (
      'not_evaluated',
      'no_match_visible',
      'verified_external_effect',
      'external_match_unverified',
      'verification_failed',
      'ambiguous_matches',
      'reconciliation_unavailable'
    )
  ),
  latest_verified boolean,
  latest_provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT writeguard_shadow_namespace_key_uq UNIQUE (namespace, operation_key)
);

CREATE INDEX IF NOT EXISTS writeguard_shadow_last_observed_idx
  ON writeguard_shadow_observations(last_observed_at);

CREATE TABLE IF NOT EXISTS writeguard_shadow_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shadow_observation_id uuid NOT NULL
    REFERENCES writeguard_shadow_observations(id) ON DELETE CASCADE,
  invocation_number integer NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT writeguard_shadow_invocation_number_uq
    UNIQUE (shadow_observation_id, invocation_number)
);

CREATE INDEX IF NOT EXISTS writeguard_shadow_invocations_observation_idx
  ON writeguard_shadow_invocations(shadow_observation_id, invocation_number);
