# @chat-adapter/teams

[![npm version](https://img.shields.io/npm/v/@chat-adapter/teams)](https://www.npmjs.com/package/@chat-adapter/teams)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/teams)](https://www.npmjs.com/package/@chat-adapter/teams)

Microsoft Teams adapter for [Chat SDK](https://chat-sdk.dev). Configure with Azure Bot Service.

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

## Azure Bot setup

### 1. Create Azure Bot resource

1. Go to [portal.azure.com](https://portal.azure.com)
2. Click **Create a resource**
3. Search for **Azure Bot** and select it
4. Click **Create** and fill in:
   - **Bot handle**: Unique identifier for your bot
   - **Subscription**: Your Azure subscription
   - **Resource group**: Create new or use existing
   - **Pricing tier**: F0 (free) for testing
   - **Type of App**: **Single Tenant** (recommended for enterprise)
   - **Creation type**: **Create new Microsoft App ID**
5. Click **Review + create** then **Create**

### 2. Get app credentials

1. Go to your Bot resource then **Configuration**
2. Copy **Microsoft App ID** as `TEAMS_APP_ID`
3. Click **Manage Password** (next to Microsoft App ID)
4. In the App Registration page, go to **Certificates & secrets**
5. Click **New client secret**, add description, select expiry, click **Add**
6. Copy the **Value** immediately (shown only once) as `TEAMS_APP_PASSWORD`
7. Go to **Overview** and copy **Directory (tenant) ID** as `TEAMS_APP_TENANT_ID`

### 3. Configure messaging endpoint

1. In your Azure Bot resource, go to **Configuration**
2. Set **Messaging endpoint** to `https://your-domain.com/api/webhooks/teams`
3. Click **Apply**

### 4. Enable Teams channel

1. In your Azure Bot resource, go to **Channels**
2. Click **Microsoft Teams**
3. Accept the terms of service
4. Click **Apply**

### 5. Create Teams app package

Create a `manifest.json` file:

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "your_app_id_here",
  "packageName": "com.yourcompany.chatbot",
  "developer": {
    "name": "Your Company",
    "websiteUrl": "https://your-domain.com",
    "privacyUrl": "https://your-domain.com/privacy",
    "termsOfUseUrl": "https://your-domain.com/terms"
  },
  "name": {
    "short": "Chat Bot",
    "full": "Chat SDK Demo Bot"
  },
  "description": {
    "short": "A chat bot powered by Chat SDK",
    "full": "A chat bot powered by Chat SDK that responds to messages and commands."
  },
  "icons": {
    "outline": "outline.png",
    "color": "color.png"
  },
  "accentColor": "#FFFFFF",
  "bots": [
    {
      "botId": "your_app_id_here",
      "scopes": ["personal", "team", "groupchat"],
      "supportsFiles": false,
      "isNotificationOnly": false
    }
  ],
  "permissions": ["identity", "messageTeamMembers"],
  "validDomains": ["your-domain.com"]
}
```

Create icon files (32x32 `outline.png` and 192x192 `color.png`), then zip all three files together.

### 6. Upload app to Teams

**For testing (sideloading):**

1. In Teams, click **Apps** in the sidebar
2. Click **Manage your apps** then **Upload an app**
3. Click **Upload a custom app** and select your zip file

**For organization-wide deployment:**

1. Go to [Teams Admin Center](https://admin.teams.microsoft.com)
2. Go to **Teams apps** then **Manage apps**
3. Click **Upload new app** and select your zip file
4. Go to **Setup policies** to control who can use the app

## Configuration

All options are auto-detected from environment variables when not provided.

| Option | Required | Description |
|--------|----------|-------------|
| `appId` | No* | Azure Bot App ID. Auto-detected from `TEAMS_APP_ID` |
| `appPassword` | No** | Azure Bot App Password. Auto-detected from `TEAMS_APP_PASSWORD` |
| `certificate` | No** | Certificate-based authentication config |
| `federated` | No** | Federated (workload identity) authentication config |
| `appType` | No | `"MultiTenant"` or `"SingleTenant"` (default: `"MultiTenant"`) |
| `appTenantId` | For SingleTenant | Azure AD Tenant ID. Auto-detected from `TEAMS_APP_TENANT_ID` |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

\*`appId` is required — either via config or `TEAMS_APP_ID` env var.

\*\*Exactly one authentication method is required: `appPassword`, `certificate`, or `federated`.

### Authentication methods

The adapter supports three mutually exclusive authentication methods. When no explicit auth is provided, `TEAMS_APP_PASSWORD` is auto-detected from environment variables.

#### Client secret (default)

The simplest option — provide `appPassword` directly or set `TEAMS_APP_PASSWORD`:

```typescript
createTeamsAdapter({
  appPassword: "your_app_password_here",
});
```

#### Certificate

Authenticate with a PEM certificate. Provide either `certificateThumbprint` or `x5c` (public certificate for subject-name validation):

```typescript
createTeamsAdapter({
  certificate: {
    certificatePrivateKey: "-----BEGIN RSA PRIVATE KEY-----\n...",
    certificateThumbprint: "AB1234...", // hex-encoded thumbprint
  },
});
```

Or with subject-name validation:

```typescript
createTeamsAdapter({
  certificate: {
    certificatePrivateKey: "-----BEGIN RSA PRIVATE KEY-----\n...",
    x5c: "-----BEGIN CERTIFICATE-----\n...",
  },
});
```

#### Federated (workload identity)

For environments with managed identities (e.g. Azure Kubernetes Service, GitHub Actions):

```typescript
createTeamsAdapter({
  federated: {
    clientId: "your_managed_identity_client_id_here",
    clientAudience: "api://AzureADTokenExchange", // optional, this is the default
  },
});
```

## Environment variables

```bash
TEAMS_APP_ID=...
TEAMS_APP_PASSWORD=...
TEAMS_APP_TENANT_ID=...  # Required for SingleTenant
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
| Modals | No |

### Conversations

| Feature | Supported |
|---------|-----------|
| Slash commands | No |
| Mentions | Yes |
| Add reactions | No |
| Remove reactions | No |
| Typing indicator | No |
| DMs | Yes |
| Ephemeral messages | No (DM fallback) |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | Yes |
| Fetch single message | No |
| Fetch thread info | Yes |
| Fetch channel messages | Yes |
| List threads | Yes |
| Fetch channel info | Yes |
| Post channel message | Yes |

## Limitations

- **Adding reactions**: Teams Bot Framework doesn't support bots adding reactions. Calling `addReaction()` or `removeReaction()` throws a `NotImplementedError`. The bot can still receive reaction events via `onReaction()`.
- **Typing indicators**: Not available via Bot Framework. `startTyping()` is a no-op.

### Message history (`fetchMessages`)

Fetching message history requires the Microsoft Graph API with client credentials flow. To enable it:

1. Set `appTenantId` in the adapter config
2. Grant one of these Azure AD app permissions:
   - `ChatMessage.Read.Chat`
   - `Chat.Read.All`
   - `Chat.Read.WhereInstalled`

Without these permissions, `fetchMessages` will not be able to retrieve channel history.

### Receiving all messages

By default, Teams bots only receive messages when directly @-mentioned. To receive all messages in a channel or group chat, add Resource-Specific Consent (RSC) permissions to your Teams app manifest:

```json
{
  "authorization": {
    "permissions": {
      "resourceSpecific": [
        {
          "name": "ChannelMessage.Read.Group",
          "type": "Application"
        }
      ]
    }
  }
}
```

Alternatively, configure the bot in Azure to receive all messages.

## Troubleshooting

### "Unauthorized" error

- Verify `TEAMS_APP_ID` and your chosen auth credential are correct
- For client secret auth, check that `TEAMS_APP_PASSWORD` is valid
- For certificate auth, ensure the private key and thumbprint/x5c match what's registered in Azure AD
- For federated auth, verify the managed identity client ID and audience are correct
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

## License

MIT
