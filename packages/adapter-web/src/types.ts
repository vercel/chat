import type { Logger } from "chat";

/** Identity resolved from an inbound web request. */
export interface WebUser {
  /** Stable user identifier. Used to scope thread IDs and as the message author id. */
  id: string;
  /** Optional display name. Falls back to `id` when omitted. */
  name?: string;
}

/**
 * Wire protocol the adapter speaks with the browser.
 *
 * - `"ai-sdk"`: AI SDK UI message stream, for `useChat` from `@ai-sdk/react`,
 *   `@ai-sdk/vue`, `@ai-sdk/svelte`, and the `@chat-adapter/web/*` helpers.
 * - `"ag-ui"`: AG-UI events, for TanStack AI's `fetchServerSentEvents`
 *   connection and other AG-UI clients.
 */
export type WebProtocolName = "ai-sdk" | "ag-ui";

/** One part of a {@link WebMessage}. Text parts carry their text in `text`. */
export interface WebMessagePart {
  type: string;
  [key: string]: unknown;
}

/**
 * Raw message type for the Web adapter, exposed as `message.raw`.
 *
 * Incoming user messages keep the parts the client sent, minus anything the
 * protocol doesn't allow (tool parts are always dropped). An AI SDK
 * `UIMessage` is assignable to it, and with `"ai-sdk"` you can cast
 * `message.raw as UIMessage` to get typed part fields.
 */
export interface WebMessage {
  id: string;
  metadata?: unknown;
  parts: WebMessagePart[];
  role: "user" | "assistant" | "system";
}

export interface WebAdapterConfig {
  /**
   * Resolve the user from the inbound HTTP request.
   *
   * Required — this is the security boundary for the Web adapter. Returning
   * `null` causes the adapter to respond with HTTP 401. Use your auth provider
   * (NextAuth, Clerk, custom session cookie, etc.) here.
   */
  getUser: (request: Request) => WebUser | null | Promise<WebUser | null>;
  /** Optional logger override. */
  logger?: Logger;
  /**
   * When true, chat-sdk persists incoming message history in the configured state adapter.
   *
   * Default: `true`. Web has no platform-side history API, so the only way for
   * chat-sdk handlers to see prior turns via `thread.messages` / `channel.messages`
   * is through the configured state adapter's message history cache. The
   * request body's `messages[]` is not a substitute: only its latest user
   * message reaches the handler, so `false` leaves handlers with just the
   * current message.
   */
  persistMessageHistory?: boolean;
  /**
   * Wire protocol for requests and streamed responses.
   *
   * Default: `"ai-sdk"`. Use `"ag-ui"` for TanStack AI and other AG-UI clients.
   */
  protocol?: WebProtocolName;
  /**
   * Derive a chat-sdk thread id from the resolved user and the client's conversation id
   * (`id` with `"ai-sdk"`, `threadId` with `"ag-ui"`).
   *
   * Default: `web:{user.id}:{conversationId}` — one thread per client conversation.
   * Override to implement different threading semantics (e.g., one thread per user).
   */
  threadIdFor?: (args: { user: WebUser; conversationId: string }) => string;
  /**
   * Bot username. Required by chat-sdk for mention detection (`@username`).
   * Web messages are routed as DMs so mention detection rarely matters in practice,
   * but this also seeds the message author identity for bot-emitted messages.
   */
  userName: string;
}

/**
 * @deprecated Use `WebAdapterConfig`. Kept as an alias for backwards
 * compatibility with the previous name.
 */
export type WebAdapterOptions = WebAdapterConfig;
