---
"chat": patch
"@chat-adapter/linear": patch
---

Honor an adapter's definitive `isMention: false` instead of re-detecting mentions from the message text.

An adapter that reads structured platform content now reports `true` or `false`, and the SDK falls back to matching `@username` in the text only when the adapter reports nothing. A definitive `false` wins, so `@username` inside a code sample or quoted text no longer starts a mention handler.

Ordinary Linear comments are now left undetermined, so SDK text detection still applies to them.
