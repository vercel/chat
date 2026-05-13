---
"@chat-adapter/web": minor
---

Add first-class Vue and Svelte support via new subpath exports `@chat-adapter/web/vue` and `@chat-adapter/web/svelte`. Both export a `useChat()` function with the same signature as `@chat-adapter/web/react`, returning a framework-reactive `Chat` instance from `@ai-sdk/vue` / `@ai-sdk/svelte` preconfigured with `DefaultChatTransport`.
