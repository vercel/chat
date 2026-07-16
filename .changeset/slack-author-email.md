---
"@chat-adapter/slack": minor
---

Expose sender email addresses on normalized incoming Slack message authors. `message.author.email` is populated from the same cached `users.info` lookup used for display names and requires the `users:read.email` scope; without it the field stays undefined.
