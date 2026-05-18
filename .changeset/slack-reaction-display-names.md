---
"@chat-adapter/slack": patch
---

fix(slack): resolve reaction user display names

Slack reaction events now resolve the reacting user's display name and real name
through the existing cached user lookup path. If lookup fails, the adapter falls
back to the Slack user ID.
