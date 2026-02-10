---
name: Ephemeral Messages
overview: Add ephemeral message support via thread.postEphemeral(userId, message) across all platform adapters. Slack and Google Chat use native ephemeral APIs, while Discord and Teams silently fallback to DMs for consistent cross-platform behavior.
todos:
  - id: core-types
    content: Add EphemeralMessage type and postEphemeral to Adapter/Thread interfaces in types.ts
    status: completed
  - id: thread-impl
    content: Implement postEphemeral() in ThreadImpl with DM fallback logic
    status: completed
  - id: slack-adapter
    content: Implement postEphemeral using chat.postEphemeral API
    status: completed
  - id: slack-tests
    content: Add tests for Slack ephemeral messages
    status: completed
  - id: gchat-adapter
    content: Implement postEphemeral using privateMessageViewer field
    status: completed
  - id: gchat-tests
    content: Add tests for Google Chat ephemeral messages
    status: completed
  - id: discord-adapter
    content: Implement postEphemeral with DM fallback (no native support)
    status: completed
  - id: teams-adapter
    content: Implement postEphemeral with DM fallback (no native support)
    status: completed
  - id: exports
    content: Export EphemeralMessage and PostEphemeralOptions types from chat package index
    status: completed
  - id: docs
    content: Add compatibility table to README with platform behavior notes
    status: completed
isProject: false
---

# Ephemeral Messages Implementation

## Platform Behavior Summary

| Platform | Behavior | Notes |

|----------|----------|-------|

| Slack | Native ephemeral | Session-dependent, visible only to target user in

channel |

| Google Chat | Native private message | Uses `privateMessageViewer` field,

persists |

| Discord | Fallback to DM | No native ephemeral outside interactions |

| Teams | Fallback to DM | No native ephemeral support |

## Core Types

Add to [packages/chat/src/types.ts](packages/chat/src/types.ts):

```typescript
/** Result of posting an ephemeral message */
interface EphemeralMessage {
  /** Message ID (may be empty for some platforms) */
  id: string;
  /** Thread ID where message was sent (or DM thread if fallback) */
  threadId: string;
  /** Whether this used native ephemeral or fell back to DM */
  usedFallback: boolean;
  /** Platform-specific raw response */
  raw: unknown;
}

/** Options for postEphemeral */
interface PostEphemeralOptions {
  /**
   * If true, falls back to sending a DM when native ephemeral is not supported.
   * If false, returns null when native ephemeral is not supported.
   */
  fallbackToDM: boolean;
}
```

Add to `Adapter` interface:

```typescript
/**
 * Post an ephemeral message visible only to a specific user.
 * If not implemented, Thread will fallback to openDM + postMessage.
 */
postEphemeral?(
  threadId: string,
  userId: string,
  message: AdapterPostableMessage,
): Promise<EphemeralMessage>;
```

Add to `Thread` interface with comprehensive TSDoc:

````typescript
/**
 * Post an ephemeral message visible only to a specific user.
 *
 * **Platform Behavior:**
 * - **Slack**: Native ephemeral (session-dependent, disappears on reload)
 * - **Google Chat**: Native private message (persists, only target user sees it)
 * - **Discord**: No native support - requires fallbackToDM: true
 * - **Teams**: No native support - requires fallbackToDM: true
 *
 * @param user - User ID string or Author object (from message.author or event.user)
 * @param message - Message content (string, markdown, card, etc.)
 * @param options.fallbackToDM - Required. If true, falls back to DM when native
 *   ephemeral is not supported. If false, returns null when unsupported.
 * @returns EphemeralMessage with `usedFallback: true` if DM was used, or null
 *   if native ephemeral not supported and fallbackToDM is false
 *
 * @example
 * ```typescript
 * // Always send (DM fallback on Discord/Teams)
 * await thread.postEphemeral(user, 'Only you can see this!', { fallbackToDM: true })
 *
 * // Only send if native ephemeral supported (Slack/GChat)
 * const result = await thread.postEphemeral(user, 'Secret!', { fallbackToDM: false })
 * if (!result) {
 *   // Platform doesn't support native ephemeral - handle accordingly
 * }
 * ```
 */
postEphemeral(
  user: string | Author,
  message: string | PostableMessage | CardJSXElement,
  options: PostEphemeralOptions,
): Promise<EphemeralMessage | null>;
````

## Implementation by Package

### 1. packages/chat (Core)

**thread.ts** - Implement with fallback logic:

```typescript
async postEphemeral(
  user: string | Author,
  message: string | PostableMessage | CardJSXElement,
  options: PostEphemeralOptions,
): Promise<EphemeralMessage | null> {
  const { fallbackToDM } = options;
  const userId = typeof user === "string" ? user : user.userId;

  // Convert JSX to card if needed
  const postable = this.normalizeMessage(message);

  // Try native ephemeral if adapter supports it
  if (this.adapter.postEphemeral) {
    return this.adapter.postEphemeral(this.id, userId, postable);
  }

  // No native support - either fallback to DM or return null
  if (!fallbackToDM) {
    return null;
  }

  // Fallback: send via DM
  if (this.adapter.openDM) {
    const dmThreadId = await this.adapter.openDM(userId);
    const result = await this.adapter.postMessage(dmThreadId, postable);
    return {
      id: result.id,
      threadId: dmThreadId,
      usedFallback: true,
      raw: result.raw,
    };
  }

  // No DM support either - return null
  return null;
}
```

### 2. packages/adapter-slack

Uses Slack Web API `chat.postEphemeral`:

