# @chat-adapter/shared

[![npm version](https://img.shields.io/npm/v/@chat-adapter/shared)](https://www.npmjs.com/package/@chat-adapter/shared)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/shared)](https://www.npmjs.com/package/@chat-adapter/shared)

Shared utilities for [Chat SDK](https://chat-sdk.dev) adapters. Provides common helpers used across adapter implementations.

## Installation

```bash
pnpm add @chat-adapter/shared
```

## Utilities

### Adapter helpers

- `extractCard(message)` - extract a `CardElement` from an `AdapterPostableMessage`
- `extractFiles(message)` - extract `FileUpload[]` from an `AdapterPostableMessage`

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

### Error classes

Standardized errors for adapter implementations:

- `AdapterError` - base error class
- `AdapterRateLimitError` - platform rate limit (includes `retryAfter`)
- `AuthenticationError` - expired or invalid tokens
- `NetworkError` - connection failures
- `PermissionError` - missing scopes or permissions
- `ResourceNotFoundError` - missing channel/thread/message
- `ValidationError` - invalid config or input

## License

MIT
