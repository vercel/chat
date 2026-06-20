import type {
  TeamsActivity,
  TeamsContinuation,
  TeamsWebhookAttachment,
  TeamsWebhookUser,
} from "./types";

export function extractTeamsContinuation(
  activity: TeamsActivity
): TeamsContinuation {
  return {
    ...(activity.id ? { activityId: activity.id } : {}),
    ...(activity.channelData?.channel?.id
      ? { channelId: activity.channelData.channel.id }
      : {}),
    ...(activity.channelData?.teamsChannelId
      ? { channelId: activity.channelData.teamsChannelId }
      : {}),
    conversationId: activity.conversation?.id ?? "",
    ...(activity.replyToId ? { replyToId: activity.replyToId } : {}),
    serviceUrl: activity.serviceUrl ?? "",
    ...(activity.channelData?.team?.id
      ? { teamId: activity.channelData.team.id }
      : {}),
    ...(activity.channelData?.teamsTeamId
      ? { teamId: activity.channelData.teamsTeamId }
      : {}),
    ...(activity.conversation?.tenantId
      ? { tenantId: activity.conversation.tenantId }
      : {}),
    ...(activity.channelData?.tenant?.id
      ? { tenantId: activity.channelData.tenant.id }
      : {}),
  };
}

export function extractTeamsUser(
  activity: TeamsActivity
): TeamsWebhookUser | undefined {
  if (!activity.from?.id) {
    return undefined;
  }
  return {
    ...(activity.from.aadObjectId
      ? { aadObjectId: activity.from.aadObjectId }
      : {}),
    id: activity.from.id,
    ...(activity.from.name ? { name: activity.from.name } : {}),
  };
}

export function extractTeamsAttachments(
  activity: TeamsActivity
): TeamsWebhookAttachment[] {
  const attachments = Array.isArray(activity.attachments)
    ? activity.attachments
    : [];
  return attachments
    .filter((attachment): attachment is Record<string, unknown> =>
      Boolean(attachment && typeof attachment === "object")
    )
    .map((attachment) => ({
      ...(typeof attachment.content === "undefined"
        ? {}
        : { content: attachment.content }),
      ...(typeof attachment.contentType === "string"
        ? { contentType: attachment.contentType }
        : {}),
      ...(typeof attachment.contentUrl === "string"
        ? { contentUrl: attachment.contentUrl }
        : {}),
      ...(typeof attachment.name === "string" ? { name: attachment.name } : {}),
      raw: attachment,
    }));
}

export function isTeamsMention(
  activity: TeamsActivity,
  botAppId?: string
): boolean {
  if (!botAppId) {
    return false;
  }
  return (activity.entities ?? []).some(
    (entity) =>
      entity.type === "mention" &&
      typeof entity.mentioned?.id === "string" &&
      (entity.mentioned.id === botAppId ||
        entity.mentioned.id.endsWith(`:${botAppId}`))
  );
}
