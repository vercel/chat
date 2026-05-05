"use client";

import { type UseChatHelpers, useChat as useChatRaw } from "@ai-sdk/react";
import { type ChatInit, DefaultChatTransport, type UIMessage } from "ai";
import { useMemo } from "react";

export interface WebUseChatOptions<UI_MESSAGE extends UIMessage = UIMessage>
  extends Omit<ChatInit<UI_MESSAGE>, "transport"> {
  /** API endpoint for the Web adapter route. Defaults to "/api/chat". */
  api?: string;
  /** Custom throttle wait in ms for chat messages and data updates. */
  experimental_throttle?: number;
  /** Whether to resume an ongoing chat generation stream. */
  resume?: boolean;
  /**
   * chat-sdk thread id — becomes useChat's conversation `id` and surfaces
   * in the request body so the server can derive the chat-sdk thread id.
   * Strongly recommended; falls back to `id` from `ChatInit`.
   */
  threadId?: string;
}

/**
 * `useChat` preconfigured for `@chat-adapter/web`.
 *
 * Wraps `@ai-sdk/react`'s `useChat` with a `DefaultChatTransport` pointed at
 * `/api/chat` (or whatever you pass as `api`). Everything else passes through
 * unchanged — `messages`, `sendMessage`, `status`, `stop`, `regenerate`, etc.
 *
 * For advanced configuration (custom transport, response interceptors, etc.)
 * use `@ai-sdk/react`'s `useChat` directly.
 */
export function useChat<UI_MESSAGE extends UIMessage = UIMessage>(
  opts: WebUseChatOptions<UI_MESSAGE> = {}
): UseChatHelpers<UI_MESSAGE> {
  const { api = "/api/chat", threadId, ...rest } = opts;
  const transport = useMemo(
    () => new DefaultChatTransport<UI_MESSAGE>({ api }),
    [api]
  );
  // Only pass `id` when explicitly provided. Passing `id: undefined` makes
  // @ai-sdk/react's useChat recreate its internal Chat instance on every
  // render (because `"id" in options` becomes true with a value that never
  // matches the auto-generated id), which silently wipes message state.
  const id = threadId ?? rest.id;
  return useChatRaw<UI_MESSAGE>({
    ...rest,
    transport,
    ...(id !== undefined ? { id } : {}),
  });
}

export type { UseChatHelpers } from "@ai-sdk/react";
export type { UIMessage } from "ai";
