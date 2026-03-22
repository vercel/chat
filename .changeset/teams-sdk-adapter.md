---
"@chat-adapter/teams-sdk": minor
---

Add new `@chat-adapter/teams-sdk` package: a Teams adapter that integrates the Microsoft teams.ts SDK (`@microsoft/teams.apps`) for native streaming, reaction support via Microsoft Graph API, and declarative activity routing — while preserving the serverless-first architecture of the existing `@chat-adapter/teams` adapter.

Key capabilities over `@chat-adapter/teams`:

- **Native streaming** via `HttpStream` from `@microsoft/teams.apps` — delivers live token-by-token streaming in Teams without polling
- **Add/remove reactions** via Microsoft Graph API (`/chats/{id}/messages/{id}/setReaction`) when `appTenantId` is configured
- **Declarative activity routing** using teams.ts `Router` — replaces the if/else dispatch chain with a structured route table (`"message"`, `"messageReaction"`, `"card.action"`, `"install.add"`, `"conversationUpdate"`, etc.)
- **Full Adaptive Card action support** (`adaptiveCard/action` invoke → `"card.action"` route) with proper `InvokeResponse` acknowledgement
- **Streaming ephemeral messages** — experimental targeted message support via `channelData.OnBehalfOf`
- Supports all existing auth modes: `appPassword`, `certificate` (thumbprint / x5c), `federated` (managed identity), `SingleTenant` / `MultiTenant`
