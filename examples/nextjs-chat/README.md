# Next.js Chat Example

A full-featured example app demonstrating the Chat SDK with Next.js. Integrates with Slack, Microsoft Teams, Google Chat, Discord, GitHub, Linear, Instagram, and other supported platforms — configure whichever platforms you need via environment variables.

## Getting started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Redis (for state persistence)
- At least one platform configured (see [Environment variables](#environment-variables))

### Setup

1. Install dependencies from the monorepo root:

```bash
pnpm install
```

2. Copy the example environment file and fill in your platform credentials:

```bash
cp .env.example .env.local
```

3. Start the dev server:

```bash
pnpm dev
```

The app runs at `http://localhost:3000`. Platform webhooks should point to `/api/webhooks/{platform}` (e.g. `/api/webhooks/slack`).

> For local development with real webhooks, use a tunneling tool like [ngrok](https://ngrok.com) or [`localtunnel`](https://github.com/localtunnel/localtunnel).

## What it demonstrates

- **Event handlers** — mentions, thread subscriptions, pattern matching, reactions
- **AI mode** — `@mention AI` to enable streaming LLM responses via the Vercel AI SDK
- **Cards** — interactive JSX-based cards with buttons, dropdowns, and fields
- **Modals** — form dialogs with text inputs, validation, and private metadata
- **Actions** — button clicks and dropdown selections with response handlers
- **Slash commands** — platform-specific command handling
- **Ephemeral messages** — user-only visible messages with DM fallback
- **DMs** — programmatic direct message initiation
- **File uploads** — attachment detection and display
- **Multi-platform** — same bot logic across all six platforms

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── webhooks/[platform]/route.ts   # Main webhook entry point
│   │   └── discord/gateway/route.ts        # Discord gateway cron
│   ├── settings/page.tsx                   # Preview branch config UI
│   └── page.tsx                            # Home page
├── lib/
│   ├── bot.tsx                             # Bot logic and handlers
│   ├── adapters.ts                         # Adapter initialization
│   └── recorder.ts                         # Webhook recording system
└── middleware.ts                            # Preview branch proxy
```

## Environment variables

Copy `.env.example` for the full list. At minimum, set `BOT_USERNAME` and credentials for one platform:

| Variable | Description |
|----------|-------------|
| `BOT_USERNAME` | Bot display name |
| `SLACK_CONNECTOR` | Slack [Vercel Connect](https://vercel.com/docs/connect) connector UID (e.g. `slack/acme-slack`) |
| `SLACK_AGENT_VIEW` | Set to `true` when your Slack manifest uses `agent_view` (see the commented blocks in `slack-manifest.yml`) — enables the Agent messaging experience with auto-applied suggested prompts |
| `SLACK_NATIVE_STREAMING` | Set to `false` to stream via post-and-edit (`chat.update`) instead of Slack's native streaming API — useful on Slack flavours without `chat.startStream` (e.g. GovSlack) |
| `VERCEL_OIDC_TOKEN` | Vercel OIDC token used by Connect (run `vercel env pull`) |
| `TEAMS_APP_ID` | Teams app ID |
| `TEAMS_APP_PASSWORD` | Teams app password |
| `GOOGLE_CHAT_CREDENTIALS` | Google Chat service account JSON |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `DISCORD_PUBLIC_KEY` | Discord interaction verification key |
| `INSTAGRAM_ACCESS_TOKEN` | Instagram User access token |
| `INSTAGRAM_ACCOUNT_ID` | Instagram professional account ID returned by `/me?fields=user_id,username` |
| `INSTAGRAM_APP_SECRET` | Meta app secret used to verify Instagram webhook signatures |
| `INSTAGRAM_VERIFY_TOKEN` | Private value configured as the Instagram webhook verify token |
| `GITHUB_CONNECTOR` | GitHub [Vercel Connect](https://vercel.com/docs/connect) connector UID (needs `VERCEL_OIDC_TOKEN` — run `vercel env pull`) |
| `LINEAR_CONNECTOR` | Linear [Vercel Connect](https://vercel.com/docs/connect) connector UID (needs `VERCEL_OIDC_TOKEN` — run `vercel env pull`) |
| `LINEAR_MODE` | Linear inbound mode: `comments` or `agent-sessions` |
| `NOTION_TOKEN` | Notion connection access token |
| `NOTION_VERIFICATION_TOKEN` | Notion webhook HMAC key (from subscription verification handshake) |
| `NOTION_MENTION_MODE` | Optional: `mention` \| `all-comments` \| `keyword` (adapter default `mention`) |
| `NOTION_KEYWORDS` | Optional: comma-separated keywords when `NOTION_MENTION_MODE=keyword` |
| `REDIS_URL` | Redis connection string |

See the [Chat SDK docs](https://chat-sdk.dev/docs) for full platform setup guides.

For Linear app-actor mode, set `LINEAR_MODE=agent-sessions`, enable **Agent session events** on the webhook, install the Linear app with `actor=app` and `app:mentionable`, and keep using the existing `thread.startTyping()` / `thread.post(...)` handler flow. The adapter maps those calls onto Linear agent activities automatically.

### Test Instagram DMs

1. Add the four required `INSTAGRAM_*` variables to `.env.local`.
2. Expose the app through an HTTPS tunnel or deploy it to Vercel.
3. Configure Meta's callback URL as
   `https://your-domain.com/api/webhooks/instagram`.
4. Subscribe the professional account to the webhook fields:

```bash
curl -X POST \
  "https://graph.instagram.com/v26.0/me/subscribed_apps?subscribed_fields=messages,message_reactions,messaging_postbacks,messaging_seen&access_token=$INSTAGRAM_ACCESS_TOKEN"
```

Send the professional account a DM from another Instagram account. Normal
messages run the example's AI response; send `post-card` to test Instagram
quick replies without invoking the model.

## Recording and replay

The app includes a recording system for capturing production webhook interactions and converting them into replay tests.

```bash
# Enable recording in your environment
RECORDING_ENABLED=true

# List recorded sessions
pnpm recording:list

# Export a session
pnpm recording:export <session-id>
```

See `packages/integration-tests/fixtures/replay/README.md` for the full workflow.

## Preview branch testing

Test PRs with real webhook traffic by proxying requests from production to a preview deployment:

1. Deploy a preview branch to Vercel
2. Go to `/settings` on the production deployment
3. Enter the preview branch URL and save

All webhook requests are proxied until the URL is cleared.
