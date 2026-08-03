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
 *
 * By default a read is allowed when it resolves to the same channel as the
 * scoped conversation, so a thread scope still permits sibling threads in its
 * channel. Pass `strict` to confine a thread scope to that thread alone,
 * rejecting sibling threads and the parent channel; a channel scope is
 * unaffected and still allows any thread within it.
 *
 * When no scope resolves (no explicit scope and no conversation being handled,
 * e.g. a cron job or queued work), reads run workspace-wide but warn once.
 */
export function createScopeGuard(
  chat: ChatBinding,
  scope: ReadScope | false | undefined,
  strict = false
): ScopeGuard | undefined {
  if (scope === false) {
    return;
  }

  let explicit: string | undefined;
  if (scope !== undefined) {
    explicit = typeof scope === "string" ? scope : scope.id;
  }

  let warnedUnscoped = false;

  return (id: string) => {
    const active = explicit ?? activeConversation();
    if (!active) {
      if (!warnedUnscoped) {
        warnedUnscoped = true;
        chat
          .getLogger()
          .warn(
            `Agent read tool ran unscoped: "${id}" was read workspace-wide because no conversation is being handled and no \`scope\` was set. Pass \`scope\` to createChatTools to confine reads.`
          );
      }
      return;
    }

    const activeChannel = channelOf(chat, active);
    const targetChannel = channelOf(chat, id);

    // Same channel is always required. Under strict a thread scope additionally
    // requires the exact scoped conversation, so both sibling threads and the
    // parent channel are rejected: on per-thread-ACL platforms the channel is
    // the widest read available (a GitHub channel is the whole repo), so
    // allowing it would defeat the point of confining to one thread. A channel
    // scope is unaffected and still permits anything within it.
    const sameChannel = targetChannel === activeChannel;
    const scopeIsChannel = active === activeChannel;
    const inScope = sameChannel && (!strict || scopeIsChannel || id === active);

    if (!inScope) {
      throw new Error(
        `Tool call blocked: reads are scoped to "${active}", but "${id}" resolves outside it.`
      );
    }
  };
}
