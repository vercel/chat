---
"@chat-adapter/slack": patch
---

Read the bot's mention from the message content instead of trusting the `app_mention` event type.

Slack can deliver `app_mention` for a message whose bot-id reference only appears inside code, where it renders literally and is not an invocation. The adapter now classifies the content the way Slack renders it: a `user` element for the bot, or a `<@U…>` token in mrkdwn content, is a mention. Inline code (`style.code`), preformatted elements, rich-text `text` elements, link labels, and `raw_text` table cells render literally and are not mentions.

When a message carries blocks, they model its body and the flattened `text` field is not consulted, because it loses the code/literal distinction. A message whose content was inspected and holds no mention reports `isMention: false`, even when the bot's display name appears as plain text. The synchronous `parseMessage` path classifies the same way, so the pre-edit snapshot of an edited message agrees with the edited message.

An `app_mention` event whose content never shows the known bot id is still trusted, because Slack saw a mention under an id the adapter does not know (for example the `W…` id an Enterprise Grid workspace emits). When the adapter cannot identify the bot at all (`botUserId` unresolved), `app_mention` is trusted the same way and other messages stay undetermined.

`raw_text` table cells now render literally, matching how they are classified: Slack reserves mentions and links for `rich_text` cells, so a `<@U…>` token in a `raw_text` cell no longer resolves to a display name.
