import { describe, expect, it } from "vitest";
import {
  extractTeamsAttachments,
  extractTeamsContinuation,
  extractTeamsUser,
  isTeamsMention,
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

  it("rejects non-object JSON and non-string bodies", () => {
    expect(() => parseTeamsWebhookBody("null")).toThrow(TeamsWebhookParseError);
    expect(() => parseTeamsWebhookBody(42)).toThrow(TeamsWebhookParseError);
  });

  it("classifies Action.Submit messages and msteams payloads as card actions", () => {
    expect(
      parseTeamsWebhookBody({
        ...baseActivity,
        type: "message",
        value: { actionId: "approve" },
      })
    ).toMatchObject({ actionId: "approve", kind: "card_action" });
    expect(
      parseTeamsWebhookBody({
        ...baseActivity,
        type: "message",
        value: { msteams: { type: "messageBack" } },
      })
    ).toMatchObject({ actionId: undefined, kind: "card_action" });
  });

  describe("message/submitAction invokes", () => {
    // Modeled on Microsoft's documented feedback payload; no captured traffic
    // exists yet.
    const feedbackInvoke = (value: unknown) => ({
      ...baseActivity,
      id: "invoke-id",
      name: "message/submitAction",
      replyToId: "1700000000000",
      type: "invoke",
      value,
    });

    it("classifies a thumbs up as positive message feedback", () => {
      const raw = feedbackInvoke({
        actionName: "feedback",
        actionValue: { reaction: "like", feedback: "" },
      });

      expect(parseTeamsWebhookBody(raw)).toStrictEqual({
        continuation: {
          activityId: "invoke-id",
          channelId: "channel-id",
          conversationId: "conversation-id",
          replyToId: "1700000000000",
          serviceUrl: "https://smba.example/",
          teamId: "team-id",
          tenantId: "tenant-id",
        },
        kind: "message_feedback",
        messageId: "1700000000000",
        raw,
        user: { aadObjectId: "aad-id", id: "user-id", name: "Ada" },
        value: "positive",
      });
    });

    it("classifies a thumbs down with the comment the user typed", () => {
      expect(
        parseTeamsWebhookBody(
          feedbackInvoke({
            actionName: "feedback",
            actionValue: {
              reaction: "dislike",
              feedback: JSON.stringify({ feedbackText: "Missing last week." }),
            },
          })
        )
      ).toMatchObject({
        comment: "Missing last week.",
        kind: "message_feedback",
        messageId: "1700000000000",
        value: "negative",
      });
    });

    it("omits the comment when it isn't in Teams' feedbackText envelope", () => {
      const payload = parseTeamsWebhookBody(
        feedbackInvoke({
          actionName: "feedback",
          actionValue: { reaction: "like", feedback: "Missing last week." },
        })
      );

      expect(payload).toMatchObject({
        kind: "message_feedback",
        value: "positive",
      });
      expect(payload).not.toHaveProperty("comment");
    });

    it("leaves the message ID unset when the invoke has no replyToId", () => {
      const { replyToId: _replyToId, ...invoke } = feedbackInvoke({
        actionName: "feedback",
        actionValue: { reaction: "like", feedback: "" },
      });

      const payload = parseTeamsWebhookBody(invoke);

      expect(payload.kind).toBe("message_feedback");
      expect(payload).toHaveProperty("messageId", undefined);
    });

    it.each([
      [
        "another action name",
        { actionName: "report", actionValue: { reaction: "like" } },
      ],
      ["a missing action name", { actionValue: { reaction: "like" } }],
      [
        "a reaction Teams doesn't document",
        { actionName: "feedback", actionValue: { reaction: "laugh" } },
      ],
      ["a missing action value", { actionName: "feedback" }],
      ["a missing value", undefined],
    ])("marks %s as unsupported", (_kind, value) => {
      expect(parseTeamsWebhookBody(feedbackInvoke(value))).toMatchObject({
        kind: "unsupported",
        reason: "Unsupported Teams activity type: invoke",
      });
    });

    it("does not treat another invoke carrying a feedback value as feedback", () => {
      expect(
        parseTeamsWebhookBody({
          ...feedbackInvoke({
            actionName: "feedback",
            actionValue: { reaction: "like", feedback: "" },
          }),
          name: "composeExtension/submitAction",
        })
      ).toMatchObject({ kind: "unsupported" });
    });
  });

  it("marks unknown and unhandled activity types as unsupported", () => {
    expect(
      parseTeamsWebhookBody({ ...baseActivity, type: "typing" })
    ).toMatchObject({
      kind: "unsupported",
      reason: "Unsupported Teams activity type: typing",
    });
    expect(
      parseTeamsWebhookBody({
        ...baseActivity,
        name: "signin/verifyState",
        type: "invoke",
      })
    ).toMatchObject({ kind: "unsupported" });
    expect(parseTeamsWebhookBody({ ...baseActivity })).toMatchObject({
      reason: "Unsupported Teams activity type: unknown",
    });
  });

  it("extracts a user only when an id is present", () => {
    expect(extractTeamsUser({ from: { name: "Ada" } })).toBeUndefined();
    expect(extractTeamsUser({ from: { id: "user-id" } })).toEqual({
      id: "user-id",
    });
  });

  it("normalizes attachments and skips non-object entries", () => {
    expect(
      extractTeamsAttachments({
        attachments: [
          null,
          "bad",
          {
            content: { foo: 1 },
            contentType: "application/json",
            contentUrl: "https://example.com/file",
            name: "file",
          },
        ],
      })
    ).toEqual([
      {
        content: { foo: 1 },
        contentType: "application/json",
        contentUrl: "https://example.com/file",
        name: "file",
        raw: {
          content: { foo: 1 },
          contentType: "application/json",
          contentUrl: "https://example.com/file",
          name: "file",
        },
      },
    ]);
  });

  it("detects mentions by id suffix and ignores them without a botAppId", () => {
    const activity = {
      entities: [{ mentioned: { id: "28:bot-id" }, type: "mention" }],
    };
    expect(isTeamsMention(activity, "bot-id")).toBe(true);
    expect(isTeamsMention(activity)).toBe(false);
  });
});
