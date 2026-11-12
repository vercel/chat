---
"@chat-adapter/gchat": minor
---

Expose sender email addresses on Google Chat events. `message.author.email` is set on incoming webhook messages and `event.user.email` on card button clicks, both from the `email` field Google Chat sends in the event. Pub/Sub messages, reactions, and `fetchMessages` results come from the Chat API, whose user resource has no email, so the adapter fills the field from its user cache, which holds an email once the user has sent a webhook message that included one. Without a cached email the field is `undefined`.

The user cache now keeps a stored email, avatar, and bot flag when a later event for the same user omits them, so `getUser` no longer loses the email after a Pub/Sub message or a `fetchMessages` call. An empty email is treated as missing. A display name seen only on a Pub/Sub or `fetchMessages` payload creates a cache entry when the user has none, and no longer replaces an existing one.
