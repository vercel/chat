---
"@chat-adapter/gchat": patch
---

Set `message.isMention` from `USER_MENTION` annotations when `botUserId` is configured. It was left unset, so Chat fell back to matching `@userName` in the text, and a bot named `Bot` also handled mentions of a user named `Bot Dev`. When `botUserId` is configured, a plain-text `@bot` without a mention annotation no longer counts as a mention. Without `botUserId` the text fallback still applies.
