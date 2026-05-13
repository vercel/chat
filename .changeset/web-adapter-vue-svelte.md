---
"@chat-adapter/web": minor
---

Add first-class Vue and Svelte support via new subpath exports `@chat-adapter/web/vue` and `@chat-adapter/web/svelte`. Each exports a `useChat()` factory preconfigured with `DefaultChatTransport`, returning a framework-reactive `Chat` instance from `@ai-sdk/vue` / `@ai-sdk/svelte` respectively. Note: unlike the React subpath which wraps `@ai-sdk/react`'s `useChat` hook and returns destructurable helpers, the Vue and Svelte wrappers return a `Chat` class instance — access `chat.messages`, `chat.sendMessage()`, `chat.status`, and `chat.stop()` directly on the object.
