---
"chat": patch
---

Fix Workflow DevKit workflows failing to start with `ReferenceError: AbortController is not defined`. The default thread signal is now created on first use, and threads revived inside the workflow VM get an inert signal that never aborts.
