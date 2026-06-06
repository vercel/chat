import { describe, expect, it } from "vitest";
import {
  normalizeRcsSenderId,
  parseChannelMetadata,
  resolveInboundThreadSender,
} from "./channel";

describe("parseChannelMetadata", () => {
  it("parses a plain object", () => {
    expect(parseChannelMetadata('{"type":"rcs"}')).toEqual({ type: "rcs" });
  });

  it("rejects arrays", () => {
    expect(parseChannelMetadata('["rcs"]')).toBeUndefined();
  });

  it("rejects null and invalid JSON", () => {
    expect(parseChannelMetadata("null")).toBeUndefined();
    expect(parseChannelMetadata("not-json")).toBeUndefined();
    expect(parseChannelMetadata(undefined)).toBeUndefined();
  });
});

describe("resolveInboundThreadSender", () => {
  it("prefers MessagingServiceSid from the webhook", () => {
    expect(
      resolveInboundThreadSender({
        messagingServiceSid: "MG123",
        to: "+15550000001",
      })
    ).toBe("MG123");
  });

  it("uses configured messaging service for inbound RCS metadata", () => {
    expect(
      resolveInboundThreadSender({
        channelMetadata: { type: "rcs" },
        messagingServiceSidConfig: "MG123",
        to: "+15550000001",
      })
    ).toBe("MG123");
  });

  it("uses configured rcsSenderId for inbound RCS metadata", () => {
    expect(
      resolveInboundThreadSender({
        channelMetadata: { type: "rcs" },
        rcsSenderIdConfig: "brand_agent",
        to: "+15550000001",
      })
    ).toBe("rcs:brand_agent");
  });

  it("keeps plain phone sender for non-RCS inbound", () => {
    expect(
      resolveInboundThreadSender({
        messagingServiceSidConfig: "MG123",
        to: "+15550000001",
      })
    ).toBe("+15550000001");
  });
});

describe("normalizeRcsSenderId", () => {
  it("adds the rcs: prefix when missing", () => {
    expect(normalizeRcsSenderId("brand_agent")).toBe("rcs:brand_agent");
    expect(normalizeRcsSenderId("rcs:brand_agent")).toBe("rcs:brand_agent");
  });
});
