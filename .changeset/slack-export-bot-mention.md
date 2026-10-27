---
"@chat-adapter/slack": minor
---

Add `isBotMention(event, botUserId)`, which reports whether a Slack `message` or `app_mention` event invokes the bot the same way the adapter sets `message.isMention`. Slack sends `app_mention` for the bot's token inside code, so the event type alone does not show that a user addressed the bot. Apps that route or acknowledge Slack events before a Chat SDK bot handles them can use it to make the same decision. It is exported from `@chat-adapter/slack/webhook`, which imports no runtime packages, and from `@chat-adapter/slack`, and follows the `isBotMention` contract documented for adapters. `botUserId` must be a Slack user ID; an empty or malformed value throws a `TypeError`.
