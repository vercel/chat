# @chat-adapter/imessage

[![npm version](https://img.shields.io/npm/v/@chat-adapter/imessage)](https://www.npmjs.com/package/@chat-adapter/imessage)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/imessage)](https://www.npmjs.com/package/@chat-adapter/imessage)

iMessage adapter for [Chat SDK](https://chat-sdk.dev/docs). Supports both local (on-device) and remote ([photon](https://photon.codes)-based) iMessage integration.

## Installation

```bash
npm install chat @chat-adapter/imessage
```

## Usage

```typescript
import { Chat } from "chat";
import { createiMessageAdapter } from "@chat-adapter/imessage";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    imessage: createiMessageAdapter({
      serverUrl: process.env.IMESSAGE_SERVER_URL!,
      apiKey: process.env.IMESSAGE_API_KEY!,
    }),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from iMessage!");
});
```

## Documentation

Full setup instructions, configuration reference, and features at [chat-sdk.dev/docs/adapters/imessage](https://chat-sdk.dev/docs/adapters/imessage).

## License

MIT
