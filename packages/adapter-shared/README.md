# @chat-adapter/shared

> npm package: [`@chat-adapter/shared`](https://www.npmjs.com/package/@chat-adapter/shared)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Shared utilities for [Chat SDK](https://chat-sdk.dev) adapters. Provides common helpers used across adapter implementations.

Documentation: [chat-sdk.dev/docs/contributing/building](https://chat-sdk.dev/docs/contributing/building) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/shared
```

## Utilities

### Adapter helpers

- `extractCard(message)` - extract a `CardElement` from an `AdapterPostableMessage`
- `extractFiles(message)` - extract `FileUpload[]` from an `AdapterPostableMessage`
- `extractPostableAttachments(message)` - extract `Attachment[]` from an `AdapterPostableMessage`

### Buffer conversion

- `toBuffer(input)` - convert various inputs (Buffer, Blob, string, URL) to Buffer
- `toBufferSync(input)` - synchronous version of toBuffer
- `bufferToDataUri(buffer, mimeType)` - convert a Buffer to a data URI string

### Card conversion

- `cardToFallbackText(card)` - render a `CardElement` as plain text for platforms that don't support cards
- `createEmojiConverter(platform)` - create a function that converts emoji placeholders to platform format
- `mapButtonStyle(style)` - map generic button styles to platform-specific variants
- `renderGfmTable(headers, rows)` - render a GitHub Flavored Markdown table
- `escapeTableCell(text)` - escape pipe characters in table cells

### Token encryption

AES-256-GCM helpers for encrypting OAuth tokens at rest before writing them to a state adapter. Used by `@chat-adapter/slack` and `@chat-adapter/linear`; available to any adapter that persists credentials.

- `encryptToken(plaintext, key)` - encrypt a string and return an `EncryptedTokenData` envelope (random 12-byte IV per call)
- `decryptToken(data, key)` - decrypt an envelope back to the original string
- `decodeKey(encoded)` - decode a hex-64 or base64-44 encoded 32-byte key; throws on wrong length
- `isEncryptedTokenData(value)` - type guard for distinguishing envelopes from legacy plaintext records
- `EncryptedTokenData` - the envelope type (`{ data, iv, tag }`, all base64)

### Error classes

Standardized errors for adapter implementations:

- `AdapterError` - base error class
- `AdapterRateLimitError` - platform rate limit (includes `retryAfter`)
- `AuthenticationError` - expired or invalid tokens
- `NetworkError` - connection failures
- `PermissionError` - missing scopes or permissions
- `ResourceNotFoundError` - missing channel/thread/message
- `ValidationError` - invalid config or input

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor, install the Chat SDK skill so it knows the SDK APIs, adapter patterns, and project conventions before writing code.

```bash
npx skills add vercel/chat
```

The skill references bundled documentation in `node_modules/chat/docs`, plus adapter guides and starter templates in the published package.

You can also install the [Vercel Plugin](https://vercel.com/docs/agent-resources/vercel-plugin) for a broader agent toolkit — it includes the Chat SDK skill alongside specialist agents, agent slash commands, and more:

```bash
npx plugins add vercel/vercel-plugin
```

The plugin is optional; the skill alone is enough to build with Chat SDK.

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## License

MIT
