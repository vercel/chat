# Build AI agents with AI Gateway and AI SDK

**Author:** Ben Sabic

---

An AI agent is a model that runs in a loop, using tools to gather information or take action until it completes a task. The AI SDK gives you the TypeScript primitives to build that loop, and AI Gateway gives it one endpoint and one set of credentials for hundreds of models, so you can switch providers by changing a single string instead of managing separate accounts, keys, and rate limits.

This guide takes you from your first model request to a working agent, then makes that agent reliable with model fallbacks, reachable in chat platforms with Chat SDK, and durable with the Workflow SDK.

## Overview

In this guide, you'll learn how to:

*   Set up a [Next.js](https://nextjs.org/) project and authenticate to AI Gateway with OIDC tokens
    
*   Generate text, stream responses, and produce structured outputs
    
*   Give your agent tools so they can act, not just respond
    
*   Keep your agent available with model fallbacks
    
*   Run AI-generated code safely in isolated [Vercel Sandbox](https://vercel.com/sandbox) microVMs
    
*   Bring your agent to Slack, Teams, and other chat platforms with [Chat SDK](https://chat-sdk.dev/)
    
*   Give your agent secure, short-lived access to third-party APIs with [Vercel Connect](https://vercel.com/connect)
    
*   Make your agent durable and resumable with the [Workflow SDK](https://workflow-sdk.dev)
    

## Prerequisites

Before you begin, make sure you have:

*   A [Vercel account](https://vercel.com/signup)
    
*   Node.js 20 or later
    
*   [Vercel CLI](https://vercel.com/docs/cli) installed (`npm i -g vercel`)
    

## How it works

AI Gateway is a single endpoint that sits in front of every supported provider. You send it a model string in the form `creator/model-name`, and the Gateway resolves the provider, authenticates, routes the request, and tracks usage. Because the AI SDK communicates with this endpoint natively, your application code remains the same whether you call Claude Opus 4.8, GPT-5.5, or Gemini 3.1 Pro. Tokens cost the same as they would from the provider directly, with no markup.

The AI SDK provides the function-level API you'll build the agent from (`generateText`, `streamText`, `generateObject`, and the tool loop), and AI Gateway provides the infrastructure underneath: authentication, usage tracking, failover, and billing. The two are built with high cohesion but loose coupling, so you can adopt the SDK on its own and add Gateway features via provider options when needed.

## Steps

### 1\. Create a Next.js app

Use `create-next-app` to bootstrap a new project:

`pnpm create next-app@latest ai-gateway-demo --yes cd ai-gateway-demo`

The `--yes` flag uses the recommended defaults: TypeScript, Tailwind CSS, ESLint, App Router, and Turbopack, with the `@/*` import alias. Omit the flag if you want to customize these options interactively.

### 2\. Install the AI SDK

Add the `ai` package to your project:

`pnpm add ai`

AI Gateway works with both AI SDK v5 and v6. Check your installed version with `pnpm list ai`.

### 3\. Authenticate with OIDC

AI Gateway authenticates requests using [Vercel OIDC tokens](https://vercel.com/docs/oidc), which Vercel generates and links to your project automatically. You don't need to create or store an API key.

First, link your local project to a Vercel project:

`vercel link`

Then pull the environment variables, which include the OIDC token:

`vercel env pull`

This writes the token to your local environment file. OIDC tokens are valid for 12 hours, so during local development, you'll need to run `vercel env pull` again to refresh the token when it expires.

When you deploy to Vercel, OIDC tokens are provisioned automatically, so no further setup is required in production.

### 4\. Generate text

Start with the simplest request: generate a single block of text. Create an API route at `app/api/chat/route.ts`. Pass a plain string model ID to `generateText` and the AI Gateway resolves the provider and routes the request. With OIDC authentication, you don't reference a key anywhere in your code:

`import { generateText } from 'ai'; export async function GET() { const { text } = await generateText({ model: 'anthropic/claude-opus-4.8', prompt: 'Explain quantum computing in one paragraph.', }); return Response.json({ text }); }`

Start the dev server and visit the route to see the response:

`pnpm dev`

### 5\. Stream responses

For real-time output, use `streamText` and return a streamed response. This is the pattern you'll use for chat interfaces and any response long enough that waiting for the full result would hurt the experience:

`import { streamText } from 'ai'; export async function POST(request: Request) { const { prompt } = await request.json(); const result = streamText({ model: 'openai/gpt-5.5', prompt, }); return result.toUIMessageStreamResponse(); }`

To switch models, change the model string. No other code changes are required.

### 6\. Generate structured outputs

Use `generateObject` with a [Zod](https://zod.dev/) schema to get type-safe structured data instead of free text:

`import { generateObject } from 'ai'; import { z } from 'zod'; export async function GET() { const { object } = await generateObject({ model: 'anthropic/claude-opus-4.8', schema: z.object({ name: z.string(), age: z.number(), city: z.string(), }), prompt: 'Extract: John is 30 years old and lives in NYC.', }); return Response.json(object); // { name: 'John', age: 30, city: 'NYC' } }`

### 7\. Give your agent tools

So far, the model has produced text and data, but it hasn't done anything. Tools change that: you define functions the model can invoke to fetch data, call an API, or act on the outside world, and the AI SDK runs the model in a loop, calling tools and feeding results back until the task is done. A model plus tools in a loop is an agent, and the AI SDK handles that loop for you.

Define a tool with a description, an input schema, and an `execute` function:

`import { generateText, tool } from 'ai'; import { z } from 'zod'; export async function GET() { const { text } = await generateText({ model: 'anthropic/claude-opus-4.8', tools: { getWeather: tool({ description: 'Get the current weather for a location', parameters: z.object({ location: z.string().describe('City name, e.g. San Francisco'), }), execute: async ({ location }) => ({ location, temperature: 72, condition: 'sunny', }), }), }, prompt: "What's the weather in Tokyo?", }); return Response.json({ text }); }`

You now have a working agent. Everything that follows makes it more capable and more reliable: fallbacks keep it available, Sandbox lets it run code safely, Chat SDK puts it in front of users, and the Workflow SDK makes it durable.

### 8\. Keep your agent available with fallbacks

An agent makes many model calls over the course of a task, so it has many chances to hit a provider outage or error. That makes failover matter more for agents, not less. Pass a `models` array in `providerOptions.gateway` to list backup models, which the Gateway tries in order when the primary model fails:

`import { streamText } from 'ai'; export async function POST(request: Request) { const { prompt } = await request.json(); const result = streamText({ model: 'openai/gpt-5.5', // Primary model prompt, providerOptions: { gateway: { models: ['anthropic/claude-opus-4.8', 'google/gemini-3.1-pro-preview'], // Fallbacks }, }, }); return result.toUIMessageStreamResponse(); }`

In this example, the Gateway first attempts the primary model. If that fails, it tries `anthropic/claude-opus-4.7`, then `google/gemini-3.1-pro-preview`. The response comes from the first model that succeeds, and failover happens automatically without changes to your application logic.

## Let your agent run code safely

A capable agent often needs to do more than call predefined tools: it may generate code and run it, whether to compute a result, transform data, or test its own output. Executing model-generated code on your own infrastructure is risky because the code might consume excessive resources, read sensitive files, make unwanted network requests, or run destructive commands.

[Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) provides the agent with an isolated environment to run the code. Each sandbox is an ephemeral Linux microVM with resource limits and automatic timeouts, so untrusted code runs without touching your production systems. It's a standalone SDK you can call from any environment, and the same OIDC token you pulled earlier authenticates both Sandbox and AI Gateway.

Add the Sandbox SDK to your project:

`pnpm add @vercel/sandbox ms`

The pattern has two parts: generate code with the model via the AI Gateway, then write it to a fresh sandbox and run it. The sandbox is created, used, and stopped within a single request:

``import ms from 'ms'; import { generateText } from 'ai'; import { Sandbox } from '@vercel/sandbox'; const SYSTEM_PROMPT = `You are a code generator. Write JavaScript that runs in Node.js. Output only the code, with no explanations or markdown.`; async function generateCode(task: string): Promise<string> { const { text } = await generateText({ model: 'anthropic/claude-sonnet-4.6', system: SYSTEM_PROMPT, prompt: `Write JavaScript code to: ${task}`, }); return text .replace(/^\s*```(?:javascript|js)?\s*/i, '') .replace(/\s*```\s*$/i, '') .trim(); } async function executeCode(code: string) { const sandbox = await Sandbox.create({ resources: { vcpus: 2 }, timeout: ms('2m'), runtime: 'node22', }); try { await sandbox.writeFiles([ { path: '/vercel/sandbox/code.mjs', content: Buffer.from(code) }, ]); const result = await sandbox.runCommand({ cmd: 'node', args: ['code.mjs'] }); const stdout = await result.stdout(); const stderr = await result.stderr(); return { output: stdout || stderr || '(no output)', exitCode: result.exitCode }; } finally { await sandbox.stop(); } }``

This gives the agent two layers of safety: the system prompt steers the model away from dangerous operations, and the sandbox enforces isolation regardless of what the model produces. The sandbox captures both `stdout` and `stderr`, so the agent can read failures and retry without those failures affecting your host. For a complete walkthrough, see [How to execute AI-generated code safely with Vercel Sandbox](https://vercel.com/kb/guide/how-to-execute-ai-generated-code-safely).

## Bring your agent to your users

The agent you've built runs over an HTTP route, but your users may already be in Slack, Microsoft Teams, Discord, or Google Chat. [Chat SDK](https://chat-sdk.dev/) is a TypeScript library for building chatbots that work across these platforms from a single codebase, and it integrates directly with AI SDK. That means the same agent you call through AI Gateway can answer inside a thread without rebuilding it for each platform.

Two helpers from the `chat/ai` subpath connect the two SDKs. Importing from `chat/ai` rather than the main `chat` entrypoint keeps the optional `ai` and `zod` peer dependencies out of bundles that don't use them.

### Feed thread history to your agent

`toAiMessages` converts an array of Chat SDK `Message` objects into the `{ role, content }[]` format the AI SDK expects. The output is structurally compatible with the AI SDK's `ModelMessage[]`, so you can pass it straight into a model call. Fetch recent messages from the thread, convert them, and use them as the agent's prompt:

`import { toAiMessages } from 'chat/ai'; bot.onSubscribedMessage(async (thread, message) => { const result = await thread.adapter.fetchMessages(thread.id, { limit: 20 }); const history = await toAiMessages(result.messages); const response = await agent.stream({ prompt: history }); await thread.post(response.fullStream); });`

`toAiMessages` maps messages authored by the bot to the `assistant` role and all others to `user`, sorts them chronologically, and includes image and text attachments as multipart content. For multi-user threads, pass `includeNames: true` so the model can tell speakers apart.

### Let your agent act on the platform

`createChatTools` provides the agent with a set of AI SDK tools for posting messages, adding reactions, and performing other platform actions. Pass it to your Chat instance alongside an AI SDK call:

`import { Chat } from 'chat'; import { createChatTools } from 'chat/ai'; import { createSlackAdapter } from '@chat-adapter/slack'; import { createMemoryState } from '@chat-adapter/state-memory'; import { generateText } from 'ai'; const chat = new Chat({ userName: 'mybot', adapters: { slack: createSlackAdapter() }, state: createMemoryState(), }); const result = await generateText({ model: 'anthropic/claude-opus-4.8', tools: createChatTools({ chat, preset: 'messenger' }), prompt: 'Post a friendly hello in slack:C0123ABC and react to it with a thumbs up.', });`

Each tool resolves the right adapter from the id prefix you give it (`slack:`, `discord:`, `gchat:`), so one agent can drive any platform your Chat instance is wired up to. Because the model string still routes through AI Gateway, you keep the provider failover and unified billing from the earlier steps while reaching users wherever they already work.

## Give your agent secure access to third-party APIs

Once your agent acts on outside services, such as posting to Slack, opening GitHub pull requests, or querying a data warehouse, it needs credentials for those providers. Bundling long-lived API keys into your deployment is risky: the secret sits in your environment indefinitely, applies to every request, and is hard to scope or revoke.

[Vercel Connect](https://vercel.com/docs/connect) solves this by issuing short-lived provider tokens at runtime instead. You register a connector for a provider once, link it to your projects and environments, and your code requests a scoped token only when it needs one. The same OIDC token you've used throughout authenticates the request, so no provider secret lives in your deployment.

Add the Connect SDK to your project:

`pnpm add @vercel/connect`

Request a token with `getToken`, passing the connector, the subject the token acts as, and the scopes you need:

`import { getToken } from '@vercel/connect'; const token = await getToken('slack/acme-slack', { subject: { type: 'app' }, installationId: 'inst_workspace_xyz', scopes: ['chat:write'], });`

The subject controls whose identity the token represents: `{ type: 'app' }` acts as your service, while `{ type: 'user', id: '...' }` acts on behalf of a specific user who authorized access once. The SDK caches tokens in-process and refreshes them automatically, so an agent that makes many provider calls in a single run requests a single token rather than one per call. Connect currently supports Slack, GitHub, and OAuth connectors in Beta. To set up your first connector, see [Access external APIs from your agents with Vercel Connect](https://vercel.com/kb/guide/vercel-connect).

## Build durable agents with the Workflow SDK

The agents you've built so far run in memory. If the process crashes, the function times out, or the user refreshes the page, the agent's progress is lost. That's fine for short, single-tool interactions, but it's costly for production agents that chain several tool calls, such as booking a flight or running a research task across multiple APIs.

`WorkflowAgent` from `@ai-sdk/workflow` runs the same agent loop as the standard in-memory agent, but inside a [Vercel Workflow](https://vercel.com/docs/workflows). Each tool call becomes a durable step, so progress persists across process boundaries, and failed steps are retried from the last checkpoint instead of restarting the whole loop. Tools marked `needsApproval` can suspend the agent for hours or days until a user responds, which makes human-in-the-loop flows possible without a custom state store or polling.

To get durability, the agent runs inside a function marked `'use workflow'`, and each tool's `execute` function is marked `'use step'`:

``import { WorkflowAgent, type ModelCallStreamPart } from '@ai-sdk/workflow'; import { convertToModelMessages, tool, type UIMessage } from 'ai'; import { getWritable } from 'workflow'; import { z } from 'zod'; async function searchFlightsStep(input: { origin: string; destination: string; date: string; }) { 'use step'; const response = await fetch(`https://api.flights.example/search?...`); return response.json(); } export async function chat(messages: UIMessage[]) { 'use workflow'; const modelMessages = await convertToModelMessages(messages); const agent = new WorkflowAgent({ model: 'anthropic/claude-sonnet-4-6', instructions: 'You are a flight booking assistant.', tools: { searchFlights: tool({ description: 'Search for available flights', inputSchema: z.object({ origin: z.string(), destination: z.string(), date: z.string(), }), execute: searchFlightsStep, }), }, }); const result = await agent.stream({ messages: modelMessages, writable: getWritable<ModelCallStreamPart>(), }); return { messages: result.messages }; }``

The model string is the same `creator/model-name` form you've used throughout, so the request still routes through AI Gateway with its failover and unified billing. What changes is the runtime: tool calls now persist, retry, and appear as discrete steps in the workflow dashboard. To add human approval, set `needsApproval: true` on a tool definition, which suspends the durable workflow until the user responds.

Start with the standard in-memory agent, and reach for `WorkflowAgent` when tool calls outlive their request, approvals exceed function timeouts, or each call should be independently retryable and traced. For a full breakdown of what `WorkflowAgent` adds, how `needsApproval` works, and how to keep chat streams resumable across timeouts, see the [What is WorkflowAgent?](https://vercel.com/kb/guide/what-is-workflowagent) guide.

## Best practices

*   **Refresh your OIDC token during local development**: Tokens are valid for 12 hours. If requests start failing locally with an authentication error, run `vercel env pull` to get a fresh token.
    
*   **Set fallbacks for production traffic**: A single model and provider is a single point of failure. Listing two or three fallback models in `providerOptions.gateway` keeps requests available when one provider has an outage.
    
*   **Keep model IDs in configuration**: Because switching models is a single string change, storing model IDs in environment variables or a config file lets you switch providers without editing application code.
    
*   **Confirm your AI SDK version**: All core features are available in both v5 and v6, but v6 adds capabilities such as video generation. Run `pnpm list ai` to check, and see the [AI SDK v6 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0) before upgrading.
    

## Resources and next steps

*   Learn about [model routing and fallbacks](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options) for finer control over provider preference
    
*   Read more about [OIDC authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok/authentication) and how tokens work on Vercel
    
*   Explore the [AI SDK documentation](https://ai-sdk.dev/getting-started) for advanced patterns
    
*   Run AI-generated code safely with [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) and the [code execution guide](https://vercel.com/kb/guide/how-to-execute-ai-generated-code-safely)
    
*   Build a cross-platform chatbot with [Chat SDK](https://chat-sdk.dev/docs) and its [AI SDK integration](https://chat-sdk.dev/docs/ai/ai-sdk-tools)
    
*   Request short-lived provider tokens at runtime with [Vercel Connect](https://vercel.com/docs/connect)
    
*   Make your agents durable with [WorkflowAgent](https://vercel.com/kb/guide/what-is-workflowagent) and [Workflow SDK](https://workflow-sdk.dev/)
    
*   Browse the [model library](https://vercel.com/ai-gateway/models) to see every supported provider and model

---

[View full KB sitemap](/kb/sitemap.md)
