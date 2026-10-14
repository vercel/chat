---
"chat": minor
"@chat-adapter/web": minor
"@chat-adapter/slack": patch
---

feat: stream model reasoning with `reasoning` chunks

`StreamChunk` has a new `reasoning` type, `{ type: "reasoning", text }`, for deltas of the model's reasoning. Like `task_update` and `plan_update`, `reasoning` chunks don't count toward the posted message's text.

The Web adapter streams them to `useChat` as reasoning parts. Consecutive `reasoning` chunks fill one part, and text, a task, or a plan chunk closes it. A `reasoning` chunk also closes the current text part, so `message.parts` keeps reasoning and text in the order the handler yielded them.

Every other adapter drops `reasoning` chunks, so reasoning is never posted to a chat platform. The Slack adapter skips them instead of forwarding them to Slack's streaming API, which has no reasoning chunk type. A rejected chunk would also turn off task and plan chunks for the rest of the stream.
