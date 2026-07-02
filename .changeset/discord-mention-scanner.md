---
"@chat-adapter/discord": patch
---

use the shared `replaceBareMentions` scanner for `@mention` conversion so email addresses, `@handles` inside URLs, and mentions inside code spans are no longer mangled into Discord mentions, and already-formatted `<@id>` tokens are not double-wrapped
