---
"chat": patch
"@chat-adapter/web": patch
---

enforce the conversation scope on write tools and stop trusting client-supplied message history in the web adapter

`createChatTools` now runs the same scope guard on write tools that read tools already used, so a thread or channel id the model supplies that resolves outside the scoped conversation is rejected before the write executes. `sendDirectMessage` targets a user id rather than a conversation and stays gated by approval alone.

The web adapter no longer treats the request body's `messages` array as a source of conversation state. Only the latest user message is consumed, and tool parts are stripped from it so a browser cannot inject forged tool-call or approval state. Text, file, and custom data parts pass through unchanged; a message left with no parts after stripping is rejected with HTTP 400. Prior turns come from the state adapter when `persistMessageHistory` is enabled.
