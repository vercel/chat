---
"@chat-adapter/slack": minor
---

Decode the bot's own mention in incoming Slack messages. The adapter now resolves `<@U_BOT>` to the bot's display name (`@<DisplayName>`) the same way it resolves every other user mention, instead of leaving the raw user-ID markup in place, and sets `isMention` on the parsed message by detecting the bot's ID in the raw event text. This keeps `message.text` self-describing for downstream consumers (LLM prompts, classifiers) while preserving mention detection, which previously depended on the raw ID markup surviving in the text.
