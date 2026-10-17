---
"@chat-adapter/slack": patch
---

Read the body of a Block Kit message from its blocks. When a message carries blocks, Slack renders them and uses `text` only as the notification fallback, so `message.text` and `message.formatted` could miss content an app or workflow placed in the blocks, including the request in a mention that reached `onNewMention`. Text in `section` (including `fields`), `header`, and `context` blocks now forms the body. Messages typed in a Slack client carry `rich_text` blocks and keep using `text`.
