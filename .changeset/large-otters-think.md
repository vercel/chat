---
"@chat-adapter/gchat": minor
---

Bind Pub/Sub push verification to a specific identity with the new pubsubServiceAccountEmail option, alongside the existing audience check. Pushes are rejected unless the token email matches it. Direct webhooks are unaffected.
