---
"@chat-adapter/slack": patch
---

fix(slack): prefer `webhookVerifier` over `signingSecret` and `SLACK_SIGNING_SECRET`

When a `webhookVerifier` is configured, it now takes precedence over both the
`signingSecret` config field and the `SLACK_SIGNING_SECRET` env var. Previously,
a configured `signingSecret` (or env var) would shadow the verifier.
