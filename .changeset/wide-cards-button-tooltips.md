---
"chat": minor
"@chat-adapter/teams": minor
---

Add `tooltip` to `Button` and `LinkButton`, and a `width` hint to `Card`. The Teams adapter and the `@chat-adapter/teams/cards` subpath render them as the Adaptive Card action `tooltip` and the `msteams` full-width card property; other adapters ignore them. Emitted Adaptive Cards now declare schema version 1.5, which is the version that introduced action tooltips. Buttons with a `callbackUrl` keep their `tooltip` and other fields when the URL is swapped for a callback token.
