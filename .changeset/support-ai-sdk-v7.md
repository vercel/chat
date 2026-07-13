---
"chat": minor
"@chat-adapter/web": minor
---

Support AI SDK v7 as a peer dependency.

- `chat` now accepts `ai@^6.0.182 || ^7.0.0` (`chat/ai` tools work with both majors).
- `@chat-adapter/web` now accepts `ai@^6 || ^7`, `@ai-sdk/react@^3 || ^4`, `@ai-sdk/svelte@^4 || ^5`, and `@ai-sdk/vue@^3 || ^4`.
- The `chat/ai` tool factories now declare explicit `Tool<Input, Output>` return types instead of relying on inference, so the published declarations no longer depend on `ai` internals that changed in v7. The public type surface is unchanged.
