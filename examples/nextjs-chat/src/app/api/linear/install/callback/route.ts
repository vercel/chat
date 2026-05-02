import { bot } from "@/lib/bot";
import { consumeAndVerifyOAuthState } from "@/lib/oauth-state";

const STATE_COOKIE = "linear_oauth_state";
const CALLBACK_PATH = "/api/linear/install/callback";

export async function GET(request: Request) {
  const adapter = bot.getAdapter("linear");
  const redirectUri = process.env.LINEAR_REDIRECT_URI;

  if (!adapter) {
    return new Response("Linear adapter not configured", { status: 500 });
  }

  if (!redirectUri) {
    return new Response("LINEAR_REDIRECT_URI is not configured", {
      status: 500,
    });
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
    const { organizationId } = await adapter.handleOAuthCallback(request, {
      redirectUri,
    });
    return new Response(
      `Linear app installed for organization ${organizationId}!`
    );
  } catch (error) {
    console.error("[linear/install/callback] OAuth error:", error);
    return new Response("OAuth installation failed", { status: 500 });
  }
}
