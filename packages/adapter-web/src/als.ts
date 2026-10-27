import { AsyncLocalStorage } from "node:async_hooks";
import type { WebStreamEvent } from "./protocol";

/**
 * Per-request context for a Web adapter HTTP invocation.
 *
 * Stashed in AsyncLocalStorage during `handleWebhook` so that `postMessage`,
 * `editMessage`, `stream`, etc. — which are called by chat-sdk's user handler
 * synchronously inside the request — can write to the current
 * SSE response body without explicit threading through every method.
 */
export interface WebRequestContext {
  /** The client's conversation id (`id` or `threadId` in the request body). */
  conversationId: string;
  /** Abort signal of the inbound HTTP request — used to short-circuit streaming. */
  signal: AbortSignal;
  /** The user id resolved by `WebAdapterConfig.getUser`. */
  userId: string;
  /** Write a stream event to the current response in the configured protocol. */
  write: (event: WebStreamEvent) => void;
}

export const webRequestContext = new AsyncLocalStorage<WebRequestContext>();

/** Read the current per-request context. Throws if called outside `handleWebhook`. */
export function requireWebRequestContext(): WebRequestContext {
  const ctx = webRequestContext.getStore();
  if (!ctx) {
    throw new Error(
      "Web adapter operation invoked outside of an active request — " +
        "ensure your handler is called via Chat.processMessage during handleWebhook."
    );
  }
  return ctx;
}
