---
"@chat-adapter/slack": minor
"@chat-adapter/github": minor
"@chat-adapter/linear": minor
---

Rename the typed native client getter on the Slack, GitHub, and Linear adapters to match the underlying SDK class.

- `bot.getAdapter("slack").client` is now `bot.getAdapter("slack").webClient` (returns `WebClient` from `@slack/web-api`).
- `bot.getAdapter("github").client` is now `bot.getAdapter("github").octokit` (returns `Octokit`).
- `bot.getAdapter("linear").client` is now `bot.getAdapter("linear").linearClient` (returns `LinearClient`).

The previous `.client` getter is kept as a deprecated alias on all three adapters, so existing code continues to work without changes.
