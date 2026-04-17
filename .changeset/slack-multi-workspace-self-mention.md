---
"@chat-adapter/slack": patch
---

Fix self-mention detection in multi-workspace installs by using the request-scoped bot user ID instead of the adapter-level default
