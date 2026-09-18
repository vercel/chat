---
"@chat-adapter/discord": minor
---

Update `discord-api-types` from 0.37 to 0.38 and use its types for every Discord payload instead of hand-written copies. `DiscordComponentType` and `DiscordMessageFlag` keep their plain `as const` shape and member set; their values now come from `ComponentType` and `MessageFlags`.

Type changes for TypeScript consumers of `DiscordInteractionFlagsContext`: `interaction` is now `APIApplicationCommandInteraction` and `user` is `APIUser`, so `user.avatar` and `user.global_name` are `string | null` instead of optional strings. Context menu commands continue to reach `onSlashCommand` under their command name.

Gateway forwarding fixes for reactions: the forwarder now sets `channel_type`, the resolved `thread` for reactions posted in threads, and the reacting `user` for DM reactions, so the webhook side resolves threads and DM reactors without a second channel lookup. Events for the same channel are forwarded in the order the Gateway delivered them, so a quick add-then-remove no longer races. Failed channel or user lookups during forwarding are logged at warn instead of being dropped silently.

Legacy Gateway mode no longer fails slash commands and button clicks in channels discord.js has not cached (for example a first DM); the handlers fall back to `channel_id` as before.
