import type { AppContextEntity, Message } from "chat";

/** A single entity in a Slack active-view context (wire shape). */
export interface SlackAppContextEntity {
  enterprise_id?: string;
  team_id?: string;
  type: string;
  value: unknown;
}

/** Slack active-view context object (`app_context` on messages, `context` elsewhere). */
export interface SlackAppContext {
  entities?: SlackAppContextEntity[];
}

/** Slack `app_context_changed` event payload (wire shape, agent_view only). */
export interface SlackAppContextChangedEvent {
  channel: string;
  context: SlackAppContext;
  event_ts: string;
  type: "app_context_changed";
  user: string;
}

const CHANNEL_TOKEN = "slack#/types/channel_id";
const CANVAS_TOKEN = "slack#/types/canvas_id";
const LIST_TOKEN = "slack#/types/list_id";
const MESSAGE_TOKEN = "slack#/types/message_context";

/**
 * Normalize Slack active-view context entities into the core `AppContextEntity` union.
 * Unrecognized entity types map to `{ kind: "unknown" }` for forward-compatibility.
 * @param context - The Slack context object; tolerates a missing/malformed one.
 * @returns Relevance-ordered normalized entities; empty when the context has none.
 */
export function normalizeAppContextEntities(
  context: SlackAppContext | undefined
): AppContextEntity[] {
  const entities = context?.entities;
  if (!entities) {
    return [];
  }

  return entities.map((entity) => {
    const base = {
      teamId: entity.team_id,
      enterpriseId: entity.enterprise_id,
    };

    if (entity.type === CHANNEL_TOKEN) {
      return { ...base, kind: "channel", channelId: entity.value as string };
    }

    if (entity.type === CANVAS_TOKEN) {
      return { ...base, kind: "canvas", canvasId: entity.value as string };
    }

    if (entity.type === LIST_TOKEN) {
      return { ...base, kind: "list", listId: entity.value as string };
    }

    if (entity.type === MESSAGE_TOKEN) {
      const value = entity.value as
        | { message_ts?: unknown; channel_id?: unknown }
        | null
        | undefined;
      // A malformed value falls through to kind "unknown" instead of crashing
      // the webhook: one odd entity must not turn into a 500 + Slack retry loop.
      if (
        value &&
        typeof value.message_ts === "string" &&
        typeof value.channel_id === "string"
      ) {
        return {
          ...base,
          kind: "message",
          messageTs: value.message_ts,
          channelId: value.channel_id,
        };
      }
    }

    return {
      ...base,
      kind: "unknown",
      type: entity.type,
      value: entity.value,
    };
  });
}

/**
 * Read the folded active-view context Slack attaches to a DM message
 * (`message.im`'s `app_context` field), normalized to core entities.
 * @param message - The incoming message whose raw payload may carry `app_context`.
 * @returns Normalized entities; empty when no folded context is present.
 */
export function getAppContext(message: Message): AppContextEntity[] {
  const raw = message.raw as { app_context?: SlackAppContext } | undefined;
  const context = raw?.app_context;

  return context ? normalizeAppContextEntities(context) : [];
}
