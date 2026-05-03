---
"chat": minor
---

`Chat.processMessage` now returns `Promise<void>` instead of `void`, exposing the inner task so adapters can await full handler completion. The returned promise rejects if the user handler throws — required by streaming adapters such as `@chat-adapter/web` whose response body is the user handler's output and need to surface errors to the client.

Existing webhook adapters using `options.waitUntil` are unchanged: the SDK still tracks the work with errors swallowed (they're logged) so platforms don't retry on handler bugs.
