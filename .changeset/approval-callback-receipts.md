---
"chat": patch
---

`requestApproval()` from `chat/workflow` now verifies each click server-side instead of reading the decision and user from the webhook request. When a button with a `callbackUrl` is clicked, Chat SDK now stores a receipt in the state adapter with the verified action ID, user, thread, and message, and adds its identifier to the callback payload as `receipt`. `requestApproval()` takes the decision and user only from that receipt, accepts each receipt once, and ignores requests without a valid one. If the receipt can't be stored, Chat SDK skips the callback POST and restores the button's callback token so the user can click again. When someone outside `approvers` clicks, `requestApproval()` now also refreshes the card's buttons, because each button's callback works only once and that click previously left the button unusable for approvers.

The `Chat` instance that handles the click and the one running the workflow must share a state adapter, and `requestApproval()` now throws when passed a `Thread` that wasn't created by Chat SDK. Errors logged when a callback URL POST fails now include only the URL's origin, under `callbackOrigin` instead of `callbackUrl`.
