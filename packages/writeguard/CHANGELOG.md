# Changelog

This project follows Semantic Versioning.

## 0.5.0 - Unreleased Build Week working version (2026-07-16)

- Added the working `writeguard analyze` command, which dynamically loads the optional `@closure/writeguard-analyzer-openai` integration and keeps machine-readable output on stdout.
- Preserved the deterministic core dependency boundary: no OpenAI SDK is included in `@closure/writeguard`.

## 0.4.0 - Unreleased Build Week working version (2026-07-16)

- Added the explicit `@closure/writeguard/analysis` subpath with `writeguard.analysis/v1` runtime-validated contracts.
- Added deterministic MCP tool normalization, provenance hashing, JSON Schema preservation, sensitive-field hints, and credential-shape rejection.
- Added the injectable analyzer boundary; no OpenAI dependency or runtime model path is included.
- Added deterministic artifact serialization/digests and a separate developer-review contract.
- Added the `writeguard normalize-mcp` CLI/bin. Analysis, generation, and verification commands remain intentionally absent.
- Preserved the existing root and `./testing` exports and all deterministic execution behavior.

## 0.3.0 - 2026-07-15

- Added the first externally packable `@closure/writeguard` facade.
- Added explicit PostgreSQL and unsafe in-memory storage factories.
- Added public migration support without example-owned support-case tables.
- Added observational shadow mode.
- Added privacy-preserving local pilot telemetry.
- Added an adapter conformance runner under `@closure/writeguard/testing`.

## Versioning policy

- Patch: compatible fixes, documentation, and verification improvements.
- Minor before 1.0: additive APIs or carefully documented type/schema changes.
- Major: breaking public API, receipt semantics, or storage compatibility.
- Database migrations are forward-only and must be safe for rolling application deployment.
- Internal workspace packages are not part of the compatibility promise.
