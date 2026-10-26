import { describe, expectTypeOf, it } from "vitest";
import type { SlackEvent } from "./index";
import { isBotMention, type SlackAppMentionPayload } from "./webhook";

describe("isBotMention types", () => {
  it("accepts a webhook payload's raw event and a SlackEvent", () => {
    expectTypeOf(isBotMention).toBeCallableWith(
      {} as SlackAppMentionPayload["raw"],
      "U_BOT"
    );
    expectTypeOf(isBotMention).toBeCallableWith({} as SlackEvent, "U_BOT");
  });

  it("requires the bot user ID", () => {
    // @ts-expect-error The bot user ID is required.
    expectTypeOf(isBotMention).toBeCallableWith({} as SlackEvent);
  });
});
