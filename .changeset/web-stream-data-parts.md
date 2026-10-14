---
"@chat-adapter/web": minor
---

feat(web): stream task and plan updates as data parts

`task_update` and `plan_update` stream chunks, which the Web adapter used to drop, now reach `useChat` as `data-task` and `data-plan` UI message parts. A `data-task` part's `id` is the task's `id`, so each update replaces the task's earlier part in place, and its `data` is `{ id, title, status, details?, output? }`. A `data-plan` part's `id` is the assistant message ID and its `data` is `{ title }`.

A task or plan chunk closes the current text part, and text yielded after it streams into a new text part with the ID `{messageId}-{n}`. `message.parts` therefore lists text, tasks, and the plan in the order the handler yielded them. The first text part keeps the message ID, and a stream that yields only text produces the same events as before.

The new `WebUIMessage` type types `useChat<WebUIMessage>()` so `part.data` narrows by part type. `WebTaskData` and `WebPlanData` are the `data` types of the two parts.
