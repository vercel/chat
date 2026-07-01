# Build your own Slackbot with Vercel Connect

**Author:** Ben Sabic

---

You can build an AI-powered Slack bot that responds to mentions, maintains conversation history, and calls tools autonomously, without storing a long-lived Slack bot token or signing secret in your environment. Chat SDK handles the platform integration (e.g., webhooks and message formatting) and AI SDK's `ToolLoopAgent` runs the reasoning loop that lets your agent call tools and act on results. [Vercel Connect](https://vercel.com/connect) issues a user-authorized Slack token at runtime and forwards Slack events to your project, keeping credentials scoped to the environments that need them.

You'll create a Slack connector using Vercel Connect, link it to your project, and request a scoped runtime token from your agent's code. Along the way, you'll enable streaming responses, tool calling, and more using Redis and the [Vercel AI Gateway](https://vercel.com/ai-gateway).

> **Vercel Connect is in beta and available on all plans.** Features and behavior, including available connectors and trigger forwarding, may change before general availability. Usage is subject to the [Beta Agreement](https://vercel.com/docs/release-phases/public-beta-agreement) and [Vercel Connect terms](https://vercel.com/docs/connect/legal).

## Prerequisites

Before you begin, make sure you have:

*   Node.js 20+ and a package manager (e.g., [pnpm](https://pnpm.io/))
    
*   Access to a Vercel team and project with Vercel Connect enabled
    
*   Vercel CLI installed (`npm i -g vercel`)
    
*   A Slack workspace where you can install an app
    

## How it works

Chat SDK is a unified TypeScript SDK for building chatbots across Slack, Teams, Discord, and other platforms. You register event handlers (like `onNewMention` and `onSubscribedMessage`), and the SDK routes incoming webhooks to them. The Slack adapter handles message parsing and Slack API interactions. The Redis state adapter tracks which threads your bot has subscribed to and manages distributed locking to handle concurrent messages.

AI SDK's `ToolLoopAgent` wraps a language model with tools and runs an autonomous loop: the model generates text or calls a tool, the SDK executes the tool, feeds the result back, and repeats until the model finishes. When you pass a model string like `"anthropic/claude-opus-4.8"`, and host your application on Vercel, the AI SDK will route the request through the AI Gateway automatically.

Chat SDK accepts any `AsyncIterable<string>` as a message, so you can pass the agent's `fullStream` directly to `thread.post()` for real-time streaming in Slack.

Vercel Connect provides Slack credentials at runtime, so you don't have to manage a static bot token. You register a Slack connector once, link it to your project, then call `getToken` from your code for a short-lived, scoped Slack token. Connect also forwards inbound Slack events to a trigger destination you register on the connector. For this agent, that destination is your project at `/api/webhooks/slack`.

Connect handles authentication in both directions:

*   For outbound calls to the Slack API, `getToken` from `@vercel/connect` gives your agent a short-lived Slack token.
    
*   For inbound events, Connect verifies them with Slack and forwards them to your app. Your `webhookVerifier` then confirms each one came from Connect using `verifyVercelOidcToken` from `@vercel/oidc`.
    

## Steps

### 1\. Scaffold the project, install dependencies, and add the Vercel Plugin

Create a new [Next.js](https://nextjs.org/) app and add your dependencies:

`npx create-next-app@latest my-slack-agent --typescript --app cd my-slack-agent pnpm add chat @chat-adapter/slack @chat-adapter/state-redis ai zod @vercel/connect @vercel/oidc`

Here's what each package does:

*   The `chat` package is the Chat SDK core.
    
*   The `@chat-adapter/slack` and `@chat-adapter/state-redis` packages are the [Slack platform adapter](https://chat-sdk.dev/adapters/slack) and [Redis state adapter](https://chat-sdk.dev/adapters/redis), respectively.
    
*   The `ai` package is the AI SDK, and includes the [AI Gateway provider](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway).
    
*   `zod` is used to define tool input schemas.
    
*   `@vercel/connect` is the Vercel Connect SDK, which provides `getToken`.
    
*   `@vercel/oidc` verifies the Bearer OIDC token on Connect-forwarded webhooks (`verifyVercelOidcToken`).
    

* * *

The [Vercel Plugin](https://vercel.com/docs/agent-resources/vercel-plugin) turns your AI coding agent (e.g., OpenAI Codex, Claude Code, or Cursor) into a Vercel expert. It adds skills, slash commands, and current knowledge of the tools this template uses, including Vercel Connect, Chat SDK, and AI SDK. The plugin is optional; it isn't required to build your Slackbot or to follow this guide.

`npx plugins add vercel/vercel-plugin`

### 2\. Create a Slack connector with Vercel Connect

Vercel Connect creates and manages the Slack app for you. You don't register an app at [api.slack.com](https://api.slack.com), write a manifest, or copy any credentials. You create a connector in the Vercel dashboard, set its scopes and events there, and install it in your workspace.

Open the [Connect page](https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fconnect) on your team's dashboard, then click Create Connector to start the Add Connection flow. Once you've done that:

1.  Choose Slack as the provider.
    
2.  Select your Slack workspace and name the app (e.g., `acme-slack`). If you haven't connected a Slack workspace yet, connect and authorize one first, then return to the [Connect page](https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fconnect). Keep Triggers enabled so Slack events reach your project.
    
3.  Open Advanced and set:
    
    *   Bot Scopes the agent needs: `chat:write`, `channels:history`, `channels:read`, `groups:history`, `im:history`, `mpim:history`, `reactions:write`, and `users:read`.
        
    *   Trigger Event Types to forward: `app_mention`, plus the message events for the surfaces your agent supports (`message.channels`, `message.groups`, `message.im`, `message.mpim`), so both new mentions and follow-up replies work.
        
4.  Click Create Slack Connector, then Install to your Slack Workspace.
    
5.  In the connector's settings, link it to your project, select the environments it applies to (e.g., production), and register your project as a trigger destination with the path `/api/webhooks/slack`, the route you'll create in step seven.
    

Because Connect manages the Slack app, Slack delivers events to Connect's intake URL (shown in the connector settings), not directly to your deployment's `/api/webhooks/slack`. Connect verifies Slack, then forwards each event to the trigger destination you registered.

### 3\. Provision Redis and pull environment variables

Your agent uses Redis for thread subscriptions and distributed locking. Provision [Upstash Redis](https://vercel.com/marketplace/upstash) and connect it to your project with the Vercel CLI:

`vercel link vercel integration add upstash`

`vercel integration add` installs the Upstash integration if it isn't already, provisions a database, connects it to your project, and pulls its connection environment variables into `.env.local`. Follow the prompts to pick the Redis product and a plan.

To use the dashboard instead, open the [Storage](https://vercel.com/d?to=%2F%5Bteam%5D%2F%5Bproject%5D%2Fstores) page for your project, click Create Database, and follow the flow to add Upstash Redis. Then sync the variables locally:

`vercel env pull`

`vercel env pull` also adds a `VERCEL_OIDC_TOKEN`, which AI SDK uses to authenticate requests to the AI Gateway, so there's no API key to generate or store. The OIDC token expires after 12 hours, so re-run `vercel env pull` to refresh it, or start the dev server with `vercel dev` to refresh it automatically. Linking the project also lets Vercel Connect resolve the connector when your code calls `getToken`.

You should see `REDIS_URL` (from Upstash) and `VERCEL_OIDC_TOKEN` (for AI Gateway and `@vercel/connect`). You should not add `SLACK_BOT_TOKEN` or `SLACK_SIGNING_SECRET`.

### 4\. Define your agent's tools

Create `lib/tools.ts` with the tools your agent can call. This example defines a weather tool and a docs tool, but you can add any tools your use case requires:

``import { tool } from "ai"; import { z } from "zod"; export const tools = { getWeather: tool({ description: "Get the current weather for a location", inputSchema: z.object({ location: z.string().describe("City name, e.g. San Francisco"), }), execute: async ({ location }) => { // Replace with a real weather API call const response = await fetch( `https://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=${encodeURIComponent(location)}` ); const data = await response.json(); return { location, temperature: data.current.temp_f, condition: data.current.condition.text, }; }, }), searchDocs: tool({ description: "Search the company documentation for a topic", inputSchema: z.object({ query: z.string().describe("The search query"), }), execute: async ({ query }) => { // Replace with your actual search implementation return { results: [`Result for: ${query}`] }; }, }), };``

Each tool has a `description` (which tells the model when to use it), an `inputSchema` (a Zod schema that the model fills in), and an `execute` function that runs when the tool is called. If a tool calls another provider that Vercel Connect supports (e.g., GitHub), it can request a scoped token for itself.

### 5\. Create the Connect webhook verifier

Before the bot can trust an incoming event, it needs to verify the OIDC Bearer token that Connect attaches to each forwarded webhook. Create `lib/slack-connect-webhook-verifier.ts`:

`import { verifyVercelOidcToken } from "@vercel/oidc"; const BEARER_TOKEN_PATTERN = /^Bearer\s+(.+)$/i; export async function verifySlackConnectWebhook( request: Request ): Promise<true> { const token = request.headers .get("authorization") ?.match(BEARER_TOKEN_PATTERN)?.[1] ?.trim(); if (!token) { throw new Error("Missing Authorization bearer token"); } await verifyVercelOidcToken(token); return true; }`

`verifyVercelOidcToken` checks the JWT against Vercel's JWKS and, by default, matches `project_id` and `environment` to `VERCEL_PROJECT_ID` and `VERCEL_ENV` on the deployment. Returning `true` tells the adapter the body is trusted; throwing or returning a falsy value yields a `401`. When you use `webhookVerifier`, the adapter doesn't run Slack's 5-minute timestamp check, since Connect is your freshness boundary.

For more details, see the [OIDC API reference](https://vercel.com/docs/oidc/api) and [Connect triggers](https://vercel.com/docs/connect/concepts/triggers).

### 6\. Create the agent and bot

Create `lib/bot.ts` with a `ToolLoopAgent` and a `Chat` instance.

Instead of reading a long-lived `SLACK_BOT_TOKEN`, the Slack adapter fetches a short-lived token with Vercel Connect:

`import { Chat } from "chat"; import { toAiMessages } from "chat/ai"; import { createSlackAdapter } from "@chat-adapter/slack"; import { createRedisState } from "@chat-adapter/state-redis"; import { ToolLoopAgent } from "ai"; import { getToken } from "@vercel/connect"; import { tools } from "./tools"; import { verifySlackConnectWebhook } from "./slack-connect-webhook-verifier"; const agent = new ToolLoopAgent({ model: "anthropic/claude-opus-4.8", instructions: "You are a helpful AI assistant in a Slack workspace. " + "Answer questions clearly and use your tools when you need " + "real-time data. Keep responses concise and well-formatted for chat.", tools, }); export const bot = new Chat({ userName: "ai-agent", adapters: { slack: createSlackAdapter({ // Outbound: short-lived Slack token from Connect botToken: () => getToken("slack/acme-slack", { subject: { type: "app" } }), // Inbound: verify Connect-forwarded OIDC Bearer token webhookVerifier: verifySlackConnectWebhook, }), }, state: createRedisState(), }); // Handle first-time mentions bot.onNewMention(async (thread, message) => { await thread.subscribe(); const result = await agent.stream({ prompt: message.text }); await thread.post(result.fullStream); }); // Handle follow-up messages in subscribed threads bot.onSubscribedMessage(async (thread, message) => { const allMessages = []; for await (const msg of thread.allMessages) { allMessages.push(msg); } const history = await toAiMessages(allMessages); const result = await agent.stream({ messages: history }); await thread.post(result.fullStream); });`

The `botToken` option accepts a function that returns a token, and the adapter calls it on each Slack API request. That makes it a natural fit for Vercel Connect's short-lived tokens, since `getToken` returns a fresh token for the connector's installation each time. Request the token with subject `app` so the agent acts as the application itself; the bot scopes you set on the connector determine what the token can do.

Replace `slack/acme-slack` with your connector UID from the Connect dashboard or `vercel connect list`.

Pass `webhookVerifier` whenever Slack events arrive via Connect triggers. Omit `signingSecret` and don't set `SLACK_SIGNING_SECRET`. If both are present, `webhookVerifier` wins, but leaving `SLACK_SIGNING_SECRET` unset avoids mixing direct-Slack and Connect modes.

When someone tags the bot, `onNewMention` fires. The handler subscribes to the thread (to track future messages in that thread) and streams the agent's response.

For follow-up messages, `onSubscribedMessage` retrieves the full thread history using `thread.allMessages`, converts it to the AI SDK message format with `toAiMessages`, and passes it to the agent so it has complete conversation context.

Using `fullStream` is preferred over `textStream` because it preserves paragraph breaks between tool-calling steps. Chat SDK auto-detects the stream type and handles Slack's native streaming API for real-time updates.

### 7\. Wire up the webhook route

Create the API route at `app/api/webhooks/[platform]/route.ts`:

``import { after } from "next/server"; import { bot } from "@/lib/bot"; type Platform = keyof typeof bot.webhooks; export async function POST( request: Request, context: RouteContext<"/api/webhooks/[platform]"> ) { const { platform } = await context.params; const handler = bot.webhooks[platform as Platform]; if (!handler) { return new Response(`Unknown platform: ${platform}`, { status: 404 }); } return handler(request, { waitUntil: (task) => after(() => task), }); }``

This creates a `POST /api/webhooks/slack` endpoint. The `waitUntil` option ensures your event handlers finish processing after the HTTP response is sent, which is required on serverless platforms where the function would otherwise terminate early.

With trigger forwarding enabled, Connect POSTs verified Slack payloads to this route. Verification happens in `webhookVerifier` before the adapter parses the body. The route itself stays unchanged. Only the adapter config gains `webhookVerifier`.

### 8\. Test the agent

Slack sends events to Connect, which forwards them to a deployed Vercel project rather than to your machine. You test the full round trip against a preview or development deployment, with no local tunnel to spin up. Your app rejects direct Slack POSTs unless you add a separate direct-webhook path with `SLACK_SIGNING_SECRET`.

1.  Deploy a preview build to receive the Slack events:
    

`vercel`

1.  In the [connector's settings](https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fconnect?service=slack), make sure that deployment's environment is linked and registered as the trigger destination at `/api/webhooks/slack`.
    
2.  Invite the bot to a channel (`/invite @AI Agent`).
    
3.  Tag the bot and ask it, "What's the weather in San Francisco?". You should see a streaming response appear in the thread.
    

### 9\. Deploy to Production

Once you've tested your agent, deploy it to production:

`vercel --prod`

Your Slack AI agent is now live and will respond to mentions in your workspace.

## Troubleshooting

### Bot doesn't respond to mentions

Check that your Slack connector has trigger forwarding enabled and that your project is registered as a trigger destination with the correct path (`/api/webhooks/slack`). Confirm the connector is installed in your workspace and that its Trigger Event Types include the events your agent needs (`app_mention` and the relevant message events). You can review all of this in the connector's settings. Verify production/preview deployment logs on `/api/webhooks/slack` for 401s before debugging `getToken`.

### Token requests fail or return unauthorized

Make sure the project is linked (`vercel link`) and that the connector is linked to it for the current environment. Confirm the connector is installed in your workspace and that the bot scopes the agent uses are enabled on the connector. You can check the connector's link, environments, and scopes in its settings.

### Webhook returns 401 / Invalid signature

*   Confirm `webhookVerifier` is set and imports `verifyVercelOidcToken`.
    
*   Confirm OIDC Federation is enabled on the project.
    
*   Remove `SLACK_SIGNING_SECRET` from the project if set (can force the wrong verification path in some setups).
    
*   Confirm the request is coming from Connect (trigger destination configured), not from Slack hitting your app directly.
    

### Missing Authorization bearer token

*   The event reached your app without Connect forwarding (wrong Events URL on the Slack side, or trigger destination not registered).
    
*   Fix the trigger path to `/api/webhooks/slack` and link the correct environment.
    

### Streaming appears choppy or delayed

Chat SDK uses Slack's native streaming API for smooth updates. If you're seeing issues, check that your Redis connection is stable, as the SDK uses distributed locks to manage concurrent messages.

### Tool calls fail silently

If the agent calls a tool but no result appears, check for errors in your tool's `execute` function. AI SDK surfaces tool execution errors back to the model, which may attempt to recover. Add error handling in your tools and check your server logs for details.

### Thread history grows too large

For long-running threads, the conversation history can exceed the model's context window. Consider limiting the number of messages you pass to the agent by slicing the history array or by using a summarization step for older messages.

## Related resources

*   [Vercel Connect overview](https://vercel.com/docs/connect)
    
*   [Vercel Connect quickstart guide](https://vercel.com/docs/connect/quickstart)
    
*   [Chat SDK streaming](https://chat-sdk.dev/docs/streaming)
    
*   [Chat SDK actions](https://chat-sdk.dev/docs/actions) and [cards](https://chat-sdk.dev/docs/cards)
    
*   [AI SDK agent documentation](https://ai-sdk.dev/docs/agents/building-agents)
    
*   [AI Gateway documentation](https://vercel.com/docs/ai-gateway)

---

[View full KB sitemap](/kb/sitemap.md)
