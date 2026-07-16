# Design-Partner Pilot Questionnaire

Do not include customer identities, credentials, confidential incident text, payment details, or production payloads. Aggregate ranges and sanitized examples are sufficient.

## Workflow

1. What external write should the pilot evaluate?
2. What business event makes two invocations the same intention?
3. What makes two similar invocations genuinely different intentions?
4. Is the workflow reversible, conditionally reversible, or effectively irreversible?
5. Can the workflow run entirely in sandbox or non-production mode?

## Current retry behavior

6. Which component retries: agent framework, queue, worker, HTTP client, operator, or provider SDK?
7. Can framework tool-call IDs change during retry, replay, or resume?
8. What timeouts or failures leave the outcome uncertain?
9. What does the application do today after an uncertain outcome?
10. How are concurrent requests for the same business intention handled?

## Idempotency and reconciliation

11. Does the provider accept idempotency keys? What is their retention window?
12. How is the current idempotency key derived?
13. Can a durable correlation marker be attached to the provider resource?
14. Which provider query can find a prior effect?
15. Can the query return zero, one, or multiple plausible matches?
16. What eventual-consistency, pagination, retention, or rate limits apply?
17. Which fields prove that the intended postcondition holds?

## Recovery and impact

18. How are uncertain actions investigated and resolved manually?
19. Which team owns the review queue?
20. Approximately how often do uncertain outcomes occur?
21. What is the impact range of a duplicate, missing, or ambiguous action?
22. How long does manual recovery typically take?
23. Are there actions that must never be retried automatically?

## Volume and architecture

24. What is the approximate daily and peak hourly volume range?
25. How many processes, workers, regions, or queues can initiate the action?
26. Which language, runtime, agent framework, and provider SDK are used?
27. Is PostgreSQL available to the service, and how are migrations deployed?
28. Is there an existing durable workflow runtime or operation ledger?

## Security and deployment

29. Which data categories must never enter WriteGuard metadata or telemetry?
30. What log, database, encryption, retention, and deletion requirements apply?
31. Is a local JSONL pilot metric file acceptable, or should telemetry be disabled?
32. Must the pilot use an isolated database or network boundary?
33. Who can approve sandbox enforcement and later rollback?
34. What evidence is required before any non-production expansion?

## Pilot success

35. What duplicate-prevention, reconciliation, and review-rate targets would make the pilot useful?
36. What integration-time or code-reduction result would justify adoption?
37. What result would falsify the WriteGuard value proposition for this workflow?
38. Who will review the weekly sanitized pilot summary?
