---
"chat": patch
---

Sync bundled KB resources from Edge Config: add four new guides (Vercel Connect, the Slack Vercel Connect bot, AI Gateway + AI SDK, and the daily digest bot), refresh existing guide bodies, and regenerate `resources/templates.json`. The `sync-resources` script now fetches and validates all guides before writing (so a failed fetch leaves the tree untouched), validates the source config shape, rejects duplicate slugs, retries transient fetches, and mirrors `SKILL.md` to all four committed copies.
