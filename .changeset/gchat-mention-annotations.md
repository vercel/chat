---
"@chat-adapter/gchat": patch
---

Set `message.isMention` from `USER_MENTION` annotations when `botUserId` is configured. It was left unset, so Chat fell back to matching `@userName` in the text, and a bot named `Bot` also handled mentions of a user named `Bot Dev`. Without `botUserId` the text fallback still applies.
