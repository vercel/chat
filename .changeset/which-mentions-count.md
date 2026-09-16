---
"chat": patch
"@chat-adapter/linear": patch
---

Honor an adapter's definitive `isMention: false` instead of re-detecting mentions from the message text.

An adapter that reads structured platform content reports `true` or `false`, and the SDK falls back to matching `@username` in the text only when the adapter reports nothing. A definitive `false` now wins, so an adapter can suppress a mention that exists only in text its platform renders literally, such as a code sample. Adapters that previously returned `false` to mean "not detected" should return `undefined` instead.

Ordinary Linear comments are now left undetermined, so SDK text detection still applies to them.
