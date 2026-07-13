# @chat-adapter/slack

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

- 0f743c9: Add declarative agent-experience config and harden native streaming:

  - `suggestedPrompts` — a static payload or per-thread resolver, applied automatically when an assistant/agent thread opens (`assistant_thread_started` in legacy `assistant_view`, or a Messages-tab `app_home_opened` under `agentView`, where prompts pin at the top of the agent conversation without a `thread_ts`). The resolver receives the thread context (`channelId`, `userId`, legacy `threadTs`/`teamId`/`enterpriseId`, and active-view `entities` under `agentView`); returning `null`/`undefined` skips the thread. Prompts beyond Slack's 4-prompt limit are dropped with a warning, and resolver/API failures are logged without failing the webhook.
  - `loadingMessages` — default rotating status strings for the assistant thinking indicator, used by `startTyping` and `setAssistantStatus` when no explicit status/messages are passed.
  - `nativeStreaming` config (default `true`). Set `false` on Slack flavours without the `chat.startStream` family (e.g. GovSlack) to always stream via post-and-edit.
  - If the workspace rejects the first native streaming call, `stream()` now falls back to throttled post-and-edit mid-stream instead of failing the reply; already-consumed text is preserved. Permanent platform errors (`unknown_method`, `method_deprecated`, `feature_not_enabled`) latch native streaming off for subsequent streams on the adapter instance. Structured chunks (`task_update` / `plan_update`) are skipped in fallback mode.

  - `feedbackButtons` — append Slack's native thumbs up/down (`context_actions` + `feedback_buttons` block) to every streamed reply. Pass `true` for defaults or an options object (`actionId`, labels, values); clicks dispatch through `bot.onAction` with a positive/negative value. A `buildFeedbackButtonsBlock(options?)` helper is exported for attaching the block to non-streamed messages.

  New exported types: `SlackFeedbackButtonsOptions`, `SlackSuggestedPrompt`, `SlackSuggestedPrompts`, `SlackSuggestedPromptsContext`, `SlackSuggestedPromptsOptions`.

### Patch Changes

- Updated dependencies [5c926f1]
- Updated dependencies [2531a42]
- Updated dependencies [1721fa0]
- Updated dependencies [4717a38]
- Updated dependencies [6714efc]
  - chat@4.34.0
  - @chat-adapter/shared@4.34.0

## 4.33.0

### Patch Changes

- 0b63791: Process Slack Socket Mode retry envelopes instead of discarding them. Slack redelivers an event (immediately, +1 min, +5 min) when a prior delivery wasn't acknowledged — including events sent while the app had no open socket, e.g. during a restart or a routine connection refresh. The adapter previously acked and dropped every envelope with `retry_num > 0`, so such events were permanently lost even though Slack redelivered them. Retries are now routed like first deliveries (logged at info with `retry_num`/`retry_reason`); `Chat.processMessage`'s message-id dedupe drops true duplicates.
- Updated dependencies [3abdc69]
- Updated dependencies [0b63791]
- Updated dependencies [0c761f1]
- Updated dependencies [ef2542c]
- Updated dependencies [24a04d5]
- Updated dependencies [d4c52ca]
- Updated dependencies [076fe5d]
  - chat@4.33.0
  - @chat-adapter/shared@4.33.0

## 4.32.0

### Patch Changes

