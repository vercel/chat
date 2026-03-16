---
"@chat-adapter/github": patch
---

Fix `removeReaction` in multi-tenant mode by lazily detecting `botUserId` via the per-installation octokit client when it wasn't set during `initialize()`
