---
"@chat-adapter/slack": patch
---

Stop treating a bot reference as a mention when the rendered message shows it only as text. Slack sends an `app_mention` event for the bot's `<@U…>` token anywhere in a message's `text` field, including inside inline code or a code block, even when the message shows no mention. The adapter now reports `isMention: false` for these messages, so they no longer reach `onNewMention`.

When an `app_mention` doesn't reference the bot's known user ID, the adapter treats it as a mention only if the rendered message shows a mention of some user outside code. This covers the `W…` IDs that Enterprise Grid workspaces can use for the bot. The same rule now applies when the bot user ID hasn't been resolved yet, where the adapter previously treated every `app_mention` as a mention.

For messages whose blocks are Block Kit rather than `rich_text`, such as a header or section posted by an integration, the adapter now reads a bot token in `text` outside code as a mention when the blocks don't show the bot. This applies to both `app_mention` and `message` events, so the two events for the same message are classified the same way.
