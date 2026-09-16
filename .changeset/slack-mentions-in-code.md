---
"@chat-adapter/slack": patch
---

Read the bot's mention from the message content instead of trusting the `app_mention` event type.

Slack can deliver `app_mention` for a message whose bot-id reference only appears inside code, where it renders literally and is not an invocation. The adapter now classifies the content: a `user` element for the bot outside code, or a `<@U…>` token outside code in the mrkdwn `text`, a table cell, or an attachment, is a mention. Inline code (`style.code`), preformatted blocks, and HTML-escaped tokens are literal text.

Slack mentions are user-id tokens, so a message whose content was fully inspected and holds no such token reports `isMention: false`, even when the bot's display name appears as plain text or inside code. When the adapter cannot identify the bot (`botUserId` unresolved), an `app_mention` event is still trusted and other messages stay undetermined.
