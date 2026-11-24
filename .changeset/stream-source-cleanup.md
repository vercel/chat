---
"chat": patch
---

Close the source stream passed to `thread.post()` when an adapter's `stream()` stops reading early. The stream wrappers given to `stream()` and to the post and edit fallback had `next()` but no `return()`, so leaving the loop after reading at least one chunk (a `break`, a thrown error, or a failed post while streaming) never reached the cleanup in the abort handling, and the source generator stayed open with its model request still running. Both wrappers are now async generators, which pass `return()` through to the source.
