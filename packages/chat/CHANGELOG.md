# chat

## 4.34.0

### Minor Changes

- 1721fa0: Add support for Slack's Agent messaging experience (`agent_view`).

  - New core event `onAppContextChanged` with a normalized `AppContextEntity[]` describing the user's active view (channel / canvas / list / message / unknown).
  - `AppHomeOpenedEvent` now carries the folded active-view context as `entities` and the opened `tab` (Slack: `"home"` / `"messages"`), so handlers can tell a Home-tab open from the DM-open signal under `agent_view`.
  - Slack adapter: new `agentView` config flag (under `agent_view`, `app_home_opened` is the DM-open signal regardless of tab and folded context is surfaced), routing for the `app_context_changed` event, and a `getAppContext(message)` helper to read the folded context on DM messages.
  - `setSuggestedPrompts` now accepts an optional thread reference (agent_view lets prompts sit at the top of the agent conversation).
  - Under `agentView`, DM (Messages-tab) messages are threaded per new Slack's model — each user message is a thread root (`thread_ts ?? ts`). Conversation-scoped threads returned by `openDM()` keep working: when that thread is subscribed, incoming top-level DM messages route to it.
  - `createSlackAdapter` env auth fallback (`SLACK_BOT_TOKEN` / `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`) is now disabled only when an auth or verification field (`botToken`, `clientId`, `clientSecret`, `installationProvider`, `signingSecret`, `webhookVerifier`) is passed explicitly, instead of by any config object — so `createSlackAdapter({ agentView: true })` still picks up env credentials, while explicit-secret configs stay immune to ambient env vars.
  - Bumped `@slack/web-api` to `^7.18.0` (adds the optional `thread_ts` typing for `setSuggestedPrompts`).

