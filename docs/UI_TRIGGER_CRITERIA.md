# UI Trigger Criteria

Milestone 4 intentionally has no management UI. CLI output, aggregate reports, receipts, and PostgreSQL inspection are sufficient until repeated external evidence proves otherwise.

Consider a UI only when all of these are true:

- At least three external pilot teams have completed shadow observation and at least two have used enforced mode.
- The same evidence-navigation task occurs weekly at all three teams.
- Each team spends at least 30 minutes per week reconstructing operation status from existing reports/receipts, or creates its own ad hoc UI.
- The required view can be defined without exposing raw provider payloads, credentials, customer identifiers, or unrestricted database rows.
- A named operator—not only the integration engineer—needs the view, and role/authorization requirements are understood.
- The CLI/export workflow cannot solve the problem with a small, maintainable change.

The first UI, if triggered, should answer one narrow question such as “which sanitized operations need review and why?” It must not become a hosted control plane, generic workflow builder, analytics warehouse, billing surface, or user-management system by default.

Until those thresholds are evidenced, UI requests belong in the weekly feedback record as observations, not roadmap commitments.
