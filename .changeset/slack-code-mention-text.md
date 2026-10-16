---
"@chat-adapter/slack": patch
---

Stop treating a bot reference as a mention when the message blocks show it only as text. Slack sends an `app_mention` event for the bot's `<@U…>` token in a message's `text` field, including a token inside inline code or a code block, even when the rendered message shows no mention. The adapter now reports `isMention: false` for these messages, so they no longer reach `onNewMention`. A `W…` token that appears only inside code no longer counts as a mention under an id the adapter does not know.
