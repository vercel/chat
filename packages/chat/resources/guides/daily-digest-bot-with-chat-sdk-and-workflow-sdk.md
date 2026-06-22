# Build a daily digest bot with Chat SDK and Workflow SDK

**Author:** Anshuman Bhardwaj

---

Build a daily digest bot that gathers GitHub activity, summarizes it with a model, and posts to Slack on a schedule without running it inline in a cron handler, where a single slow source or a failing channel can take down the whole run. A cron route starts a single durable workflow that fans out a step per channel, so each fetches, summarizes, and posts on its own, and retries independently.

This guide builds the bot with [Chat SDK](https://chat-sdk.dev) and [Workflow SDK](https://workflow-sdk.dev). Every credential is brokered at runtime: Slack and GitHub authenticate through [Vercel Connect](https://vercel.com/connect), and the model authenticates with your project's [OpenID Connect (OIDC) token](https://vercel.com/docs/oidc). There are no API keys or client secrets to set.

Deploy the template now, or read on for a deeper look at how it all works.

## Quick start with an AI coding agent

If you are working with an AI coding agent, hand it the project and this prompt:

### Vercel Plugin

Turn your agent into a Vercel expert with this [plugin](https://vercel.com/docs/agent-resources/vercel-plugin). It gives your coding agent current knowledge of the Vercel products this template uses, including Vercel Connect, Vercel Workflows, Vercel Cron, AI Gateway, and Chat SDK. The plugin is optional; it is not required to use this template or for this guide.

`npx plugins add vercel/vercel-plugin`

## Prerequisites

Before you begin, make sure you have:

*   Node.js 20+
    
*   [pnpm](https://pnpm.io/) (or npm/yarn)
    
*   A Vercel team and project with Vercel Connect enabled, plus permission to create connectors and link them to projects
    
*   The [Vercel CLI](https://vercel.com/docs/cli) is installed
    
*   A Slack workspace where you can install apps
    
*   A GitHub account where you can install apps
    

## Create the project

Create a new [Next.js](https://nextjs.org/docs) app with `create-next-app` :

`pnpm create next-app@latest scheduled-digest-bot --yes cd scheduled-digest-bot`

Then install the Chat SDK, Vercel Connect, and Workflow SDK packages:

`pnpm add chat @chat-adapter/slack @chat-adapter/state-redis ai workflow @vercel/connect zod`

Wrap your Next.js config in `withWorkflow`:

`import { withWorkflow } from "workflow/next"; import type { NextConfig } from "next"; const nextConfig: NextConfig = { serverExternalPackages: [ "@chat-adapter/slack", "@chat-adapter/state-redis", "@redis/client", "@slack/socket-mode", "@slack/web-api", "redis", ], }; export default withWorkflow(nextConfig);`

## Configure credentials

Your agent uses Redis for thread subscriptions and distributed locking. Provision [Upstash Redis](https://vercel.com/marketplace/upstash) and connect it to your project with the Vercel CLI:

`vercel link vercel integration add upstash`

`vercel integration add` installs the Upstash integration if it isn’t already, provisions a database, connects it to your project, and pulls its connection environment variables into `.env.local`. Follow the prompts to pick the Redis product and a plan.

Use the [Vercel CLI](https://vercel.com/docs/cli) to link the project and pull [environment variables](https://vercel.com/docs/environment-variables):

`vercel env pull`

AI SDK uses `VERCEL_OIDC_TOKEN` to authenticate with the Vercel AI Gateway with [OIDC authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok/authentication#oidc-token).

`VERCEL_OIDC_TOKEN=...`

### Create and link the Slack connector

Create the Slack connector in Vercel Connect before you wire the bot locally. Vercel Connect creates and manages the Slack app, so you do not need to create a Slack app at [`api.slack.com`](http://api.slack.com) or copy a long-lived Slack bot token.

1.  Open the Connect page in your Vercel team dashboard.
    
2.  Choose **Create Connector**.
    
3.  Select **Slack** as the provider.
    
4.  Select the Slack workspace and name the connector, for example `digest-bot`.
    
5.  Keep triggers enabled if this project should receive Slack events.
    
6.  Keep the default scopes selected.
    
7.  Create the connector and install it in the Slack workspace.
    
8.  In the connector settings, link it to the Vercel project and select the environments where it should be available.
    

Copy the Slack connector id and store it in `.env.local` file as `CONNECTOR_SLACK`, for example:

`CONNECTOR_SLACK=slack/digest-bot`

Also, add the following environment variables:

`CRON_SECRET="replace-with-a-long-random-string" # e.g. "openssl rand --base64 32" DIGEST_CHANNEL_ID="slack:SLACK_CHANNEL_ID"`

### Create and link the GitHub connector

Create the GitHub connector in Vercel Connect and install it on the repositories you want included in the digest.

1.  Open the Connect page in your Vercel team dashboard.
    
2.  Choose **Create Connector**.
    
3.  Select **GitHub** as the provider.
    
4.  Select the GitHub account or organization to connect.
    
5.  Install the connector on all repositories the digest should read, or select a smaller repository allowlist.
    
6.  Create the connector.
    
7.  In the connector settings, link it to the Vercel project and select the environments where it should be available.
    

Copy the GitHub connector id and store it in `.env.local` file as `CONNECTOR_GITHUB`, for example:

`CONNECTOR_GITHUB=github/digest-github`

The digest requests an app-scoped token from Vercel Connect:

`import { getToken } from "@vercel/connect"; export async function getGitHubToken() { const connector = process.env.CONNECTOR_GITHUB; if (!connector) { throw new Error("CONNECTOR_GITHUB is required."); } return getToken(connector, { subject: { type: "app" } }); }`

The connector installation determines which repositories the token can access. If a repository is missing from the digest, check the connector installation and project/environment link before changing code.

## Create the Chat SDK bot

`lib/bot.ts` centralizes the Chat SDK instance. It requests short-lived Slack tokens from Vercel Connect and configures Redis state so proactive posts and webhook handling share the same bot.

`import { createSlackAdapter } from "@chat-adapter/slack"; import { createRedisState } from "@chat-adapter/state-redis"; import { getToken } from "@vercel/connect"; import { Chat } from "chat"; let bot: Chat | null = null; function getSlackBotToken() { const connector = process.env.CONNECTOR_SLACK; if (!connector) { throw new Error( "CONNECTOR_SLACK is required. Use the Vercel Connect connector id, such as slack/acme-slack.", ); } return getToken(connector, { subject: { type: "app" } }); } function verifyConnectForwardedSlackRequest() { return true; } export function getBot() { if (!bot) { bot = new Chat({ userName: process.env.BOT_USER_NAME ?? "digest-bot", adapters: { slack: createSlackAdapter({ botToken: getSlackBotToken, webhookVerifier: verifyConnectForwardedSlackRequest, }), }, state: createRedisState(), dedupeTtlMs: 600_000, }).registerSingleton(); } return bot; }`

## Define digest schemas and types

`lib/digest/types.ts` keeps the workflow input, source contract, and model output schema in one place. The same schema validates the cron input and constrains the AI SDK response.

`import { z } from "zod"; export const DigestConfigSchema = z.object({ tone: z.enum(["terse", "detailed"]).default("terse"), maxSections: z.number().int().positive().max(8).default(4), include: z .array(z.string()) .default(["github-repositories", "github-issues"]), }); export const DigestInputSchema = z.object({ channelId: z.string().min(1), lookbackHours: z.number().int().positive().max(168).default(24), detailsUrl: z.url().optional(), config: DigestConfigSchema.default({ tone: "terse", maxSections: 4, include: ["github-repositories", "github-issues"], }), }); export const DigestChannelIdSchema = z.string().min(1); export type DigestConfig = z.infer<typeof DigestConfigSchema>; export type DigestInput = z.infer<typeof DigestInputSchema>; export type GatherActivity = (input: DigestInput) => Promise<unknown>; export const DigestSchema = z.object({ headline: z.string().min(1), sections: z .array( z.object({ label: z.string().min(1), body: z.string().min(1), }), ) .min(1), }); export type Digest = z.infer<typeof DigestSchema>;`

## Enroll the digest channel

`lib/digest/enrollment.ts` turns the single `DIGEST_CHANNEL_ID` environment variable into the workflow input. Keep schedule-independent choices, like lookback window and tone, in code so the environment stays small.

`import { DigestChannelIdSchema, type DigestConfig, type DigestInput, } from "./types"; const DIGEST_LOOKBACK_HOURS = 24; const DIGEST_DETAILS_URL = "https://vercel.com"; const DIGEST_CONFIG: DigestConfig = { tone: "terse", maxSections: 4, include: ["github-repositories", "github-issues"], }; export async function loadDigestChannel(): Promise<DigestInput | null> { const raw = process.env.DIGEST_CHANNEL_ID; if (!raw) { return null; } const channelId = DigestChannelIdSchema.parse(raw); return { channelId, lookbackHours: DIGEST_LOOKBACK_HOURS, detailsUrl: DIGEST_DETAILS_URL, config: DIGEST_CONFIG, }; }`

## Start the workflow from cron

Keep the cron route thin. It should verify the secret `CRON_SECRET`), load the single configured channel, start the workflow, and return the run id.

``import { start } from "workflow/api"; import { loadDigestChannel } from "@/lib/digest/enrollment"; import { runDailyDigest } from "@/lib/digest/workflow"; export async function GET(request: Request) { const auth = request.headers.get("authorization"); if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) { return new Response("Unauthorized", { status: 401 }); } const channel = await loadDigestChannel(); if (!channel) { return Response.json({ started: false, reason: "DIGEST_CHANNEL_ID is not set" }); } const run = await start(runDailyDigest, [channel]); return Response.json({ started: true, runId: run.runId }); }``

### Scheduling the cron route

`vercel.json` tells Vercel Cron to call the digest route every day. The route still checks `CRON_SECRET`, so only authorized cron requests can start a workflow.

`{ "crons": [ { "path": "/api/cron/digest", "schedule": "0 8 * * *" } ] }`

Add the `CRON_SECRET` environment variable to your Vercel project before deploying the application.

## Create GitHub digest workflow

Use one workflow to orchestrate the work, but keep expensive or failure-prone operations in separate steps. This makes the workflow retries and run inspection more useful.

`import { fetchGitHubActivity, generateDigest, postDigest } from "./step"; import type { DigestInput } from "./types"; export async function runDailyDigest(channel: DigestInput) { "use workflow"; try { const activity = await fetchGitHubActivity(channel); const digest = await generateDigest(channel, activity); await postDigest(channel, digest); return { posted: 1, failed: 0, channelId: channel.channelId }; } catch (error) { return { posted: 0, failed: 1, channelId: channel.channelId, error: error instanceof Error ? error.message : String(error), }; } }`

`import { generateText, Output } from "ai"; import { postDigestCard } from "./card"; import { buildPrompt } from "./prompt"; import { gatherProjectActivity } from "./sources"; import { DigestSchema, type Digest, type DigestInput } from "./types"; export async function fetchGitHubActivity(input: DigestInput) { "use step"; return gatherProjectActivity(input); } export async function generateDigest(input: DigestInput, activity: unknown) { "use step"; const { output } = await generateText({ model: process.env.DIGEST_MODEL ?? "anthropic/claude-haiku-4.5", output: Output.object({ schema: DigestSchema, name: "daily_digest", description: "A concise channel digest with headline and sections.", }), prompt: buildPrompt(activity, input.config), }); return output; } export async function postDigest(input: DigestInput, digest: Digest) { "use step"; return postDigestCard(input, digest); }`

### Fetch GitHub issues with Search API

`lib/digest/sources.ts` owns the GitHub data contract. It gets a token from Vercel Connect, discovers connector-visible repositories, counts open issues, and returns a precomputed activity payload for the model.

Use the REST repository endpoints to discover connector-visible repositories. Then use batched GitHub GraphQL queries for issue counts and recent issue nodes.

> Avoid the GitHub Search API for per-repository issue counts. Its quota is much lower, and a scheduled digest can exhaust it quickly when it searches once per repository.

Here’s the API request flow:

*   Fetch up to a bounded number of active repositories.
    
*   Count public and private repositories in code.
    
*   Query GraphQL in batches for `issues(states: OPEN) { totalCount }`.
    
*   Fetch recent issue nodes only for the repositories shown in the digest. Keep recent issue nodes capped, for example 10 per repository.
    

The digest payload should give the model precomputed totals, not ask it to infer them. Build the payload in a complete helper function:

`type RepositorySummary = { name: string; visibility: "public" | "private"; }; type RecentIssue = { repository: string; title: string; url: string; createdAt: string; }; type IssueReport = { repository: RepositorySummary; openIssueCount: number; recentlyOpenedIssues: RecentIssue[]; }; function buildDigestActivity( repositories: RepositorySummary[], issueReports: IssueReport[], maxProcessed: number, ) { const publicRepositories = repositories.filter( (repository) => repository.visibility === "public", ); const privateRepositories = repositories.filter( (repository) => repository.visibility === "private", ); const recentlyOpened = issueReports .flatMap((report) => report.recentlyOpenedIssues) .sort((left, right) => right.createdAt.localeCompare(left.createdAt)); const openInPublicRepositories = sumOpenIssues(issueReports, "public"); const openInPrivateRepositories = sumOpenIssues(issueReports, "private"); return { repositories: { total: repositories.length, public: publicRepositories.length, private: privateRepositories.length, processed: Math.min(repositories.length, maxProcessed), maxProcessed, }, issues: { totalOpen: openInPublicRepositories + openInPrivateRepositories, openInPublicRepositories, openInPrivateRepositories, recentlyOpenedInLookback: recentlyOpened.length, recentlyOpened, byRepository: issueReports.map((report) => ({ repository: report.repository.name, visibility: report.repository.visibility, openIssueCount: report.openIssueCount, recentlyOpenedInLookback: report.recentlyOpenedIssues.length, })), }, }; } function sumOpenIssues( issueReports: IssueReport[], visibility: RepositorySummary["visibility"], ) { return issueReports .filter((report) => report.repository.visibility === visibility) .reduce((sum, report) => sum + report.openIssueCount, 0); }`

This keeps the prompt focused on writing the digest rather than doing arithmetic over raw issue lists. It also makes the posted summary easier to verify when you inspect a workflow run.

The source file should also throw `RetryableError` for transient GitHub failures and `FatalError` for bad configuration, so workflow retries only the failures that can recover.

### Build the digest prompt

`lib/digest/prompt.ts` turns the structured GitHub activity into model instructions. Keep totals and source data in the activity object, then use the prompt only to control tone and output priorities.

``import type { DigestConfig } from "./types"; export function buildPrompt(activity: unknown, config: DigestConfig) { return [ `Write a ${config.tone} daily GitHub issues digest.`, `Return at most ${config.maxSections} sections.`, `Only include these source areas: ${config.include.join(", ")}.`, "Include the total number of public repositories and private repositories.", "Include the total number of open issues in public repositories and private repositories.", "If repository totals may be limited by the fetch cap, call that out briefly.", "Highlight newly opened issues, affected repositories, owners, labels, and notable themes.", "If there are no recently opened issues, still summarize the repository and open issue totals.", "Use clear labels and concise bodies.", "Return a headline and sections that match the requested schema.", JSON.stringify(activity, null, 2), ].join("\n\n"); }``

## Post a Chat SDK Card

Create the Slack message card in the `lib/digest/card.tsx` :

``import { Actions, Card, CardText, LinkButton, Section } from "chat"; import { getBot } from "@/lib/bot"; import type { Digest, DigestInput } from "./types"; export async function postDigestCard(input: DigestInput, digest: Digest) { const channel = getBot().channel(input.channelId); await channel.post( Card({ title: digest.headline, children: [ ...digest.sections.map((section) => Section([CardText(`**${section.label}** ${section.body}`)]), ), Actions([ LinkButton({ url: input.detailsUrl ?? "https://vercel.com", label: "View details", }), ]), ], }), ); return { posted: true as const, channelId: input.channelId }; }``

## Run the application locally

To trigger the cron route, start the app:

`pnpm dev`

In another terminal, run the following curl command to trigger the cron job:

`curl -H "Authorization: Bearer $CRON_SECRET" \ http://localhost:3000/api/cron/digest`

To inspect workflow runs include the steps timeline and retries during development, run the following command:

`pnpm exec workflow web`

You now have a daily digest bot with Chat SDK, Workflow SDK, and Vercel Connect. These primitives are extensible for more comprehensible use cases like a PR review bot or an incident watchlist to help you navigate public reports on GitHub.

## Troubleshooting

Each item below lists a symptom, its cause, and the fix.

### The cron route returns unauthorized

Make sure `CRON_SECRET` is set in the environment where the cron job runs, such as production. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`, and the route fails closed when the variable is missing or the header does not match.

Symptom: A Vercel Cron run or manual request gets `401 Unauthorized`.

Cause: `CRON_SECRET` is missing from the environment where the route runs, or the request does not include `Authorization: Bearer $CRON_SECRET`.

Fix: Set `CRON_SECRET` in production and any preview environment where the cron route should run. For local tests, pull the environment with `vercel env pull` or set the variable in the shell before calling the route.

### The Slack digest does not post

Symptom: The workflow runs, but no message appears in Slack.

Cause: The Slack app is not in the configured channel, `DIGEST_CHANNEL_ID` is not in Chat SDK channel id format, or `CONNECTOR_SLACK` is missing from the environment.

Fix: Invite the Slack app to the channel, set `DIGEST_CHANNEL_ID` to a value such as `slack:C123ABC`, and confirm the Slack connector is linked to the Vercel project environment.

### GitHub repositories are missing

Symptom: The digest includes fewer repositories than expected.

Cause: The GitHub connector is installed on a limited repository allowlist, or the connector is not linked to the environment running the workflow.

Fix: Update the GitHub connector installation to include the repositories you want, then confirm `CONNECTOR_GITHUB` is available in the same Vercel environment as the workflow.

### GitHub API rate limit reached

Check that issue counts use GraphQL batching, not GitHub Search API calls. Search API limits are easier to hit and should not be used once per repository.

Symptom: The `fetchGitHubActivity` step fails with a rate limit error.

Cause: GitHub rate limits can still apply to connector tokens, especially if the workflow queries too many repositories or uses the Search API for counts.

Fix: Keep repository fetching bounded, use GraphQL batching for issue counts, and avoid per-repository GitHub Search API calls. The template marks rate limits as `RetryableError` so workflow can retry after a delay.

### Slack signing secret error

When Slack events are routed through Vercel Connect, Connect verifies the event before forwarding it. The Slack adapter still expects a `webhookVerifier`, so provide one that delegates trust to Connect for that route. If you receive events directly from Slack, use Slack's signing secret instead.

Symptom: The Slack webhook route fails with a signing secret error.

Cause: The Slack adapter requires a webhook verifier, but Vercel Connect has already verified Connect-forwarded Slack events before they reach the app.

Fix: For Connect-forwarded Slack events, use a verifier that delegates trust to Connect for that route. If events come directly from Slack, configure verification with Slack's signing secret instead.

### Invalid JSX element: must be a Card element

Use the Chat SDK function-call Card API in workflow steps instead of JSX if the generated workflow route does not recognize the JSX Card shape at runtime.

Symptom: The Slack post step fails with `Invalid JSX element: must be a Card element`.

Cause: The workflow route may not recognize a JSX Card shape at runtime.

Fix: Use the Chat SDK function-call Card API in `lib/digest/card.tsx`, as shown above.

### Local Connect token requests fail

Symptom: GitHub or Slack token requests work in production but fail locally.

Cause: The local `VERCEL_OIDC_TOKEN` written by `vercel env pull` has expired, or the local project is linked to the wrong Vercel project.

Fix: Run `vercel link` to confirm the project, then run `vercel env pull` again.

## Related resources

*   [Workflow SDK documentation](https://workflow-sdk.dev)
    
*   [Chat SDK cards](https://chat-sdk.dev/docs/cards)
    

*   [Vercel Connect](https://vercel.com/docs/connect) and [Vercel Connect CLI](https://vercel.com/docs/cli/connect)
    
*   [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
    
*   [Vercel OIDC](https://vercel.com/docs/oidc)

---

[View full KB sitemap](/kb/sitemap.md)
