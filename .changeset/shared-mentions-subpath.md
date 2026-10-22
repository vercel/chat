---
"@chat-adapter/shared": minor
---

Add the `@chat-adapter/shared/mentions` subpath, which exports `maskCodeSpans` and `replaceBareMentions` without importing `chat` or any other runtime package. Runtime-free entry points, such as `@chat-adapter/slack/webhook`, can use the same code-span rules as the adapters.
