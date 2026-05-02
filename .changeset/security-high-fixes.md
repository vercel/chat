---
"@chat-adapter/shared": minor
"@chat-adapter/gchat": minor
"@chat-adapter/github": patch
"@chat-adapter/linear": minor
"@chat-adapter/slack": patch
"chat": patch
---

Security fixes for HIGH-severity findings:

- **adapter-slack**: Replace timing-unsafe `!==` with `crypto.timingSafeEqual` when validating the `x-slack-socket-token` header on forwarded socket-mode events.
- **adapter-github**: In multi-tenant App mode, eagerly auto-detect the bot user ID on the first installation client / first webhook so `isMe` checks work and self-reply loops are prevented. Falls back to `apps.getAuthenticated` + `users.getByUsername` when `users.getAuthenticated` is unavailable for installation tokens.
- **adapter-linear**: Add optional `encryptionKey` config (or `LINEAR_ENCRYPTION_KEY` env var) that AES-256-GCM-encrypts `accessToken` and `refreshToken` at rest in the state store. Tolerates plaintext records for zero-downtime rollout.
- **adapter-gchat**: Fail-closed by default — the constructor now throws `ValidationError` if neither `googleChatProjectNumber` nor `pubsubAudience` is configured. To accept unverified webhooks (development only), set the new `disableSignatureVerification: true` flag (or `GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION=true`). Mirrors the Slack adapter's signing-secret requirement.
- **adapter-shared**: New `decodeKey` / `encryptToken` / `decryptToken` / `isEncryptedTokenData` utilities (AES-256-GCM, hex or base64 32-byte keys), shared by Slack and Linear.