- 4717a38: Add chart support and richer table rendering, with native Slack data table and data visualization blocks.

  - New core `ChartElement` and `Chart()` builder (JSX supported) with pie, bar, area, and line charts, mirroring Slack's data visualization model: pie charts take `segments`, series charts take named `series` plotted against shared `categories` with optional `xLabel`/`yLabel`.
  - `TableElement` / `Table()` gain optional `caption` (accessible table description) and `pageSize` (rows per page) fields.
  - Charts degrade gracefully on platforms without native chart support: the underlying data renders as a text table via the shared card fallback (new `chartElementToFallbackText` helper).
  - Slack adapter: card tables now render as [data table blocks](https://docs.slack.dev/reference/block-kit/blocks/data-table-block) by default — paginated and sortable — instead of plain table blocks. Header-only tables keep the plain table block; tables exceeding Slack limits (100 data rows, 20 columns, 10,000 characters) fall back to ASCII as before.
  - Slack adapter: card charts render as [data visualization blocks](https://docs.slack.dev/reference/block-kit/blocks/data-visualization-block). Charts violating Slack constraints (50-character title, 12 segments/series, 20 categories, 20-character labels, one data point per category, max 2 charts per message) fall back to a text rendering instead of being rejected by the API.
  - The `@chat-adapter/slack/blocks` subpath gets the same treatment: `SlackChartElement` types, `chart` card children, data table rendering, and matching limits.
  - `postMessage` now surfaces Slack's per-block validation details when the API rejects blocks (`invalid_blocks`), instead of the bare "An API error occurred" message.

- 6714efc: Support AI SDK v7 as a peer dependency.

  - `chat` now accepts `ai@^6.0.182 || ^7.0.0` (`chat/ai` tools work with both majors).
  - `@chat-adapter/web` now accepts `ai@^6 || ^7`, `@ai-sdk/react@^3 || ^4`, `@ai-sdk/svelte@^4 || ^5`, and `@ai-sdk/vue@^3 || ^4`.
  - The `chat/ai` tool factories now declare explicit `Tool<Input, Output>` return types instead of relying on inference, so the published declarations no longer depend on `ai` internals that changed in v7. The public type surface is unchanged.

### Patch Changes

- 5c926f1: Preserve markdown structural whitespace when extracting normalized message text.
- 2531a42: Fix `detectMention` (and the Telegram adapter's `isBotMentioned`) falsely matching `@bot` when `@bot-dev` is mentioned. `\b` (word boundary) matches between a word character and a hyphen, so `/@bot\b/` incorrectly matches `@bot-dev`. Replaced with `(?![\w-])` to exclude hyphens.

## 4.33.0

### Minor Changes

- ef2542c: add X (Twitter) adapter: reply to public mentions, send and receive direct messages, post and edit from the bot account, and like posts, using the X API v2 with OAuth 2.0 and managed token refresh

### Patch Changes

- 3abdc69: docs(adapters): add Cloudflare Agents as a vendor-official state adapter (`agents/chat-sdk`) to the catalog and docs listing. It is hidden from the create-chat-sdk CLI (Worker/Durable Objects runtime), and the interactive state picker now filters out CLI-incompatible state adapters.
- 0b63791: Raise the default message dedupe TTL from 5 to 10 minutes so it outlives the longest platform redelivery window. Slack's Events API retries up to ~5 minutes after the original delivery — exactly at the old TTL boundary, where a retried event could miss the expired dedupe entry from its first processing and be handled twice. Configurable behavior is unchanged (`dedupeTtlMs` still overrides).
- 0c761f1: docs(adapters): add Dial as a vendor-official adapter (`@getdial/chat-sdk-adapter`) to the catalog, docs listing, and CLI scaffold spec
- 24a04d5: docs(adapters): add Photon as a vendor-official adapter (`@photon-ai/chat-adapter-imessage`) to the catalog, docs listing, and CLI scaffold spec
- 076fe5d: preserve skipped mention routing for debounce and message patterns

## 4.32.0

### Minor Changes

- 2e47351: Add `autoCompletePrevious` option to `Plan.addTask()`. Defaults to `true` so sequential workflows keep auto-completing existing in-progress tasks; pass `false` to keep multiple tasks in progress for parallel execution.

### Patch Changes

- eccc6b9: detect bot mentions in skipped queue and burst messages
- 438f551: Fix lightweight thread handles so streaming posts without an incoming message context no longer crash.
- d034b8b: docs(adapters): add Linq as a vendor-official adapter (`@linqapp/chat-sdk-adapter`) to the catalog, docs listing, and CLI scaffold spec
- 06af3e1: docs(adapters): add Novu as a vendor-official adapter (`@novu/chat-sdk-adapter`) to the catalog, docs listing, and CLI scaffold spec
- efa9610: Sync bundled KB resources from Edge Config: add four new guides (Vercel Connect, the Slack Vercel Connect bot, AI Gateway + AI SDK, and the daily digest bot), refresh existing guide bodies, and regenerate `resources/templates.json`. The `sync-resources` script now fetches and validates all guides before writing (so a failed fetch leaves the tree untouched), validates the source config shape, rejects duplicate slugs, retries transient fetches, and mirrors `SKILL.md` to all four committed copies.

## 4.31.0

### Minor Changes

- 778ae69: Add a zero-dependency `chat/adapters` catalog subpath for official and vendor-official adapter metadata, environment specs, and setup helpers.
- 171657a: Adding support for stable IDs to link button action handlers

## 4.30.0

### Minor Changes

- 5461ea9: Add native Telegram private chat draft streaming with fallback streaming elsewhere.

## 4.29.0

### Minor Changes

- ac8a207: Add `chat/ai` subpath as the home for AI utilities, including `createChatTools` for the Vercel AI SDK and `toAiMessages` for converting chat history into AI SDK prompts.

  `createChatTools` exposes Chat SDK operations as ready-to-use AI SDK tools so an agent can read messages, post replies, send DMs, react, edit, delete, and manage thread subscriptions across every adapter the supplied `Chat` instance has registered. Write operations require user approval by default and can be toggled globally or per-tool via `requireApproval`. Three presets (`reader`, `messenger`, `moderator`) scope the toolset, and tools can also be cherry-picked from the same subpath.

  `toAiMessages` (and the `AiMessage` / `AiMessagePart` / `ToAiMessagesOptions` types) now ship from `chat/ai` alongside the tools — keeping the optional `ai` and `zod` peer dependencies out of bundles that don't use them. The previous `chat` re-exports continue to work, but are marked `@deprecated` so editors surface a hint pointing at `chat/ai`; existing code keeps compiling, and migrating is a single import-path change.

- b75eedb: add burst concurrency strategy

### Patch Changes

- e60bc8c: chore: set supported Node versions in engines

## 4.28.1

### Patch Changes

- 0cc3d06: fix StreamEvent type from step-finish to finish-step

## 4.28.0

### Minor Changes

- eb5f94a: add message.subject for resolving parent issues and PRs from webhook messages, expose typed platform client via adapter.client
- c1cd9b5: Add `callbackUrl` to `Button` and `Modal`. When a button is clicked or a modal is submitted, the SDK POSTs the action payload to `callbackUrl` in addition to firing any registered `onAction` / `onModalSubmit` handler. This pairs naturally with webhook-based workflow engines for awaitable button/modal flows.

  Supported platforms: Slack, Teams, Google Chat, WhatsApp, Telegram, and Discord.

- 46d183b: Rename `messageHistory` → `threadHistory` (with backwards compatibility).

  The per-thread history cache was previously named `messageHistory`, which collides conceptually with the new cross-platform per-user Transcripts API. Renamed to `threadHistory` to make the distinction clear.

  **Renamed:**

  - `ChatConfig.messageHistory` → `ChatConfig.threadHistory`
  - `Adapter.persistMessageHistory` → `Adapter.persistThreadHistory`
  - `MessageHistoryCache` → `ThreadHistoryCache`
  - `MessageHistoryConfig` → `ThreadHistoryConfig`
  - File `message-history.ts` → `thread-history.ts`

  **Backwards compatibility:**

  - The old `ChatConfig.messageHistory` field is still read; `threadHistory` takes precedence when both are set.
  - The old `Adapter.persistMessageHistory` flag is still read; either flag being `true` enables persistence.
  - `MessageHistoryCache` and `MessageHistoryConfig` are re-exported as deprecated aliases of the new names.
  - The state-adapter storage key prefix (`msg-history:`) is **unchanged** — renaming it would silently orphan existing data.

  The `@chat-adapter/telegram` and `@chat-adapter/whatsapp` adapters now use `persistThreadHistory`. Custom adapters built against `persistMessageHistory` continue to work unchanged.

- 46d183b: Add Transcripts API for cross-platform per-user message persistence.

  `bot.transcripts` (when configured via `ChatConfig.transcripts` + `ChatConfig.identity`) provides `append` / `list` / `count` / `delete` keyed by a stable cross-platform user key. Backed by the existing `StateAdapter.appendToList` primitive, so every built-in state adapter (`memory`, `redis`, `ioredis`, `pg`) supports it with no changes.

  - `IdentityResolver` runs once per inbound message during dispatch; the result is cached on the `Message` instance as `message.userKey`.
  - Distinct from the existing per-thread `threadHistory` config (which backfills thread context for adapters that lack server-side history).
  - `delete` wipes every stored entry under a user key. Single-entry and time-range deletes are not part of this API — the underlying `appendToList` primitive can't support them safely under concurrent writes.

- 3490a8c: Add **`@chat-adapter/web`** — a new platform adapter that lets a chat-sdk bot serve a browser chat UI alongside Slack/Teams/Discord, without writing any client-side glue.

  The adapter speaks the [AI SDK UI message stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol), so [`@ai-sdk/react`](https://www.npmjs.com/package/@ai-sdk/react)'s `useChat` and the [`ai-elements`](https://elements.ai-sdk.dev/) component library work out of the box. The same `bot.onDirectMessage(...)` handler fires for both web and other platforms — including stream-based replies via `thread.post(stream)`.

  Two subpath exports:

  - `@chat-adapter/web` — server-side `createWebAdapter({ userName, getUser })` that produces an `Adapter` for the `Chat` constructor.
  - `@chat-adapter/web/react` — thin client wrapper exposing `useChat()` preconfigured with `DefaultChatTransport`. Re-exports `UIMessage` and `UseChatHelpers` types.

  ```ts
  // server
  const bot = new Chat({
    userName: "mybot",
    adapters: {
      web: createWebAdapter({
        userName: "mybot",
        getUser: (req) => ({ id: getUserIdFromCookie(req) }),
      }),
    },
    state: createMemoryState(),
  });
  export const POST = bot.webhooks.web;
  ```

  ```tsx
  // client
  import { useChat } from "@chat-adapter/web/react";
  const { messages, sendMessage, status } = useChat();
  ```

  v1 covers text + markdown, native streaming, DM-style routing (`isDM: true`), persisted message history (`persistMessageHistory: true` by default — required for `channel.messages` since web has no platform history API), and abort propagation via `request.signal`. Out of scope for v1: cards/JSX rendering, reactions, modals, file uploads, edit/delete, and multi-tab proactive push.

### Patch Changes

- 9824d33: Security fixes for HIGH-severity findings:

  - **adapter-slack**: Replace timing-unsafe `!==` with `crypto.timingSafeEqual` when validating the `x-slack-socket-token` header on forwarded socket-mode events.
  - **adapter-github**: In multi-tenant App mode, eagerly auto-detect the bot user ID on the first installation client / first webhook so `isMe` checks work and self-reply loops are prevented. Falls back to `apps.getAuthenticated` + `users.getByUsername` when `users.getAuthenticated` is unavailable for installation tokens.
  - **adapter-linear**: Add optional `encryptionKey` config (or `LINEAR_ENCRYPTION_KEY` env var) that AES-256-GCM-encrypts `accessToken` and `refreshToken` at rest in the state store. Tolerates plaintext records for zero-downtime rollout.
  - **adapter-gchat**: Fail-closed by default — the constructor now throws `ValidationError` if neither `googleChatProjectNumber` nor `pubsubAudience` is configured. To accept unverified webhooks (development only), set the new `disableSignatureVerification: true` flag (or `GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION=true`). Mirrors the Slack adapter's signing-secret requirement.
  - **adapter-shared**: New `decodeKey` / `encryptToken` / `decryptToken` / `isEncryptedTokenData` utilities (AES-256-GCM, hex or base64 32-byte keys), shared by Slack and Linear.

## 4.27.0

### Minor Changes

- 1e7c551: restore attachment fetchData after queue/debounce serialization
- b0ab804: Bundle guide markdown and a templates manifest with the package so AI agents can discover Chat SDK resources without fetching at runtime. Guides are written to `resources/guides/*.md` and templates to `resources/templates.json` by the root-level `pnpm sync-resources` script.
- b9a1961: Switch Telegram adapter's outbound `parse_mode` from legacy `Markdown` to `MarkdownV2`, and replace the standard-markdown passthrough renderer with a proper AST → MarkdownV2 renderer. Standard markdown (`**bold**`) and legacy `Markdown` (`*bold*`) use different syntaxes and have no shared escape rules, so any message containing `.`, `!`, `(`, `)`, `-`, `_` in regular text — which is virtually every LLM-generated message — was being rejected with `can't parse entities`. The new renderer walks the mdast tree and emits MarkdownV2 with context-aware escaping (normal text vs. code blocks vs. link URLs), uniformly applies MarkdownV2 `parse_mode` to every format-converter output (including AST messages, which previously shipped without `parse_mode` and rendered asterisks literally), and escapes card fallback text.

  Also fix silent message truncation that the MarkdownV2 migration widened from a rare bug into a reliable 400. The previous truncator sliced messages at 4096/1024 chars and appended literal `...`, but in MarkdownV2 `.` is a reserved character that must be escaped, the slice can leave an orphan trailing `\`, and it can cut through a paired entity (`*bold*`, `` `code` ``) leaving it unclosed — all of which cause `can't parse entities`. The two truncate methods are unified into `truncateForTelegram(text, limit, parseMode)`, which appends an escaped `\.\.\.` for MarkdownV2 and walks back past unbalanced entity delimiters or orphan backslashes before appending. Plain-text messages keep literal `...`.

  Internal typing hardening: `renderMarkdownV2` is now typed exhaustively on mdast's `Nodes` union with a `never` assertion, so new mdast node types fail the build rather than silently falling through. Introduce `TelegramParseMode = "MarkdownV2" | "plain"` replacing the previous `string | undefined` at call sites, with `toBotApiParseMode` mapping to the Bot API wire format at the boundary. The `chat` package gains a re-export of mdast's `Nodes` union so adapters can build exhaustively typed renderers without importing mdast directly.

- a520797: Add `chat.getUser()` method and `UserInfo` type for cross-platform user lookups. Implement `getUser` on Slack, Discord, Google Chat, GitHub, Linear, and Telegram adapters.
- 70281dc: add initialOption and option_groups support for ExternalSelect
- 9093292: add streaming options to thread.post() with platform-specific namespacing
- 7e90d9c: Add Socket Mode support for environments behind firewalls that can't expose public HTTP endpoints, and add `{ action: "clear" }` modal response to close the entire modal view stack
- bca4792: Allow `task_update` streaming chunks to include optional `details` text for Slack task cards
- 37dbb4a: Add `thread.getParticipants()` to get unique human participants in a thread
- 608d5f0: Add `chat.thread(threadId)` method to create Thread handles outside of webhook contexts
- a179b29: Implement external_select block kit for Slack
- a8f2aab: Allow `plan.updateTask()` to target a specific task by ID via `{ id: taskId }` instead of always updating the last in_progress task

### Patch Changes

- 8a0c7b3: Fix Slack structured streaming when `thread.post(stream)` is called from a handler created by an interactive (`block_actions`) payload.
  The team ID is now resolved from `team.id` in addition to `team_id` / `team`.
- d630e6c: fix(chat): honor `concurrency.maxConcurrent` in the `concurrent` strategy. The cap was documented but never applied, so handlers dispatched unbounded. Also warns when `maxConcurrent` is paired with a non-`concurrent` strategy (previously ignored silently) and throws on `maxConcurrent < 1` to prevent a deadlock.

## 4.26.0

### Minor Changes

- 2235c16: export standalone reviver for workflow-safe deserialization without adapter dependencies

### Patch Changes

- ddb084b: guard fallback streaming against empty post and edit calls

## 4.25.0

### Minor Changes

- 2700ce8: Allow Slack native streaming to send markdown tables without wrapping them in code fences, while preserving the previous append-only table fallback for other consumers.

## 4.24.0

### Minor Changes

- 4f5d200: Add Teams dialog (task module) support with `actionType: "modal"` on buttons and `onOpenModal` webhook hook

### Patch Changes

- 8d89274: fix: disable source maps in published packages
- 27b34e1: Use adapter to parse channel id for `thread.channelId`

## 4.23.0

### Minor Changes

- 4166e09: Add `channelVisibility` enum to distinguish private, workspace, external, and unknown channel scopes. Implements `getChannelVisibility()` on the Adapter interface and Slack adapter, replacing the previous `isExternalChannel` boolean.

## 4.22.0

### Minor Changes

- f2d8957: Implement new concurrency strategies for overlapping messages

## 4.21.0

### Minor Changes

- e45a67f: Add optional `disconnect()` hook to the Adapter interface, called during `chat.shutdown()` for resource cleanup

### Patch Changes

- 13ba1c7: Fix `fromFullStream()` step separator detection for AI SDK v5+: rename `step-finish` event check to `finish-step`
- 95fd8ce: Add missing `toJSON()` method declarations to `Thread` and `Channel` interfaces to match their implementations.

## 4.20.2

## 4.20.1

### Patch Changes

- e206371: new toAiMessages API for history-to-AI-SDK transformation. And introduces LinkPreview object on Message
- 8d88b8c: Fix GitHub adapter streaming: accumulate text and post once instead of using the fallbackStream post+edit loop, which caused 422 errors from empty body edits during TTFT. Also log fallbackStream edit failures via the Logger instead of silently swallowing them.

## 4.20.0

## 4.19.0

### Minor Changes

- eb49b2a: Add `forceReleaseLock` to StateAdapter and `onLockConflict` config option for interrupt/steerability of long-running handlers
- 5b41f08: Add `thread.schedule()` and `ScheduledMessage` type for scheduling messages to be sent at a future time. Slack adapter implements scheduling via `chat.scheduleMessage` API with `cancel()` support.
- c4b0e69: Tighten Adapter & StateAdapter interfaces: make `channelIdFromThreadId` required, make `EphemeralMessage` generic over `TRawMessage`, add `satisfies Adapter` to mock adapter, migrate remaining adapters to shared error types

## 4.18.0

### Patch Changes

- a3cfc1a: AI SDK6 compat fixes and support for native slack tables

## 4.17.0

### Patch Changes

- cc65dc3: fix: non-atomic message deduplication causes app_mention events to be silently dropped

## 4.16.1

### Patch Changes

- 130e780: Fix openModal crash when action has no thread context (e.g. home tab buttons)
- ff954f9: Better streaming for AI SDK
- f27c89b: Improve StreamChunk type safety with discriminated union and fix url_verification security bypass

## 4.16.0

### Minor Changes

- 02e7ef6: Implements table markdown rendering, and fully streaming markdown rendering including for Slack which has native streaming. Overhauls adapters to have better fallback-render behavior
- f0c7050: add onMemberJoinedChannel on slack adapter

### Patch Changes

- 9522b04: Add `disabled` prop to `Button()` for Google Chat and Discord
- f5a75c9: Add `fallbackStreamingPlaceholderText` config option to suppress the initial "..." placeholder in post+edit fallback streaming
- 73de82d: Add remend for streaming markdown healing

## 4.15.0

### Minor Changes

- 0f85031: Added configurable dedupeTtlMs option to ChatConfig

  Change default dedupe ttl to 5min

- 5b3090a: Add CardLink element

## 4.14.0

### Minor Changes

- 90dc325: Add typing indicators for Slack adapter using Slack assistants API

## 4.13.4

### Patch Changes

- 716ce2a: Automatically create new ConsoleLogger

## 4.13.3

### Patch Changes

- ce33270: Currently deserialized threads cannot post streams to Slack due to lost metadata

## 4.13.2

### Patch Changes

- 7d00feb: Add docs to package

## 4.13.1

## 4.13.0

### Minor Changes

- f371c0d: feat(slack): full Slack Assistants API support

  - Route `assistant_thread_started` and `assistant_thread_context_changed` events
  - Add `onAssistantThreadStarted` and `onAssistantContextChanged` handler registration
  - Add `setSuggestedPrompts`, `setAssistantStatus`, `setAssistantTitle` methods on Slack adapter
  - Extend `stream()` to accept `stopBlocks` for Block Kit on stream finalization
  - Bump `@slack/web-api` to `^7.11.0` for `chatStream` support
  - Export all new types

## 4.12.0

### Minor Changes

- 8c50252: Adding support for slash commands.

## 4.11.0

### Minor Changes

- 417374b: Adding inline Select components and Radio buttons to cards

## 4.10.1

### Patch Changes

- c99b183: Added support for creating modals from ephemeral messages.

## 4.10.0

### Minor Changes

- c7d51cb: Added support for passing arbitrary metadata through the modal lifecycle via a new privateMetadata field.

## 4.9.1

## 4.9.0

## 4.8.0

### Minor Changes

- cca9867: GitHub + Linear integrations

## 4.7.2

## 4.7.1

### Patch Changes

- 160f1f7: Fetch relatedMessage separately from the event thread.

## 4.7.0

### Minor Changes

- a13f43e: Add relatedThread and relatedMessage to modal events.

## 4.6.0

### Minor Changes

- 68e3f74: Add <LinkButton> component

## 4.5.0

### Minor Changes

- efa6b36: add postEphemeral() for ephemeral messages

## 4.4.1

### Patch Changes

- 1882732: Serde from chat singleton
- b5826c2: Adding private metadata field to `onModalClose` events.
- 9e8f9e7: Serde support

## 4.4.0

### Minor Changes

- 8ca6371: Add support for modals, modal events, text inputs and selectors.

## 4.3.0

### Minor Changes

- 498eb04: Discord support

### Patch Changes

- d80ea3f: Refactor

## 4.2.0

### Minor Changes

- 0b5197a: Fixed and tested fetchMessages and allMessages

## 4.1.0

### Minor Changes

- 9b95317: Native streaming support

## 4.0.2

## 4.0.1

### Patch Changes

- b27ea10: READMEs
