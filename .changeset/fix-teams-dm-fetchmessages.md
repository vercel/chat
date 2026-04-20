---
'@chat-adapter/teams': patch
---

Fix fetchMessages 404 for DM conversations by caching the user's AAD object ID and resolving the Graph API chat ID
