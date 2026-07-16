ALTER TABLE support_cases
  DROP CONSTRAINT IF EXISTS support_cases_tenant_order_uq;

CREATE INDEX IF NOT EXISTS support_cases_tenant_order_idx ON support_cases(tenant_id, order_id);
