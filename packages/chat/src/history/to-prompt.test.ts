import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "../types";
import { toPromptEntries } from "./to-prompt";

describe("toPromptEntries", () => {
  it("maps transcript entries to prompt entries preserving order", () => {
    const entries: TranscriptEntry[] = [
      {
        id: "1",
        userKey: "u1",
        role: "user",
        text: "Hello",
        platform: "slack",
        threadId: "slack:C:T",
        timestamp: 1,
      },
      {
        id: "2",
        userKey: "u1",
        role: "assistant",
        text: "Hi there",
        platform: "slack",
        threadId: "slack:C:T",
        timestamp: 2,
      },
    ];

    expect(toPromptEntries(entries)).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
  });

  it("skips entries with empty text", () => {
    const entries: TranscriptEntry[] = [
      {
        id: "1",
        userKey: "u1",
        role: "user",
        text: "",
        platform: "slack",
        threadId: "slack:C:T",
        timestamp: 1,
      },
      {
        id: "2",
        userKey: "u1",
        role: "assistant",
        text: "visible",
        platform: "slack",
        threadId: "slack:C:T",
        timestamp: 2,
      },
    ];

    expect(toPromptEntries(entries)).toEqual([
      { role: "assistant", content: "visible" },
    ]);
  });
});