- a8c4af7: prevent cached slack display names inside urls from being resolved as user mentions before payload formatting
- 07c1112: Fix `@mention` rewriting so handles inside inline code spans (`` `@vercel/postgres` ``) and fenced code blocks (` ``` `) are no longer turned into `<@USER_ID>` Slack mentions. Agents printing npm package names or shell snippets previously had those handles corrupted into bot user IDs. Mention linking now skips whole code spans and code blocks; handles outside code (including the same name mentioned elsewhere in the message) still resolve normally.
- Updated dependencies [eccc6b9]
- Updated dependencies [438f551]
- Updated dependencies [d034b8b]
- Updated dependencies [06af3e1]
- Updated dependencies [2e47351]
- Updated dependencies [efa9610]
  - chat@4.32.0
  - @chat-adapter/shared@4.32.0

## 4.31.0

### Minor Changes

- 8336a3e: Add `webClientOptions` to `SlackAdapterConfig`, forwarded to both the default and per-token `@slack/web-api` `WebClient` instances. This exposes Web API settings such as `retryConfig`, per-request `timeout`, and `rejectRateLimitedCalls`. Use the existing `apiUrl` option to override the Slack Web API base URL.
- 171657a: Adding support for stable IDs to link button action handlers

### Patch Changes

- a8bf99a: Fix `@mention` rewriting so an `@handle` inside a URL is no longer turned into a `<@handle>` Slack mention, which corrupted the link. Mention linking now skips whole `http(s)://…` spans, so handles in paths (`https://hackmd.io/@jkyang/abc`), query strings (`?user=@george`), and fragments (`#@george`) are preserved; the lookbehind also excludes a `/` immediately before `@` to cover schemeless URLs (`mastodon.social/@user`). Whitespace- and punctuation-led mentions (e.g. `(cc @george)`), emails, and `<mailto:…>` links are unaffected.
- Updated dependencies [778ae69]
- Updated dependencies [171657a]
  - chat@4.31.0
  - @chat-adapter/shared@4.31.0

## 4.30.0

### Minor Changes

- 4c46c26: add lightweight Slack formatting primitives subpath
- dbd8dc5: expose runtime-free Block Kit helpers for Slack card conversion
- aba6aa9: add lightweight Slack API primitives subpath
- b332a03: add lightweight Slack webhook primitives subpath
- 6ed4a43: add low-level Slack helpers for files, thread replies, views, interactions, and input blocks

### Patch Changes

- 9b8d8c4: expand npm `keywords` for adapter and state packages to improve discoverability (adds `chat-sdk`, `chatbot`, `ai-agent`, `ai-sdk`, `vercel`, plus platform-specific terms)
- 073ff92: surface Slack file upload confirmation ids in postMessage results
- b63c042: fix(slack): resolve reaction user display names

  Slack reaction events now resolve the reacting user's display name and real name
  through the existing cached user lookup path. If lookup fails, the adapter falls
  back to the Slack user ID.

- 1294490: reuse low-level Slack formatting helpers in the adapter
- 999d268: pass the Slack bot token through native stream append and stop calls
- Updated dependencies [5461ea9]
  - chat@4.30.0
  - @chat-adapter/shared@4.30.0

## 4.29.0

### Minor Changes

- 2f108bd: Rename the typed native client getter on the Slack, GitHub, and Linear adapters to match the underlying SDK class.

  - `bot.getAdapter("slack").client` is now `bot.getAdapter("slack").webClient` (returns `WebClient` from `@slack/web-api`).
  - `bot.getAdapter("github").client` is now `bot.getAdapter("github").octokit` (returns `Octokit`).
  - `bot.getAdapter("linear").client` is now `bot.getAdapter("linear").linearClient` (returns `LinearClient`).

  The previous `.client` getter is kept as a deprecated alias on all three adapters, so existing code continues to work without changes.

- c46fdb6: Add support for external `installationProvider` and Enterprise Grid org-wide installs.

  - New optional `installationProvider` config: `{ getInstallation(installationId, isEnterpriseInstall) => Promise<SlackInstallation | null> }`. When set, the adapter resolves bot tokens for incoming events, slash commands, and interactive payloads through the provider instead of the internal `StateAdapter` — useful for hosted token-management systems (e.g. Vercel Connect). The provider is read-only; OAuth callback writes (`setInstallation`, `handleOAuthCallback`) and the `getInstallation`/`deleteInstallation` public methods continue to use internal state, so callers using a provider should manage their own writes.
  - Enterprise Grid org-wide installs (`is_enterprise_install: true`) are now keyed on `enterprise_id` instead of `team_id` across event_callback, slash command, and interactive payload paths. Multi-workspace deployments using the internal `StateAdapter` for org-wide installs must repopulate installations under the `enterprise_id` key — previously, org-wide events would fall through to a `team_id` lookup that did not match what the OAuth flow had stored.

- fdebde7: feat(slack): expose direct `WebClient` access via `adapter.client`

  `bot.getAdapter("slack").client` now returns a typed `WebClient` from
  `@slack/web-api`, matching the existing pattern on the Linear and GitHub
  adapters. The returned client is bound to the bot token for the current
  request context (multi-workspace) or the configured default token
  (single-workspace). Use it for any Web API call not covered by the SDK's
  high-level methods, e.g. `adapter.client.pins.add(...)` or
  `adapter.client.usergroups.list(...)`.

  Resolution order:

  1. The token from the current `requestContext` — set during webhook
     handling, or by `adapter.withBotToken(token, fn)`.
  2. The default `botToken`, when configured as a static string or a
     synchronous resolver function.

  Throws `AuthenticationError` outside of any context in multi-workspace
  mode, or when `botToken` is configured as an async resolver function.
  For async tokens, await the token first and bind it explicitly with
  `adapter.withBotToken(token, () => adapter.client...)`.

  Also fixes `createSlackAdapter()` silently dropping the `apiUrl`
  config field.

- 2ffed48: Adapter internals are now `protected` rather than `private`, so consumers can subclass an adapter to override or extend its behavior (e.g. handling additional Telegram update types by overriding `processUpdate`).

### Patch Changes

- e60bc8c: chore: set supported Node versions in engines
- 06fb8e5: Align package shapes with the new `konsistent` conventions. All changes are
  backwards-compatible — previous type names are kept as deprecated aliases.

  - `@chat-adapter/gchat`, `@chat-adapter/slack`: moved `*AdapterConfig` (and
    related sub-types) into a `./types` module; the public re-exports from
    `index.ts` are unchanged.
  - `@chat-adapter/slack`: `createSlackAdapter` now accepts `SlackAdapterConfig`
    directly instead of `Partial<SlackAdapterConfig>`. Every field on the config
    was already optional, so no call sites need to change.
  - `@chat-adapter/messenger`: `MessengerAdapterConfig` fields are now optional
    (the factory still falls back to `FACEBOOK_*` env vars), and `logger` /
    `userName` live on `MessengerAdapterConfig` directly. The factory signature
    is now `createMessengerAdapter(config?: MessengerAdapterConfig)`.
  - `@chat-adapter/web`: renamed `WebAdapterOptions` to `WebAdapterConfig`; the
    old name is exported as a deprecated alias.
  - `@chat-adapter/whatsapp`: every field on `WhatsAppAdapterConfig` is optional
    (the factory still falls back to `WHATSAPP_*` env vars). `createWhatsAppAdapter`
    is now typed `(config?: WhatsAppAdapterConfig) => WhatsAppAdapter`.
  - `@chat-adapter/state-memory`: added an empty `MemoryStateAdapterOptions`
    type so the package matches every other state adapter; `createMemoryState`
    now accepts an optional argument of that type.
  - `@chat-adapter/state-ioredis`, `@chat-adapter/state-redis`,
    `@chat-adapter/state-pg`: the URL- and client-based option shapes were split
    into named interfaces (`*StateAdapterUrlOptions` /
    `*StateAdapterClientOptions`) and unified under `*StateAdapterOptions`. The
    factories now take the union type directly. Old names — `RedisStateClientOptions`,
    `CreateRedisStateOptions`, `PostgresStateClientOptions`,
    `CreatePostgresStateOptions`, `IoRedisStateClientOptions` — are kept as
    deprecated aliases.

- 0f0c203: fix(slack): prefer `webhookVerifier` over `signingSecret` and `SLACK_SIGNING_SECRET`

  When a `webhookVerifier` is configured, it now takes precedence over both the
  `signingSecret` config field and the `SLACK_SIGNING_SECRET` env var. Previously,
  a configured `signingSecret` (or env var) would shadow the verifier.

- Updated dependencies [ac8a207]
- Updated dependencies [e60bc8c]
- Updated dependencies [add2730]
- Updated dependencies [b75eedb]
  - chat@4.29.0
  - @chat-adapter/shared@4.29.0

## 4.28.1

### Patch Changes

- Updated dependencies [0cc3d06]
  - chat@4.28.1
  - @chat-adapter/shared@4.28.1

## 4.28.0

### Minor Changes

- 3546b3f: use Slack's native `markdown_text` field for outgoing markdown messages

  Slack now natively renders markdown via the `markdown_text` parameter on
  `chat.postMessage`, `chat.postEphemeral`, `chat.update`, and
  `chat.scheduleMessage`. The adapter passes markdown through directly instead
  of converting to mrkdwn, so tables, headings, fenced code blocks, blockquotes,
  and other rich formatting now render natively in Slack.

  - Tables are rendered by Slack natively (no more ASCII-table fallback or
    Block Kit `table` block fabrication).
  - Plain `string` and `{ raw }` messages still go to the `text` field so
    literal `*` / `_` characters are preserved.
  - `markdown_text` has a 12,000 character limit (vs. ~40,000 for `text`).
  - The deprecated `SlackMarkdownConverter` alias has been removed; use
    `SlackFormatConverter` instead.
  - `renderFormatted(ast)` now returns standard markdown instead of mrkdwn.
  - Incoming `message` events are unchanged — they still arrive as mrkdwn
    and are parsed as before.

### Patch Changes

- 9824d33: Security fixes for HIGH-severity findings:

  - **adapter-slack**: Replace timing-unsafe `!==` with `crypto.timingSafeEqual` when validating the `x-slack-socket-token` header on forwarded socket-mode events.
  - **adapter-github**: In multi-tenant App mode, eagerly auto-detect the bot user ID on the first installation client / first webhook so `isMe` checks work and self-reply loops are prevented. Falls back to `apps.getAuthenticated` + `users.getByUsername` when `users.getAuthenticated` is unavailable for installation tokens.
  - **adapter-linear**: Add optional `encryptionKey` config (or `LINEAR_ENCRYPTION_KEY` env var) that AES-256-GCM-encrypts `accessToken` and `refreshToken` at rest in the state store. Tolerates plaintext records for zero-downtime rollout.
  - **adapter-gchat**: Fail-closed by default — the constructor now throws `ValidationError` if neither `googleChatProjectNumber` nor `pubsubAudience` is configured. To accept unverified webhooks (development only), set the new `disableSignatureVerification: true` flag (or `GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION=true`). Mirrors the Slack adapter's signing-secret requirement.
  - **adapter-shared**: New `decodeKey` / `encryptToken` / `decryptToken` / `isEncryptedTokenData` utilities (AES-256-GCM, hex or base64 32-byte keys), shared by Slack and Linear.

- Updated dependencies [eb5f94a]
- Updated dependencies [c1cd9b5]
- Updated dependencies [9824d33]
- Updated dependencies [46d183b]
- Updated dependencies [46d183b]
- Updated dependencies [3490a8c]
  - chat@4.28.0
  - @chat-adapter/shared@4.28.0

## 4.27.0

### Minor Changes

- 6b17c60: Add `apiUrl` config option for custom API endpoint configuration (e.g. GovSlack, GitHub Enterprise, GCC-High Teams)
- a520797: Add `chat.getUser()` method and `UserInfo` type for cross-platform user lookups. Implement `getUser` on Slack, Discord, Google Chat, GitHub, Linear, and Telegram adapters.
- 70281dc: add initialOption and option_groups support for ExternalSelect
- 2531e9c: Add dynamic `botToken` resolver and custom `webhookVerifier` to Slack adapter config. `botToken` now accepts `string | (() => string | Promise<string>)` so apps can rotate or lazily fetch tokens — the function is invoked per API call. `webhookVerifier: (request: Request) => string | Promise<string>` is used in place of `signingSecret` when set (and `signingSecret` is not provided), letting hosts verify incoming requests with their own logic and return the verified body text; the adapter responds 401 if the verifier throws.
- 7e90d9c: Add Socket Mode support for environments behind firewalls that can't expose public HTTP endpoints, and add `{ action: "clear" }` modal response to close the entire modal view stack
- a179b29: Implement external_select block kit for Slack

### Patch Changes

- 1e7c551: restore attachment fetchData after queue/debounce serialization
- 53c6b68: Fix DM messages failing with `invalid_thread_ts` by guarding Slack API calls with `threadTs || undefined`
- ded6f78: enrich link previews with title, description, and image from Slack unfurl attachments
- c26ee6c: Fix `@mention` rewrite regex so email addresses (e.g. `user@example.com`) and `<mailto:…>` links are no longer mangled into broken Slack user mentions. The lookbehind now excludes any word character before `@`, which also means mentions immediately following a word character (e.g. `prefix@user`) are no longer rewritten — a bare `@user` still converts as before.
- 0f8b2b1: Fix self-mention detection in multi-workspace installs by using the request-scoped bot user ID instead of the adapter-level default
- Updated dependencies [8a0c7b3]
- Updated dependencies [1e7c551]
- Updated dependencies [b0ab804]
- Updated dependencies [d630e6c]
- Updated dependencies [b9a1961]
- Updated dependencies [a520797]
- Updated dependencies [70281dc]
- Updated dependencies [9093292]
- Updated dependencies [7e90d9c]
- Updated dependencies [bca4792]
- Updated dependencies [37dbb4a]
- Updated dependencies [608d5f0]
- Updated dependencies [a179b29]
- Updated dependencies [a8f2aab]
  - chat@4.27.0
  - @chat-adapter/shared@4.27.0

## 4.26.0

### Patch Changes

- 8955e71: Patches bug with conversion of markdown tables to Slack table blocks
- Updated dependencies [2235c16]
- Updated dependencies [ddb084b]
  - chat@4.26.0
  - @chat-adapter/shared@4.26.0

## 4.25.0

### Patch Changes

- 1856198: Fix Slack OAuth callbacks by allowing `redirectUri` to be passed explicitly during the token exchange while preserving the callback query param as a backward-compatible fallback.
- 2700ce8: Allow Slack native streaming to send markdown tables without wrapping them in code fences, while preserving the previous append-only table fallback for other consumers.
- Updated dependencies [2700ce8]
  - chat@4.25.0
  - @chat-adapter/shared@4.25.0

## 4.24.0

### Patch Changes

- 8d89274: fix: disable source maps in published packages
- e8dbef2: Fix empty table cells causing `invalid_blocks` error from Slack API. Empty cells now fall back to a single space to satisfy the Block Kit requirement that cell text must be more than 0 characters.
- Updated dependencies [8d89274]
- Updated dependencies [4f5d200]
- Updated dependencies [27b34e1]
  - @chat-adapter/shared@4.24.0
  - chat@4.24.0

## 4.23.0

### Minor Changes

- 4166e09: Add `channelVisibility` enum to distinguish private, workspace, external, and unknown channel scopes. Implements `getChannelVisibility()` on the Adapter interface and Slack adapter, replacing the previous `isExternalChannel` boolean.

### Patch Changes

- Updated dependencies [4166e09]
  - chat@4.23.0
  - @chat-adapter/shared@4.23.0

## 4.22.0

### Patch Changes

- Updated dependencies [f2d8957]
  - chat@4.22.0
  - @chat-adapter/shared@4.22.0

## 4.21.0

### Minor Changes

- d778f72: Switch adapters from optional dep to full dep on chat

### Patch Changes

- Updated dependencies [e45a67f]
- Updated dependencies [13ba1c7]
- Updated dependencies [95fd8ce]
  - chat@4.21.0
  - @chat-adapter/shared@4.21.0

## 4.20.2

### Patch Changes

- f612b44: Fix duplicate mention resolution by using the replace callback offset instead of indexOf. Invalidate user cache on Slack user_change events so display name updates are picked up immediately.
  - chat@4.20.2
  - @chat-adapter/shared@4.20.2

## 4.20.1

### Patch Changes

- e206371: new toAiMessages API for history-to-AI-SDK transformation. And introduces LinkPreview object on Message
- 97be8a9: Automatically resolve slack channel names
- Updated dependencies [e206371]
- Updated dependencies [8d88b8c]
  - chat@4.20.1
  - @chat-adapter/shared@4.20.1

## 4.20.0

### Patch Changes

- chat@4.20.0
- @chat-adapter/shared@4.20.0

## 4.19.0

### Minor Changes

- 5b41f08: Add `thread.schedule()` and `ScheduledMessage` type for scheduling messages to be sent at a future time. Slack adapter implements scheduling via `chat.scheduleMessage` API with `cancel()` support.

### Patch Changes

- 736880a: Resolve parent `thread_ts` for reaction events on threaded replies so `onReaction` gets the correct thread ID
- c4b0e69: Tighten Adapter & StateAdapter interfaces: make `channelIdFromThreadId` required, make `EphemeralMessage` generic over `TRawMessage`, add `satisfies Adapter` to mock adapter, migrate remaining adapters to shared error types
- Updated dependencies [eb49b2a]
- Updated dependencies [5b41f08]
- Updated dependencies [c4b0e69]
  - chat@4.19.0
  - @chat-adapter/shared@4.19.0

## 4.18.0

### Patch Changes

- a3cfc1a: AI SDK6 compat fixes and support for native slack tables
- Updated dependencies [a3cfc1a]
  - chat@4.18.0
  - @chat-adapter/shared@4.18.0

## 4.17.0

### Patch Changes

- 10b0e6b: fix: Slack silently drops file_share messages, blocking file uploads from reaching processMessage
- d3db36e: fix: Slack postMessage hasText check causes no_text error for file-only posts
- Updated dependencies [cc65dc3]
  - chat@4.17.0
  - @chat-adapter/shared@4.17.0

## 4.16.1

### Patch Changes

- f0dfa4d: Fix nested list rendering in Markdown-to-platform converters

  All adapters (Slack, Discord, Teams, Google Chat) were flattening nested
  lists during `fromAst()` conversion, causing child items to be concatenated
  directly onto the parent item without any indentation or newline separation.

  The `nodeToX()` list handler now accepts a `depth` parameter and uses it to
  produce platform-appropriate indentation (`"  ".repeat(depth)`) for nested
  lists. Each list item's children are processed in order: paragraph content
  is prefixed with the bullet/number at the correct indent level, and nested
  list nodes are rendered recursively at `depth + 1`.

- f27c89b: Improve StreamChunk type safety with discriminated union and fix url_verification security bypass
- Updated dependencies [130e780]
- Updated dependencies [ff954f9]
- Updated dependencies [f27c89b]
  - chat@4.16.1
  - @chat-adapter/shared@4.16.1

## 4.16.0

### Minor Changes

- 02e7ef6: Implements table markdown rendering, and fully streaming markdown rendering including for Slack which has native streaming. Overhauls adapters to have better fallback-render behavior
- f0c7050: add onMemberJoinedChannel on slack adapter

### Patch Changes

- Updated dependencies [02e7ef6]
- Updated dependencies [9522b04]
- Updated dependencies [f5a75c9]
- Updated dependencies [f0c7050]
- Updated dependencies [73de82d]
  - @chat-adapter/shared@4.16.0
  - chat@4.16.0

## 4.15.0

### Minor Changes

- 5b3090a: Add CardLink element

### Patch Changes

- f0cfcfa: Can now attach multiple files to the same Slack message, as opposed to breaking by file.
- Updated dependencies [0f85031]
- Updated dependencies [5b3090a]
  - chat@4.15.0
  - @chat-adapter/shared@4.15.0

## 4.14.0

### Minor Changes

- ef6f370: Add custom installation key prefix support for slack installations
- 90dc325: Add typing indicators for Slack adapter using Slack assistants API

### Patch Changes

- Updated dependencies [90dc325]
  - chat@4.14.0
  - @chat-adapter/shared@4.14.0

## 4.13.4

### Patch Changes

- f266dcf: Automatically load from env vars
- Updated dependencies [716ce2a]
  - chat@4.13.4
  - @chat-adapter/shared@4.13.4

## 4.13.3

### Patch Changes

- Updated dependencies [ce33270]
  - chat@4.13.3
  - @chat-adapter/shared@4.13.3

## 4.13.2

### Patch Changes

- Updated dependencies [7d00feb]
  - chat@4.13.2
  - @chat-adapter/shared@4.13.2

## 4.13.1

### Patch Changes

- 09cdfa3: fix(slack,gchat): convert **bold** to _bold_ in Card text blocks

  CardText content with standard Markdown bold was rendering literally in Slack and Google Chat. Both platforms use single asterisk for bold. Added markdownToMrkdwn conversion in convertTextToBlock and field converters.

  - chat@4.13.1
  - @chat-adapter/shared@4.13.1

## 4.13.0

### Minor Changes

- f371c0d: feat(slack): full Slack Assistants API support

  - Route `assistant_thread_started` and `assistant_thread_context_changed` events
  - Add `onAssistantThreadStarted` and `onAssistantContextChanged` handler registration
  - Add `setSuggestedPrompts`, `setAssistantStatus`, `setAssistantTitle` methods on Slack adapter
  - Extend `stream()` to accept `stopBlocks` for Block Kit on stream finalization
  - Bump `@slack/web-api` to `^7.11.0` for `chatStream` support
  - Export all new types

### Patch Changes

- Updated dependencies [f371c0d]
  - chat@4.13.0
  - @chat-adapter/shared@4.13.0

## 4.12.0

### Minor Changes

- 8c50252: Adding support for slash commands.

### Patch Changes

- Updated dependencies [8c50252]
  - chat@4.12.0
  - @chat-adapter/shared@4.12.0

## 4.11.0

### Minor Changes

- 417374b: Adding inline Select components and Radio buttons to cards

### Patch Changes

- Updated dependencies [417374b]
  - chat@4.11.0
  - @chat-adapter/shared@4.11.0

## 4.10.1

### Patch Changes

- c99b183: Added support for creating modals from ephemeral messages.
- Updated dependencies [c99b183]
  - chat@4.10.1
  - @chat-adapter/shared@4.10.1

## 4.10.0

### Minor Changes

- c7d51cb: Added support for passing arbitrary metadata through the modal lifecycle via a new privateMetadata field.

### Patch Changes

- Updated dependencies [c7d51cb]
  - chat@4.10.0
  - @chat-adapter/shared@4.10.0

## 4.9.1

### Patch Changes

- Updated dependencies [18ce1d0]
  - @chat-adapter/shared@4.9.1
  - chat@4.9.1

## 4.9.0

### Minor Changes

- 8979049: Add multi-workspace support. A single Slack adapter instance can now serve multiple workspaces by resolving bot tokens per-request via AsyncLocalStorage. Includes OAuth V2 flow handling, installation management (set/get/delete), optional AES-256-GCM token encryption at rest, and a withBotToken helper for out-of-webhook contexts

### Patch Changes

- chat@4.9.0
- @chat-adapter/shared@4.9.0

## 4.8.0

### Patch Changes

- ba2a9ca: Fix double-wrapping of Slack mentions when input already contains `<@user>` format
- Updated dependencies [cca9867]
  - chat@4.8.0
  - @chat-adapter/shared@4.8.0

## 4.7.2

### Patch Changes

- efaa916: Allow streaming when images attached on thread start
  - chat@4.7.2
  - @chat-adapter/shared@4.7.2

## 4.7.1

### Patch Changes

- 160f1f7: Fetch relatedMessage separately from the event thread.
- Updated dependencies [160f1f7]
  - chat@4.7.1
  - @chat-adapter/shared@4.7.1

## 4.7.0

### Minor Changes

- a13f43e: Add relatedThread and relatedMessage to modal events.

### Patch Changes

- Updated dependencies [a13f43e]
  - chat@4.7.0
  - @chat-adapter/shared@4.7.0

## 4.6.0

### Minor Changes

- 68e3f74: Add <LinkButton> component

### Patch Changes

- Updated dependencies [68e3f74]
  - chat@4.6.0
  - @chat-adapter/shared@4.6.0

## 4.5.0

### Minor Changes

- efa6b36: add postEphemeral() for ephemeral messages

### Patch Changes

- Updated dependencies [efa6b36]
  - chat@4.5.0
  - @chat-adapter/shared@4.5.0

## 4.4.1

### Patch Changes

- b5826c2: Adding private metadata field to `onModalClose` events.
- 9e8f9e7: Serde support
- Updated dependencies [1882732]
- Updated dependencies [b5826c2]
- Updated dependencies [9e8f9e7]
  - chat@4.4.1
  - @chat-adapter/shared@4.4.1

## 4.4.0

### Minor Changes

- 8ca6371: Add support for modals, modal events, text inputs and selectors.

### Patch Changes

- Updated dependencies [8ca6371]
  - chat@4.4.0
  - @chat-adapter/shared@4.4.0

## 4.3.0

### Minor Changes

- 498eb04: Discord support

### Patch Changes

- d80ea3f: Refactor
- Updated dependencies [498eb04]
- Updated dependencies [d80ea3f]
  - @chat-adapter/shared@4.3.0
  - chat@4.3.0

## 4.2.0

### Minor Changes

- 0b5197a: Fixed and tested fetchMessages and allMessages

### Patch Changes

- Updated dependencies [0b5197a]
  - chat@4.2.0

## 4.1.0

### Minor Changes

- 9b95317: Native streaming support

### Patch Changes

- Updated dependencies [9b95317]
  - chat@4.1.0

## 4.0.2

### Patch Changes

- chat@4.0.2

## 4.0.1

### Patch Changes

- b27ea10: READMEs
- Updated dependencies [b27ea10]
  - chat@4.0.1
