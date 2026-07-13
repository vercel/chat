# create-chat-sdk

> npm package: [`create-chat-sdk`](https://www.npmjs.com/package/create-chat-sdk)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Scaffold a webhook-only [Chat SDK](https://chat-sdk.dev) bot project from the command line.

Documentation: [chat-sdk.dev/docs/create-chat-sdk](https://chat-sdk.dev/docs/create-chat-sdk) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Usage

```bash
npm create chat-sdk@latest my-bot
```

With another package manager:

```bash
pnpm create chat-sdk@latest my-bot
yarn create chat-sdk my-bot
bunx create-chat-sdk@latest my-bot
```

## Non-interactive mode

Pass platform and state adapters with `--adapter`:

```bash
npm create chat-sdk@latest -- my-bot --adapter slack redis -y
```

With npm, the `--` separator is required — npm consumes flags before it instead of forwarding them to the CLI. `pnpm create` and `yarn create` forward flags without it.

Adapter values come from the `chat/adapters` catalog. The default interactive prompt lists official adapters. Pass `--vendor` to list vendor-official adapters instead. For automation and coding agents, pass official or vendor adapter slugs directly with `--adapter`. Community adapters are not scaffolded.

When the CLI detects a coding agent environment, it announces the detection and automatically runs in non-interactive mode. Pass at least one platform adapter with `--adapter`; the state adapter defaults to `memory`. If no project name is provided, the default name is `my-bot`. Pass `--interactive` to force prompts.

## Vercel Connect

The Slack, GitHub, and Linear adapters can authenticate with [Vercel Connect](https://chat-sdk.dev/docs/vercel-connect) instead of stored provider secrets. Pass `--connect`, or choose **Vercel Connect** at the interactive auth-mode prompt:

```bash
npm create chat-sdk@latest -- my-bot --adapter slack --connect -y
```

The generated bot spreads the matching helper from `@vercel/connect/chat` into the adapter factory, adds `@vercel/connect` to dependencies, and lists each connector UID (such as `SLACK_CONNECTOR`) in `.env.example` instead of native secrets.

## Options

```txt
Usage: create-chat-sdk [options] [name]

Arguments:
  name                      name of the project

Options:
  -d, --description <text>  project description
  --adapter <values...>     platform or state adapters to include
  --vendor                  list vendor-official adapters in the interactive
                            prompt
  --connect                 authenticate Slack, GitHub, and Linear adapters
                            with Vercel Connect
  --pm <manager>            package manager to use (npm, yarn, pnpm, bun)
  -y, --yes                 skip prompts and accept defaults
  --interactive             always prompt, even when a coding agent
                            environment is detected
  -f, --force               overwrite generated files in an existing directory
  -s, --skip-install        skip dependency installation
  --no-git                  skip git repository initialization
  -q, --quiet               suppress non-essential output
  -h, --help                display help for command
```

Color output follows the [NO_COLOR standard](https://no-color.org/) — set `NO_COLOR=1` to disable colors.

## Generated project

The generated project is a minimal Next.js API app:

- `src/lib/bot.ts` — generated Chat SDK bot configuration
- `src/app/api/webhooks/[platform]/route.ts` — dynamic webhook route
- `src/app/api/chat/route.ts` — generated only when the Web adapter is selected
- `.env.example` — generated from selected adapter env specs
- `next.config.ts` — generated server config and externals
- `package.json` — generated adapter, peer, and extra dependencies
- `.chat-sdk.json` — generated file ownership used by safe `--force` reruns

The template does not include pages, layouts, or a client UI.

## Development

```bash
pnpm --filter create-chat-sdk build
pnpm --filter create-chat-sdk typecheck
pnpm --filter create-chat-sdk test
```

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

## Documentation

Full documentation is available at [chat-sdk.dev/docs/create-chat-sdk](https://chat-sdk.dev/docs/create-chat-sdk).

- [Getting Started](https://chat-sdk.dev/docs/getting-started) — first steps with Chat SDK
- [Platform Adapters](https://chat-sdk.dev/docs/platform-adapters) — supported platform adapters
- [State Adapters](https://chat-sdk.dev/docs/state-adapters) — persistence, locking, and dedupe options
- [Adapters](https://chat-sdk.dev/adapters) — full adapter catalog

## License

MIT
