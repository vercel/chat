# AGENTS.md — `@chat-adapter/discord`

Guidance for coding agents working inside the Discord adapter package.
The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules — read it first. This
file documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/discord` connects a Chat SDK bot to a Discord guild via
HTTP interactions and the Discord Gateway. It covers:

- HTTP webhook endpoint at `/api/webhooks/discord` for slash commands,
  message components (buttons / selects), and modal submissions.
- Gateway transport (websocket) that listens for `MESSAGE_CREATE`,
  `MESSAGE_UPDATE`, `MESSAGE_DELETE`, `MESSAGE_REACTION_ADD`, etc., so
  the bot can react to ordinary chat messages — slash commands alone
  don't expose them.
- Embeds rendering for cards (Discord has no native card primitive,
  but embeds are the closest analogue).
- Slash commands, components, and modals via the Interactions API.
- Threaded replies, DM channels, and bulk message fetches.

Both transports run side-by-side: HTTP for interactions (low
latency, public endpoint required), Gateway for everything else (no
public endpoint required, but a long-running connection is needed —
see Gateway forwarding for serverless).

## Directory layout

```
packages/adapter-discord/
├── src/
│   ├── index.ts             # DiscordAdapter + createDiscordAdapter
│   ├── index.test.ts
│   ├── cards.ts             # PostableMessage / Card → Embed payload
│   ├── cards.test.ts
│   ├── gateway.ts           # WebSocket gateway client + forwarder
│   ├── gateway.test.ts
│   ├── markdown.ts          # DiscordFormatConverter (mdast ↔ Discord MD)
│   ├── markdown.test.ts
│   └── types.ts             # Discord API typings (raw)
├── sample-messages.md       # captured webhook + gateway events
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```

`gateway.ts` includes the serverless forwarding path — a transient
WebSocket listener that ACKs gateway events and forwards them as HTTP
requests to your existing webhook endpoint, so a single handler covers
both transports.

## Build, test, typecheck

```bash
pnpm build
pnpm dev
pnpm test
pnpm test:watch
pnpm typecheck
pnpm clean

# from repo root
pnpm --filter @chat-adapter/discord build
pnpm --filter @chat-adapter/discord test
```

Replay tests for Discord live in
`packages/integration-tests/src/replay-discord.test.ts` and consume
captured fixtures.

## Public surface

Main exports from `src/index.ts`:

- `createDiscordAdapter(config?)` — primary factory. Auto-detects
  `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`,
  and (optionally) `DISCORD_GATEWAY_FORWARDING_SECRET`.
- `DiscordAdapter` class — implements `Adapter<DiscordThreadId,
  unknown>`. Public methods: `handleWebhook`, `postMessage`,
  `editMessage`, `deleteMessage`, `addReaction`, `removeReaction`,
  `startTyping`, `openModal`, `fetchThread`, `setThreadTitle`, `listThreads`,
  `fetchMessages`, `fetchSingleMessage`, `fetchChannelInfo`,
  `postChannelMessage`, `openDM`, `startGatewayListener`.
- Configuration: `DiscordAdapterConfig`, `DiscordThreadId`.
- Helpers: `cardToEmbed`, `cardToFallbackText`,
  `DiscordFormatConverter`, `decodeThreadId`, `encodeThreadId`,
  `isDM`.

## Thread ID format

```
discord:{channelId}:{threadId}
```

`channelId` is the parent text channel; `threadId` is the
`MESSAGE_CREATE.id` of the thread root (or the channel id itself for
non-threaded replies). Both are Discord snowflakes (numeric strings),
so no encoding is needed. `isDM(threadId)` returns `true` when the
underlying channel type is `DM` or `GROUP_DM`.

## Webhook flow

`DiscordAdapter.handleWebhook(request, options)` is the single entry
point for HTTP interactions:

1. **Signature verification** — Discord signs every interaction with
   ed25519 over `timestamp + body`. Verification uses the
   `DISCORD_PUBLIC_KEY` and rejects requests with stale timestamps
   (default tolerance: 60 s).
2. **Interaction type**
   - `PING` (1) → respond with `PONG`.
   - `APPLICATION_COMMAND` (2) → `chat.handleSlashCommand`.
   - `MESSAGE_COMPONENT` (3) → `chat.handleAction` (buttons + selects).
   - `MODAL_SUBMIT` (5) → modal `onSubmit` callbacks.
   - `APPLICATION_COMMAND_AUTOCOMPLETE` (4) → `chat.handleOptionsLoad`.
3. **Deferred responses** — Discord requires a response within 3 s.
   Long handlers should return `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`
   immediately and use `editOriginalInteractionResponse` later.
4. **`waitUntil`** — heavy work runs through `waitUntil` so the
   initial response lands on time.

## Gateway transport

`DiscordAdapter.startGatewayListener(options, durationMs, …)` opens a
WebSocket gateway connection, identifies, listens for events, and
returns when the duration expires. On serverless platforms (Vercel),
schedule it via cron:

```typescript
export const maxDuration = 800;

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return adapter.startGatewayListener(
    { waitUntil: (task) => after(() => task) },
    600_000,
    undefined,
    `https://${process.env.VERCEL_URL}/api/webhooks/discord`
  );
}
```

The listener forwards each gateway event as an HTTP request to your
existing webhook URL, signed with `gatewayForwardingSecret`. This
keeps a single set of handlers serving both transports.

`gateway.test.ts` includes the `isMe` detection logic for forwarded
messages — when the bot's own `MESSAGE_CREATE` is forwarded, the
adapter must skip handler dispatch to avoid feedback loops.

## Format conversion

`DiscordFormatConverter` (in `markdown.ts`) maps:

- mdast → Discord markdown — `**bold**`, `*italic*`, `~~strike~~`,
  fenced code, blockquotes (`> …`), inline code, links via
  `[label](url)`. Mentions use `<@userId>`, channel refs `<#channelId>`,
  role refs `<@&roleId>`.
