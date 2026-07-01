---
"@chat-adapter/slack": patch
---

Fix `@mention` rewriting so handles inside inline code spans (`` `@vercel/postgres` ``) and fenced code blocks (```` ``` ````) are no longer turned into `<@USER_ID>` Slack mentions. Agents printing npm package names or shell snippets previously had those handles corrupted into bot user IDs. Mention linking now skips whole code spans and code blocks; handles outside code (including the same name mentioned elsewhere in the message) still resolve normally.
