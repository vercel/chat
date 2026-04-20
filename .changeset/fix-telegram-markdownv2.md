---
"@chat-adapter/telegram": patch
---

Switch Telegram adapter's outbound `parse_mode` from legacy `Markdown` to `MarkdownV2`, and replace the standard-markdown passthrough renderer with a proper AST → MarkdownV2 renderer. Standard markdown (`**bold**`) and legacy `Markdown` (`*bold*`) use different syntaxes and have no shared escape rules, so any message containing `.`, `!`, `(`, `)`, `-`, `_` in regular text — which is virtually every LLM-generated message — was being rejected with `can't parse entities`. The new renderer walks the mdast tree and emits MarkdownV2 with context-aware escaping (normal text vs. code blocks vs. link URLs), uniformly applies MarkdownV2 `parse_mode` to every format-converter output (including AST messages, which previously shipped without `parse_mode` and rendered asterisks literally), and escapes card fallback text.
