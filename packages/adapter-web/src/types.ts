import type { Logger } from "chat";

/** Identity resolved from an inbound web request. */
export interface WebUser {
  /** Stable user identifier. Used to scope thread IDs and as the message author id. */
  id: string;
  /** Optional display name. Falls back to `id` when omitted. */
  name?: string;
}

export interface WebAdapterOptions {
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
   * is through the configured state adapter's message history cache. Set to
   * `false` only if your handler re-derives history from the request body's
   * `messages[]` itself.
   */
  persistMessageHistory?: boolean;
  /**
   * Derive a chat-sdk thread id from the resolved user and the useChat conversation id.
   *
   * Default: `web:{user.id}:{conversationId}` — one thread per useChat conversation.
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
