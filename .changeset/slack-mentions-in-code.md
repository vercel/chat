---
"@chat-adapter/slack": patch
---

Read the bot's mention from the message content instead of trusting the `app_mention` event type.

Slack fires `app_mention` when the bot's id appears inside inline code or a code block, where it renders literally and is not an invocation. The adapter now flags a message only when its rich-text blocks contain a `user` element for the bot outside code, falling back to a code-aware scan of the mrkdwn `text` field when the event carries no rich-text block.

A message that references the bot only inside code reports `isMention: false`; a message with no bot reference at all stays undetermined so the SDK's text-based detection still applies.
