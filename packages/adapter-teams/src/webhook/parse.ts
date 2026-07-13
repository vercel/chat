import {
  extractTeamsAttachments,
  extractTeamsContinuation,
  extractTeamsUser,
  isTeamsMention,
} from "./continuation";
import type {
  TeamsActivity,
  TeamsParseOptions,
  TeamsWebhookPayload,
} from "./types";

export class TeamsWebhookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamsWebhookParseError";
  }
}

export function parseTeamsWebhookBody(
  body: string | unknown,
  options: TeamsParseOptions = {}
): TeamsWebhookPayload {
  const activity = parseActivity(body);
  const continuation = extractTeamsContinuation(activity);
  const user = extractTeamsUser(activity);

  if (activity.type === "message") {
    if (isActionSubmitMessage(activity)) {
      return {
        actionId: readActionId(activity.value),
        continuation,
        kind: "card_action",
        raw: activity,
        user,
        value: activity.value,
      };
    }
    return {
      attachments: extractTeamsAttachments(activity),
      continuation,
      isMention: isTeamsMention(activity, options.botAppId),
      kind: "message",
      raw: activity,
      text: activity.text ?? "",
      user,
    };
  }

  if (activity.type === "messageReaction") {
    return {
      action: typeof activity.action === "string" ? activity.action : undefined,
      continuation,
      kind: "message_reaction",
      messageId: activity.replyToId ?? activity.id,
      raw: activity,
      user,
    };
  }

  if (activity.type === "invoke") {
    if (activity.name === "task/fetch") {
      return {
        continuation,
        kind: "dialog_open",
        raw: activity,
        user,
        value: activity.value,
      };
    }
    if (activity.name === "task/submit") {
      return {
        continuation,
        kind: "dialog_submit",
        raw: activity,
        user,
        value: activity.value,
      };
    }
    if (activity.name === "adaptiveCard/action") {
      return {
        actionId: readActionId(activity.value),
        continuation,
        kind: "card_action",
        raw: activity,
        user,
        value: activity.value,
      };
    }
  }

  if (activity.type === "conversationUpdate") {
    return { continuation, kind: "conversation_update", raw: activity };
  }

  if (activity.type === "installationUpdate") {
    return {
      action: typeof activity.action === "string" ? activity.action : undefined,
      continuation,
      kind: "installation_update",
      raw: activity,
    };
  }

  return {
    continuation,
    kind: "unsupported",
    raw: activity,
    reason: `Unsupported Teams activity type: ${activity.type ?? "unknown"}`,
  };
}

function parseActivity(body: string | unknown): TeamsActivity {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return assertActivity(parsed);
    } catch (error) {
      if (error instanceof TeamsWebhookParseError) {
        throw error;
      }
      throw new TeamsWebhookParseError("Invalid Teams webhook JSON body");
    }
  }
  return assertActivity(body);
}

function assertActivity(value: unknown): TeamsActivity {
  if (!(value && typeof value === "object")) {
    throw new TeamsWebhookParseError("Teams webhook body must be an object");
  }
  return value as TeamsActivity;
}

function isActionSubmitMessage(activity: TeamsActivity): boolean {
  return Boolean(
    activity.value &&
      typeof activity.value === "object" &&
      ("actionId" in activity.value || "msteams" in activity.value)
  );
}

function readActionId(value: unknown): string | undefined {
  if (!(value && typeof value === "object" && "actionId" in value)) {
    return undefined;
  }
  const actionId = (value as { actionId?: unknown }).actionId;
  return typeof actionId === "string" ? actionId : undefined;
}
