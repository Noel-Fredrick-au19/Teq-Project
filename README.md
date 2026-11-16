# Salesforce–portal synchronization demo

This optional demo is a small deterministic validation harness for [`docs/design.md`](docs/design.md). It uses TypeScript, Node.js 20+, Sequelize, and file-backed SQLite. It does not require AWS, PostgreSQL, Salesforce, Docker, or a web UI.

## Run from a fresh checkout

```text
pnpm install
pnpm run typecheck
pnpm test
pnpm run demo
```

The scenarios cover duplicate webhook delivery, an older webhook after a newer event, field-level portal conflict rejection and different-field merging, provenance-based loop prevention, and an outbox item surviving a database close/reopen while fake Salesforce is unavailable.

The demo proves logical state transitions and restart durability only. It does not prove PostgreSQL/RDS throughput, production locking, 5-million-record capacity, real Salesforce semantics, public HTTPS delivery, or automatic reconciliation of Salesforce changes whose webhooks were lost.
