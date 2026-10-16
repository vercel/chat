---
"@chat-adapter/slack": patch
---

Stop treating a bot reference in inline code as a mention when the message blocks show it as plain text. Slack can keep the bot's `<@U…>` token in the `text` field of such a message and send an `app_mention` event, even though the message shows code. The adapter now reports `isMention: false` for these messages, so they no longer reach `onNewMention`.
