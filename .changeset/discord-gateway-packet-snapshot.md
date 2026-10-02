---
"@chat-adapter/discord": patch
---

Forward the Discord gateway packet as it arrived on the wire. Resolving a channel yields the event loop, and discord.js patches the same object in place while the handler is parked, so the webhook previously received a `member.user` field Discord never sent.
