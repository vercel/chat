---
"@chat-adapter/teams": patch
---

Set `message.isMention` to `false` when an incoming message's mention entities do not mention the bot. It was left unset, so Chat fell back to matching `@userName` in the text, and a bot named `Bot` also handled mentions of another bot named `Bot Dev`. The mention entity ID is now compared without case, and a plain-text `@bot` without a mention entity no longer counts as a mention in group chats or channels.
