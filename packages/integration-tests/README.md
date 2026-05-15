# Integration Tests

Integration tests for the Chat SDK that verify real-world webhook payloads are handled correctly.

## Test Categories

- **Unit tests** (`slack.test.ts`, `teams.test.ts`, `gchat.test.ts`) - Test adapter functionality with mock payloads
- **Replay tests** (`replay*.test.ts`) - Replay actual production webhook recordings
- **Emulator tests** (`src/emulator/<adapter>/*.test.ts`) - Drive the SDK against an in-process Emulate.dev server, one per supported adapter ([`@emulators/slack`](https://emulate.dev/docs/slack), [`@emulators/github`](https://emulate.dev/docs/github)). Assertions read the emulator's stateful store (messages, comments, reactions, installations) instead of mock call records. Each adapter is wired in via its `apiUrl` config. Inbound deliveries: the Slack flow re-signs `event_callback` payloads with `x-slack-signature` via a small in-test forwarder before handing them to `chat.webhooks.slack(...)`, while the GitHub flow is a near-passthrough because the emulator's `WebhookDispatcher` already signs with `X-Hub-Signature-256` exactly as the adapter expects. Helpers live in [`src/emulator/slack/utils.ts`](./src/emulator/slack/utils.ts) and [`src/emulator/github/utils.ts`](./src/emulator/github/utils.ts).

## Replay Tests

Replay tests use recorded webhook payloads from production to verify the SDK handles real interactions correctly.

**See [fixtures/replay/README.md](./fixtures/replay/README.md) for:**
- How to record new fixtures
- Fixture format documentation
- SHA-based recording workflow
- Platform-specific webhook formats

## Running Tests

```bash
# Run all integration tests
pnpm --filter @chat-adapter/integration-tests test

# Run with watch mode
pnpm --filter @chat-adapter/integration-tests test:watch
```
