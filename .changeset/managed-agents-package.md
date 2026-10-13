---
"@chat-adapter/managed-agents": minor
---

Add `@chat-adapter/managed-agents`, which connects hosted agent sessions to Chat SDK threads. `createManagedAgent()` keeps one provider session per thread in thread state, streams replies with tool progress, posts Approve/Deny cards for tool approvals, and interrupts the provider run when the turn is stopped. It ships with three drivers: `@chat-adapter/managed-agents/claude` for Claude Managed Agents, `@chat-adapter/managed-agents/cursor` for the Cursor SDK, and `@chat-adapter/managed-agents/openai` for the OpenAI Agents API. Other providers can implement the `ManagedAgentDriver` interface.
