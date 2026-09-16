---
"@chat-adapter/slack": patch
---

Read the bot's mention from the message content instead of trusting the `app_mention` event type.

Slack can deliver `app_mention` for a message whose bot-id reference only appears inside code, where it renders literally and is not an invocation. The adapter now classifies the content the way Slack renders it: a `user` element for the bot, or a `<@U…>` token in mrkdwn content, is a mention. Inline code (`style.code`), preformatted elements, rich-text `text` elements, link labels, and `raw_text` table cells render literally and are not mentions.

When a message carries blocks, they model its body and the flattened `text` field is not consulted, because it loses the code/literal distinction. A message whose content was inspected and holds no mention reports `isMention: false`, even when the bot's display name appears as plain text. When the adapter cannot identify the bot (`botUserId` unresolved), an `app_mention` event is still trusted and other messages stay undetermined.
