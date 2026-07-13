import { bot } from "../../lib/bot";
import { toChatRequest } from "../../lib/web-request";

type Platform = keyof typeof bot.webhooks;

export default defineEventHandler(async (event) => {
  const platform = getRouterParam(event, "platform") as Platform;
  const handler = bot.webhooks[platform];

  if (!handler) {
    throw createError({
      statusCode: 404,
      message: `Unknown platform: ${platform}`,
    });
  }

  if (event.method === "GET") {
    return `${platform} webhook endpoint is active`;
  }

  return handler(toChatRequest(event), {
    waitUntil: (task) => event.waitUntil(task),
  });
});
