---
"@chat-adapter/slack": patch
---

Fix duplicate mention resolution by using the replace callback offset instead of indexOf. Invalidate user cache on Slack user_change events so display name updates are picked up immediately.
