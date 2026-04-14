---
"chat": minor
---

Add `callbackUrl` prop to buttons and modals. When a button is clicked or a modal is submitted, the chat SDK POSTs action data to the callback URL in addition to firing existing handlers. This enables awaitable button/modal patterns when composed with webhook-based workflow engines.
