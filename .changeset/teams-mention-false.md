---
"@chat-adapter/teams": patch
---

Set `message.isMention` to `false` when an incoming message's mention entities do not mention the bot. It was left unset, so Chat fell back to matching `@userName` in the text, and a bot named `Bot` also handled mentions of another bot named `Bot Dev`.
