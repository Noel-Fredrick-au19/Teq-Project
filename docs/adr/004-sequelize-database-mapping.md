# ADR 004: Sequelize SQLite demo and PostgreSQL/RDS production mapping

## Decision

Use Sequelize models and migrations for both environments. The demo uses SQLite so it runs locally without AWS or an external database. Production uses PostgreSQL on RDS with the same logical entities and transaction boundaries.

## Rationale

SQLite makes the optional validation demo easy to run from a fresh checkout. PostgreSQL is required for production-scale concurrent workers, row-level locking, richer indexing, and RDS operations.

## Consequences

SQLite validates model shape, constraints, transaction intent, and scenario behavior, but not production throughput or lock contention. PostgreSQL production workers should use row-level locks and `SKIP LOCKED`; SQLite uses conservative single-writer behavior. Any dialect-specific migration must be documented and tested separately.

