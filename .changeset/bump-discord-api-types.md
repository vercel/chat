---
"@chat-adapter/discord": patch
---

Update `discord-api-types` from 0.37 to 0.38 and use its types for every Discord payload instead of hand-written copies. `DiscordComponentType` and `DiscordMessageFlag` are now re-exports of `ComponentType` and `MessageFlags`, with the same values. Gateway forwarding now includes the channel type and, for DM reactions, the reacting user on reaction events, so forwarded reactions in threads and DMs resolve correctly.
