import { bot } from "../lib/bot";
import { toChatRequest } from "../lib/web-request";

export default defineEventHandler((event) => {
  const handler = bot.webhooks.web;
  if (!handler) {
    throw createError({
      statusCode: 500,
      message: "Web adapter not configured",
    });
  }
  return handler(toChatRequest(event), {
    waitUntil: (task) => event.waitUntil(task),
  });
});
