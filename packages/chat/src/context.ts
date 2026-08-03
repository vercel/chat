import { AsyncLocalStorage } from "node:async_hooks";

const conversationStorage = new AsyncLocalStorage<string>();

/**
 * Run `fn` with `threadId` marked as the conversation currently being handled.
 * Chat wraps handler dispatch in this so tools invoked inside a handler can
 * tell which conversation they are serving.
 *
 * An `undefined` id runs `fn` bare, with no active conversation, the same state
 * as running outside a handler. This lets dispatch paths whose conversation id
 * is optional (e.g. a modal with no related thread or channel) call this
 * unconditionally.
 */
export function runInConversation<T>(
  threadId: string | undefined,
  fn: () => T
): T {
  return threadId === undefined ? fn() : conversationStorage.run(threadId, fn);
}

/**
 * The conversation being handled on this async call stack, if any.
 * Returns `undefined` outside a handler, such as in a cron job or a script.
 */
export function activeConversation(): string | undefined {
  return conversationStorage.getStore();
}
