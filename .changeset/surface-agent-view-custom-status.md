---
"@chat-adapter/slack": minor
---

Surface custom status text in the Agent messaging experience. `startTyping` and `setAssistantStatus` with a custom status now call the legacy `assistant.threads.setStatus` endpoint, whose compatibility bridge renders the text in the agent-session loading UX — instead of silently dropping the text and showing the generic "Working…" indicator. Clearing (empty status) still transitions the session to `active` via the Agent Sessions lifecycle.
