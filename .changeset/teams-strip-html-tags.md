---
"@chat-adapter/teams": patch
---

Harden Teams HTML-to-text conversion to strip tags until the output is stable, so nested or malformed markup can't leave a partial tag behind. `stripHtmlTags` is now shared across the format and Graph message converters.
