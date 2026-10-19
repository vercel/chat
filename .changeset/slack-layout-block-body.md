---
"@chat-adapter/slack": patch
---

Read the body of a Block Kit message from its blocks. When a message carries blocks, Slack renders them and uses `text` only as the notification fallback, so `message.text` and `message.formatted` could miss content an app or workflow placed in the blocks, including the request in a mention that reached `onNewMention`. When every block is a `section`, `header`, `context`, `image`, `divider`, `actions`, or table block, the text in those blocks now forms the body in block order, with tables in place and links from `mrkdwn` text in `message.links`. Messages with any other block type, including the `rich_text` blocks a Slack client sends, keep using `text`, so content the adapter can't render still reaches the message.
