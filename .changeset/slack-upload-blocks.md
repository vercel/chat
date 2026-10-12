---
"@chat-adapter/slack": minor
---

Add a `blocks` option to `uploadSlackFiles` so the message that shares the uploaded files can carry Block Kit blocks. Slack renders the files below the blocks. Passing both `blocks` and `initialComment` throws a `TypeError`, since Slack would silently ignore `blocks`.
