---
'@chat-adapter/teams': minor
---

Add a `token` config option to `TeamsAdapterConfig` for supplying a custom token factory, forwarded to the Teams SDK's `AppOptions.token`. This lets bots authenticate on runtimes that can't reach Azure IMDS (so `federated` managed identity isn't reachable) but can still mint access tokens through an external mechanism, without needing a static client secret.
