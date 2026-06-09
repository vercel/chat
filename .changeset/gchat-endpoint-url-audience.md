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

Direct-webhook tokens are now also matched against the expected Google Chat
issuer/email claims (`chat@system.gserviceaccount.com`, or the
`service-{projectNumber}@gcp-sa-gsuiteaddons.iam.gserviceaccount.com`
service identity for Workspace Add-on Chat apps) with `email_verified: true`,
so a public endpoint URL audience alone is not sufficient to forge a request.

The adapter still infers an endpoint URL from incoming requests for
button-click action routing only — that inferred value is never used as a
JWT verification audience, because `request.url` derives from the
attacker-controllable `Host` header in serverless runtimes.
