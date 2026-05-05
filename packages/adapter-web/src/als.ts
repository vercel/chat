import { AsyncLocalStorage } from "node:async_hooks";
import type { UIMessageStreamWriter } from "ai";

/**
 * Per-request context for a Web adapter HTTP invocation.
 *
 * Stashed in AsyncLocalStorage during `handleWebhook` so that `postMessage`,
 * `editMessage`, `stream`, etc. — which are called by chat-sdk's user handler
 * synchronously inside the request — can locate the writer for the current
 * SSE response body without explicit threading through every method.
 */
export interface WebRequestContext {
  /** The useChat conversation id supplied in the request body's `id` field. */
  conversationId: string;
  /** Abort signal of the inbound HTTP request — used to short-circuit streaming. */
  signal: AbortSignal;
  /** The user id resolved by `WebAdapterOptions.getUser`. */
  userId: string;
  /** AI SDK UI message stream writer for the current response. */
  writer: UIMessageStreamWriter;
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
