# ADR 001: Processing architecture and component boundaries

## Decision

Use one logical synchronization service with a webhook endpoint, inbound processor, portal transaction path, and durable outbox worker. The endpoint and worker may be separate deployable processes later, but the database is the durable boundary.

## Rationale

Inbound events need validation and field application before acknowledgement. Portal edits need current state, audit history, and outbox creation in one transaction. Separating the worker from remote API calls keeps database transactions short and permits independent scaling without requiring a distributed transaction.

## Consequences

The local demo can run one process. Production can scale webhook intake and workers independently, using PostgreSQL locks for worker claims. The database schema and idempotency rules, not process memory, provide correctness.

