---
"@chat-adapter/slack": patch
---

Fix Slack native streaming losing reply text after structured chunks. Once a stream segment had appended `plan_update` or `task_update` chunks, later text deltas were still sent through the `markdown_text` parameter, which Slack rejects with `streaming_mode_mismatch` in chunk mode, so the text never appeared in the final message. Text deltas on a segment that has appended structured chunks — including a segment opened by rotation, which replays the plan and open tasks — are now sent as `markdown_text` chunks. Text sent before any structured chunk is unchanged.
