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

The adapter caches each user's Azure AD object ID from incoming activities, so `getUser` only works for users who have previously interacted with the bot. Returns `null` if the user hasn't been seen or the Graph call fails.

## Message history (`fetchMessages`)

Fetching message history requires the Microsoft Graph API with client credentials flow. To enable it:

1. Set `appTenantId` in the adapter config (or `TEAMS_APP_TENANT_ID` env var)
2. Grant one of these Azure AD app permissions:
   - `ChatMessage.Read.Chat`
   - `Chat.Read.All`
   - `Chat.Read.WhereInstalled`

Without these permissions, `fetchMessages` will throw a `NotImplementedError`.

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

## License

MIT
