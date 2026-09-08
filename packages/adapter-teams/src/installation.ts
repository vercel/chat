import type { Account, ConversationReference } from "@microsoft/teams.api";
import type { TeamsConversationReference } from "./types";

function copyAccount(account: Account): TeamsConversationReference["bot"] {
  return {
    id: account.id,
    aadObjectId: account.aadObjectId,
    name: account.name,
    role: account.role,
  };
}

/** Copy only destination metadata, never arbitrary properties or live SDK context. */
export function copyInstallationReference(
  ref: ConversationReference
): TeamsConversationReference {
  return {
    activityId: ref.activityId,
    bot: copyAccount(ref.bot),
    channelId: String(ref.channelId),
    conversation: {
      id: ref.conversation.id,
      conversationType: String(ref.conversation.conversationType ?? ""),
      isGroup: ref.conversation.isGroup,
      name: ref.conversation.name,
      tenantId: ref.conversation.tenantId,
    },
    locale: ref.locale,
    serviceUrl: ref.serviceUrl,
    user: ref.user ? copyAccount(ref.user) : undefined,
  };
}
