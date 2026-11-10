---
"@chat-adapter/gchat": minor
---

Expose sender email addresses on Google Chat webhook events. `message.author.email` is set on incoming messages and `event.user.email` on card button clicks, both from the `email` field Google Chat sends in the event. When the event has no email, the field stays `undefined`. Messages from Pub/Sub and `fetchMessages` still have no email, because the Chat API user resource doesn't include one.
