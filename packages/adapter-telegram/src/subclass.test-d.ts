import type { AdapterPostableMessage } from "chat";
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
      sendNumber() {
        return this.sendSplitPart(() => Promise.resolve(1), "telegram:1", {
          delivered: 1,
          lastDeliveredAt: 0,
          retryWaitMs: 0,
        });
      }
      split(message: AdapterPostableMessage) {
        return this.splitLongMessage(message, false);
      }
      fits() {
        return this.fitsRegularMessage({ plainText: "a", text: "a" });
      }
      interval() {
        return this.splitPartIntervalMs("telegram:1");
      }
      longMessageMode() {
        return this.longMessages;
      }
    }
    // The send wrapper resolves to whatever the wrapped send resolves to.
    expectTypeOf(
      SplitSubclass.prototype.sendNumber
    ).returns.resolves.toEqualTypeOf<number>();
    expectTypeOf(SplitSubclass.prototype.split).returns.toEqualTypeOf<
      AdapterPostableMessage[] | null
    >();
    expectTypeOf(SplitSubclass.prototype.fits).returns.toEqualTypeOf<boolean>();
    expectTypeOf(
      SplitSubclass.prototype.interval
    ).returns.toEqualTypeOf<number>();
    expectTypeOf(
      SplitSubclass.prototype.longMessageMode
    ).returns.toEqualTypeOf<TelegramLongMessageMode>();
    // The split state is optional, so a subclass can send a single message.
    expectTypeOf<Parameters<SplitSubclass["sendPostable"]>>().toEqualTypeOf<
      [
        threadId: string,
        message: AdapterPostableMessage,
        replyToMessageId?: string,
        splitState?: Parameters<SplitSubclass["sendSplitPart"]>[2],
      ]
    >();
  });

  it("lets a subclass turn thread history persistence off", () => {
    expectTypeOf<
      TelegramAdapter["persistThreadHistory"]
    >().toEqualTypeOf<boolean>();

    class NoHistorySubclass extends TelegramAdapter {
      // Compile-time check: this override fails to type-check if the base
      // narrows persistThreadHistory back to the literal `true`.
      override readonly persistThreadHistory = false;
    }
    expectTypeOf<
      NoHistorySubclass["persistThreadHistory"]
    >().toEqualTypeOf<false>();
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
