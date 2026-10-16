import type { Adapter } from "chat";
import { describe, expectTypeOf, it } from "vitest";
import { createWebhookAdapter, WebhookAdapter } from "./index";

interface WahaPayload {
  payload: { body: string; from: string; id: string };
}

describe("WebhookAdapterConfig", () => {
  it("accepts a typed payload and callbacks that return nothing", () => {
    const adapter = createWebhookAdapter({
      secret: "s",
      parse: (event: WahaPayload) => ({
        id: event.payload.id,
        channelId: event.payload.from,
        text: event.payload.body,
        author: { userId: event.payload.from },
      }),
      send: async ({ channelId, text }) => {
        await Promise.resolve([channelId, text]);
      },
      edit: async () => undefined,
    });
    expectTypeOf(adapter).toEqualTypeOf<WebhookAdapter>();
    expectTypeOf(adapter).toMatchTypeOf<Adapter>();
  });
});

describe("subclass extensibility", () => {
  it("exposes protected members and methods to subclasses", () => {
    class TestSubclass extends WebhookAdapter {
      checkAccess() {
        return [
          this.config,
          this.logger,
          this.formatConverter,
          this.parseBody,
          this.verifyRequest,
          this.verifySignature,
        ] as const;
      }
    }
    expectTypeOf(TestSubclass.prototype.checkAccess).toBeFunction();
  });
});
