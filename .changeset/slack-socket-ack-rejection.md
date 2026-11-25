---
"@chat-adapter/slack": patch
---

Stop a failed Socket Mode `ack()` from crashing the process. When an event arrived while the socket was closing or reconnecting, `ack()` rejected with `slack_socket_mode_no_reply_received_error`. `SocketModeClient` doesn't await its `slack_event` listeners, so the rejection went unhandled and Node exited, for example in the middle of a graceful shutdown. The adapter now logs `Failed to acknowledge socket mode event` instead. This covers both `mode: "socket"` and `startSocketModeListener()`.

What happens to the event depends on its type. An Events API event is skipped, and Slack redelivers it because it was never acknowledged. A slash command is skipped too, and Slack doesn't document redelivery for it, so it can be lost. For an interactive payload the handler has already run, so only its response to Slack is lost, for example modal validation errors. The exception is `startSocketModeListener()` with a `webhookUrl`, which acknowledges every event before forwarding it, so a failed `ack()` there means the event isn't forwarded, whatever its type.

An error that escapes an interactive payload's handler is logged as `Error handling socket mode event`, and the payload isn't acknowledged.

With `mode: "socket"`, events that arrive after `disconnect()` starts are now ignored, matching `startSocketModeListener()`.

A forwarded socket event that fails while being routed now logs `Error routing forwarded socket event` and returns a 500 response. It previously returned 400 `Invalid JSON`. A forwarded request with valid JSON but no `body` or `eventType` returns 400 `Invalid socket event`.
