# ADR 003: Durable inbox/outbox and outage recovery

## Decision

Use a unique inbound-event record and a transactional outbound outbox. Current state, history, and portal-originated outbox work commit together. Workers use leases, retries, rate limiting, and short claim/result transactions.

## Rationale

Duplicate webhooks require durable idempotency. Process restarts during a Salesforce outage must not lose outbound calls. A remote API call cannot share the local database transaction safely, so the outbox separates local commit from delivery.

## Consequences

At 20 edits/second, six hours creates 432,000 portal outbox items. At 80 requests/second and one request per edit, draining takes 90 minutes before retry overhead. This does not recover Salesforce-side changes whose webhooks were lost; those require a provider replay or query capability.

