# @chat-adapter/teams

[![npm version](https://img.shields.io/npm/v/@chat-adapter/teams)](https://www.npmjs.com/package/@chat-adapter/teams)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/teams)](https://www.npmjs.com/package/@chat-adapter/teams)

Microsoft Teams adapter for [Chat SDK](https://chat-sdk.dev).

## Installation

```bash
pnpm add @chat-adapter/teams
```

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
npm install -g @microsoft/teams.cli@preview
```

### 1. Create the app

```bash
teams login
teams app create --name "My Bot" --endpoint "https://your-domain.com/api/webhooks/teams" --env .env
```

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

### Azure bots (optional)

By default, `teams app create` creates a Teams-managed bot (no Azure subscription required). For OAuth connections or SSO, create an Azure bot instead:

```bash
az login
teams app create --name "My Bot" --endpoint "https://your-domain.com/api/webhooks/teams" --env .env --azure --resource-group my-rg
```

### Managing your app

```bash
# Update the messaging endpoint
teams app update <appId> --endpoint "https://new-domain.com/api/webhooks/teams"

# Rotate the client secret
teams app auth secret create <appId> --env .env
```

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
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | Yes |
| Delete message | Yes |
| File uploads | Yes |
| Streaming | Post+Edit fallback |

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

## Message history (`fetchMessages`)

Fetching message history requires the Microsoft Graph API with client credentials flow. To enable it:

1. Set `appTenantId` in the adapter config (or `TEAMS_APP_TENANT_ID` env var)
2. Grant one of these Azure AD app permissions:
   - `ChatMessage.Read.Chat`
   - `Chat.Read.All`
   - `Chat.Read.WhereInstalled`

Without these permissions, `fetchMessages` will throw a `NotImplementedError`.

### Receiving all messages

By default, Teams bots only receive messages when directly @-mentioned. To receive all messages in a channel or group chat, add the RSC permission:

```bash
teams app rsc add <appId> ChannelMessage.Read.Group --type Application
```

## Troubleshooting

Run `teams app doctor <appId>` to diagnose common issues — it checks bot registration, AAD app health, manifest consistency, and endpoint reachability.

### "Unauthorized" error

- Verify `TEAMS_APP_ID` and your chosen auth credential are correct
- Check that `TEAMS_APP_PASSWORD` is valid and not expired (rotate with `teams app auth secret create`)
- For federated auth, verify the managed identity client ID is correct and that federated credentials are configured in Azure AD
- For SingleTenant apps, ensure `TEAMS_APP_TENANT_ID` is set

### Bot not appearing in Teams

- Run `teams app doctor` to check registration and channel status
- Check that the app manifest is correctly configured
- Ensure the app is installed in the workspace/team

### Messages not received

- Verify the messaging endpoint is correct (`teams app update --endpoint`)
- Check that your server is accessible from the internet

## License

MIT
