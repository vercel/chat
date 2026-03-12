---
"chat": patch
"@chat-adapter/github": patch
"@chat-adapter/whatsapp": patch
---

Export `accumulateStream` utility for adapters that don't support streaming natively. Use it in GitHub and WhatsApp adapters instead of duplicated inline loops. Add `stream()` to GitHub adapter to avoid the fallbackStream post+edit loop (which caused 422 errors from empty body edits during TTFT). Log fallbackStream edit failures via the Logger instead of silently swallowing them.
