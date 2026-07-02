---
"@chat-adapter/slack": patch
---

Recover expired Slack native streams with `chat.update` so buffered markdown is not dropped when Slack returns `message_not_in_streaming_state`.
