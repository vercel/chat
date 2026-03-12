---
"chat": patch
"@chat-adapter/github": patch
---

Fix GitHub adapter streaming: accumulate text and post once instead of using the fallbackStream post+edit loop, which caused 422 errors from empty body edits during TTFT. Also log fallbackStream edit failures via the Logger instead of silently swallowing them.
