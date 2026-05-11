# @chat-adapter/email

[![npm version](https://img.shields.io/npm/v/@chat-adapter/email)](https://www.npmjs.com/package/@chat-adapter/email)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/email)](https://www.npmjs.com/package/@chat-adapter/email)

Email adapter for [Chat SDK](https://chat-sdk.dev). One adapter, multiple Email Service Providers.

This package owns the email-shaped behavior — RFC-822 threading via `Message-ID` / `In-Reply-To` / `References`, MIME composition, HTML+text rendering of cards and markdown — and delegates outbound sending and inbound webhook parsing to pluggable ESP providers.

## Installation

```bash
pnpm add @chat-adapter/email
```

## Usage

Providers live on the `/providers` subpath. Import the one you need and pass it to `createEmailAdapter`:

### Resend

```typescript
import { Chat } from "chat";
import { createEmailAdapter } from "@chat-adapter/email";
import { resend } from "@chat-adapter/email/providers";
import { createRedisState } from "@chat-adapter/state-redis";

const bot = new Chat({
  userName: "support-bot",
  adapters: {
    email: createEmailAdapter({
      fromAddress: "support@yourdomain.com",
      fromName: "Acme Support",
      provider: resend(),
    }),
  },
  state: createRedisState(),
});

bot.onDirectMessage(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`Thanks for emailing! You said: ${message.text}`);
});
```

### Inbound

```typescript
import { Chat } from "chat";
import { createEmailAdapter } from "@chat-adapter/email";
import { inbound } from "@chat-adapter/email/providers";
import { createRedisState } from "@chat-adapter/state-redis";

const bot = new Chat({
  userName: "support-bot",
  adapters: {
    email: createEmailAdapter({
      fromAddress: "support@yourdomain.com",
      provider: inbound(),
    }),
  },
  state: createRedisState(),
});

bot.onDirectMessage(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`Thanks for emailing! You said: ${message.text}`);
});
```

### Mix and match

You can wire one provider's `transport` to another's `inbound` when the easiest sender and the easiest inbound parser don't belong to the same ESP.

```typescript
import { createEmailAdapter } from "@chat-adapter/email";
import { inbound, resend } from "@chat-adapter/email/providers";

createEmailAdapter({
  fromAddress: "support@yourdomain.com",
  transport: resend().transport,
  inbound: inbound().inbound,
});
```

## Supported Email Service Providers

| Provider | Send | Receive | Required env vars | Notes |
|----------|:----:|:-------:|-------------------|-------|
| [Resend](https://resend.com) (`resend`) | ✓ | ✓ | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` (receive only) | Svix HMAC-SHA256 webhook verification. Body and headers are fetched via the Receiving API after the webhook fires. |
| [Inbound](https://inbound.new) (`inbound`) | ✓ | ✓ | `INBOUND_API_KEY`, `INBOUND_VERIFICATION_TOKEN` (receive only) | Constant-time `X-Webhook-Verification-Token` verification. Webhook payload is self-contained (body, headers, attachment metadata inline). Attachments are lazy-fetched via authenticated `downloadUrl`. |

Capabilities are determined by the provider's API surface; receive-only or send-only setups are first-class — pass only the directions you need. Need another ESP? See [Adding a custom provider](#adding-a-custom-provider) below — the `EmailProvider` contract is intentionally tiny so anyone can wire up Postmark, SendGrid, Mailgun, SES, etc. against the same machinery.

## Adding a custom provider

A provider is a plain object with optional `transport` and `inbound` fields. Implement either (or both) and pass it to `createEmailAdapter`:

```typescript
import { defineEmailProvider } from "@chat-adapter/email";

const myProvider = defineEmailProvider({
  transport: {
    name: "my-esp",
    async send(email) {
      // email.messageId / email.inReplyTo / email.references are already
      // composed — forward them as RFC-822 headers on your wire format.
      return { providerMessageId: "abc", raw: {} };
    },
  },
  inbound: {
    name: "my-esp",
    verifySignature(request, body) {
      // Return true if the request is authentic; false to reject with 401.
    },
    async parse(request, body) {
      // Return a ParsedInboundEmail, or null to skip (e.g. delivery events).
    },
  },
});
```

The main `@chat-adapter/email` entry also exports helpers for common provider needs:

- `verifySvixSignature` / `verifySvixRequest` — Svix-style HMAC-SHA256 webhook verification.
- `verifyConstantTimeToken` — shared-token verification (constant-time compare).
- `throwForEspError` — maps HTTP responses to typed `AdapterError` subclasses.
- `parseAddress` — RFC-822 `Name <addr@example.com>` parsing.
- `normalizeHeaderKeys` — lowercase header keys for consistent lookup.

See [`src/types.ts`](./src/types.ts) for the full `EmailTransport`, `EmailInbound`, `OutboundEmail`, and `ParsedInboundEmail` contracts.

## Threading

Email threads are rooted on the first message's `Message-ID`. Inbound messages walk the `References` and `In-Reply-To` headers to find the thread root; outbound replies always include the full `References` chain (capped at 10 entries) so mail clients group them correctly.

The thread ID format is `email:<base64url(rootMessageId)>`.

## Limitations

- **No edit / delete / reactions** — email is immutable. Calling `editMessage`, `deleteMessage`, `addReaction`, or `removeReaction` throws `NotImplementedError`.
- **No native streaming** — `stream()` buffers all chunks and sends one email at the end.
- **No @-mentions** — every inbound message in an unsubscribed thread routes to `onDirectMessage`.
- **Cards in email** — buttons render as anchor tags driven by `callbackUrl`. Inline button clicks back to the bot are not possible (no live channel).
- **1:1 conversations** — group threads (multi-recipient) are not supported.

## License

MIT
