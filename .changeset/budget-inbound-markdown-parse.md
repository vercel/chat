---
"chat": patch
"@chat-adapter/discord": patch
"@chat-adapter/gchat": patch
"@chat-adapter/github": patch
"@chat-adapter/instagram": patch
"@chat-adapter/linear": patch
"@chat-adapter/messenger": patch
"@chat-adapter/notion": patch
"@chat-adapter/slack": patch
"@chat-adapter/teams": patch
"@chat-adapter/telegram": patch
"@chat-adapter/twilio": patch
"@chat-adapter/web": patch
"@chat-adapter/whatsapp": patch
"@chat-adapter/x": patch
---

`parseIncoming()` now skips markdown parsing for more kinds of input that are slow to parse, not just long text. Some messages under the 16,384-character limit took seconds to parse, threw a stack overflow, or produced trees too deep to serialize. Examples include unmatched `*`, `_`, or `~` in one paragraph, runs of `]` or `<`, `www.` repeated within one word, and lines that open hundreds of nested quotes or lists. Before parsing, `parseIncoming()` now also checks for more than 2,048 `*`, `_`, and `~` characters (`maxIncomingEmphasisMarkers`), more than 128 `]` characters (`maxIncomingClosingBrackets`), more than 512 `<` characters (`maxIncomingAngleBrackets`), more than 8 `www.` links in one word (`maxIncomingWwwAutolinks`), and lines nested more than 32 deep (`maxIncomingContainerMarkers`). These checks run in linear time and ignore characters inside fenced code blocks. After parsing, it checks for trees deeper than 128 levels (`maxIncomingAstDepth`), and it also falls back when `toAst()` throws a `RangeError`. When any limit is hit, the text is kept verbatim in a single text node. Converters can override `incomingFallbackText()` to clean up that text, and `exceedsIncomingBudget()` to check text they rewrite before parsing.

The Discord gateway, Instagram, Linear, Messenger, Notion, Slack, Teams history, Telegram, Twilio, Web, WhatsApp, and XChat adapters now build incoming and fetched messages with `parseIncoming()` instead of parsing them without limits, and so does GitHub `listThreads` for pull request titles. These adapters didn't limit inbound length before, so messages over 16,384 characters now also lose markdown structure in `formatted`, while keeping their content in `text`. Deeply nested quotes no longer make these adapters drop the message, return a server error, or fail a whole page of history.

Slack checks the limits once across a message's text, blocks, attachments, and table cells, checks the markdown it converts mrkdwn into, and on fallback decodes entities and renders mentions, channels, and links as parsed messages do. Discord, Google Chat, and WhatsApp check the markdown they convert platform text into. Teams checks the limits on decoded text, renders mentions and entities as plain text on fallback, and no longer backtracks for seconds on malformed links in incoming HTML.
