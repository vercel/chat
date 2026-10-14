---
"@chat-adapter/github": patch
---

When `installationId` is configured, new issue and pull request review comments from a different installation now get a `404` and don't reach handlers. Passing a non-numeric `installationId` in config now throws a `ValidationError`.
