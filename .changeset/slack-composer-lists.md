---
"@chat-adapter/slack": patch
---

Parse bulleted and numbered lists from Slack's message composer into mdast `list` nodes, including nested items. Slack flattens these lists in `event.text` to lines starting with `•` or `◦`, so when a message's `rich_text` blocks contain a list, the adapter now builds the message body from the blocks. `message.text` for such a list reads `one\ntwo` instead of `• one\n• two`. Literal list text such as `---` and `[x]` stays literal, and paragraphs in subsequent rich text blocks stay outside the list.

Messages without a list, with blocks other than `rich_text` and tables, or with unsupported rich text elements still use `event.text`. This preserves references such as `message_mention` that the block renderer cannot reconstruct.

Link labels that contain `>` in rich text blocks, including table cells, now stay inside the link instead of ending it early.
