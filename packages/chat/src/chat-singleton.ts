/**
 * Singleton holder for Chat instance.
 * Separate module to avoid circular dependency between chat.ts and thread.ts.
 */
import type { Adapter, StateAdapter } from "./types";

/**
 * Interface for the Chat singleton to avoid importing the full Chat class.
 */
export interface ChatSingleton {
  getAdapter(name: string): Adapter | undefined;
  getState(): StateAdapter;
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
