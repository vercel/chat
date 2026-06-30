---
"@chat-adapter/github": minor
---

Add Vercel Connect support to the GitHub adapter. A new `installationToken` config option (string or resolver) supplies installation access tokens directly, skipping the GitHub App private-key JWT exchange, and an optional `webhookVerifier` verifies inbound webhooks (e.g. Connect trigger-forwarded requests via a Vercel OIDC token) in place of the GitHub webhook secret. Pair with `connectGitHubAdapter()` from `@vercel/connect/chat`.

`botUserId` now also auto-detects from the `GITHUB_BOT_USER_ID` env var, and the adapter learns its bot user id from the first comment it posts. In Connect mode (where the bot user id can't be auto-detected from an installation token) set `botUserId` / `GITHUB_BOT_USER_ID` to enable self-message detection and avoid the adapter replying to its own comments.

Note: the `connectGitHubAdapter()` helper ships in `@vercel/connect` — release this adapter together with (or after) the `@vercel/connect` version that adds the `@vercel/connect/chat` subpath so the documented helper resolves.
