import { describe, expect, it } from "vitest";
import {
  extractTeamsContinuation,
  parseTeamsWebhookBody,
  readTeamsWebhook,
  TeamsWebhookParseError,
} from "./index";

const baseActivity = {
  channelData: {
    channel: { id: "channel-id" },
    team: { id: "team-id" },
    tenant: { id: "tenant-id" },
  },
  conversation: { id: "conversation-id" },
  from: { aadObjectId: "aad-id", id: "user-id", name: "Ada" },
  id: "activity-id",
  serviceUrl: "https://smba.example/",
};

describe("Teams webhook primitives", () => {
  it("parses message activities with continuation and mention state", () => {
    const payload = parseTeamsWebhookBody(
      {
        ...baseActivity,
        entities: [
          {
            mentioned: { id: "28:bot-id", name: "Bot" },
            text: "<at>Bot</at>",
            type: "mention",
          },
        ],
        text: "<at>Bot</at> hello",
        type: "message",
      },
      { botAppId: "bot-id" }
    );

    expect(payload).toMatchObject({
      continuation: {
        activityId: "activity-id",
        channelId: "channel-id",
        conversationId: "conversation-id",
        serviceUrl: "https://smba.example/",
        teamId: "team-id",
        tenantId: "tenant-id",
      },
      isMention: true,
      kind: "message",
      text: "<at>Bot</at> hello",
      user: { aadObjectId: "aad-id", id: "user-id", name: "Ada" },
    });
  });

  it("classifies card actions and dialogs", () => {
    expect(
      parseTeamsWebhookBody({
        ...baseActivity,
        name: "adaptiveCard/action",
        type: "invoke",
        value: { actionId: "approve" },
      })
    ).toMatchObject({ actionId: "approve", kind: "card_action" });
    expect(
      parseTeamsWebhookBody({
        ...baseActivity,
        name: "task/fetch",
        type: "invoke",
      })
    ).toMatchObject({ kind: "dialog_open" });
    expect(
      parseTeamsWebhookBody({
        ...baseActivity,
        name: "task/submit",
        type: "invoke",
      })
    ).toMatchObject({ kind: "dialog_submit" });
  });

  it("classifies reaction and lifecycle activities", () => {
    expect(
      parseTeamsWebhookBody({
        ...baseActivity,
        action: "add",
        replyToId: "message-id",
        type: "messageReaction",
      })
    ).toMatchObject({
      action: "add",
      kind: "message_reaction",
      messageId: "message-id",
    });
    expect(
      parseTeamsWebhookBody({ ...baseActivity, type: "conversationUpdate" })
    ).toMatchObject({ kind: "conversation_update" });
    expect(
      parseTeamsWebhookBody({
        ...baseActivity,
        action: "add",
        type: "installationUpdate",
      })
    ).toMatchObject({ action: "add", kind: "installation_update" });
  });

  it("reads request bodies without verifying JWTs", async () => {
    const payload = await readTeamsWebhook(
      new Request("https://example.com/teams", {
        body: JSON.stringify({
          ...baseActivity,
          text: "hello",
          type: "message",
        }),
        method: "POST",
      })
    );

    expect(payload.kind).toBe("message");
  });

  it("extracts continuation from channelData fallbacks", () => {
    expect(
      extractTeamsContinuation({
        channelData: {
          teamsChannelId: "teams-channel",
          teamsTeamId: "teams-team",
        },
        conversation: { id: "conversation", tenantId: "tenant" },
        serviceUrl: "service",
      })
    ).toMatchObject({
      channelId: "teams-channel",
      conversationId: "conversation",
      serviceUrl: "service",
      teamId: "teams-team",
      tenantId: "tenant",
    });
  });

  it("throws parse errors for invalid JSON", () => {
    expect(() => parseTeamsWebhookBody("{")).toThrow(TeamsWebhookParseError);
  });
});
