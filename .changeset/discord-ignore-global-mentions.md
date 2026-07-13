---
"@chat-adapter/discord": minor
---

Ignore `@everyone`/`@here` pings by default in gateway mode. Previously the legacy gateway listener treated global pings as bot mentions, so the bot responded to announcements. A new `respondToGlobalMentions` config option (default `false`) restores the old behavior when enabled, and also lets forwarded gateway messages opt in via the `mention_everyone` field.
