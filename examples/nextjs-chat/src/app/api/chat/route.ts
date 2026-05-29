import { after } from "next/server";
import { bot } from "@/lib/bot";

/**
 * Web chat endpoint — receives `useChat` requests and streams responses
 * using the AI SDK UI message stream protocol. The same `bot` instance
 * handles Slack, Teams, etc., so any handler registered there fires here too.
 */
export async function POST(request: Request): Promise<Response> {
  const handler = bot.webhooks.web;
  if (!handler) {
    return new Response("Web adapter not configured", { status: 500 });
  }
  return handler(request, {
    waitUntil: (task) => after(() => task),
  });
}
