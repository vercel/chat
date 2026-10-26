import { describe, expectTypeOf, it } from "vitest";
import {
  TelegramAdapter,
  type TelegramAdapterConfig,
  type TelegramLongMessageMode,
} from "./index";

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

  it("exposes the long message split hooks to subclasses", () => {
    class SplitSubclass extends TelegramAdapter {
      retryNumber() {
        return this.retrySplitPartRateLimit(
          () => Promise.resolve(1),
          "telegram:1"
        );
      }
      longMessageMode() {
        return this.longMessages;
      }
      hooks() {
        // Compile-time check: fails if any of these become `private`.
        return [
          this.postMessageParts,
          this.sendPostable,
          this.splitLongMessage,
        ] as const;
      }
    }
    // The retry wrapper resolves to whatever the wrapped send resolves to.
    expectTypeOf(
      SplitSubclass.prototype.retryNumber
    ).returns.resolves.toEqualTypeOf<number>();
    expectTypeOf(
      SplitSubclass.prototype.longMessageMode
    ).returns.toEqualTypeOf<TelegramLongMessageMode>();
    expectTypeOf(SplitSubclass.prototype.hooks).toBeFunction();
  });
});

describe("longMessages config", () => {
  it("accepts only the documented strategies", () => {
    expectTypeOf<TelegramLongMessageMode>().toEqualTypeOf<
      "truncate" | "split"
    >();
    expectTypeOf<TelegramAdapterConfig["longMessages"]>().toEqualTypeOf<
      TelegramLongMessageMode | undefined
    >();
    // @ts-expect-error only "truncate" and "split" are valid
    const invalid: TelegramAdapterConfig = { longMessages: "drop" };
    expectTypeOf(invalid).toEqualTypeOf<TelegramAdapterConfig>();
  });
});
