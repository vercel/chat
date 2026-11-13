---
"@chat-adapter/teams": minor
---

`postMessage`, `postChannelMessage`, `postEphemeral`, and `editMessage` accept a raw Adaptive Card as `{ adaptiveCard, fallbackText }` and send it as is, for Adaptive Card features that Chat SDK cards don't cover, such as `Badge`. `adaptiveCard` takes the card's JSON or a card built with `@microsoft/teams.cards`, and the adapter throws a `ValidationError` when it isn't an object or when the message also sets `markdown`, `raw`, `ast`, or `card`. The new `TeamsPostableAdaptiveCard` and `TeamsPostableMessage` types describe the input.

`fallbackText` becomes the activity's `summary`. This now also applies to a Chat SDK card posted as `{ card, fallbackText }`, which previously sent no summary.
