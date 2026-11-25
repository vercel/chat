---
"chat": patch
---

Close the source stream passed to `thread.post()` once the post settles. The stream wrappers given to an adapter's `stream()` and to the post and edit fallback had `next()` but no `return()`, so leaving the loop early (a `break`, a thrown error, or a failed post while streaming) never reached the cleanup in the abort handling, and the source generator stayed open with its model request still running. Both wrappers are now async generators, which pass `return()` through to the source. A source that was never read at all (the adapter's `stream()` throws or returns before reading, the placeholder post fails, or the thread is already aborted) is now closed too, so an AI SDK `ReadableStream` is cancelled instead of left running. A read still pending when the thread is aborted can delay that close, so pass the abort signal to the model call as well.
