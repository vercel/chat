---
"@chat-adapter/twilio": minor
"@chat-adapter/catalog": patch
---

Add WhatsApp and RCS typing indicators through Twilio's Messaging v3 Indicators API, with a `messagingApiUrl` option to override its base URL. On WhatsApp, Twilio marks the referenced message as read. `TwilioApiError` messages now include the Twilio error code and message when the response body is JSON.
