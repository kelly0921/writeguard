CREATE TABLE IF NOT EXISTS support_cases (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  order_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
  refund_status text NOT NULL CHECK (refund_status IN ('NOT_REQUESTED', 'PENDING', 'CONFIRMED', 'NEEDS_REVIEW')),
  refund_operation_key text,
  refund_receipt_id uuid REFERENCES writeguard_execution_receipts(id) ON DELETE SET NULL,
  last_framework_tool_call_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS support_cases_refund_status_idx ON support_cases(refund_status);
CREATE INDEX IF NOT EXISTS support_cases_tenant_order_idx ON support_cases(tenant_id, order_id);
