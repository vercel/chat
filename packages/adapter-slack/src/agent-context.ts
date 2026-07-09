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
 * @param context - The Slack context object.
 * @returns Relevance-ordered normalized entities; empty when the context has none.
 */
export function normalizeAppContextEntities({
  entities,
}: SlackAppContext): AppContextEntity[] {
  if (!entities) {
    return [];
  }

  return entities.map((entity) => {
    const teamId = entity.team_id;
    const enterpriseId = entity.enterprise_id;

    if (entity.type === CHANNEL_TOKEN) {
      return {
        kind: "channel",
        channelId: entity.value as string,
        teamId,
        enterpriseId,
      };
    }

    if (entity.type === CANVAS_TOKEN) {
      return {
        kind: "canvas",
        canvasId: entity.value as string,
        teamId,
        enterpriseId,
      };
    }

    if (entity.type === LIST_TOKEN) {
      return {
        kind: "list",
        listId: entity.value as string,
        teamId,
        enterpriseId,
      };
    }

    if (entity.type === MESSAGE_TOKEN) {
      const value = entity.value as { message_ts: string; channel_id: string };
      return {
        kind: "message",
        messageTs: value.message_ts,
        channelId: value.channel_id,
        teamId,
        enterpriseId,
      };
    }

    return {
      kind: "unknown",
      type: entity.type,
      value: entity.value,
      teamId,
      enterpriseId,
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
