---
"@chat-adapter/discord": minor
---

Update `discord-api-types` from 0.37 to 0.38 and use its types for every Discord payload instead of hand-written copies. `DiscordComponentType` and `DiscordMessageFlag` are now re-exports of `ComponentType` and `MessageFlags`, with the same values.

Type changes for TypeScript consumers of `DiscordInteractionFlagsContext`: `interaction` is now `APIChatInputApplicationCommandInteraction` and `user` is `APIUser`, so `user.avatar` and `user.global_name` are `string | null` instead of optional strings. Application command interactions other than chat input (context menu commands) now receive a 400 response instead of being treated as slash commands.

Gateway forwarding now includes the channel type and, for DM reactions, the reacting user on reaction events, so forwarded reactions in threads and DMs resolve correctly.
