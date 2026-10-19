---
"@chat-adapter/web": minor
"@chat-adapter/catalog": patch
---

The Web adapter's server entry no longer depends on the AI SDK at runtime, and a new `protocol` option lets it speak AG-UI (`protocol: "ag-ui"`) for TanStack AI and other AG-UI clients. The default stays `"ai-sdk"`. `ai` is now an optional peer dependency, needed only for the `react`, `vue`, and `svelte` helpers.

`message.raw` is now typed as the new `WebMessage` type instead of the AI SDK `UIMessage`. A `UIMessage` is still assignable to `WebMessage`, but part fields other than `type` are typed `unknown`. If your handler reads typed part fields with the `"ai-sdk"` protocol, cast with `message.raw as UIMessage`.

Request handling is stricter and handles retries:

- The last entry in `messages` must be a user message. Bodies ending in an assistant or tool message, such as client-side tool results, now get a 400 instead of being silently ignored.
- A conversation id (`id` with `"ai-sdk"`, `threadId` with `"ag-ui"`) that is present but not a string gets a 400 instead of a new conversation.
- Resending the same user message, as regenerate in `useChat` or reload in TanStack AI does, now runs the handler again instead of being dropped as a duplicate. History keeps the earlier reply and stores the repeated message a second time.
- A body shaped for the other protocol gets a 400 that names the `protocol` option.
