---
"@chat-adapter/web": patch
---

Allow multiple Web adapters in one Chat instance via a new optional `name` config. Each adapter now uses that name as its thread ID prefix, so registering adapters under different keys (e.g. `support` and `sales`) gives them distinct thread IDs that `chat.thread()` can resolve. The default name remains `web`, so existing setups are unchanged.
