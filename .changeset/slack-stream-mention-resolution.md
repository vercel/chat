---
"@chat-adapter/slack": patch
---

Resolve outgoing @name mentions on the Slack native streaming path so streamed responses mention users consistently with the post-and-edit fallback. Committed renderer text is resolved incrementally, keeping fenced code literal and preserving the existing ambiguity semantics.
