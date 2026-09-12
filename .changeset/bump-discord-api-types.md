---
"@chat-adapter/discord": patch
---

Update `discord-api-types` from 0.37 to 0.38 and import `MessageType` from `discord-api-types/v10` instead of the deprecated `v9` entrypoint. This also dedupes the copy pulled in by `discord.js`, so only one version of the package is installed.