- Discord markdown → mdast — round-trips the same constructs. Custom
  emoji `<:name:id>` and animated `<a:name:id>` are preserved as
  inline `image` nodes pointing at the CDN URL.
- Tables — Discord has no native table markdown; the converter
  flattens to fixed-width text inside a code fence.

## Cards (embeds)

`cardToEmbed` translates a Chat SDK `Card` JSX tree into a Discord
[Embed](https://discord.com/developers/docs/resources/channel#embed-object):

- `<Header>` → `embed.title`.
- `<Section>` content → `embed.description` (markdown allowed).
- `<Field>` → `embed.fields[]` with `inline` set to `true` when the
  card opts in.
- `<Image>` → `embed.image.url`.
- `<Divider>` is rendered as a blank line in the description.

Buttons and selects are emitted as **components** (action rows)
attached to the message rather than inside the embed. Up to 5 buttons
per action row, up to 5 action rows per message.

`<LinkButton>` becomes a `LINK` style button (`url` set, no
custom_id). `<Button>` becomes a primary/secondary/danger button with
`custom_id = callbackId`.

## Modals

`openModal` returns a deferred response that opens a Discord modal.
Modal limits: up to 5 components, only `TEXT_INPUT` (short and
paragraph styles) and `STRING_SELECT` are accepted. Submit events
arrive as `MODAL_SUBMIT` interactions and dispatch through
`chat.handleAction` with the modal's callback id.

## Discord quirks worth remembering

- **3-second response SLA** on every interaction. Defer first, then
  follow up.
- **Slash commands must be registered** with the Discord API before
  they fire. Use the bulk-overwrite endpoint
  (`PUT /applications/{id}/commands`) on deploy, or guild-scoped for
  faster local iteration.
- **Privileged intents.** `MESSAGE_CONTENT` is privileged and must be
  enabled in the developer portal before the gateway will deliver
  message text in non-mention contexts.
- **DM channels need a recipient first.** `openDM` calls
  `POST /users/@me/channels` with `recipient_id`; the channel id is
  cached in state so subsequent `openDM(userId)` calls reuse it.
- **Webhook vs bot messages.** Webhook-posted messages are not
  attributed to the bot; for bot identity to apply, post via the bot
  token endpoint.
- **Reactions are unicode-or-custom.** Use `:emoji_name:id` for custom
  emoji; the adapter normalises common aliases (`thumbs_up` → `👍`)
  via the resolver in `cards.ts`.
- **Forwarded gateway events** include the bot's own messages — keep
  `isMe` detection in `gateway.ts` symmetric with the webhook side.

## Testing approach

- **Unit tests** colocated with each module. Card / embed parity
  tests are particularly important because Discord rejects malformed
  embeds without a useful error.
- **Replay tests** in `packages/integration-tests/src/replay-discord.test.ts`
  exercise both webhook and gateway flows, including the forwarded-
  event path.
- **Gateway shim** — `gateway.test.ts` uses a `vi.fn()` WebSocket so
  tests don't need a network connection.

When you add a new interaction type, capture a fresh fixture in
`sample-messages.md` and extend the parser tests.

## Coding conventions

- Use named exports throughout. No default exports.
- The Discord API typings live in `types.ts` — extend them rather
  than reaching for `discord-api-types` for new fields.
- Errors map to `@chat-adapter/shared` (`AuthenticationError`,
  `AdapterRateLimitError`, `NetworkError`, `ValidationError`).
- Top-level regex literals only.
- Avoid storing the bot token in instance state — pass it explicitly
  to fetch helpers so testing can stub the credentials path.

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/discord` plus `chat` if a public type changed). Sample
fixtures and AGENTS.md edits don't.

## Resources

- [Create a Discord support bot with Nuxt and Redis](https://vercel.com/kb/guide/create-a-discord-support-bot-with-nuxt-and-redis) — Walks through building a Discord support bot with Nuxt, covering project setup, Discord app configuration, Gateway forwarding, AI-powered responses, and deployment.

See all guides and templates at [chat-sdk.dev/resources](https://chat-sdk.dev/resources).

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/discord.mdx`](../../apps/docs/content/adapters/official/discord.mdx)
- README: [`packages/adapter-discord/README.md`](README.md)
- Shared error/utility helpers: [`packages/adapter-shared/src/index.ts`](../adapter-shared/src/index.ts)
- Core Adapter contract: [`packages/chat/src/adapter.ts`](../chat/src/adapter.ts)
- Sample webhook + gateway payloads: [`packages/adapter-discord/sample-messages.md`](sample-messages.md)
