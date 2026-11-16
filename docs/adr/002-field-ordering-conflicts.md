# ADR 002: Field-level ordering and conflict resolution

## Decision

Track ordering and provenance per field. Portal saves use a server monotonic commit sequence and optimistic field versions. Salesforce events use a provider sequence/replay ID when available, otherwise `occurredAt` plus a deterministic tie-breaker under an explicit assumption.

## Rationale

Record-level last-writer-wins would lose a valid change when two users edit different fields. Field-level state allows independent fields to merge while resolving same-field conflicts deterministically.

## Consequences

Stale portal saves can return a visible conflict instead of silently overwriting. Current state may combine values from different edits, which is intentional. Provider ordering quality remains a production dependency.

