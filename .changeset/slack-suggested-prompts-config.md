---
"@chat-adapter/slack": minor
---

Add declarative agent-experience config and harden native streaming:

- `suggestedPrompts` — a static payload or per-thread resolver, applied automatically when an assistant/agent thread opens (`assistant_thread_started` in legacy `assistant_view`, or a Messages-tab `app_home_opened` under `agentView`, where prompts pin at the top of the agent conversation without a `thread_ts`). The resolver receives the thread context (`channelId`, `userId`, legacy `threadTs`/`teamId`/`enterpriseId`, and active-view `entities` under `agentView`); returning `null`/`undefined` skips the thread. Prompts beyond Slack's 4-prompt limit are dropped with a warning, and resolver/API failures are logged without failing the webhook.
- `loadingMessages` — default rotating status strings for the assistant thinking indicator, used by `startTyping` and `setAssistantStatus` when no explicit status/messages are passed.
- `nativeStreaming` config (default `true`). Set `false` on Slack flavours without the `chat.startStream` family (e.g. GovSlack) to always stream via post-and-edit.
- If the workspace rejects the first native streaming call, `stream()` now falls back to throttled post-and-edit mid-stream instead of failing the reply; already-consumed text is preserved. Permanent platform errors (`unknown_method`, `method_deprecated`, `feature_not_enabled`) latch native streaming off for subsequent streams on the adapter instance. Structured chunks (`task_update` / `plan_update`) are skipped in fallback mode.

- `feedbackButtons` — append Slack's native thumbs up/down (`context_actions` + `feedback_buttons` block) to every streamed reply. Pass `true` for defaults or an options object (`actionId`, labels, values); clicks dispatch through `bot.onAction` with a positive/negative value. A `buildFeedbackButtonsBlock(options?)` helper is exported for attaching the block to non-streamed messages.

New exported types: `SlackFeedbackButtonsOptions`, `SlackSuggestedPrompt`, `SlackSuggestedPrompts`, `SlackSuggestedPromptsContext`, `SlackSuggestedPromptsOptions`.
