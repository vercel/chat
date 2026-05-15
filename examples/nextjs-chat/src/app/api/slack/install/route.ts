import { issueOAuthState } from "@/lib/oauth-state";

const BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "files:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "mpim:history",
  "mpim:read",
  "reactions:read",
  "reactions:write",
  "users:read",
];

const STATE_COOKIE = "slack_oauth_state";
const CALLBACK_PATH = "/api/slack/install/callback";

export async function GET() {
  const clientId = process.env.SLACK_CLIENT_ID;

  if (!clientId) {
    return new Response("SLACK_CLIENT_ID is not configured", { status: 500 });
  }

  const state = await issueOAuthState({
    cookieName: STATE_COOKIE,
    callbackPath: CALLBACK_PATH,
  });

  const installUrl = new URL("https://slack.com/oauth/v2/authorize");
  installUrl.searchParams.set("client_id", clientId);
  installUrl.searchParams.set("scope", BOT_SCOPES.join(","));
  installUrl.searchParams.set("state", state);

  return Response.redirect(installUrl.toString(), 302);
}
