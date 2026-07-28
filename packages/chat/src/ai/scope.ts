import { activeConversation } from "../context";
import type { ChatBinding } from "./types";

/**
 * The conversation a toolset's reads are confined to. Pass the `Thread` or
 * `Channel` the agent is running in, or a raw thread/channel id.
 */
export type ReadScope = string | { id: string };

export type ScopeGuard = (id: string) => void;

function channelOf(chat: ChatBinding, id: string): string {
  const prefix = id.split(":")[0];
  const adapter = prefix ? chat.getAdapter(prefix) : undefined;
  return (
    adapter?.channelIdFromThreadId?.(id) ?? id.split(":").slice(0, 2).join(":")
  );
}

/**
 * Build the guard read tools call before touching the platform.
 *
 * The scope resolves per call: an explicit one wins, and a toolset built
 * without one inherits the conversation currently being handled. Returns
 * `undefined` only when the caller opted out with `scope: false`.
 */
export function createScopeGuard(
  chat: ChatBinding,
  scope: ReadScope | false | undefined
): ScopeGuard | undefined {
  if (scope === false) {
    return;
  }

  let explicit: string | undefined;
  if (scope !== undefined) {
    explicit = typeof scope === "string" ? scope : scope.id;
  }

  return (id: string) => {
    const active = explicit ?? activeConversation();
    if (!active) {
      return;
    }

    const channel = channelOf(chat, active);
    if (channelOf(chat, id) !== channel) {
      throw new Error(
        `Tool call blocked: reads are scoped to channel "${channel}", but "${id}" resolves outside it.`
      );
    }
  };
}
