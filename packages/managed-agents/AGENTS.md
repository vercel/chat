# AGENTS.md: `@chat-adapter/managed-agents`

Guidance for coding agents working in this package. Read the repository [AGENTS.md](../../AGENTS.md) first.

## Overview

This package connects hosted agent sessions (Claude Managed Agents, Cursor agents, OpenAI Agents API) to Chat SDK threads. It is not a platform or state adapter, so the konsistent adapter rules do not apply.

## Layout

```
src/
  index.ts            Public exports for the shared core
  types.ts            ManagedAgentDriver contract and normalized events
  managed-agent.ts    createManagedAgent: sessions, turns, approvals
  render.ts           Driver events to a Chat SDK stream
  claude/index.ts     Claude Managed Agents driver (@anthropic-ai/sdk)
  cursor/index.ts     Cursor driver (@cursor/sdk)
  openai/index.ts     OpenAI Agents API driver (openai)
  test-utils.ts       Fake thread and helpers for unit tests
  chat.integration.test.ts  Real Chat + ThreadImpl with a mock adapter
  index.test-d.ts     Type tests for the public API
```

## Tests

- `pnpm test` also type-checks every `*.test.ts` and `*.test-d.ts` file (`tsconfig.typecheck.json`). `tsc` alone skips test files.
- Type provider fixtures against the real SDK types (`BetaManagedAgentsStreamSessionEvents`, `SDKMessage`, `RunResult`). Do not cast fixtures to `any` or `Record<string, unknown>`.
- Mock only network-facing provider calls. Import error classes and types from the real SDK.
- Cover chat-side behavior that depends on Chat SDK internals in `chat.integration.test.ts`, not with the fake thread.

## Rules

- The core never imports a provider SDK. Provider code lives only in its driver subpath, and each provider SDK is an optional peer dependency.
- Drivers translate provider events into `ManagedAgentEvent`. Keep chat behavior (posting, state, cards) in the core.
- A driver's stream ends after `turn-end`, `approval-request`, or `session-ended`. Returning without one means the connection dropped.
- `resumeSession` returns `false` for missing or foreign sessions and throws for transient failures.
- Never log message content or tool inputs. Log driver names and error class names only.
- Claude: open the event stream before sending events, skip events until the sent event is echoed, and treat `agent.message` as authoritative over previews.
- Run `pnpm --filter @chat-adapter/managed-agents test` and `typecheck` after changes.
