---
"@chat-adapter/teams": patch
---

Look up users with a Graph token issued by their own tenant in `getUser()`, so users from other tenants of a multi-tenant bot are no longer resolved to `null`.
