---
"@chat-adapter/telegram": minor
---

Fix Telegram rejecting messages with `Bad Request: can't parse entities` when the text contained reserved characters like `.`, `(`, `)`, `-`, `|`, `!`, `+`, `=`, `{`, `}`, `#`. This happened on almost every LLM reply because periods and parentheses appear in normal prose.

The adapter now uses `parse_mode: "MarkdownV2"` (the modern Telegram parse mode) and walks the mdast AST directly to emit properly escaped output:

- **Regular text** — escapes all 18 MarkdownV2 reserved characters: `_ * [ ] ( ) ~ \` > # + - = | { } . !`
- **Inline and fenced code** — escapes only `` ` `` and `\` (per spec)
- **Link URLs** — escapes only `)` and `\` inside the `(...)` portion
- **Formatting entities** — bold `*…*`, italic `_…_`, underline `__…__`, strikethrough `~…~`, headings render as bold
- **Lists** — bullets emitted as `\-`, ordered numerals as `N\.`
- **Thematic breaks** — emitted as `\-\-\-`

Reference: [Telegram Bot API — Formatting options](https://core.telegram.org/bots/api#formatting-options). See `packages/adapter-telegram/docs/markdown-v2.md` for the full rule set.
