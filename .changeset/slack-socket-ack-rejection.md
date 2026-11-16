---
"@chat-adapter/slack": patch
---

Stop a failed Socket Mode `ack()` from crashing the process. When an event arrived while the socket was closing or reconnecting, `ack()` rejected with `slack_socket_mode_no_reply_received_error`. `SocketModeClient` doesn't await its `slack_event` listeners, so the rejection went unhandled and Node exited, for example in the middle of a graceful shutdown. The adapter now logs `Error handling socket mode event` instead, and Slack redelivers the unacknowledged event. This covers both `mode: "socket"` and `startSocketModeListener()`.
