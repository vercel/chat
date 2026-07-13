import type { Message } from "chat";
import { describe, expect, it } from "vitest";
import { getAppContext, normalizeAppContextEntities } from "./agent-context";

describe("normalizeAppContextEntities", () => {
  it("returns [] for an empty context object", () => {
    expect(normalizeAppContextEntities({})).toEqual([]);
  });

  it("returns [] for a missing context", () => {
    expect(normalizeAppContextEntities(undefined)).toEqual([]);
  });

  it("maps channel_id", () => {
    expect(
      normalizeAppContextEntities({
        entities: [{ type: "slack#/types/channel_id", value: "C123" }],
      })
    ).toEqual([{ kind: "channel", channelId: "C123" }]);
  });

  it("maps canvas_id and list_id", () => {
    expect(
      normalizeAppContextEntities({
        entities: [
          { type: "slack#/types/canvas_id", value: "F1" },
          { type: "slack#/types/list_id", value: "L1" },
        ],
      })
    ).toEqual([
      { kind: "canvas", canvasId: "F1" },
      { kind: "list", listId: "L1" },
    ]);
  });

  it("maps message_context", () => {
    expect(
      normalizeAppContextEntities({
        entities: [
          {
            type: "slack#/types/message_context",
            value: { message_ts: "111.222", channel_id: "C9" },
          },
        ],
      })
    ).toEqual([{ kind: "message", messageTs: "111.222", channelId: "C9" }]);
  });

  it("maps unrecognized tokens to kind unknown", () => {
    expect(
      normalizeAppContextEntities({
        entities: [{ type: "slack#/types/future", value: 42 }],
      })
    ).toEqual([{ kind: "unknown", type: "slack#/types/future", value: 42 }]);
  });

  it("maps a message_context with a malformed value to kind unknown instead of throwing", () => {
    expect(
      normalizeAppContextEntities({
        entities: [
          { type: "slack#/types/message_context", value: null },
          { type: "slack#/types/message_context", value: "not-an-object" },
          { type: "slack#/types/message_context", value: { message_ts: 1 } },
        ],
      })
    ).toEqual([
      { kind: "unknown", type: "slack#/types/message_context", value: null },
      {
        kind: "unknown",
        type: "slack#/types/message_context",
        value: "not-an-object",
      },
      {
        kind: "unknown",
        type: "slack#/types/message_context",
        value: { message_ts: 1 },
      },
    ]);
  });

  it("preserves team_id/enterprise_id and relevance order", () => {
    expect(
      normalizeAppContextEntities({
        entities: [
          { type: "slack#/types/channel_id", value: "C1", team_id: "T1" },
          {
            type: "slack#/types/canvas_id",
            value: "F1",
            enterprise_id: "E1",
          },
        ],
      })
    ).toEqual([
      { kind: "channel", channelId: "C1", teamId: "T1" },
      { kind: "canvas", canvasId: "F1", enterpriseId: "E1" },
    ]);
  });
});

describe("getAppContext", () => {
  it("reads and normalizes folded app_context from message.raw", () => {
    const message = {
      raw: {
        app_context: {
          entities: [{ type: "slack#/types/channel_id", value: "C1" }],
        },
      },
    } as unknown as Message;
    expect(getAppContext(message)).toEqual([
      { kind: "channel", channelId: "C1" },
    ]);
  });

  it("returns [] when the message has no folded app_context", () => {
    const message = { raw: {} } as unknown as Message;
    expect(getAppContext(message)).toEqual([]);
  });
});
