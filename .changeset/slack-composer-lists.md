---
"@chat-adapter/slack": patch
---

Parse bulleted and numbered lists from Slack's message composer into mdast `list` nodes, including nested items. Slack flattens these lists in `event.text` to lines starting with `•` or `◦`, so when a message's `rich_text` blocks contain a list, the adapter now builds the message body from the blocks. `message.text` for such a list reads `one\ntwo` instead of `• one\n• two`. Messages without a list, or with blocks other than `rich_text` and tables, still use `event.text`.

Link labels that contain `>` in rich text blocks, including table cells, now stay inside the link instead of ending it early.
