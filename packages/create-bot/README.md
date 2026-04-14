# create-bot

Scaffold a new [Chat SDK](https://chat-sdk.dev) bot project.

Chat SDK is a unified TypeScript SDK by Vercel for building chat bots across Slack, Teams, Google Chat, Discord, WhatsApp, and more.

## Quick Start

```bash
npx create-bot my-bot
```

Or with your preferred package manager:

```bash
pnpm create bot my-bot
yarn create bot my-bot
bunx create-bot my-bot
```

The CLI walks you through selecting platform adapters, a state adapter, and installs dependencies for you.

## Usage

```
Usage: create-bot [options] [name]

Arguments:
  name                      name of the project

Options:
  -d, --description <text>  project description
  --adapter <values...>     platform or state adapters to include (skips interactive prompt)
  --pm <manager>            package manager to use (npm, yarn, pnpm, bun)
  -y, --yes                 skip confirmation prompts (accept defaults)
  -q, --quiet               suppress non-essential output
  --no-color                disable color output (respects NO_COLOR)
  -h, --help                display help for command
```

## Examples

Interactive mode (prompts for everything):

```bash
npx create-bot
```

Provide a name and let the CLI prompt for the rest:

```bash
npx create-bot my-bot
```

Skip adapter prompts by passing them directly:

```bash
npx create-bot my-bot --adapter slack teams redis
```

Fully non-interactive:

```bash
npx create-bot my-bot -d 'My awesome bot' --adapter slack redis -y
```

Silent non-interactive (for CI/scripts):

```bash
npx create-bot my-bot --adapter slack pg -yq --pm pnpm
```

## Available Adapters

### Messaging Platforms

| Adapter | Flag value | Package |
| --- | --- | --- |
| Slack | `slack` | `@chat-adapter/slack` |
| Microsoft Teams | `teams` | `@chat-adapter/teams` |
| Google Chat | `gchat` | `@chat-adapter/gchat` |
| Discord | `discord` | `@chat-adapter/discord` |
| Telegram | `telegram` | `@chat-adapter/telegram` |
| WhatsApp | `whatsapp` | `@chat-adapter/whatsapp` |
| Beeper Matrix | `matrix` | `@beeper/chat-adapter-matrix` |
| Photon iMessage | `imessage` | `chat-adapter-imessage` |
| Zernio | `zernio` | `@zernio/chat-sdk-adapter` |

### Developer Tools

| Adapter | Flag value | Package |
| --- | --- | --- |
| GitHub | `github` | `@chat-adapter/github` |
| Linear | `linear` | `@chat-adapter/linear` |
| Resend | `resend` | `@resend/chat-sdk-adapter` |
| Liveblocks | `liveblocks` | `@liveblocks/chat-sdk-adapter` |

### State

| Adapter | Flag value | Package | Notes |
| --- | --- | --- | --- |
| In-Memory | `memory` | `@chat-adapter/state-memory` | Development only |
| Redis | `redis` | `@chat-adapter/state-redis` | node-redis driver |
| ioredis | `ioredis` | `@chat-adapter/state-ioredis` | ioredis driver |
| PostgreSQL | `pg` | `@chat-adapter/state-pg` | |

## What You Get

The scaffolded project is a Next.js app with:

- **`src/lib/bot.ts`** — Bot configuration with your selected adapters
- **`src/app/api/webhooks/[platform]/route.ts`** — Dynamic webhook route
- **`.env.example`** — Pre-populated with the environment variables for your adapters
- **`next.config.ts`** — Configured with any required `serverExternalPackages`

## After Scaffolding

```bash
cd my-bot
cp .env.example .env.local
# Fill in your credentials in .env.local
npm run dev
```

See the [Chat SDK docs](https://chat-sdk.dev/docs) for platform setup guides and API reference.

## License

MIT
