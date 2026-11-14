---
"chat": minor
"@chat-adapter/teams": minor
---

Add an optional `feedbackButtons` field to `PostableRaw`, `PostableMarkdown`, `PostableAst`, `PostableCard`, `StreamingPlanOptions`, and `StreamOptions`. When it's `true`, adapters that support native feedback buttons per message show them. The Teams adapter shows Teams' thumbs up and thumbs down buttons on new, edited, channel, targeted, and streamed messages, and on raw Adaptive Cards. An edit must set the flag again to keep the buttons. Clicks dispatch through `bot.onAction("message_feedback")` with the value `"positive"` or `"negative"`, the same as the Slack adapter's feedback buttons, and any comment the user typed is in `event.values.feedback`.
