import { describe, expectTypeOf, it } from "vitest";
import { LinearAdapter } from "./index";

describe("subclass extensibility", () => {
  it("exposes protected members and methods to subclasses", () => {
    class TestSubclass extends LinearAdapter {
      checkAccess() {
        // Compile-time check: if any of these revert to `private`, this fails to type-check.
        return [
          this.logger,
          this.formatConverter,
          this.handleCommentCreated,
        ] as const;
      }
    }
    expectTypeOf(TestSubclass.prototype.checkAccess).toBeFunction();
  });
});
