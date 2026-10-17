import type { UIMessage } from "ai";
import { describe, expectTypeOf, it } from "vitest";
import type { WebAdapter, WebMessage } from "./index";

describe("WebMessage", () => {
  it("accepts an AI SDK UIMessage", () => {
    expectTypeOf<UIMessage>().toExtend<WebMessage>();
    expectTypeOf<WebAdapter["parseMessage"]>()
      .parameter(0)
      .toEqualTypeOf<WebMessage>();
  });
});
