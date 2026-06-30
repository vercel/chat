---
"chat": patch
---

Fix `detectMention` falsely matching `@bot` when `@bot-dev` is mentioned. `\b` (word boundary) matches between a word character and a hyphen, so `/@bot\b/` incorrectly matches `@bot-dev`. Replaced with `(?![\w-])` to exclude hyphens.
