import type { UIMessage } from "ai";
import type { Logger, PlanUpdateChunk, TaskUpdateChunk } from "chat";

/**
 * Payload of a `data-task` part: a `task_update` chunk without its `type`.
 * The part's `id` is the task id, so each update replaces the previous one.
 */
export type WebTaskData = Omit<TaskUpdateChunk, "type">;

/**
 * Payload of a `data-plan` part: a `plan_update` chunk without its `type`.
 * The part's `id` is the message id, so each update replaces the previous one.
 */
export type WebPlanData = Omit<PlanUpdateChunk, "type">;

/**
 * Data parts the Web adapter streams for structured `StreamChunk`s, keyed by
 * the part name after `data-`.
 */
// biome-ignore lint/style/useConsistentTypeDefinitions: UIMessage constrains its data-parts type to Record<string, unknown>, which an interface doesn't satisfy without an index signature that would erase the part names.
export type WebDataParts = {
  plan: WebPlanData;
  task: WebTaskData;
};

/** A `UIMessage` typed with the data parts the Web adapter streams. */
export type WebUIMessage = UIMessage<unknown, WebDataParts>;

/** Identity resolved from an inbound web request. */
export interface WebUser {
  /** Stable user identifier. Used to scope thread IDs and as the message author id. */
  id: string;
  /** Optional display name. Falls back to `id` when omitted. */
  name?: string;
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

/**
 * @deprecated Use `WebAdapterConfig`. Kept as an alias for backwards
 * compatibility with the previous name.
 */
export type WebAdapterOptions = WebAdapterConfig;
