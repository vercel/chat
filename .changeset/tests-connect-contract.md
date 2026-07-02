---
"@chat-adapter/tests": minor
---

Add `connectWebhookContract`, a shared Vitest suite for verifying an adapter's Vercel Connect webhook verification. Given a small per-adapter descriptor (how to build the adapter in Connect mode and craft an inbound webhook), it asserts the behavior every Connect-capable adapter shares: a `webhookVerifier` replaces the native signature/secret check and gates inbound requests — accept (`200`) on a truthy result, reject (`401`) on a thrown error or falsy result — and is invoked with the request and raw body. Connect-capable adapters can opt in with ~10 lines.
