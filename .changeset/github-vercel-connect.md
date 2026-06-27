---
"@chat-adapter/github": minor
---

Add Vercel Connect support to the GitHub adapter. A new `installationToken` config option (string or resolver) supplies installation access tokens directly, skipping the GitHub App private-key JWT exchange, and an optional `webhookVerifier` verifies inbound webhooks (e.g. Connect trigger-forwarded requests via a Vercel OIDC token) in place of the GitHub webhook secret. Pair with `connectGitHubAdapter()` from `@vercel/connect/chat`.

Note: the `connectGitHubAdapter()` helper ships in `@vercel/connect` — release this adapter together with (or after) the `@vercel/connect` version that adds the `@vercel/connect/chat` subpath so the documented helper resolves.
