import { AsyncLocalStorage } from "node:async_hooks";

/**
 * `null` marks a handler dispatch with no conversation, which tools treat
 * differently from code running outside any handler (no store at all).
 */
const conversationStorage = new AsyncLocalStorage<string | null>();

/**
 * Run `fn` with `threadId` marked as the conversation currently being handled.
 * Chat wraps handler dispatch in this so tools invoked inside a handler can
 * tell which conversation they are serving.
 *
 * An `undefined` id runs `fn` as a handler with no active conversation, even
 * when called from inside another handler. This lets dispatch paths whose
 * conversation id is optional (e.g. a modal with no related thread or
 * channel) call this unconditionally.
 */
export function runInConversation<T>(
  threadId: string | undefined,
  fn: () => T
): T {
  return conversationStorage.run(threadId ?? null, fn);
}

/**
 * The conversation being handled on this async call stack, if any.
 * Returns `undefined` outside a handler, such as in a cron job or a script,
 * and inside a handler that has no conversation.
 */
export function activeConversation(): string | undefined {
  return conversationStorage.getStore() ?? undefined;
}

/**
 * Whether this async call stack is inside a Chat handler dispatch, with or
 * without a conversation.
 */
export function inHandler(): boolean {
  return conversationStorage.getStore() !== undefined;
}
