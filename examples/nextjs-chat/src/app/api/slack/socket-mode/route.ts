import { after } from "next/server";
import { bot } from "@/lib/bot";
import { createPersistentListener } from "@/lib/persistent-listener";

export const maxDuration = 800;

// Default listener duration: 10 minutes
const DEFAULT_DURATION_MS = 600 * 1000;

/**
 * Persistent listener for Slack Socket Mode.
 * Handles cross-instance coordination via Redis pub/sub.
 */
const slackSocketMode = createPersistentListener({
  name: "slack-socket-mode",
  redisUrl: process.env.REDIS_URL,
  defaultDurationMs: DEFAULT_DURATION_MS,
  maxDurationMs: DEFAULT_DURATION_MS,
});

/**
 * Start the Slack Socket Mode WebSocket listener.
 *
 * This endpoint is invoked by a Vercel cron job every 9 minutes to maintain
 * continuous Socket Mode connectivity. Events are acked immediately and
 * forwarded via HTTP POST to the existing webhook endpoint.
 *
 * Security: Requires CRON_SECRET validation.
 *
 * Usage: GET /api/slack/socket-mode
 * Optional query param: ?duration=600000 (milliseconds, max 600000)
 */
export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[slack-socket-mode] CRON_SECRET not configured");
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.log("[slack-socket-mode] Unauthorized: invalid CRON_SECRET");
    return new Response("Unauthorized", { status: 401 });
  }

  await bot.initialize();

  const slack = bot.getAdapter("slack");
  if (!slack) {
    console.log("[slack-socket-mode] Slack adapter not configured");
    return new Response("Slack adapter not configured", { status: 404 });
  }

  // Construct webhook URL for forwarding socket events
  const baseUrl =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    process.env.NEXT_PUBLIC_BASE_URL;
  let webhookUrl: string | undefined;
  if (baseUrl) {
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    const queryParam = bypassSecret
      ? `?x-vercel-protection-bypass=${bypassSecret}`
      : "";
    webhookUrl = `https://${baseUrl}/api/webhooks/slack${queryParam}`;
  }

  return slackSocketMode.start(request, {
    afterTask: (task) => after(() => task),
    run: async ({ abortSignal, durationMs, listenerId }) => {
      console.log(
        `[slack-socket-mode] Starting Socket Mode listener: ${listenerId}`,
        {
          webhookUrl: webhookUrl ? "configured" : "not configured",
          durationMs,
        }
      );

      const response = await slack.startSocketModeListener(
        { waitUntil: (task: Promise<unknown>) => after(() => task) },
        durationMs,
        abortSignal,
        webhookUrl
      );

      console.log(
        `[slack-socket-mode] Socket Mode listener ${listenerId} completed with status: ${response.status}`
      );

      return response;
    },
  });
}
