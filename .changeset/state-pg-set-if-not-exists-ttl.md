---
"@chat-adapter/state-pg": patch
---

Fix `setIfNotExists()` so it can claim a cache key whose existing row has expired. Previously the query used `ON CONFLICT DO NOTHING`, so an expired row in `chat_state_cache` still blocked acquisition until opportunistic cleanup deleted it — diverging from the memory and Redis adapters, which treat expired entries as absent. Keys stored without a TTL remain permanent and are never overwritten.
