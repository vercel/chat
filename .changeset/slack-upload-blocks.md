---
"@chat-adapter/slack": minor
---

Add a `blocks` option to `uploadSlackFiles` so the message that shares the uploaded files can carry Block Kit blocks. Slack renders the files below the blocks and ignores `blocks` when `initialComment` is also set.
