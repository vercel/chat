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
   * Default: false. The AI SDK client retains the conversation in its UI state and
   * resends it on every request, so server-side persistence is unnecessary for
   * single-device use. Enable for cross-device continuity.
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
