import { Message, type SerializedMessage } from "./message";
import type { FormattedContent, StateAdapter } from "./types";

/** Default maximum number of messages to store per thread */
const DEFAULT_MAX_MESSAGES = 100;

/** Default TTL for thread history (7 days in milliseconds) */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Key prefix for thread history entries.
 *
 * Kept as `msg-history:` for backwards compatibility — renaming would silently
 * orphan every existing user's stored data. The user-facing names changed; the
 * storage shape didn't.
 */
const KEY_PREFIX = "msg-history:";

export interface ThreadHistoryConfig {
  /** Maximum messages to keep per thread (default: 100) */
  maxMessages?: number;
  /**
   * Store each message's `formatted` tree (default: true). Set to `false` to
   * store a single text node holding the message's `text` instead, which
   * keeps stored history close to the size of the text.
   */
  storeFormatted?: boolean;
  /** TTL for cached history in milliseconds (default: 7 days) */
  ttlMs?: number;
}

type TreeNode = Record<string, unknown>;

function isTreeNode(value: unknown): value is TreeNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Copy a `formatted` tree without the parser's `position` data, which is most
 * of a parsed tree's size and describes offsets in source text that history
 * does not keep. Iterative, so a deeply nested tree cannot overflow the stack.
 * The input is left untouched: it is the live message's own tree.
 */
function withoutPositions(formatted: FormattedContent): FormattedContent {
  // Keyed by source node, so a node reachable twice (or a cycle in a
  // hand-built tree) is copied once and the walk always ends.
  const copies = new Map<TreeNode, TreeNode>();
  const pending: TreeNode[] = [];
  const copyNode = (node: TreeNode): TreeNode => {
    const existing = copies.get(node);
    if (existing) {
      return existing;
    }
    const { position: _position, ...copy } = node;
    copies.set(node, copy);
    pending.push(copy);
    return copy;
  };
  const root = copyNode(formatted as unknown as TreeNode);
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (Array.isArray(node.children)) {
      node.children = node.children.map((child: unknown) =>
        isTreeNode(child) ? copyNode(child) : child
      );
    }
  }
  return root as unknown as FormattedContent;
}

function textOnly(text: string): FormattedContent {
  return {
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", value: text }] },
    ],
  };
}

/**
 * Persistent per-thread history cache backed by the StateAdapter.
 *
 * Used by adapters that lack server-side message history APIs (e.g. WhatsApp,
 * Telegram). Messages are atomically appended via `state.appendToList()`,
 * which is safe without holding a thread lock.
 *
 * Distinct from the cross-platform per-user {@link TranscriptsApi} (see
 * `transcripts.ts`) — this cache is keyed by thread, not user.
 */
export class ThreadHistoryCache {
  private readonly state: StateAdapter;
  private readonly maxMessages: number;
  private readonly storeFormatted: boolean;
  private readonly ttlMs: number;

  constructor(state: StateAdapter, config?: ThreadHistoryConfig) {
    this.state = state;
    this.maxMessages = config?.maxMessages ?? DEFAULT_MAX_MESSAGES;
    this.storeFormatted = config?.storeFormatted ?? true;
    this.ttlMs = config?.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Atomically append a message to the history for a thread.
   * Trims to maxMessages (keeps newest) and refreshes TTL.
   */
  async append(threadId: string, message: Message): Promise<void> {
    const key = `${KEY_PREFIX}${threadId}`;

    // Omit raw payloads and parser positions to keep history storage bounded.
    const serialized = message.toJSON();
    for (
      let current: SerializedMessage | undefined = serialized;
      current;
      current = current.replyTo
    ) {
      current.raw = null;
      if (!this.storeFormatted) {
        current.formatted = textOnly(current.text);
      } else if (isTreeNode(current.formatted)) {
        current.formatted = withoutPositions(current.formatted);
      }
    }

    await this.state.appendToList(key, serialized, {
      maxLength: this.maxMessages,
      ttlMs: this.ttlMs,
    });
  }

  /**
   * Get messages for a thread in chronological order (oldest first).
   *
   * @param threadId - The thread ID
   * @param limit - Optional limit on number of messages to return (returns newest N)
   */
  async getMessages(threadId: string, limit?: number): Promise<Message[]> {
    const key = `${KEY_PREFIX}${threadId}`;
    const stored = await this.state.getList<SerializedMessage>(key);

    const sliced =
      limit && stored.length > limit
        ? stored.slice(stored.length - limit)
        : stored;

    return sliced.map((s) => Message.fromJSON(s));
  }
}
