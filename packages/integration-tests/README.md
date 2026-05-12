# Integration Tests

Integration tests for the Chat SDK that verify real-world webhook payloads are handled correctly.

## Test Categories

- **Unit tests** (`slack.test.ts`, `teams.test.ts`, `gchat.test.ts`) - Test adapter functionality with mock payloads
- **Replay tests** (`replay*.test.ts`) - Replay actual production webhook recordings
- **Emulator tests** (`emulator-*.test.ts`) - Drive the SlackAdapter against an in-process [`@emulators/slack`](https://emulate.dev/docs/slack) server. Assertions read the emulator's stateful store (messages, reactions, installations) instead of mock call records. The emulator is wired in via the adapter's `apiUrl` config, and inbound `event_callback` deliveries are re-signed by a small in-test forwarder before being handed to `chat.webhooks.slack(...)`. Helpers live in [`src/slack-emulator-utils.ts`](./src/slack-emulator-utils.ts).

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
