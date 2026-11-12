---
"@chat-adapter/gchat": patch
---

Set `message.isMention` from `USER_MENTION` annotations on webhook, Pub/Sub, and fetched messages. It was left unset, so Chat fell back to matching `@userName` in the text, and a bot named `Bot` also handled mentions of a user named `Bot Dev`.

When `botUserId` is configured, `isMention` is `true` only when an annotation names the bot, and a plain-text `@bot` without a mention annotation no longer counts as a mention. Without `botUserId`, a message that only mentions people reports `isMention: false`, and every other message still uses the text fallback.

Messages read from the API (`fetchMessages`, `fetchMessage`, `fetchChannelMessages`, and `listThreads`) now have the bot's mention rewritten to `@userName`, as webhook and Pub/Sub messages already did. A message that mentions the bot more than once is now rewritten at the right positions. The adapter warns at startup when `botUserId` is not a `users/...` resource name, and once when a mentioned app's ID differs from `botUserId`.
