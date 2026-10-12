---
"chat": minor
"@chat-adapter/teams": minor
---

Add an optional `aiGenerated` field to `PostableRaw`, `PostableMarkdown`, `PostableAst`, `PostableCard`, `StreamingPlanOptions`, and `StreamOptions`. When it's `true`, adapters with a native AI label show it. The Teams adapter shows Teams' "AI generated" label on new, edited, channel, targeted, and streamed messages. An edit must set the flag again to keep the label. The built-in AI tools now set `aiGenerated: true` on the `markdown` and `raw` messages they post or edit.
