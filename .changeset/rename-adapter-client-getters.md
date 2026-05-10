---
"@chat-adapter/github": minor
"@chat-adapter/linear": minor
---

Rename the typed native client getter on the GitHub and Linear adapters to match the underlying SDK class.

- `bot.getAdapter("github").client` is now `bot.getAdapter("github").octokit` (returns `Octokit`).
- `bot.getAdapter("linear").client` is now `bot.getAdapter("linear").linearClient` (returns `LinearClient`).

The previous `.client` getter is kept as a deprecated alias on both adapters, so existing code continues to work without changes.
