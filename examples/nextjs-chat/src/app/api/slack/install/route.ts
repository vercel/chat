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

export function GET() {
  const clientId = process.env.SLACK_CLIENT_ID;

  if (!clientId) {
    return new Response("SLACK_CLIENT_ID is not configured", { status: 500 });
  }

  const installUrl = new URL("https://slack.com/oauth/v2/authorize");
  installUrl.searchParams.set("client_id", clientId);
  installUrl.searchParams.set("scope", BOT_SCOPES.join(","));

  return Response.redirect(installUrl.toString(), 302);
}
