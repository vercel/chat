import { describe, expectTypeOf, it } from "vitest";
import { GitLabAdapter } from "./index";

describe("subclass extensibility", () => {
  it("exposes protected members and methods to subclasses", () => {
    class TestSubclass extends GitLabAdapter {
      checkAccess() {
        // Compile-time check: if any of these revert to `private`, this fails to type-check.
        return [
          this.logger,
          this.formatConverter,
          this.verifySignature,
          this.verifySecretToken,
          this.rawRequest,
        ] as const;
      }
    }
    expectTypeOf(TestSubclass.prototype.checkAccess).toBeFunction();
  });
});
