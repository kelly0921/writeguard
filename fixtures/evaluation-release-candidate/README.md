# WriteGuard evaluation release candidate fixture

This fixture is consumed by the canonical repository command:

```text
pnpm evaluate:local
```

It is copied into a clean temporary directory and installs packed public packages. The offline journey uses a deterministic recorded GPT-5.6 evaluation fixture, an explicit separate approval artifact, a simulated refund provider, safe static verification, opt-in generated tests, the public six-scenario adapter-conformance runner, and a CI receipt policy.

The exact live GPT-5.6 payload from the sanitized 9/9 evaluation was intentionally not retained. The recorded artifact is schema-valid and provenance-bound but must not be represented as a live call. No OpenAI, Stripe, PostgreSQL, authentication, or real provider is used.
