---
"chat": minor
"@chat-adapter/slack": minor
---

Add support for Slack's Agent messaging experience (`agent_view`).

- New core event `onAppContextChanged` with a normalized `AppContextEntity[]` describing the user's active view (channel / canvas / list / message / unknown).
- `AppHomeOpenedEvent` now carries the folded active-view context as `entities` and the opened `tab` (Slack: `"home"` / `"messages"`), so handlers can tell a Home-tab open from the DM-open signal under `agent_view`.
- Slack adapter: new `agentView` config flag (under `agent_view`, `app_home_opened` is the DM-open signal regardless of tab and folded context is surfaced), routing for the `app_context_changed` event, and a `getAppContext(message)` helper to read the folded context on DM messages.
- `setSuggestedPrompts` now accepts an optional thread reference (agent_view lets prompts sit at the top of the agent conversation).
- Under `agentView`, DM (Messages-tab) messages are threaded per new Slack's model — each user message is a thread root (`thread_ts ?? ts`). Conversation-scoped threads returned by `openDM()` keep working: when that thread is subscribed, incoming top-level DM messages route to it.
- `createSlackAdapter` env auth fallback (`SLACK_BOT_TOKEN` / `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`) is now disabled only when an auth-related field (`botToken`, `clientId`, `clientSecret`, `installationProvider`) is passed explicitly, instead of by any config object — so `createSlackAdapter({ agentView: true })` still picks up env credentials.
- Bumped `@slack/web-api` to `^7.18.0` (adds the optional `thread_ts` typing for `setSuggestedPrompts`).
