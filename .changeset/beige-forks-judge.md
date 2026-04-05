---
"chat": minor
---

Fix Slack structured streaming when `thread.post(stream)` is called from a handler created by an interactive (`block_actions`) payload.
The team ID is now resolved from `team.id` in addition to `team_id` / `team`.
