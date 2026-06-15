import type { ProjectConfig } from "../types.js";

/**
 * Determine whether the selected adapters need the Web adapter chat route.
 *
 * @param config - Resolved project configuration.
 * @returns Whether `/api/chat` should be generated.
 */
export const needsWebRoute = (config: ProjectConfig): boolean =>
  config.platformAdapters.some((adapter) => adapter.slug === "web");

/**
 * Generate `src/app/api/chat/route.ts` for the Web adapter.
 *
 * @returns Route handler source.
 */
export const generateWebRoute = (): string =>
  `import { bot } from "@/lib/bot";\n\nexport const POST = (request: Request) => bot.webhooks.web(request);\n`;

/**
 * Generate the auth helper used by the Web adapter starter.
 *
 * @returns Auth helper source.
 */
export const generateAuthStub = (): string =>
  `export interface WebUser {\n  id: string;\n}\n\nexport async function getUser(_request: Request): Promise<WebUser | null> {\n  // TODO: Replace this with your app's authentication.\n  return { id: "local-user" };\n}\n`;

/**
 * Determine whether the project needs the Discord Gateway listener route.
 *
 * Discord delivers slash commands and button clicks to the HTTP interactions
 * webhook, but regular messages and reactions only arrive over the Gateway
 * WebSocket. The generated starter handlers (`onNewMention`,
 * `onSubscribedMessage`) depend on those message events, so a Discord project
 * needs a cron-driven Gateway listener to receive them on serverless.
 *
 * @param config - Resolved project configuration.
 * @returns Whether the Discord Gateway route and cron should be generated.
 */
export const needsDiscordGateway = (config: ProjectConfig): boolean =>
  config.platformAdapters.some((adapter) => adapter.slug === "discord");

/**
 * Generate `src/app/api/discord/gateway/route.ts`.
 *
 * The route is invoked by a Vercel cron job. It keeps a Gateway connection
 * alive for most of the function's lifetime and forwards received events to the
 * Discord interactions webhook so the bot's message handlers run.
 *
 * @returns Route handler source.
 */
export const generateDiscordGatewayRoute = (): string =>
  `import { after } from "next/server";
import { bot } from "@/lib/bot";

// Keep the Gateway connection alive for most of the function's lifetime.
export const maxDuration = 800;

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== \`Bearer \${cronSecret}\`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const durationMs = 600 * 1000;
  const webhookUrl = \`https://\${process.env.VERCEL_URL}/api/webhooks/discord\`;

  await bot.initialize();
  const discord = bot.getAdapter("discord");
  return discord.startGatewayListener(
    { waitUntil: (task) => after(() => task) },
    durationMs,
    undefined,
    webhookUrl
  );
}
`;

/**
 * One scheduled cron entry emitted into the generated `vercel.json`.
 */
interface CronJob {
  path: string;
  schedule: string;
}

const cronJobs = (config: ProjectConfig): CronJob[] => {
  const jobs: CronJob[] = [];
  if (needsDiscordGateway(config)) {
    // Runs every 9 minutes, overlapping the 10-minute listener so Gateway
    // coverage stays continuous.
    jobs.push({ path: "/api/discord/gateway", schedule: "*/9 * * * *" });
  }
  return jobs;
};

/**
 * Determine whether the project needs a generated `vercel.json`.
 *
 * @param config - Resolved project configuration.
 * @returns Whether `vercel.json` should be written.
 */
export const needsVercelJson = (config: ProjectConfig): boolean =>
  cronJobs(config).length > 0;

/**
 * Generate `vercel.json` with the cron schedules required by selected adapters.
 *
 * @param config - Resolved project configuration.
 * @returns Formatted `vercel.json` contents.
 */
export const generateVercelJson = (config: ProjectConfig): string =>
  `${JSON.stringify({ crons: cronJobs(config) }, null, 2)}\n`;
