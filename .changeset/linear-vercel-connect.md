---
"@chat-adapter/linear": minor
---

Add Vercel Connect support to the Linear adapter. The `accessToken` config option now accepts a resolver (`() => string | Promise<string>`) in addition to a string, so tokens can be sourced from Vercel Connect at runtime, and a new optional `webhookVerifier` verifies inbound webhooks (e.g. Connect trigger-forwarded requests via a Vercel OIDC token) in place of the Linear webhook secret. Pair with `connectLinearAdapter()` from `@vercel/connect/chat`. Connect-mode outbound calls outside webhook handling are supported via `withInstallation(organizationId, fn)`.

Note: the `connectLinearAdapter()` helper ships in `@vercel/connect` — release this adapter together with (or after) the `@vercel/connect` version that adds the `@vercel/connect/chat` subpath so the documented helper resolves.
