---
"@chat-adapter/slack": patch
---

Attempt to repair expired text-only Slack stream segments with their confirmed Markdown content before continuing or returning the reply. Preserve segment prefixes and close unfinished code fences. Skip repair for structured task/plan content and text exceeding Slack update limits, and preserve existing recovery behavior if an update fails.
