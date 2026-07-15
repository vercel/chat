---
"@chat-adapter/teams": minor
"chat": minor
---

Expose Microsoft Graph email addresses on normalized incoming Teams message authors. Resolved user profiles are cached in the state adapter (1 hour, failed lookups 5 minutes) so the lookup doesn't add a Graph call per message.
