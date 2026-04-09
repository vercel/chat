---
"@chat-adapter/linear": major
---

Add multi-tenant support in the Linear adapter using `clientId` / `clientSecret`.

The Linear adapter now exposes a `handleOAuthCallback()` function for OAuth multi-tenant support. 

Add `clientCredentials.scopes` to the Linear adapter so single-tenant client-credentials auth can request custom OAuth scopes.

Add support for agent sessions in Linear, with streaming / task / plan support.
