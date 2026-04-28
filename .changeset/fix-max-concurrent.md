---
'chat': patch
---

fix(chat): honor `concurrency.maxConcurrent` in the `concurrent` strategy. The cap was documented but never applied, so handlers dispatched unbounded. Also warns when `maxConcurrent` is paired with a non-`concurrent` strategy (previously ignored silently) and throws on `maxConcurrent < 1` to prevent a deadlock.
