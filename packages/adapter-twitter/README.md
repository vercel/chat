# @chat-adapter/twitter

[![npm version](https://img.shields.io/npm/v/@chat-adapter/twitter)](https://www.npmjs.com/package/@chat-adapter/twitter)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/twitter)](https://www.npmjs.com/package/@chat-adapter/twitter)

Twitter / X Webhooks adapter for [Chat SDK](https://chat-sdk.dev/docs).

This adapter uses the **X Account Activity API** (Enterprise/Pro tier required) to receive Direct Messages in real-time and the **X API v2** to send responses.

## Installation

```bash
npm install chat @chat-adapter/twitter
```

## Usage

```typescript
import { Chat } from "chat";
import { createTwitterAdapter } from "@chat-adapter/twitter";
import { createMemoryState } from "@chat-adapter/state-memory";

const bot = new Chat({
  userName: "my_twitter_bot",
  adapters: {
    twitter: createTwitterAdapter({
      consumerKey: process.env.TWITTER_CONSUMER_KEY!,
      consumerSecret: process.env.TWITTER_CONSUMER_SECRET!,
      accessToken: process.env.TWITTER_ACCESS_TOKEN!,
      accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET!,
      bearerToken: process.env.TWITTER_BEARER_TOKEN!,
    }),
  },
  state: createMemoryState(), // Required for deduping
});

// Twitter DMs are treated as standard messages (not mentions)
bot.onNewMessage(async (thread, message) => {
  await thread.post(`Echo: ${message.text}`);
});
```

## Environment variables

If you don't pass options into `createTwitterAdapter()`, it will automatically read from these environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `TWITTER_CONSUMER_KEY` | Yes | App API Key |
| `TWITTER_CONSUMER_SECRET` | Yes | App API Secret |
| `TWITTER_ACCESS_TOKEN` | Yes | Bot account access token |
| `TWITTER_ACCESS_TOKEN_SECRET` | Yes | Bot account access token secret |
| `TWITTER_BEARER_TOKEN` | Yes | App Bearer token (for v2 read endpoints) |
| `TWITTER_BOT_USERNAME` | No | Override the bot display name |
| `TWITTER_WEBHOOK_ENV` | No | Account Activity environment name (default: "production") |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `consumerKey` | `string` | `process.env.TWITTER_CONSUMER_KEY` | App API Key |
| `consumerSecret` | `string` | `process.env.TWITTER_CONSUMER_SECRET` | App API Secret for CRC hashing |
| `accessToken` | `string` | `process.env.TWITTER_ACCESS_TOKEN` | Bot account access token |
| `accessTokenSecret` | `string` | `process.env.TWITTER_ACCESS_TOKEN_SECRET` | Bot account access token secret |
| `bearerToken` | `string` | `process.env.TWITTER_BEARER_TOKEN` | App Bearer token |
| `userName` | `string` | `process.env.TWITTER_BOT_USERNAME` | Bot display name |
| `apiBaseUrl` | `string` | `"https://api.twitter.com"` | Override domain for testing |

## Platform setup

1. Create a project in the [X Developer Portal](https://developer.x.com).
2. Generate your **Consumer Key**, **Consumer Secret**, and **Bearer Token**.
3. Set up **OAuth 1.0a User Authentication** in your app settings with Read/Write/Direct Messages permissions.
4. Generate the **Access Token** and **Access Token Secret** for your bot account.
5. Apply for the **Account Activity API** (requires Pro or Enterprise access).
6. Start your server so the webhook endpoint is active.
7. Register your webhook URL and subscribe your bot account using the Account Activity API.

## Features

- **Direct Messages**: Receive and reply to 1-1 DMs
- **CRC Hashing**: Automatically responds to Twitter's Challenge-Response Checks
- **Media Attachments**: Extracts image and video URLs from incoming DMs
- **Plain Text Rendering**: Automatically converts markdown AST to plain text (with ASCII tables) since Twitter DMs don't support rich formatting

### Limitations
- **No Message Editing**: The Twitter API does not support editing DMs. `editMessage` throws `NotImplementedError`.
- **Typing Indicators**: The X API doesn't support bot typing indicators.
- **Rate Limits**: The DM API is subject to X's strict rate limits.
- **Premium Tier Requirement**: Requires Account Activity API access, which is not available on free or basic tiers.

## License

MIT
