import { describe, expectTypeOf, it } from "vitest";
import type { SlackEvent, SlackMessageBlock } from "./index";
import { richTextBody } from "./rich-text";

describe("rich text types", () => {
  it("describes inline styles without breaking reads of style.code", () => {
    // A union with the list's string style would make `block.style?.code`
    // a type error for existing consumers of the exported type.
    expectTypeOf<NonNullable<SlackMessageBlock["style"]>>().toEqualTypeOf<{
      bold?: boolean;
      code?: boolean;
      italic?: boolean;
      strike?: boolean;
    }>();
  });

  it("returns a body only when the blocks produce one", () => {
    expectTypeOf(richTextBody).parameters.toEqualTypeOf<[SlackEvent]>();
    expectTypeOf(richTextBody).returns.toEqualTypeOf<string | undefined>();
  });
});
