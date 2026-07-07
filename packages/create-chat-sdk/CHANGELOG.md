# create-chat-sdk

## 0.1.1

### Patch Changes

- d034b8b: docs(adapters): add Linq as a vendor-official adapter (`@linqapp/chat-sdk-adapter`) to the catalog, docs listing, and CLI scaffold spec
- 06af3e1: docs(adapters): add Novu as a vendor-official adapter (`@novu/chat-sdk-adapter`) to the catalog, docs listing, and CLI scaffold spec

## 0.1.0

### Minor Changes

- 8f3af76: Add the `create-chat-sdk` CLI for scaffolding webhook-only Next.js Chat SDK bot projects. Supports interactive prompts, non-interactive `--adapter` selection from the `chat/adapters` catalog, coding-agent detection with an `--interactive` escape hatch, and generated `src/lib/bot.ts`, `.env.example`, `next.config.ts`, and README output per selected adapter.
