ALTER TABLE writeguard_operation_events
  ADD COLUMN IF NOT EXISTS event_sequence bigserial;

ALTER TABLE writeguard_operation_events
  ALTER COLUMN event_sequence SET NOT NULL;

CREATE INDEX IF NOT EXISTS writeguard_events_operation_sequence_idx
  ON writeguard_operation_events(operation_id, event_sequence);
