---
"chat": minor
"@chat-adapter/teams": minor
---

Add an optional `aiGenerated` field to `PostableRaw`, `PostableMarkdown`, `PostableAst`, and `PostableCard`. When it's `true`, the Teams adapter shows Teams' "AI generated" label on the message, for new, edited, channel, and targeted messages. Other adapters ignore the field.
