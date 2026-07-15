[![Microsoft Teams adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/teams/og)](https://chat-sdk.dev/adapters/official/teams)

# @chat-adapter/teams

> npm package: [`@chat-adapter/teams`](https://www.npmjs.com/package/@chat-adapter/teams)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

Microsoft Teams adapter for [Chat SDK](https://chat-sdk.dev).

Documentation: [chat-sdk.dev/adapters/official/teams](https://chat-sdk.dev/adapters/official/teams) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/teams
```

## Scaffold with the CLI

To scaffold a new Microsoft Teams bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter teams memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

The adapter auto-detects `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, and `TEAMS_APP_TENANT_ID` from environment variables:

```typescript
import { Chat } from "chat";
import { createTeamsAdapter } from "@chat-adapter/teams";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    teams: createTeamsAdapter({
      appType: "SingleTenant",
    }),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from Teams!");
});
```

## Bot setup

The [Teams CLI](https://microsoft.github.io/teams-sdk/cli) handles AAD app registration, client secret generation, bot registration, and Teams channel setup in one command.

```bash
npm install -g @microsoft/teams.cli
```

### 1. Create the app

```bash
teams login
teams status          # verify auth + sideloading permissions
teams app create --name "My Bot" --endpoint "https://your-domain.com/api/webhooks/teams" --env .env
```

> [!TIP]
> For local development, use a tunnel (e.g. [devtunnel](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/), ngrok) to expose your local server.

Credentials (`CLIENT_ID`, `CLIENT_SECRET`, `TENANT_ID`) are written to `.env`. Rename them to match the adapter:

```bash
TEAMS_APP_ID=<CLIENT_ID>
TEAMS_APP_PASSWORD=<CLIENT_SECRET>
TEAMS_APP_TENANT_ID=<TENANT_ID>
```

### 2. Install in Teams

Get a direct install link:

```bash
teams app get <appId> --install-link
```

Or download the app package for sideloading:

```bash
teams app package download <appId> -o my-bot.zip
```

Then in Teams: **Apps** > **Manage your apps** > **Upload an app** > **Upload a custom app**.

### 3. Verify

```bash
teams app doctor <appId>
```

Checks bot registration, AAD app health, manifest consistency, and endpoint reachability.

## Configuration

All options are auto-detected from environment variables when not provided. Internally, the adapter maps these options to the Teams SDK (`@microsoft/teams.apps`).

| Option | Required | Description |
|--------|----------|-------------|
| `appId` | No* | Azure Bot App ID. Auto-detected from `TEAMS_APP_ID` |
| `appPassword` | No** | Azure Bot App Password. Auto-detected from `TEAMS_APP_PASSWORD` |
| `federated` | No** | Federated (workload identity) authentication config |
| `appType` | No | `"MultiTenant"` or `"SingleTenant"` (default: `"MultiTenant"`) |
| `appTenantId` | For SingleTenant | Azure AD Tenant ID. Auto-detected from `TEAMS_APP_TENANT_ID` |
| `userName` | No | Bot display name (default: `"bot"`) |
| `apiUrl` | No | Override the Teams API base URL (e.g. for GCC-High or sovereign-cloud deployments). Auto-detected from `TEAMS_API_URL` |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

\*`appId` is required — either via config or `TEAMS_APP_ID` env var.

\*\*Exactly one authentication method is required: `appPassword` or `federated`. When neither is provided, `TEAMS_APP_PASSWORD` is auto-detected from environment.

### Authentication methods

The adapter supports two authentication methods. When no explicit auth is provided, `TEAMS_APP_PASSWORD` is auto-detected from environment variables.

#### Client secret (default)

The simplest option — provide `appPassword` directly or set `TEAMS_APP_PASSWORD`:

```typescript
createTeamsAdapter({
  appPassword: "your_app_password_here",
});
```

#### Federated (workload identity)

For environments with managed identities (e.g. Azure Kubernetes Service, GitHub Actions). Maps to `managedIdentityClientId` in the Teams SDK:

```typescript
createTeamsAdapter({
  federated: {
    clientId: "your_managed_identity_client_id_here",
  },
});
```

## Environment variables

```bash
TEAMS_APP_ID=...
TEAMS_APP_PASSWORD=...
TEAMS_APP_TENANT_ID=...  # Required for SingleTenant apps
TEAMS_API_URL=...        # Optional, for GCC-High or sovereign-cloud deployments
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | Yes |
| Delete message | Yes |
| File uploads | Yes |
| Streaming | Native (DMs) / Buffered fallback (group chats) |

### Rich content

| Feature | Supported |
|---------|-----------|
| Card format | Adaptive Cards |
| Buttons | Yes |
| Link buttons | Yes |
| Select menus | No |
| Tables | GFM |
| Fields | Yes |
| Images in cards | Yes |
| Modals | Yes |

### Conversations

| Feature | Supported |
|---------|-----------|
| Slash commands | No |
| Mentions | Yes |
| Add reactions | No |
| Remove reactions | No |
| Receive reactions | Yes |
| Typing indicator | Yes |
| DMs | Yes |
| Ephemeral messages | No (DM fallback) |
| User lookup (`getUser`) | Yes (requires `User.Read.All`) |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | Yes (requires Graph permissions) |
| Fetch single message | No |
| Fetch thread info | Yes |
| Fetch channel messages | Yes (requires Graph permissions) |
| List threads | Yes (requires Graph permissions) |
| Fetch channel info | Yes (requires Graph permissions) |
| Post channel message | Yes |

## User lookup (`getUser`)

The adapter supports looking up user profiles via the Microsoft Graph API. To enable it:

1. Grant the `User.Read.All` **application permission** in your Azure AD app registration
2. Grant admin consent for the permission

```typescript
const user = await bot.getUser(message.author);
console.log(user?.email);    // "alice@contoso.com"
console.log(user?.fullName); // "Alice Smith"
```

Incoming message authors also include `email` when Graph resolves the sender. The adapter uses the activity's Azure AD object ID first and falls back to its cached ID, so missing permissions or lookup failures leave `message.author.email` undefined without preventing message delivery. This applies to live incoming messages only — authors on edited-message events and messages returned by `fetchMessages` are not hydrated with an email. Resolved profiles are cached in the state adapter for 1 hour (failed lookups for 5 minutes), so busy conversations don't trigger a Graph call per message.

The adapter caches each user's Azure AD object ID from incoming activities for later `getUser` calls. `getUser` returns `null` if the user hasn't been seen or the Graph call fails.

## Message history (`fetchMessages`)

Fetching message history requires `TEAMS_APP_TENANT_ID` and the right permissions depending on the conversation type:

| Context | Permission | Type | Admin consent? |
|---------|-----------|------|---------------|
| Channel | `ChannelMessage.Read.Group` | RSC | No |
| Group chat | `ChatMessage.Read.Chat` | RSC | No |
| DM | `Chat.Read.All` | Azure AD | Yes |

RSC permissions are set via the Teams CLI (no admin consent needed):

```bash
teams app rsc add <appId> ChannelMessage.Read.Group --type Application
teams app rsc add <appId> ChatMessage.Read.Chat --type Application
```

For DM message history, RSC is not sufficient. Add the `Chat.Read.All` Azure AD permission using the [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/):

```bash
az ad app permission add \
  --id <appId> \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions 6b7d71aa-70aa-4810-a8d9-5d9fb2830017=Role

az ad app permission admin-consent --id <appId>
```

Without any of these permissions, `fetchMessages` will throw a `NotImplementedError`.

### Receiving all messages

By default, Teams bots only receive messages when directly @-mentioned. The RSC permissions above (`ChannelMessage.Read.Group` and `ChatMessage.Read.Chat`) also enable receiving all messages in channels and group chats as a side effect.

## Troubleshooting

Run `teams app doctor <appId>` to diagnose common issues — it checks bot registration, AAD app health, manifest consistency, and endpoint reachability.

### "Unauthorized" error

- Verify `TEAMS_APP_ID` and your chosen auth credential are correct
- For client secret auth, check that `TEAMS_APP_PASSWORD` is valid and not expired
- For federated auth, verify the managed identity client ID is correct and that federated credentials are configured in Azure AD
- For SingleTenant apps, ensure `TEAMS_APP_TENANT_ID` is set
- Check that the messaging endpoint URL is correct in Azure

### Bot not appearing in Teams

- Verify the Teams channel is enabled in Azure Bot
- Check that the app manifest is correctly configured
- Ensure the app is installed in the workspace/team

### Messages not received

- Verify the messaging endpoint URL is correct
- Check that your server is accessible from the internet
- Review Azure Bot logs for errors

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
