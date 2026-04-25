---
"@chat-adapter/slack": minor
---

Add dynamic `botToken` resolver and custom `webhookVerifier` to Slack adapter config. `botToken` now accepts `string | (() => string | Promise<string>)` so apps can rotate or lazily fetch tokens — the function is invoked per API call. `webhookVerifier: (request: Request) => string | Promise<string>` is used in place of `signingSecret` when set (and `signingSecret` is not provided), letting hosts verify incoming requests with their own logic and return the verified body text; the adapter responds 401 if the verifier throws.
