---
"chat": minor
"@chat-adapter/slack": minor
---

Add a `visibleTo` option to `Button` and `LinkButton` that lists the user IDs allowed to see the button. The Slack adapter renders it as `visible_to_user_ids`. Other adapters ignore it and show the button to everyone. It only hides the button, so action handlers still need to check who clicked.
