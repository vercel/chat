import { Chat } from "@ai-sdk/vue";
import { type ChatInit, DefaultChatTransport, type UIMessage } from "ai";

export interface WebUseChatOptions<UI_MESSAGE extends UIMessage = UIMessage>
  extends Omit<ChatInit<UI_MESSAGE>, "transport"> {
  /** API endpoint for the Web adapter route. Defaults to "/api/chat". */
  api?: string;
  /**
   * chat-sdk thread id — becomes the Chat's conversation `id` and surfaces
   * in the request body so the server can derive the chat-sdk thread id.
   * Strongly recommended; falls back to `id` from `ChatInit`.
   */
  threadId?: string;
}

/**
 * Creates a `Chat` instance preconfigured for `@chat-adapter/web`.
 *
 * Wraps `@ai-sdk/vue`'s `Chat` class with a `DefaultChatTransport` pointed
 * at `/api/chat` (or whatever you pass as `api`). The returned instance has
 * Vue-reactive `messages`, `status`, and `error` properties — access them
 * directly in your `<template>` or `<script setup>`.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useChat } from "@chat-adapter/web/vue";
 * const chat = useChat({ api: "/api/chat", threadId: "support-1" });
 * </script>
 *
 * <template>
 *   <div v-for="msg in chat.messages" :key="msg.id">
 *     <template
 *       v-for="(part, index) in msg.parts"
 *       :key="`${msg.id}-${part.type}-${index}`"
 *     >
 *       <p v-if="part.type === 'text'">{{ part.text }}</p>
 *     </template>
 *   </div>
 * </template>
 * ```
 *
 * For advanced configuration (custom transport, response interceptors, etc.)
 * use `@ai-sdk/vue`'s `Chat` class directly.
 */
export function useChat<UI_MESSAGE extends UIMessage = UIMessage>(
  opts: WebUseChatOptions<UI_MESSAGE> = {}
): Chat<UI_MESSAGE> {
  const { api = "/api/chat", threadId, ...rest } = opts;
  const id = threadId ?? rest.id;
  const init = {
    ...rest,
    transport: new DefaultChatTransport<UI_MESSAGE>({ api }),
    ...(id !== undefined ? { id } : {}),
  };
  // Cast resolves a pnpm multi-version type incompatibility between @ai-sdk/provider-utils
  // patch versions in monorepo dev environments. At runtime the types are identical.
  // biome-ignore lint/suspicious/noExplicitAny: pnpm peer resolution version mismatch
  return new Chat<UI_MESSAGE>(init as any);
}

export type { Chat } from "@ai-sdk/vue";
export type { UIMessage } from "ai";
