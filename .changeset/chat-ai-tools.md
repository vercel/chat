---
"chat": minor
---

Add `chat/ai` subpath as the home for AI utilities, including `createChatTools` for the Vercel AI SDK and `toAiMessages` for converting chat history into AI SDK prompts.

`createChatTools` exposes Chat SDK operations as ready-to-use AI SDK tools so an agent can read messages, post replies, send DMs, react, edit, delete, and manage thread subscriptions across every adapter the supplied `Chat` instance has registered. Write operations require user approval by default and can be toggled globally or per-tool via `requireApproval`. Three presets (`reader`, `messenger`, `moderator`) scope the toolset, and tools can also be cherry-picked from the same subpath.

`toAiMessages` (and the `AiMessage` / `AiMessagePart` / `ToAiMessagesOptions` types) now ship from `chat/ai` alongside the tools — keeping the optional `ai` and `zod` peer dependencies out of bundles that don't use them. The previous `chat` re-exports continue to work, but are marked `@deprecated` so editors surface a hint pointing at `chat/ai`; existing code keeps compiling, and migrating is a single import-path change.
