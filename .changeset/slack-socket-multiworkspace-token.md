---
"@chat-adapter/slack": patch
---

Establish the per-team bot token context in Socket Mode for multi-workspace apps. `routeSocketEvent` now resolves the installation token via `installationProvider` and runs the dispatch inside `requestContext` for `events_api`, `slash_commands`, and `interactive` events — matching the webhook path. Previously, Socket Mode dispatched events with no token in multi-workspace mode (no `botToken`, only an `installationProvider`), so every downstream Web API call threw `AuthenticationError: No bot token available. In multi-workspace mode, ensure the webhook is being processed.`
