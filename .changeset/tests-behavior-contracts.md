---
"@chat-adapter/tests": minor
---

Add two shared behavioral test contracts for adapter authors:

- `threadIdContract` — verifies an adapter's thread-id codec round-trips (`decode(encode(x))`), prefixes ids with the adapter name, matches any pinned encoded strings, and (optionally) distinguishes DM from non-DM threads.
- `selfMessageContract` — verifies an adapter dispatches inbound messages from other users (to `processMessage` by default) but ignores messages the bot authored itself, so it never replies to itself. Requires the matchers to be registered via `setupFiles: ["@chat-adapter/tests/setup"]`.
