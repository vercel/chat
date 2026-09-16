---
"@chat-adapter/slack": patch
---

Read the bot's mention from the message content instead of trusting the `app_mention` event type.

Slack can deliver `app_mention` for a message whose bot-id reference only appears inside code, where it renders literally and is not an invocation. The adapter now flags a message only when it finds a `user` element for the bot outside code, a real `<@U…>` token outside code in the mrkdwn `text` field, or such a token in table or mrkdwn attachment content.

A message that references the bot only as literal text — inside code, HTML-escaped as `&lt;@U…&gt;`, or typed as a bare `@U…` — reports `isMention: false`, so the SDK's text-based detection cannot promote it. A message with no bot reference at all stays undetermined.
