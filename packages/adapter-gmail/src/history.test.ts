import { describe, expect, it, vi } from "vitest";
import { encodeGmailMessage } from "./ids";
import { createGmailAdapter } from "./index";

const mailbox = "agent@example.com";

function fixture() {
  const ids = ["first", "second", "third", "fourth", "fifth"];
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/threads/")) {
      return Promise.resolve(
        Response.json({
          id: "thread",
          messages: ids.map((id) => ({ id, threadId: "thread" })),
        })
      );
    }
    const id = url.pathname.split("/").at(-1);
    return Promise.resolve(
      Response.json({
        id,
        threadId: "thread",
        internalDate: "1788481753000",
        labelIds: ["INBOX"],
        raw: Buffer.from(
          `From: sender@example.com\r\nSubject: review\r\nMessage-ID: <${id}@example.com>\r\n\r\n${id}`
        ).toString("base64url"),
      })
    );
  });
  const adapter = createGmailAdapter({
    mailbox,
    labelId: "Label_123",
    accessToken: "test-token",
    pubsubAudience: "https://example.com/gmail",
    pubsubServiceAccountEmail: "push@project.iam.gserviceaccount.com",
    subscription: "projects/project/subscriptions/mail",
    fetch,
  });
  const threadId = adapter.encodeThreadId({ mailbox, threadId: "thread" });
  return { adapter, fetch, ids, threadId };
}

describe("Gmail thread history", () => {
  it.each([
    "forward",
    "backward",
  ] as const)("paginates %s without overlaps and returns each page in conversation order", async (direction) => {
    const { adapter, fetch, ids, threadId } = fixture();
    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const result = await adapter.fetchMessages(threadId, {
        direction,
        cursor,
        limit: 2,
      });
      pages.push(result.messages.map((message) => message.raw.message.id));
      cursor = result.nextCursor;
    } while (cursor);
    expect(pages).toEqual(
      direction === "forward"
        ? [["first", "second"], ["third", "fourth"], ["fifth"]]
        : [["fourth", "fifth"], ["second", "third"], ["first"]]
    );
    expect(new Set(pages.flat())).toEqual(new Set(ids));
    for (const [input] of fetch.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("format")).toBe(
        url.pathname.includes("/threads/") ? "minimal" : "raw"
      );
    }
  });

  it("defaults to the newest page and rejects a deleted cursor explicitly", async () => {
    const { adapter, fetch, threadId } = fixture();
    const result = await adapter.fetchMessages(threadId, { limit: 2 });
    expect(result.messages.map((message) => message.raw.message.id)).toEqual([
      "fourth",
      "fifth",
    ]);
    fetch.mockClear();
    await expect(
      adapter.fetchMessages(threadId, {
        cursor: encodeGmailMessage("deleted", mailbox),
      })
    ).rejects.toThrow("restart pagination");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    0,
    -1,
    101,
    1.5,
    Number.NaN,
  ])("rejects invalid limit %s before accessing Gmail", async (limit) => {
    const { adapter, fetch, threadId } = fixture();
    await expect(adapter.fetchMessages(threadId, { limit })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a cursor from another mailbox before accessing Gmail", async () => {
    const { adapter, fetch, threadId } = fixture();
    await expect(
      adapter.fetchMessages(threadId, {
        cursor: encodeGmailMessage("first", "another@example.com"),
      })
    ).rejects.toThrow("another Gmail mailbox");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not return a message through a different conversation", async () => {
    const { adapter } = fixture();
    await expect(
      adapter.fetchMessage(
        adapter.encodeThreadId({ mailbox, threadId: "another" }),
        encodeGmailMessage("first", mailbox)
      )
    ).rejects.toThrow("another Gmail thread");
  });

  it("does not infer recipient trust from mailbox privacy", async () => {
    const { adapter, fetch, threadId } = fixture();
    await expect(adapter.fetchThread(threadId)).resolves.toMatchObject({
      id: threadId,
      channelId: adapter.channelIdFromThreadId(threadId),
      channelVisibility: "unknown",
      isDM: false,
      metadata: { mailbox, threadId: "thread" },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
