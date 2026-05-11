---
"@chat-adapter/email": minor
---

Add `@chat-adapter/email` — a single Chat SDK adapter that owns email-shaped behavior (RFC-822 threading via `Message-ID` / `In-Reply-To` / `References`, MIME composition, HTML+text rendering of cards and markdown) and delegates outbound sending and inbound webhook parsing to pluggable Email Service Provider implementations.

```ts
import { createEmailAdapter } from "@chat-adapter/email";
import { resend } from "@chat-adapter/email/providers";

createEmailAdapter({
  fromAddress: "support@yourdomain.com",
  provider: resend(),
});
```

- Built-in providers live at the `/providers` subpath:
  - `resend` (bidirectional, Svix HMAC-SHA256 verification, fetches body via the Receiving API).
  - `inbound` (bidirectional Inbound.new — token-based webhook verification, self-contained payloads, lazy-fetched attachments).
- Pass `provider:` for the simple case where one ESP handles both directions, or pass `transport:` and `inbound:` directly for mix-and-match (e.g. send via Resend, receive via Inbound).
- The main `@chat-adapter/email` entry exposes `createEmailAdapter`, `defineEmailProvider`, shared helpers for custom providers (`verifySvixSignature`, `verifySvixRequest`, `verifyConstantTimeToken`, `throwForEspError`, `parseAddress`, `normalizeHeaderKeys`), and all types — so anyone can publish a Postmark/SendGrid/Mailgun/SES provider against the same machinery.
- Includes a self-contained markdown→HTML and Card→HTML renderer with inline styles tuned for email clients. Buttons render as anchor tags driven by `callbackUrl`.
- Streaming (`stream()`) buffers chunks and sends one email at the end; edit/delete/reactions throw `NotImplementedError` (email is immutable).
