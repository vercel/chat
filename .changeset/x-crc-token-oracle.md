---
"@chat-adapter/x": patch
---

Restrict the X CRC challenge to the opaque token shape X sends before signing it. The endpoint previously returned an HMAC over any `crc_token`, which let a caller have an arbitrary webhook body signed and replay that as `x-twitter-webhooks-signature` on a forged POST. A webhook body is JSON and can no longer pass the token check, so a CRC response can't double as a POST event signature.
