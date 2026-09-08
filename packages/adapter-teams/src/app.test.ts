import { MessageActivity } from "@microsoft/teams.api";
import { describe, expect, it, vi } from "vitest";
import { normalizeServiceUrl, TeamsApp } from "./app";
import { toAppOptions } from "./config";

const appId = "11111111-2222-3333-4444-555555555555";

function createApp() {
  return new TeamsApp(toAppOptions({ appId, appPassword: "secret" }));
}

describe("normalizeServiceUrl", () => {
  it("strips trailing slashes only", () => {
    expect(normalizeServiceUrl("https://smba.trafficmanager.net/amer/")).toBe(
      "https://smba.trafficmanager.net/amer"
    );
    expect(normalizeServiceUrl("https://smba.trafficmanager.net/amer")).toBe(
      "https://smba.trafficmanager.net/amer"
    );
  });
});

describe("TeamsApp.apiFor", () => {
  it("reuses the app client for the default service URL", () => {
    const app = createApp();
    expect(app.apiFor(app.api.serviceUrl)).toBe(app.api);
    expect(app.apiFor(`${app.api.serviceUrl}/`)).toBe(app.api);
    expect(app.apiFor("")).toBe(app.api);
  });

  it("targets other service URLs with a dedicated client", () => {
    const app = createApp();
    const regional = app.apiFor("https://smba.trafficmanager.net/emea/");
    expect(regional).not.toBe(app.api);
    expect(regional.serviceUrl).toBe("https://smba.trafficmanager.net/emea");
  });
});

describe("TeamsApp with an explicit apiUrl", () => {
  const gateway = "https://gateway.example/teams";

  it("keeps every client on the configured endpoint", () => {
    const app = new TeamsApp(
      toAppOptions({ appId, appPassword: "secret", apiUrl: gateway })
    );
    expect(app.api.serviceUrl).toBe(gateway);
    expect(app.apiFor("https://smba.trafficmanager.net/emea/")).toBe(app.api);
  });

  it("sends through the configured endpoint instead of the thread URL", async () => {
    const app = new TeamsApp(
      toAppOptions({ appId, appPassword: "secret", apiUrl: gateway })
    );
    const sender = app as unknown as {
      activitySender: { send: (...args: unknown[]) => Promise<unknown> };
    };
    const send = vi
      .spyOn(sender.activitySender, "send")
      .mockResolvedValue({ id: "sent", type: "message" });

    await app.sendTo(
      {
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/emea/",
      },
      new MessageActivity("hello")
    );

    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ serviceUrl: gateway })
    );
  });
});

describe("TeamsApp.sendTo", () => {
  it("sends through the SDK with the thread's service URL and conversation", async () => {
    const app = createApp();
    const sender = app as unknown as {
      activitySender: { send: (...args: unknown[]) => Promise<unknown> };
    };
    const send = vi
      .spyOn(sender.activitySender, "send")
      .mockResolvedValue({ id: "sent", type: "message" });

    await app.sendTo(
      {
        conversationId: "19:abc@thread.tacv2",
        conversationType: "channel",
        serviceUrl: "https://smba.trafficmanager.net/emea/",
      },
      new MessageActivity("hello")
    );

    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "message", text: "hello" }),
      {
        channelId: "msteams",
        serviceUrl: "https://smba.trafficmanager.net/emea",
        bot: { id: appId, role: "bot" },
        conversation: {
          id: "19:abc@thread.tacv2",
          conversationType: "channel",
        },
      }
    );
  });

  it("falls back to the default service URL when the thread has none", async () => {
    const app = createApp();
    const sender = app as unknown as {
      activitySender: { send: (...args: unknown[]) => Promise<unknown> };
    };
    const send = vi
      .spyOn(sender.activitySender, "send")
      .mockResolvedValue({ id: "sent", type: "message" });

    await app.sendTo(
      { conversationId: "a:dm", serviceUrl: "" },
      new MessageActivity("hello")
    );

    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ serviceUrl: app.api.serviceUrl })
    );
  });

  it("rejects sends without credentials", async () => {
    const app = new TeamsApp({});
    await expect(
      app.sendTo(
        { conversationId: "a:dm", serviceUrl: "" },
        new MessageActivity("hello")
      )
    ).rejects.toThrow("credentials");
  });
});
