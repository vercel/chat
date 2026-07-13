# create-chat-sdk

## 0.2.0

### Minor Changes

- ba375ce: Add Vercel Connect support to the scaffolder. Pass `--connect` (or choose **Vercel Connect** at the new interactive auth-mode prompt) to authenticate the Slack, GitHub, and Linear adapters with a Vercel Connect connector instead of stored provider secrets. The generated `src/lib/bot.ts` spreads the matching helper from `@vercel/connect/chat` into the adapter factory, `@vercel/connect` is added to dependencies, and `.env.example` lists each connector UID (for example `SLACK_CONNECTOR`) plus the recommended `GITHUB_BOT_USER_ID` for GitHub, in place of native secrets.
- ef2542c: add X (Twitter) adapter: reply to public mentions, send and receive direct messages, post and edit from the bot account, and like posts, using the X API v2 with OAuth 2.0 and managed token refresh

### Patch Changes

- 3abdc69: docs(adapters): add Cloudflare Agents as a vendor-official state adapter (`agents/chat-sdk`) to the catalog and docs listing. It is hidden from the create-chat-sdk CLI (Worker/Durable Objects runtime), and the interactive state picker now filters out CLI-incompatible state adapters.
- 0c761f1: docs(adapters): add Dial as a vendor-official adapter (`@getdial/chat-sdk-adapter`) to the catalog, docs listing, and CLI scaffold spec
- 24a04d5: docs(adapters): add Photon as a vendor-official adapter (`@photon-ai/chat-adapter-imessage`) to the catalog, docs listing, and CLI scaffold spec

## 0.1.1

### Patch Changes

- d034b8b: docs(adapters): add Linq as a vendor-official adapter (`@linqapp/chat-sdk-adapter`) to the catalog, docs listing, and CLI scaffold spec
- 06af3e1: docs(adapters): add Novu as a vendor-official adapter (`@novu/chat-sdk-adapter`) to the catalog, docs listing, and CLI scaffold spec

## 0.1.0

### Minor Changes

- 8f3af76: Add the `create-chat-sdk` CLI for scaffolding webhook-only Next.js Chat SDK bot projects. Supports interactive prompts, non-interactive `--adapter` selection from the `chat/adapters` catalog, coding-agent detection with an `--interactive` escape hatch, and generated `src/lib/bot.ts`, `.env.example`, `next.config.ts`, and README output per selected adapter.
