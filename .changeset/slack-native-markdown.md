---
"@chat-adapter/slack": minor
---

use Slack's native `markdown_text` field for outgoing markdown messages

Slack now natively renders markdown via the `markdown_text` parameter on
`chat.postMessage`, `chat.postEphemeral`, `chat.update`, and
`chat.scheduleMessage`. The adapter passes markdown through directly instead
of converting to mrkdwn, so tables, headings, fenced code blocks, blockquotes,
and other rich formatting now render natively in Slack.

- Tables are rendered by Slack natively (no more ASCII-table fallback or
  Block Kit `table` block fabrication).
- Plain `string` and `{ raw }` messages still go to the `text` field so
  literal `*` / `_` characters are preserved.
- `markdown_text` has a 12,000 character limit (vs. ~40,000 for `text`).
- The deprecated `SlackMarkdownConverter` alias has been removed; use
  `SlackFormatConverter` instead.
- `renderFormatted(ast)` now returns standard markdown instead of mrkdwn.
- Incoming `message` events are unchanged — they still arrive as mrkdwn
  and are parsed as before.
