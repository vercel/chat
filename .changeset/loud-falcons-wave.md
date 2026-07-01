---
"@chat-adapter/telegram": patch
---

fix(telegram): stop `trimToMarkdownV2SafeBoundary` from truncating valid messages at entity-marker characters (`_`, `*`, `~`) inside link URLs. Per the MarkdownV2 spec, only `)` and `\` are special inside the `(...)` part of an inline link, so URLs with raw underscores in query parameters (e.g. `?a_b=1&c_d=2&e_f=3`) are now left intact instead of being sliced mid-URL and degraded to plain text. Hard truncation that cuts inside a link URL now trims back to before the link's `[`.
