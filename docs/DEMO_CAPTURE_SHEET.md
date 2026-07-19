# WriteGuard demo capture sheet

Status: capture plan only. No recording, upload, or publication is authorized. Target final edit: under three minutes.

Use a disposable approved private clone. Hide the repository owner if required, absolute paths, usernames, notifications, environment variables, package-manager cache paths, and any unrelated terminal history. Keep `recorded_fixture`, `simulated`, `passed_with_limitations`, and `not_run` visible.

| Capture | Command or screen | Expected sanitized output | Screen time | Supported claim | Hide or avoid | Mode |
|---|---|---|---:|---|---|---|
| Launch canonical evaluation | `pnpm evaluate:local` | Stage messages for pack/install, normalize/analyze/approve/generate, static verify, explicit generated tests, policy, integration simulation, conformance, and report rendering | 5-8s | One documented zero-credential evaluation drives the complete journey | Cache paths and unrelated install output | Live command entry; pre-record the completion wait |
| Unsafe duplicate effect | `Get-Content .writeguard/evaluation-summary.md` | `Unsafe simulated external effects: 2` | 6-8s | Blind retry can duplicate the demonstrated simulated action | Do not imply real refunds or universal behavior | Pre-recorded result from the real run |
| GPT-5.6 risk analysis | `$r=(ConvertFrom-Json -InputObject (Get-Content -Raw .writeguard/evaluation-report.json)).report; ConvertTo-Json -InputObject $r.analysis` | Model `gpt-5.6`, source `recorded_fixture`, `liveCall: false`, status `recommendation_only` | 8-10s | GPT-5.6 is design-time and the canonical demo is recorded/offline | Any historical key workflow or raw model payload | Live read of retained sanitized receipt |
| Developer approval boundary | `ConvertTo-Json -InputObject $r.developerApproval` | State `approved`, `approvalWasInferred: false`, reviewer `evaluation-maintainer` | 7-9s | A developer approves separately; the model does not approve | Do not present the evaluation maintainer as an external tester | Live read |
| Generated wrapper/test summary | `ConvertTo-Json -InputObject $r.generation` | Manifest digest and 10 generated files including wrapper, provider boundary, manifest, bundle, and failure test | 8-10s | Generation emits bound typed integration artifacts and tests | Long digests may be visually cropped, not altered | Live read |
| Static verification command state | Reuse the `pnpm evaluate:local` stage line `run safe static verification` | Static verification stage completes before generated-test execution | 4-6s | Static checks and code execution are separate boundaries | Do not call the child process a sandbox | Pre-recorded terminal stage |
| Static verification receipt | `$s=ConvertFrom-Json -InputObject (Get-Content -Raw .writeguard/evaluation-static-verification.json); ConvertTo-Json -InputObject $s.receipt -Depth 6` | Mode `safe_static`, result `passed_with_limitations`, verified levels and limitations | 10-12s | Integrity, provenance, provider shape, and controlled compilation passed with declared limits | Avoid scrolling raw paths; the retained receipt should contain none | Live read |
| Explicit generated tests | `$g=ConvertFrom-Json -InputObject (Get-Content -Raw .writeguard/evaluation-generated-test-verification.json); ConvertTo-Json -InputObject $g.receipt -Depth 6` | Mode includes generated tests; result `passed_with_limitations`; real-provider level `not_run` | 10-12s | Manifest-owned simulated failure tests ran only after explicit opt-in | Do not imply secure isolation or real-provider proof | Live read |
| One guarded effect | Return to `.writeguard/evaluation-summary.md` | `Guarded simulated external effects: 1` | 6-8s | The guarded path creates one effect in the declared simulation | Keep `simulated` visible | Pre-recorded result |
| Policy and adapter summary | `Get-Content .writeguard/evaluation-policy.json`; then `Get-Content .writeguard/evaluation-adapter-conformance.json` | Policy `passed`; six scenarios `passed`; provider environment `simulated` | 10-14s | The receipt meets named CI requirements and the simulated adapter passes six scenarios | Do not imply provider certification | Live read or tightly pre-recorded scroll |
| Test and remote validation summary | Show `docs/BUILD_WEEK_SUBMISSION_EVIDENCE.md` sections 15 and 17 | 172 unit, 20 integration, 5 generated, 6 conformance, 6 pilot; Windows/Ubuntu/PostgreSQL links | 8-10s | Test totals and remote CI are traceable | Hide private browser/account chrome if opening GitHub | Pre-recorded document view |
| Architecture view | IDE tree: `packages/writeguard`, `packages/analyzer-openai`, `packages/generator`; optionally `docs/ARCHITECTURE.md` | Optional analyzer separated from deterministic runtime/generator | 8-10s | GPT-5.6 is not in runtime enforcement | Avoid unrelated local files and ignored `.env` files | Pre-recorded IDE view |
| Limitations/close | `.writeguard/evaluation-summary.md`, `Not verified` section | No live call, simulated provider, not a sandbox, durable storage/provider validation still required | 10-12s | The product makes its evidence boundary visible | Do not crop away the limitations | Pre-recorded result |

Suggested edited sequence:

1. Problem/lost acknowledgement: 15 seconds.
2. Launch and journey: 15 seconds.
3. Unsafe 2 versus guarded 1: 25 seconds.
4. Recorded GPT-5.6 plus explicit approval: 25 seconds.
5. Generation and verification receipts: 45 seconds.
6. Policy/conformance/test/remote evidence: 25 seconds.
7. Limitations and next provider step: 25 seconds.

The canonical run may take up to two minutes after installation. Record the real run once, preserve its unedited completion state, and accelerate only dead time in the final edit with a visible time-compression label.
