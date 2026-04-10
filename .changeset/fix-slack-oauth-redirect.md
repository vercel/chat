---
"@chat-adapter/slack": patch
---

Fix Slack OAuth callbacks by allowing `redirectUri` to be passed explicitly during the token exchange while preserving the callback query param as a backward-compatible fallback.
