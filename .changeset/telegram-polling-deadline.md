---
"@chat-adapter/telegram": patch
---

Give each polling `getUpdates` request a deadline of the long polling `timeout` plus 30 seconds. When a connection drops without a reset, for example after a network switch or a suspend and resume, the request used to wait until the operating system closed the socket, which can take 15 minutes or more, and the bot received no updates in that time. It now fails at the deadline, and the polling loop backs off and polls again on a new connection. Stopping polling and media group collection work as before.
