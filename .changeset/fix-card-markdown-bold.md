---
"@chat-adapter/slack": patch
"@chat-adapter/gchat": patch
---

fix(slack,gchat): convert **bold** to *bold* in Card text blocks

CardText content with standard Markdown bold was rendering literally in Slack and Google Chat. Both platforms use single asterisk for bold. Added markdownToMrkdwn conversion in convertTextToBlock and field converters.
