---
"@chat-adapter/state-pg": minor
---

Add `autoCreateSchema` to let applications provision PostgreSQL state tables and indexes through migrations. With `autoCreateSchema: false`, `connect()` issues no DDL and instead verifies that the tables and grants exist, rejecting with a descriptive error rather than failing on the first message. The complete DDL is exported as `postgresSchemaStatements` for migration tooling.
