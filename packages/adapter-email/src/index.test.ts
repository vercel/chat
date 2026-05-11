import { ConsoleLogger } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createEmailAdapter, defineEmailProvider, EmailAdapter } from "./index";

const NOOP_TRANSPORT = {
  name: "noop",
  send: vi.fn(async () => ({ providerMessageId: undefined, raw: {} })),
};

describe("createEmailAdapter", () => {
  it("requires fromAddress", () => {
    expect(() =>
      // @ts-expect-error: testing the runtime guard
      createEmailAdapter({ provider: { transport: NOOP_TRANSPORT } })
    ).toThrow("fromAddress");
  });

  it("requires a transport", () => {
    expect(() =>
      createEmailAdapter({ fromAddress: "bot@yourdomain.com" })
    ).toThrow("No transport configured");
  });

  it("accepts a provider with bundled transport", () => {
    const adapter = createEmailAdapter({
      fromAddress: "bot@yourdomain.com",
      provider: { transport: NOOP_TRANSPORT },
    });
    expect(adapter).toBeInstanceOf(EmailAdapter);
  });

  it("accepts an explicit transport overriding the provider", () => {
    const t1 = { ...NOOP_TRANSPORT, name: "p1" };
    const t2 = { ...NOOP_TRANSPORT, name: "p2" };
    const adapter = createEmailAdapter({
      fromAddress: "bot@yourdomain.com",
      provider: { transport: t1 },
      transport: t2,
    });
    expect(adapter).toBeInstanceOf(EmailAdapter);
  });

  it("derives messageIdDomain from fromAddress when not provided", () => {
    const adapter = createEmailAdapter({
      fromAddress: "bot@yourdomain.com",
      provider: { transport: NOOP_TRANSPORT },
      logger: new ConsoleLogger("silent"),
    });
    expect(adapter.botUserId).toBe("bot@yourdomain.com");
  });

  it("rejects when fromAddress has no domain and messageIdDomain is unset", () => {
    expect(() =>
      createEmailAdapter({
        fromAddress: "noatsign",
        provider: { transport: NOOP_TRANSPORT },
      })
    ).toThrow("Cannot derive Message-ID domain");
  });
});

describe("defineEmailProvider", () => {
  it("is an identity function", () => {
    const p = defineEmailProvider({ transport: NOOP_TRANSPORT });
    expect(p.transport).toBe(NOOP_TRANSPORT);
  });
});
