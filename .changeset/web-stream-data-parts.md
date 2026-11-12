---
"@chat-adapter/web": minor
---

feat(web): stream task and plan updates as data parts

`task_update` and `plan_update` stream chunks, which the Web adapter used to drop, now reach `useChat` as `data-task` and `data-plan` UI message parts. A `data-task` part's `id` is the task's `id`, so each update replaces the task's earlier part in place, and its `data` is `{ id, title, status, details?, output? }`. A `data-plan` part's `id` is the assistant message ID and its `data` is `{ title }`.

The first chunk for a task, or the first plan chunk, closes the current text part, and text yielded after it streams into a new text part with the ID `{id}-{n}`, where `id` is the ID of the message `thread.post()` returns. `message.parts` therefore lists text, tasks, and the plan in the order the handler first yielded them. A later update to the same task or plan replaces its part in place and leaves the current text part open. The first text part keeps that ID, and a stream that yields only text produces the same events as before. A stream that yields tasks or a plan but no text no longer adds an empty text part.

The `start` chunk's `messageId` is now shared with the handler's streams, which is how `data-plan` parts get the assistant message ID. `stream()` returns a `raw` message that lists the streamed parts.

The new `WebUIMessage` type, exported from `@chat-adapter/web/react`, `/vue`, and `/svelte`, types `useChat<WebUIMessage>()` so `part.data` narrows by part type. The server entry exports `WebTaskData` and `WebPlanData`, the `data` types of the two parts, and `WebDataParts`, which maps part names to them.

With `protocol: "ag-ui"`, task and plan updates stream as `CUSTOM` events named `task` and `plan`, with the chunk minus its `type` as `value`.
