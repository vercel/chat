---
"chat": minor
---

Reject AI tool calls that have no conversation scope when they run inside a handler with no conversation, such as an action in App Home or inside a modal, an options-load handler, or a modal opened outside a thread or channel. Pass an explicit `scope`, or `scope: false` for intentionally workspace-wide access. Calls outside any handler, such as in a cron job or script, still run workspace-wide and log a warning. An empty `scope` id now throws when the tools are created.

The standalone tool factories exported from `chat/ai`, such as `fetchMessages` and `postMessage`, now accept `scope` and `strictScope` and follow the same rules as `createChatTools`. Inside a handler they inherit the conversation being handled, so a call that targets another channel is now rejected. Outside a handler they log the same unscoped warning once per tool. Passing a guard function still works but is deprecated in favor of `scope`.
