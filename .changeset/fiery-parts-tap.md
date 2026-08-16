---
"@chat-adapter/slack": patch
---

preserve pasted Slack tables in parsed message content: `table` and `data_table` blocks become structured table nodes in `message.formatted` and tab-separated text in `message.text`. Table cells render mentions, channels, and links through the same mrkdwn converter as body text, unfurl and app attachments are excluded, date cells without a fallback are formatted from their timestamp, and tables pasted above the message text stay above it. Headerless pasted tables get an empty header row so GFM re-serialization doesn't promote the first data row to a header. `SlackEvent.blocks` is now typed with the exported `SlackMessageBlock` interface.
