---
name: Button/Modal callbackUrl
overview: Add `callbackUrl` prop to `ButtonElement` and `ModalElement`. When a button click or modal submit arrives, chat POSTs action data to the callbackUrl (if present) in addition to firing all existing handlers unchanged.
todos:
  - id: types
    content: Add `callbackUrl` to ButtonElement, ButtonOptions, ButtonProps, ModalElement, ModalOptions, ModalProps
    status: completed
  - id: jsx
    content: Pass `callbackUrl` through JSX runtime for Button and Modal
    status: completed
  - id: token-encoding
    content: Implement `processCallbackUrls()` in Thread -- walk card tree, generate tokens, store in StateAdapter, encode in value
    status: completed
  - id: action-handler
    content: In handleActionEvent(), detect token prefix, look up callbackUrl, POST payload, restore original value
    status: completed
  - id: modal-handler
    content: Extend modal context storage with callbackUrl, POST on modal submit
    status: completed
  - id: tests
    content: Add tests for token encoding, action handler callbackUrl resolution, and modal callbackUrl flow
    status: completed
  - id: changeset
    content: Create changeset for chat package (minor bump)
    status: completed
isProject: false
---

# Add `callbackUrl` to Buttons and Modals

## Design

`callbackUrl` is a purely additive, raw URL prop. When a button is clicked or a
modal submitted, chat POSTs a JSON payload to the URL. All existing behavior
(`onAction`, `onModalSubmit`, etc.) continues to fire as before. Chat does not
provide `createHook()` -- users bring their own URL (from workflow, a custom
endpoint, or anything else).

### Challenge: round-trip persistence

Platforms don't echo back custom button metadata. When Slack sends a
`block_actions` event, it only includes `action_id` and `value` -- not any
`callbackUrl` we attached at render time. So we need a way to recover the URL
when the click arrives.

**Approach:** Encode a short token in the button's `value` field, store the
mapping `token -> callbackUrl` in the StateAdapter cache with a TTL. All four
adapters already preserve the `value` field through their encode/decode
round-trip (Slack as `value`, Teams as `data.value`, Google Chat as
`parameters.value`, WhatsApp as `v` in the encoded JSON).

```
Render time:  callbackUrl present → generate token → store token→url in StateAdapter → prepend token to value
Action time:  extract token from value → look up url → POST to url → restore original value → continue normal flow
```

### Webhook payload

The POST body sent to the callbackUrl:

```typescript
// Button click
{ type: "action", actionId: string, value?: string, user: { id: string, name?: string }, threadId: string, messageId?: string }

// Modal submit
{ type: "modal_submit", callbackId: string, values: Record<string, unknown>, user: { id: string, name?: string } }
```

---

## Files to change

### 1. Types and builders -- [packages/chat/src/cards.ts](packages/chat/src/cards.ts)

- Add `callbackUrl?: string` to `ButtonElement` (line ~61) and `ButtonOptions`
  (line ~352)
- Pass it through in `Button()` function (line ~374)

### 2. Types and builders -- [packages/chat/src/modals.ts](packages/chat/src/modals.ts)

- Add `callbackUrl?: string` to `ModalElement` (line ~26) and `ModalOptions`
  (line ~105)
- Pass it through in `Modal()` function (line ~116)

### 3. JSX runtime -- [packages/chat/src/jsx-runtime.ts](packages/chat/src/jsx-runtime.ts)

- Add `callbackUrl?: string` to `ButtonProps` (line ~107) and `ModalProps` (line
  ~151)
- Pass it through in the JSX `createElement` for `Button` (line ~587) and
  `Modal` (line ~657)

### 4. Token encoding in Thread.post -- [packages/chat/src/thread.ts](packages/chat/src/thread.ts)

Add a private method `processCallbackUrls(postable)` that:

- Walks the card tree (CardElement children, looking for `ActionsElement`
  containing `ButtonElement`)
- For each button with `callbackUrl`: generates a short token (e.g.,
  `crypto.randomUUID().slice(0,12)`), stores
  `chat:callback:{token} -> callbackUrl` in StateAdapter with 30-day TTL,
  prepends a sentinel to the button's `value`: `__cb:{token}|{originalValue}`,
  and strips `callbackUrl` from the element
- Returns the modified card

Call this in `post()` (line ~391) and `postEphemeral()` before passing to
`adapter.postMessage()`.

Token format: `__cb:{token}` prefix, pipe-separated from original value. Short
enough for all platforms (WhatsApp 256-char button ID limit is the tightest; ~20
chars of overhead is fine).

### 5. Action handler -- [packages/chat/src/chat.ts](packages/chat/src/chat.ts)

In `handleActionEvent()` (line ~1138), before building the full event:

```typescript
let originalValue = event.value;
let callbackUrl: string | undefined;

if (event.value?.startsWith("__cb:")) {
  const pipeIdx = event.value.indexOf("|", 5);
  const token =
    pipeIdx === -1 ? event.value.slice(5) : event.value.slice(5, pipeIdx);
  originalValue = pipeIdx === -1 ? undefined : event.value.slice(pipeIdx + 1);
  callbackUrl = await this._stateAdapter.get<string>(`chat:callback:${token}`);
}

// Use originalValue as event.value for the rest of the handler
```

After handler execution (or in parallel), POST to callbackUrl if present:

```typescript
if (callbackUrl) {
  fetch(callbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "action",
      actionId: event.actionId,
      value: originalValue,
      user: event.user,
      threadId: event.threadId,
      messageId: event.messageId,
    }),
  }).catch((err) =>
    this.logger.error("callbackUrl POST failed", { err, callbackUrl })
  );
}
```

### 6. Modal submit handler -- [packages/chat/src/chat.ts](packages/chat/src/chat.ts)

Extend `StoredModalContext` to include `callbackUrl?: string`.

In `storeModalContext()` (line ~1057): accept and store `callbackUrl`.

Wire it up: when `openModal()` is called (line ~1186), if the modal has
`callbackUrl`, pass it to `storeModalContext()`.

In `processModalSubmit()` (line ~792): after retrieving modal context, if
`callbackUrl` is present, POST the modal values to it. Continue with normal
handler execution.

### 7. Exports -- [packages/chat/src/index.ts](packages/chat/src/index.ts)

No new exports needed -- `callbackUrl` is just a new optional prop on existing
types.

### 8. Adapter changes -- minimal

No adapter code changes required. The `callbackUrl` is stripped from the
ButtonElement before it reaches the adapter (step 4). The token is encoded in
the `value` field, which all adapters already preserve through their
encode/decode round-trip:

- **Slack**: `value` field on `block_actions` payload
- **Teams**: `data.value` on `Action.Submit`
- **Google Chat**: `parameters` array with key `value`
- **WhatsApp**: `v` field in encoded `chat:{json}` button ID

### 9. Tests

- Unit test for `processCallbackUrls()` -- token generation, value encoding,
  StateAdapter storage
- Unit test for `handleActionEvent()` -- token extraction, callbackUrl lookup,
  POST firing, original value restoration
- Unit test for modal submit -- callbackUrl stored and POSTed to on submit
- Verify existing action/modal tests still pass (no behavior change)

### 10. Changeset

Create a changeset for `chat` package with a `minor` bump: "Add callbackUrl
support to buttons and modals"
