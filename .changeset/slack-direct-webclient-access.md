---
"@chat-adapter/slack": minor
---

feat(slack): expose direct `WebClient` access via `adapter.client`

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
