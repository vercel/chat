---
"@chat-adapter/slack": patch
---

Add streaming keepalive to prevent `message_not_in_streaming_state` errors

Slack's streaming API expires the session after ~5 minutes of inactivity. When the upstream `textStream` iterable pauses for extended periods (e.g. during long-running agent tool calls), the session expires and all subsequent `append` or `stop` calls fail with `message_not_in_streaming_state`.

The fix races each chunk from the text stream against a 2-minute keepalive timer. If no chunk arrives within 2 minutes, a zero-width-space is appended to keep the Slack session alive. No chunks are ever dropped — the same pending promise is re-raced after each keepalive.
