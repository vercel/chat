---
"@chat-adapter/x": minor
"chat": minor
---

remove classic direct message support from the X adapter. DMs are handled by the XChat adapter on the @chat-adapter/x/chat subpath

add the @chat-adapter/x/setup subpath for one-time provisioning: webhook registration, Activity API subscriptions, and an OAuth 1.0a signer. Subscribing is the one operation needing user context, so it prefers OAuth 1.0a and falls back to an OAuth 2.0 user token. The adapter runtime stays OAuth 2.0 only
