const LINEAR_INSTALL_SCOPES = [
  "read",
  "write",
  "comments:create",
  "issues:create",
  "app:mentionable",
];

export function GET() {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const redirectUri = process.env.LINEAR_REDIRECT_URI;

  if (!clientId) {
    return new Response("LINEAR_CLIENT_ID is not configured", { status: 500 });
  }

  if (!redirectUri) {
    return new Response("LINEAR_REDIRECT_URI is not configured", {
      status: 500,
    });
  }

  const installUrl = new URL("https://linear.app/oauth/authorize");
  installUrl.searchParams.set("client_id", clientId);
  installUrl.searchParams.set("redirect_uri", redirectUri);
  installUrl.searchParams.set("response_type", "code");
  installUrl.searchParams.set("actor", "app");
  installUrl.searchParams.set("scope", LINEAR_INSTALL_SCOPES.join(","));

  return Response.redirect(installUrl.toString(), 302);
}
