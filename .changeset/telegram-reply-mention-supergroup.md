---
"@chat-adapter/telegram": patch
---

Count a reply to the bot as a mention (with `mentionOnReply`) in regular supergroups. The forum-topic exclusion for replies to the topic's creation message now applies only to topic messages (`is_topic_message`), so ordinary replies, which carry `message_thread_id` equal to the replied-to message's id, are no longer dropped.
