import { describe, expectTypeOf, it } from "vitest";
import { TelegramAdapter } from "./index";

describe("subclass extensibility", () => {
  it("exposes protected members and methods to subclasses", () => {
    class TestSubclass extends TelegramAdapter {
      checkAccess() {
        // Compile-time check: if any of these revert to `private`, this fails to type-check.
        return [this.logger, this.formatConverter, this.processUpdate] as const;
      }
    }
    expectTypeOf(TestSubclass.prototype.checkAccess).toBeFunction();
  });
});
