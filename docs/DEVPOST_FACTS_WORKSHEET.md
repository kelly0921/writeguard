# Devpost factual worksheet

Status: factual field handoff only. Not final persuasive copy and not authorization to create or submit a project.

| Field | Verified fact or placeholder |
|---|---|
| Project name | WriteGuard |
| Potential tagline facts | Stable business-operation identity; reconcile uncertainty before retry; explicit developer approval; deterministic runtime enforcement; machine-readable verification limitations |
| Category | Developer Tools |
| Repository URL | `https://github.com/kelly0921/writeguard` |
| Repository visibility | Private |
| Submitter type | Owner must select; pending |
| Country | Owner must provide; pending |
| Judge instructions | `docs/JUDGE_TESTING.md` |
| Canonical command | `pnpm install --frozen-lockfile`, then `pnpm evaluate:local` |
| Supported/validated platforms | Windows 11 locally; GitHub-hosted Windows and Ubuntu passed; macOS unvalidated |
| Node requirement | Node.js 20+; Node 24.17.0 validated |
| pnpm requirement | 11.9.0 |
| Credentials required for canonical evaluation | None |
| PostgreSQL/Docker required for canonical evaluation | No |
| Package versions | `@closure/writeguard@0.8.0`; `@closure/writeguard-analyzer-openai@0.1.1`; `@closure/writeguard-generator@0.3.1` |
| GPT-5.6 status | Optional design-time analyzer; historical sanitized live gate 9/9; canonical evaluator uses a recorded fixture and makes no live call |
| Canonical result | 2 unsafe simulated effects; 1 guarded simulated effect; policy and simulated adapter conformance passed; real-provider semantics `not_run` |
| Remote CI | Evaluation run `29592547066` passed Windows and Ubuntu; CI run `29592547198` passed Ubuntu/PostgreSQL |
| Fresh clone | Passed private `master` product commit `5a0b5956a995cd7020fb4df880ad5d68a58eced7`; evaluator 88.773 seconds |
| `/feedback` Session ID | Pending owner retrieval from the primary Codex session |
| Video URL | Pending; no recording or upload authorized |
| External tester status | 0 of 2 complete |
| Stripe status | Canonical calls: 0; fresh Iteration 6 test-mode conformance not authorized; historical founder-run test-mode demonstration is limited evidence, not production semantics |
| License | None while private; do not add one |
| Submission status | Not created or submitted by Codex |

## Judge testing instructions

```powershell
git clone https://github.com/kelly0921/writeguard.git writeguard
cd writeguard
git checkout master
pnpm install --frozen-lockfile
pnpm evaluate:local
```

Expected: two unsafe simulated effects, one guarded simulated effect, recorded GPT-5.6 recommendation-only analysis, explicit developer approval, static/generated verification `passed_with_limitations`, simulated adapter conformance and policy `passed`, and real-provider semantics `not_run`.

## Required private-repository sharing reminder

Before judging, the owner must separately authorize and complete private access for:

- `testing@devpost.com`
- `build-week-event@openai.com`

No collaborator has been added by this handoff.

## Factual source hierarchy

1. `docs/BUILD_WEEK_SUBMISSION_EVIDENCE.md`
2. `docs/BUILD_WEEK_ITERATION_6_VALIDATION.md`
3. `docs/RELEASE_CANDIDATE_MANIFEST.json`
4. `.writeguard/evaluation-report.json`
5. Named GitHub Actions run URLs

Do not convert pending fields into positive claims.
