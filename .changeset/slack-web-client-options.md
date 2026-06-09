---
"@chat-adapter/slack": minor
---

Add `webClientOptions` to `SlackAdapterConfig`, forwarded to both the default and per-token `@slack/web-api` `WebClient`s. This exposes Web API tuning the adapter didn't previously surface — most importantly `retryConfig` and `timeout`. By default the WebClient retries rate-limited (429) requests with `tenRetriesInAboutThirtyMinutes`, so a single `chat.update`/`chat.postMessage` can block for ~30 minutes under sustained rate limiting; callers that stream frequent edits can now pass a bounded `retryConfig` and/or a per-request `timeout`. `apiUrl` continues to take precedence over `webClientOptions.slackApiUrl`.
