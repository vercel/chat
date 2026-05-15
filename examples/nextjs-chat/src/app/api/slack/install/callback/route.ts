import { bot } from "@/lib/bot";
import { consumeAndVerifyOAuthState } from "@/lib/oauth-state";

const STATE_COOKIE = "slack_oauth_state";
const CALLBACK_PATH = "/api/slack/install/callback";

export async function GET(request: Request) {
  const adapter = bot.getAdapter("slack");

  if (!adapter) {
    return new Response("Slack adapter not configured", { status: 500 });
  }

  const stateOk = await consumeAndVerifyOAuthState({
    request,
    cookieName: STATE_COOKIE,
    callbackPath: CALLBACK_PATH,
  });
  if (!stateOk) {
    return new Response("OAuth state mismatch", { status: 400 });
  }

  try {
    await bot.initialize();
    const { teamId } = await adapter.handleOAuthCallback(request);
    return new Response(`Slack app installed for team ${teamId}!`);
  } catch (error) {
    console.error("[slack/install/callback] OAuth error:", error);
    return new Response("OAuth installation failed", { status: 500 });
  }
}
