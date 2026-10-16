---
"@chat-adapter/slack": patch
---

Parse bulleted and numbered lists from Slack's message composer into mdast `list` nodes, including nested items. Slack flattens these lists in `event.text` to lines starting with `•` or `◦`, so the adapter now builds the message body from the `rich_text` blocks when they contain a list. Messages without a list, or with blocks other than `rich_text` and tables, still use `event.text`.