```typescript
async postEphemeral(
  threadId: string,
  userId: string,
  message: AdapterPostableMessage,
): Promise<EphemeralMessage> {
  const { channel } = this.decodeThreadId(threadId);

  // Handle cards vs text
  const card = extractCard(message);
  if (card) {
    const blocks = cardToBlockKit(card);
    const result = await this.client.chat.postEphemeral({
      channel,
      user: userId,
      text: cardToFallbackText(card),
      blocks,
    });
    return { id: result.message_ts || "", threadId, usedFallback: false, raw: result };
  }

  const text = this.formatConverter.renderPostable(message);
  const result = await this.client.chat.postEphemeral({
    channel,
    user: userId,
    text,
  });

  return { id: result.message_ts || "", threadId, usedFallback: false, raw: result };
}
```

Key details:

- Requires `chat:write` scope (already configured)
- User must be member of channel
- Messages are session-dependent (don't persist across reloads)
- Note: `thread_ts` is NOT supported for ephemeral messages

### 3. packages/adapter-gchat

Uses `privateMessageViewer` field:

```typescript
async postEphemeral(
  threadId: string,
  userId: string,
  message: AdapterPostableMessage,
): Promise<EphemeralMessage> {
  const { spaceName, threadName } = this.decodeThreadId(threadId);

  const card = extractCard(message);
  const requestBody: chat_v1.Schema$Message = {
    privateMessageViewer: { name: userId }, // e.g. "users/123456"
    thread: threadName ? { name: threadName } : undefined,
  };

  if (card) {
    requestBody.cardsV2 = [cardToGoogleCard(card)];
  } else {
    requestBody.text = this.formatConverter.renderPostable(message);
  }

  const response = await this.chatApi.spaces.messages.create({
    parent: spaceName,
    messageReplyOption: threadName ? "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" : undefined,
    requestBody,
  });

  return {
    id: response.data.name || "",
    threadId,
    usedFallback: false,
    raw: response.data,
  };
}
```

Key details:

- userId format: `users/123456789`
- Supports threading (unlike Slack)
- Messages persist (unlike Slack's session-dependent behavior)

### 4. packages/adapter-discord

No native ephemeral outside interactions - relies on Thread fallback to DM:

```typescript
// No postEphemeral method - Thread.postEphemeral will use openDM fallback
// openDM is already implemented
```

### 5. packages/adapter-teams

No native ephemeral - relies on Thread fallback to DM:

```typescript
// No postEphemeral method - Thread.postEphemeral will use openDM fallback
// openDM is already implemented
```

## Test Files

- `packages/adapter-slack/src/index.test.ts` - Test native ephemeral
- `packages/adapter-gchat/src/index.test.ts` - Test native ephemeral
- `packages/chat/src/thread.test.ts` - Test postEphemeral with fallback logic

## Documentation

Add to README.md under a new "Ephemeral Messages" section:

````markdown
### Ephemeral Messages

Send a message visible only to a specific user:

```typescript
await thread.postEphemeral(user, "Only you can see this!", {
  fallbackToDM: true,
});
```
````

The `fallbackToDM` option is required and controls behavior on platforms without
native ephemeral support:

- `fallbackToDM: true` - Send as DM if native ephemeral isn't supported
- `fallbackToDM: false` - Return `null` if native ephemeral isn't supported

#### Platform Behavior

| Platform    | Native Support | Behavior             | Where it appears                            | Persistence                              |
| ----------- | -------------- | -------------------- | ------------------------------------------- | ---------------------------------------- |
| Slack       | Yes            | Ephemeral in channel | In the channel, only visible to target user | Session-only (disappears on page reload) |
| Google Chat | Yes            | Private message      | In the space, only visible to target user   | Persists until deleted                   |
| Discord     | No             | DM (if enabled)      | In a DM conversation with the bot           | Persists in DM                           |
| Teams       | No             | DM (if enabled)      | In a DM conversation with the bot           | Persists in DM                           |

**Key differences:**

- **Slack**: True ephemeral - message appears in the channel context but
  disappears when the user refreshes. Other users never see it.
- **Google Chat**: Private message viewer - message appears in the space but
  only the target user can see it. It persists and can be deleted by the bot.
- **Discord/Teams**: No native ephemeral support. With `fallbackToDM: true`,
  sends a DM instead. With `fallbackToDM: false`, returns `null`.

#### Examples

**Always deliver the message (DM fallback):**

```typescript
const result = await thread.postEphemeral(user, "Private notification", {
  fallbackToDM: true,
});

if (result.usedFallback) {
  // Was sent as DM on Discord/Teams
  console.log(`Sent as DM: ${result.threadId}`);
}
```

**Only send if native ephemeral is supported:**

```typescript
const result = await thread.postEphemeral(user, "Contextual hint", {
  fallbackToDM: false,
});

if (!result) {
  // Platform doesn't support native ephemeral (Discord/Teams)
  // Message was not sent - handle accordingly or skip
}
```

```

## Files to Modify

1. `packages/chat/src/types.ts` - Add EphemeralMessage, PostEphemeralOptions

types and interface methods

1. `packages/chat/src/thread.ts` - Implement postEphemeral with fallback logic
2. `packages/chat/src/index.ts` - Export EphemeralMessage, PostEphemeralOptions

types

1. `packages/adapter-slack/src/index.ts` - Implement postEphemeral
2. `packages/adapter-gchat/src/index.ts` - Implement postEphemeral
3. `README.md` - Add ephemeral messages documentation section

```
