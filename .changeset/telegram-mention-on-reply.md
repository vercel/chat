---
"@chat-adapter/telegram": minor
---

Add `mentionOnReply`: when enabled, a reply to one of the bot's own messages reports `isMention`, so a bot in a group keeps the conversation going without the handle being repeated. Off by default, so existing mention-only bots are unaffected, and readable from `TELEGRAM_MENTION_ON_REPLY`. Implicit forum-topic replies and the bot's own echoed messages never count, and polling mode now retries the startup `getMe` lazily so a transient outage cannot leave mention detection disabled.
