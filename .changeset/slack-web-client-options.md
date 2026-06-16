---
"@chat-adapter/slack": minor
---

Add `webClientOptions` to `SlackAdapterConfig`, forwarded to both the default and per-token `@slack/web-api` `WebClient` instances. This exposes Web API settings such as `retryConfig`, per-request `timeout`, and `rejectRateLimitedCalls`. Use the existing `apiUrl` option to override the Slack Web API base URL.
