import type { Logger } from "./logger";
import type { Adapter } from "./types";

/**
 * Symbol identifying PostableObject instances.
 * Used by type guards to detect postable objects.
 */
export const POSTABLE_OBJECT = Symbol.for("chat.postable");

/**
 * Context provided to a PostableObject after it has been posted.
 */
export interface PostableObjectContext {
  adapter: Adapter;
  logger?: Logger;
  messageId: string;
  threadId: string;
}

/**
 * Base interface for objects that can be posted to threads/channels.
 * Examples: Plan, Poll, etc.
 *
 * @template TData - The data type returned by getPostData()
 */
export interface PostableObject<TData = unknown> {
  /** Symbol identifying this as a postable object */
  readonly $$typeof: symbol;

  /**
   * Get a fallback text representation for adapters that don't support this object type.
   * This should return a human-readable string representation.
   */
  getFallbackText(): string;

  /** Get the data to send to the adapter */
  getPostData(): TData;

  /** Check if the adapter supports this object type */
  isSupported(adapter: Adapter): boolean;

  /** The kind of object - used by adapters to dispatch */
  readonly kind: string;

  /** Called after successful posting to bind the object to the thread */
  onPosted(context: PostableObjectContext): void;
}

/**
 * Type guard to check if a value is a PostableObject.
 */
export function isPostableObject(value: unknown): value is PostableObject {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as PostableObject).$$typeof === POSTABLE_OBJECT
  );
}

/**
 * Post a PostableObject using the adapter's native support or fallback text.
 */
export async function postPostableObject(
  obj: PostableObject,
  adapter: Adapter,
  threadId: string,
  postFn: (
    threadId: string,
    message: string
  ) => Promise<{ id: string; threadId?: string }>,
  logger?: Logger
): Promise<void> {
  const context = (raw: { id: string; threadId?: string }) => ({
    adapter,
    logger,
    messageId: raw.id,
    threadId: raw.threadId ?? threadId,
  });

  if (obj.isSupported(adapter) && adapter.postObject) {
    const raw = await adapter.postObject(threadId, obj.kind, obj.getPostData());
    obj.onPosted(context(raw));
  } else {
    const raw = await postFn(threadId, obj.getFallbackText());
    obj.onPosted(context(raw));
  }
}
