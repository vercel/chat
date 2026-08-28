---
"@chat-adapter/slack": patch
---

Keep alert attachment content on normalized Slack messages. Attachments that aren't link unfurls now contribute their pretext, title (linked to `title_link` when present, with the URL also surfaced in `message.links`), text, and fields instead of being dropped; `fallback` fills in when nothing else on the attachment carries content. Matching how Slack renders these fields, they are treated as plain text unless listed in the attachment's `mrkdwn_in` array, so literal `*`, `_`, and backticks in alert text survive normalization. Tables inside attachment blocks now stay adjacent to their attachment's text.

Because attachment content is part of `message.text`, mention detection and `onMessage` pattern handlers see it too: an attachment that quotes the bot's mention routes to `onNewMention`, and patterns match alert text. Handlers that should ignore other integrations' alerts can check `message.author.isBot`.
