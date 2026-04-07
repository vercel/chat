---
"@chat-adapter/linear": major
---

Rework the Linear adapter for multi-tenant OAuth installs.

- Top-level `clientId` / `clientSecret` now configure multi-tenant OAuth and `handleOAuthCallback()`.
- Move single-tenant client-credentials auth to `clientCredentials: { clientId, clientSecret, scopes? }`.
- Rename env-based client-credentials auth to `LINEAR_CLIENT_CREDENTIALS_CLIENT_ID` / `LINEAR_CLIENT_CREDENTIALS_CLIENT_SECRET` and optional `LINEAR_CLIENT_CREDENTIALS_SCOPES`.
- Add installation management helpers: `setInstallation()`, `getInstallation()`, `deleteInstallation()`, and `withInstallation()`.
