---
"@chat-adapter/teams": patch
---

Fix Teams Adaptive Card button clicks returning an empty invoke response, which caused Teams to retry and duplicate onAction delivery
