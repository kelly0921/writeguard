# Under-three-minute demo storyboard and voiceover

Status: owner-reviewable draft. No recording or upload is authorized.

## Thumbnail direction

Use a restrained developer-tool visual: “Unsafe retry: 2 effects” on the left, “WriteGuard: 1 guarded effect” on the right, with a small `UNKNOWN → reconcile → CONFIRMED` path. Avoid provider logos, safety shields implying certification, or “exactly once” language.

## Storyboard

| Time | Screen | Point |
|---|---|---|
| 0:00–0:20 | Title and lost-acknowledgement sequence | Consequential writes can succeed while their acknowledgement is lost. |
| 0:20–0:40 | README command | One zero-credential command runs the release candidate. |
| 0:40–1:10 | `pnpm evaluate:local` outcome | Unsafe retry creates 2 simulated effects; guarded execution creates 1. |
| 1:10–1:35 | Journey and explicit approval artifact | GPT-5.6 recommends at design time; a developer approves separately. |
| 1:35–2:05 | Verification/policy/conformance receipt | Digests, compilation, five failure scenarios, six adapter scenarios, and CI policy. |
| 2:05–2:30 | “Not verified” section | Recorded fixture, simulated provider, no production or sandbox claim. |
| 2:30–2:50 | Architecture and next step | Deterministic runtime plus reviewed provider hooks and durable storage. |
| 2:50–3:00 | Closing | Transactional reliability at the agent-tool boundary. |

## Voiceover script

“AI agents increasingly trigger consequential actions like refunds, emails, deployments, and account changes. The dangerous case is not just a failed request. It is a request that succeeds at the provider while the caller loses the acknowledgement. A normal retry can repeat the effect.

WriteGuard gives the business action a stable identity, persists an explicit unknown state, reconciles before retry, verifies the provider result, and returns a receipt.

The release candidate runs with one command and no credentials or database. Here the unsafe simulation retries after an ambiguous timeout and creates two effects. The guarded path records uncertainty, reconciles, and produces one simulated effect.

The design-time journey is tool, analyze, review, approve, generate, verify, integrate. GPT-5.6 only analyzes and recommends. This demo uses a recorded validated fixture and makes no live model call. Approval is a separate developer artifact, and runtime enforcement is deterministic.

The generator emits typed wrappers, a provider boundary, a manifest, and failure tests. Verification checks artifact digests and provenance, compiles against public packages, then explicitly opts into five manifest-owned simulated failure scenarios. The public adapter contract also passes six simulated conformance scenarios, and a versioned policy turns those receipts into a CI decision.

The limitations matter. Simulation does not prove Stripe or another real provider. The child process is not a security sandbox. Digests prove integrity, not authenticity. A durable integration still needs reviewed provider hooks, provider-specific conformance, and PostgreSQL-backed storage.

WriteGuard is a focused execution-safety layer for consequential AI-agent actions: reconcile uncertainty before a retry becomes a duplicate effect.”

## Recording checklist

- Use a fresh approved remote clone.
- Hide usernames, repository owner details if private, absolute paths, notifications, and environment variables.
- Record the real command; do not splice a failing run into a claimed pass.
- Keep the “recorded fixture,” “simulated,” and `not_run` labels visible.
- Add captions.
- Keep runtime claims classified as automated.
- Obtain owner approval before recording and separate approval before uploading to YouTube.
