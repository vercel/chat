/**
 * Feishu thread ID encoding/decoding utilities.
 *
 * Thread ID format: feishu:{chatId}:{rootId}
 * - chatId: Feishu chat/conversation ID (e.g., "oc_xxx")
 * - rootId: Root message ID for thread/topic (e.g., "om_xxx"), optional
 * - DM threads end with ":dm" suffix
 *
 * Examples:
 * - Group message: "feishu:oc_abc123:om_msg456"
 * - Group top-level: "feishu:oc_abc123"
 * - DM message: "feishu:oc_abc123:dm"
 * - DM thread: "feishu:oc_abc123:om_msg456:dm"
 */

import { ValidationError } from "@chat-adapter/shared";

export interface FeishuThreadId {
  chatId: string;
  isDM?: boolean;
  rootId?: string;
}

export function encodeThreadId(data: FeishuThreadId): string {
  let id = `feishu:${data.chatId}`;
  if (data.rootId) {
    id += `:${data.rootId}`;
  }
  if (data.isDM) {
    id += ":dm";
  }
  return id;
}

export function decodeThreadId(threadId: string): FeishuThreadId {
  const isDM = threadId.endsWith(":dm");
  const cleanId = isDM ? threadId.slice(0, -3) : threadId;
  const parts = cleanId.split(":");

  if (parts.length < 2 || parts[0] !== "feishu" || !parts[1]) {
    throw new ValidationError(
      "feishu",
      `Invalid Feishu thread ID: ${threadId}`
    );
  }

  return {
    chatId: parts[1],
    rootId: parts[2] || undefined,
    isDM,
  };
}

export function isDMThread(threadId: string): boolean {
  return threadId.endsWith(":dm");
}
