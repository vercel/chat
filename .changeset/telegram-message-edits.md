---
"@chat-adapter/telegram": patch
"@chat-adapter/catalog": patch
---

The Telegram adapter reports `edited_message`, `edited_channel_post`, and `edited_business_message` updates to `onMessageUpdated`. It used to send edits through the new message path with the original message ID, so the Chat dedupe dropped an edit made within 10 minutes and handled a later one as a new message. Edits also started a typing indicator in private chats. Telegram sends only the new version, so `previousMessage` is `undefined`. Edits no longer start typing or run slash commands.

The catalog lists Telegram message edit events as supported.
