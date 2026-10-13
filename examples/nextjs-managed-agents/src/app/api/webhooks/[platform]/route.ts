import { after } from "next/server";
import type { bot as Bot } from "@/lib/bot";

// Agent turns can run for minutes. The work continues after the webhook
// responds, inside after().
export const maxDuration = 300;

type Platform = keyof typeof Bot.webhooks;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string }> }
): Promise<Response> {
  // Import at request time so `next build` does not need the agent's
  // environment variables.
  const { bot } = await import("@/lib/bot");
  const { platform } = await params;
  const handler = bot.webhooks[platform as Platform];
  if (!handler) {
    return new Response(`Unknown platform: ${platform}`, { status: 404 });
  }
  return handler(request, { waitUntil: (task) => after(() => task) });
}
