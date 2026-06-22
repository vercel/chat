import { describe, expect, it } from "vitest";
import {
  Fence,
  STREAM_CHUNK_LIMIT,
  splitTask,
  splitText,
  truncateText,
} from "./stream";

describe("Slack stream limits", () => {
  it("splits text without changing content or breaking unicode", () => {
    const text = `${"word ".repeat(80)}😀${"tail ".repeat(80)}`;
    const chunks = splitText(text, 256);

    expect(chunks.join("")).toBe(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(256);
      const first = chunk.charCodeAt(0);
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(first < 0xdc00 || first > 0xdfff).toBe(true);
      expect(last < 0xd800 || last > 0xdbff).toBe(true);
    }
  });

  it("keeps every prior task part in later status updates", () => {
    const details = "searched matching workspace context ".repeat(30);
    const initial = splitTask(
      {
        details,
        id: "research",
        status: "in_progress",
        title: "Researching",
        type: "task_update",
      },
      0
    );
    const complete = splitTask(
      {
        id: "research",
        status: "complete",
        title: "Research complete",
        type: "task_update",
      },
      initial.length
    );

    expect(initial.length).toBeGreaterThan(1);
    expect(complete).toHaveLength(initial.length);
    expect(complete.every((chunk) => chunk.status === "complete")).toBe(true);
    expect(complete.map((chunk) => chunk.id)).toEqual(
      initial.map((chunk) => chunk.id)
    );
  });

  it("keeps task sources on the first continuation", () => {
    const sources = [
      {
        text: "Slack",
        type: "url" as const,
        url: "https://docs.slack.dev",
      },
    ];
    const chunks = splitTask(
      {
        details: "workspace context ".repeat(50),
        id: "research",
        sources,
        status: "complete",
        title: "Research complete",
        type: "task_update",
      } as Parameters<typeof splitTask>[0],
      0
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({ sources });
    expect(chunks.slice(1).every((chunk) => !("sources" in chunk))).toBe(true);
  });

  it("tracks fenced code across streamed chunks", () => {
    const fence = new Fence();

    fence.push("before\n```typescript\nconst value = 1;");
    expect(fence.closing).toBe("\n```");
    expect(fence.opening).toBe("```typescript\n");

    fence.push("\n```\nafter");
    expect(fence.closing).toBeUndefined();
    expect(fence.opening).toBeUndefined();
  });

  it("tracks a final fence without a trailing newline", () => {
    const fence = new Fence();

    fence.push("```typescript\nconst value = 1;\n```");
    expect(fence.closing).toBe("\n```");

    fence.finish();
    expect(fence.closing).toBeUndefined();
  });

  it("truncates titles without splitting unicode", () => {
    const text = `${"a".repeat(STREAM_CHUNK_LIMIT - 4)}😀overflow`;
    const truncated = truncateText(text, STREAM_CHUNK_LIMIT);

    expect(truncated.length).toBeLessThanOrEqual(STREAM_CHUNK_LIMIT);
    expect(truncated.endsWith("...")).toBe(true);
    expect(
      truncated.charCodeAt(truncated.length - 4)
    ).not.toBeGreaterThanOrEqual(0xd800);
  });
});
