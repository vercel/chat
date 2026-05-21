---
"@chat-adapter/gchat": patch
---

fix(gchat): accept `endpointUrl` as a direct-webhook JWT audience

When a Google Chat app's connection setting **Authentication audience** is set
to **HTTP endpoint URL** — Google's recommended option for HTTP-hosted apps
not behind Cloud Run IAM, and the only mode available for Workspace Add-on
Chat apps — incoming JWTs have `aud` equal to the endpoint URL rather than
the GCP project number. Previously the adapter only verified against
`googleChatProjectNumber`, so URL-audience tokens always failed with 401
Unauthorized. The adapter now verifies the bearer token against
`googleChatProjectNumber` and/or `endpointUrl`, accepting either when both
are set, and the constructor's fail-closed check accepts `endpointUrl` as a
valid direct-webhook verifier.

**Behavior change**: `endpointUrl` is no longer inferred from the first
incoming request's URL — it must be explicitly configured. Inferring it from
the request URL coupled deployment URL to the spoofable Host header and made
audience verification depend on whichever URL hit the bot first. Apps that
post cards with buttons must now set `endpointUrl` to route button clicks
correctly; the JSDoc and connection-settings docs already labelled it as
required for HTTP-endpoint apps.
