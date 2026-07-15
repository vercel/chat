---
"@chat-adapter/gchat": patch
---

fix(gchat): accept `endpointUrl` as a direct-webhook verifier and verify each token type correctly

When a Google Chat app's connection setting **Authentication audience** is set
to **HTTP endpoint URL** — Google's recommended option for HTTP-hosted apps
not behind Cloud Run IAM, and the only mode available for Workspace Add-on
Chat apps — incoming tokens are Google OIDC ID tokens whose `aud` is the
endpoint URL rather than the GCP project number. Previously the adapter only
verified against `googleChatProjectNumber`, so URL-audience tokens always
failed with 401 Unauthorized. The adapter now accepts `endpointUrl` as a
direct-webhook verifier (including in the constructor's fail-closed check),
validating the OIDC token's audience plus the Google Chat issuer email claims
(`chat@system.gserviceaccount.com`, or the
`service-{projectNumber}@gcp-sa-gsuiteaddons.iam.gserviceaccount.com` service
identity for Workspace Add-on Chat apps) with `email_verified: true` — a
public endpoint URL audience alone is not sufficient to forge a request.

Project-number-audience tokens are now verified per Google's reference
implementation: they are JWTs self-signed by
`chat@system.gserviceaccount.com`, so the adapter checks them against that
service account's X.509 certificates with issuer
`chat@system.gserviceaccount.com` (previously it used `verifyIdToken`, which
only accepts Google OIDC issuers and certs and therefore rejected every real
project-number token). When both verifiers are configured, either token type
is accepted.

The adapter still infers an endpoint URL from incoming requests for
button-click action routing only — that inferred value is never used as a
JWT verification audience, and inference now only happens after a request
has passed verification (or verification was explicitly disabled), because
`request.url` derives from the attacker-controllable `Host` header in
serverless runtimes.
