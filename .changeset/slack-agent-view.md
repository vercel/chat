---
"chat": minor
"@chat-adapter/slack": minor
---

Add support for Slack's Agent messaging experience (`agent_view`).

- New core event `onAppContextChanged` with a normalized `AppContextEntity[]` describing the user's active view (channel / canvas / list / message / unknown).
- `AppHomeOpenedEvent` now carries the folded active-view context as `entities`.
- Slack adapter: new `agentView` config flag (under `agent_view`, `app_home_opened` is the DM-open signal regardless of tab and folded context is surfaced), routing for the `app_context_changed` event, and a `getAppContext(message)` helper to read the folded context on DM messages.
- `setSuggestedPrompts` now accepts an optional thread reference (agent_view lets prompts sit at the top of the agent conversation).
- Under `agentView`, DM (Messages-tab) messages are threaded per new Slack's model — each user message is a thread root (`thread_ts ?? ts`).
- Bumped `@slack/web-api` to `^7.18.0` (adds the optional `thread_ts` typing for `setSuggestedPrompts`).
