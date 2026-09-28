/**
 * Singleton holder for Chat instance.
 * Separate module to avoid circular dependency between chat.ts and thread.ts.
 */
import type { Adapter, StateAdapter, StreamOptions } from "./types";

/**
 * Interface for the Chat singleton to avoid importing the full Chat class.
 */
export interface ChatSingleton {
  getAdapter(name: string): Adapter | undefined;
  getState(): StateAdapter;
  getStreamingOptions(): Pick<
    StreamOptions,
    "updateIntervalMs" | "fallbackStreamingPlaceholderText"
  >;
  ownsAdapter(adapter: Adapter): boolean;
}

let _singleton: ChatSingleton | null = null;

/**
 * Set the Chat singleton instance.
 * @internal Used by Chat.registerSingleton()
 */
export function setChatSingleton(chat: ChatSingleton): void {
  _singleton = chat;
}

/**
 * Get the Chat singleton instance.
 * @throws Error if no singleton has been registered
 */
export function getChatSingleton(): ChatSingleton {
  if (!_singleton) {
    throw new Error(
      "No Chat singleton registered. Call chat.registerSingleton() first."
    );
  }
  return _singleton;
}

/**
 * Check if a Chat singleton has been registered.
 */
export function hasChatSingleton(): boolean {
  return _singleton !== null;
}

/**
 * Clear the Chat singleton (for testing).
 * @internal
 */
export function clearChatSingleton(): void {
  _singleton = null;
}

/**
 * Tracks which Chat instance owns a restored thread or channel.
 * Once an owner is found it is retained, even if the singleton changes.
 * @internal Shared by ThreadImpl and ChannelImpl.
 */
export class ChatBinding {
  private readonly explicit?: ChatSingleton;
  private owner?: ChatSingleton;
  private checked?: ChatSingleton;

  constructor(chat?: ChatSingleton) {
    this.explicit = chat;
  }

  /** Resolve a lazily restored adapter by name and bind to its Chat. */
  resolveAdapter(name: string): Adapter {
    const chat = this.explicit ?? getChatSingleton();
    const adapter = chat.getAdapter(name);
    if (!adapter) {
      throw new Error(
        `Adapter "${name}" not found in Chat ${this.explicit ? "instance" : "singleton"}`
      );
    }
    this.owner = chat;
    return adapter;
  }

  /**
   * Get the Chat instance that owns this exact adapter, if any.
   * Without an explicit Chat, each registered singleton is checked once.
   */
  resolveOwner(adapter: Adapter): ChatSingleton | undefined {
    if (this.owner) {
      return this.owner;
    }
    const chat =
      this.explicit ?? (hasChatSingleton() ? getChatSingleton() : undefined);
    if (chat && chat !== this.checked) {
      this.checked = chat;
      if (chat.ownsAdapter(adapter)) {
        this.owner = chat;
      }
    }
    return this.owner;
  }

  /**
   * Get state from the owning Chat. An adapter passed without an explicit
   * Chat falls back to the registered singleton's state when unowned.
   */
  resolveState(adapter: Adapter): {
    owned: boolean;
    state: StateAdapter;
  } {
    const owner = this.resolveOwner(adapter);
    if (owner) {
      return { owned: true, state: owner.getState() };
    }
    if (this.explicit) {
      throw new Error(
        `Adapter "${adapter.name}" does not belong to this Chat instance. Restore with bot.reviver().`
      );
    }
    return { owned: false, state: getChatSingleton().getState() };
  }
}
