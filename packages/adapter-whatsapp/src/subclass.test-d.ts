import { describe, expectTypeOf, it } from "vitest";
import { WhatsAppAdapter } from "./index";
import type { WhatsAppInboundMessage } from "./types";

describe("subclass extensibility", () => {
  it("exposes protected members and methods to subclasses", () => {
    class TestSubclass extends WhatsAppAdapter {
      checkAccess() {
        // Compile-time check: if any of these revert to `private`, this fails to type-check.
        return [
          this.logger,
          this.formatConverter,
          this.verifySignature,
        ] as const;
      }

      checkMethods(message: WhatsAppInboundMessage) {
        return [
          () => this.handleInboundMessage(message, undefined, "123"),
          () => this.handleReaction(message, undefined, "123"),
          () => this.handleInteractiveReply(message, undefined, "123"),
          () => this.handleButtonResponse(message, undefined, "123"),
          () => this.buildMessage(message, undefined, "thread", "text", "123"),
        ];
      }
    }
    expectTypeOf(TestSubclass.prototype.checkAccess).toBeFunction();
    expectTypeOf(TestSubclass.prototype.checkMethods).toBeFunction();
  });
});
