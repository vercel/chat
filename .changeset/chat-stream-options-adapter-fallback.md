---
"chat": patch
---

Pass configured fallback streaming options (`updateIntervalMs` and `fallbackPlaceholderText`) through native `adapter.stream()` calls so adapters can align their fallback behavior with `Chat` streaming config.
