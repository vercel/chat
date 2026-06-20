---
"chat": patch
---

Fix `TypeError: Cannot read properties of undefined (reading 'userId')` when calling `chat.thread(threadId).post(asyncIterable)` or posting a stream to a thread returned by `chat.openDM(user)`. Both lightweight-handle paths previously threaded `{} as Message` into the `ThreadImpl` constructor; the truthy empty object satisfied the `if (this._currentMessage)` branch in the streaming code path and crashed when it tried to read `this._currentMessage.author.userId`. Pass `undefined` instead so the no-current-message branch is taken — non-streaming `thread.post(stringOrPostable)` and webhook-driven paths are unaffected.
