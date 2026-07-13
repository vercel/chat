---
"chat": patch
"@chat-adapter/telegram": patch
---

Fix `detectMention` (and the Telegram adapter's `isBotMentioned`) falsely matching `@bot` when `@bot-dev` is mentioned. `\b` (word boundary) matches between a word character and a hyphen, so `/@bot\b/` incorrectly matches `@bot-dev`. Replaced with `(?![\w-])` to exclude hyphens.
