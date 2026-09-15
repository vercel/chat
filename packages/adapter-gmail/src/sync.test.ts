import { createMemoryState } from "@chat-adapter/state-memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gmailChannel } from "./ids";
import { GmailSynchronizer } from "./sync";

const mailbox = "agent@example.com";
const label = "Label_123";
const key = `${gmailChannel(mailbox)}:sync:${label}`;
const reference = { id: "message", threadId: "thread" };

function message(labels = [label]) {
  return {
    ...reference,
    labelIds: labels,
    internalDate: "1788481753000",
    raw: Buffer.from(
      "From: sender@example.com\r\nMessage-ID: <original@example.com>\r\n\r\nhello"
    ).toString("base64url"),
  };
}

function history(pageToken?: string) {
  return {
    historyId: "9007199254740995",
    nextPageToken: pageToken,
    history: [
      {
        id: "9007199254740994",
        messagesAdded: [{ message: reference }],
        labelsAdded: [{ message: reference, labelIds: [label] }],
      },
    ],
  };
}

async function setup(fetch: typeof globalThis.fetch) {
  const state = createMemoryState();
  await state.connect();
  await state.set(`${key}:cursor`, "9007199254740993");
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const synchronizer = new GmailSynchronizer(
    { mailbox, token: "token", fetch },
    label,
    state,
    dispatch
  );
  return { state, dispatch, synchronizer };
}

describe("Gmail history synchronization", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accounts for deletions and label removals without loading or dispatching email", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        historyId: "9007199254740995",
        history: [
          {
            id: "9007199254740994",
            messages: [reference],
            messagesDeleted: [{ message: reference }],
            labelsRemoved: [{ message: reference, labelIds: [label] }],
          },
        ],
      })
    );
    const { state, dispatch, synchronizer } = await setup(fetch);
    await synchronizer.sync();
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toContain("/history?");
    expect(dispatch).not.toHaveBeenCalled();
    expect(await state.get(`${key}:cursor`)).toBe("9007199254740995");
  });

  it("coalesces a conversation label across history pages into its latest incoming message", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/history")) {
          const next = url.searchParams.has("pageToken");
          return Promise.resolve(
            Response.json({
              historyId: "9007199254740995",
              nextPageToken: next ? undefined : "next",
              history: [
                {
                  id: "9007199254740994",
                  labelsAdded: [
                    {
                      message: {
                        id: next ? "old" : "latest",
                        threadId: "thread",
                      },
                      labelIds: [label],
                    },
                  ],
                },
              ],
            })
          );
        }
        if (url.pathname.includes("/threads/")) {
          expect(url.searchParams.get("format")).toBe("minimal");
          expect(url.searchParams.get("fields")).toBe(
            "id,messages(id,threadId)"
          );
          return Promise.resolve(
            Response.json({
              id: "thread",
              messages: [
                { id: "old", threadId: "thread" },
                { id: "latest", threadId: "thread" },
              ],
            })
          );
        }
        return Promise.resolve(
          Response.json({ ...message(), id: url.pathname.split("/").at(-1) })
        );
      });
    const { state, synchronizer, dispatch } = await setup(fetch);
    await synchronizer.sync();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ id: "latest" }),
      })
    );
    await synchronizer.sync();
    expect(dispatch).toHaveBeenCalledOnce();
    await state.disconnect();
  });

  it("catches up from the saved cursor after watch renewal without resetting history", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/profile")) {
          return Promise.resolve(
            Response.json({
              emailAddress: mailbox,
              historyId: "9007199254741000",
            })
          );
        }
        if (url.pathname.endsWith("/watch")) {
          return Promise.resolve(
            Response.json({
              historyId: "9007199254741001",
              expiration: "1789086553000",
            })
          );
        }
        if (url.pathname.endsWith("/history")) {
          expect(url.searchParams.get("startHistoryId")).toBe(
            "9007199254740993"
          );
          return Promise.resolve(Response.json(history()));
        }
        expect(url.pathname).not.toContain("/threads/");
        return Promise.resolve(Response.json(message()));
      });
    const { state, synchronizer, dispatch } = await setup(fetch);
    try {
      await synchronizer.watch("projects/project/topics/mail");
      expect(dispatch).not.toHaveBeenCalled();
      await synchronizer.sync();
      expect(dispatch).toHaveBeenCalledOnce();
      expect(await state.get(`${key}:cursor`)).toBe("9007199254740995");
    } finally {
      await state.disconnect();
    }
  });

  it("keeps the saved cursor when renewing a watch", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ emailAddress: mailbox, historyId: "9007199254741000" })
      )
      .mockResolvedValueOnce(
        Response.json({
          historyId: "9007199254741001",
          expiration: "1789086553000",
        })
      );
    const { state, synchronizer } = await setup(fetch);
    await synchronizer.watch("projects/project/topics/mail");
    expect(await state.get(`${key}:cursor`)).toBe("9007199254740993");
    expect(await state.get(`${key}:expiration`)).toBe("1789086553000");
    await state.disconnect();
  });

  it("seeds only a missing cursor and rejects a mismatched authenticated mailbox", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ emailAddress: mailbox, historyId: "100" })
      )
      .mockResolvedValueOnce(
        Response.json({ historyId: "101", expiration: "1789086553000" })
      )
      .mockResolvedValueOnce(
        Response.json({ emailAddress: "another@example.com", historyId: "102" })
      );
    const { state, synchronizer } = await setup(fetch);
    await state.delete(`${key}:cursor`);
    await synchronizer.watch("projects/project/topics/mail");
    expect(await state.get(`${key}:cursor`)).toBe("101");
    await expect(
      synchronizer.watch("projects/project/topics/mail")
    ).rejects.toThrow("does not match");
    expect(await state.get(`${key}:cursor`)).toBe("101");
    await state.disconnect();
  });

  it("filters history by label and does not fetch unrelated message bodies", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/history")) {
          return Promise.resolve(Response.json(history()));
        }
        return Promise.resolve(Response.json(message(["INBOX"])));
      });
    const { state, synchronizer, dispatch } = await setup(fetch);
    await synchronizer.sync();
    const urls = fetch.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls[0].searchParams.get("labelId")).toBe(label);
    expect(urls.some((url) => url.searchParams.get("format") === "raw")).toBe(
      false
    );
    expect(dispatch).not.toHaveBeenCalled();
    await state.disconnect();
  });

  it("rechecks the label after metadata lookup before dispatching the body", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/history")) {
          return Promise.resolve(Response.json(history()));
        }
        return Promise.resolve(
          Response.json(
            message(url.searchParams.get("format") === "raw" ? [] : [label])
          )
        );
      });
    const { state, synchronizer, dispatch } = await setup(fetch);
    await synchronizer.sync();
    expect(dispatch).not.toHaveBeenCalled();
    await state.disconnect();
  });

  it("skips a conversation deleted between history listing and thread lookup", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) => {
        if (String(input).includes("/history?")) {
          return Promise.resolve(
            Response.json({
              historyId: "200",
              history: [
                {
                  id: "150",
                  messagesAdded: [
                    { message: { id: "first", threadId: "thread" } },
                    { message: { id: "second", threadId: "thread" } },
                  ],
                },
              ],
            })
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });
    const { state, synchronizer, dispatch } = await setup(fetch);
    await synchronizer.sync();
    expect(dispatch).not.toHaveBeenCalled();
    expect(await state.get(`${key}:cursor`)).toBe("200");
    await state.disconnect();
  });

  it.each([
    "SENT",
    "DRAFT",
    "TRASH",
    "SPAM",
  ])("does not dispatch %s messages", async (excluded) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) =>
        Promise.resolve(
          Response.json(
            String(input).includes("/history?")
              ? history()
              : message([label, excluded])
          )
        )
      );
    const { state, synchronizer, dispatch } = await setup(fetch);
    await synchronizer.sync();
    expect(dispatch).not.toHaveBeenCalled();
    await state.disconnect();
  });

  it("commits only the final page cursor and suppresses redelivered messages", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const { state, synchronizer, dispatch } = await setup(fetch);
    fetch.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        expect(await state.get(`${key}:cursor`)).toBe("9007199254740993");
        return Response.json(
          history(url.searchParams.has("pageToken") ? undefined : "next")
        );
      }
      return Response.json(message());
    });
    await synchronizer.sync();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(await state.get(`${key}:cursor`)).toBe("9007199254740995");
    fetch.mockImplementation(() => Promise.resolve(Response.json(history())));
    await synchronizer.sync();
    expect(dispatch).toHaveBeenCalledOnce();
    await state.disconnect();
  });

  it("does not advance the cursor after a later page fails", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/history")) {
          return Promise.resolve(
            url.searchParams.has("pageToken")
              ? new Response(null, { status: 503 })
              : Response.json(history("next"))
          );
        }
        return Promise.resolve(Response.json(message()));
      });
    const { state, synchronizer } = await setup(fetch);
    await expect(synchronizer.sync()).rejects.toMatchObject({ status: 503 });
    expect(await state.get(`${key}:cursor`)).toBe("9007199254740993");
    await state.disconnect();
  });

  it("recovers expired history using a profile cursor captured before the full scan", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/history")) {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        if (url.pathname.endsWith("/profile")) {
          return Promise.resolve(
            Response.json({
              emailAddress: mailbox,
              historyId: "9007199254741000",
            })
          );
        }
        if (url.pathname.endsWith("/messages")) {
          return Promise.resolve(Response.json({ messages: [reference] }));
        }
        return Promise.resolve(Response.json(message()));
      });
    const { state, synchronizer, dispatch } = await setup(fetch);
    await synchronizer.sync();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(await state.get(`${key}:cursor`)).toBe("9007199254741000");
    await synchronizer.sync();
    expect(dispatch).toHaveBeenCalledOnce();
    await state.disconnect();
  });

  it("records failed dispatch separately and releases its lock", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) =>
        Promise.resolve(
          Response.json(
            String(input).includes("/history?") ? history() : message()
          )
        )
      );
    const { state, synchronizer, dispatch } = await setup(fetch);
    dispatch.mockRejectedValueOnce(new Error("handler failed"));
    await synchronizer.sync();
    expect(await state.get(`${key}:cursor`)).toBe("9007199254740995");
    expect(await state.get(`${key}:delivered:message`)).toBeNull();
    expect(await state.get(`${key}:failed:message`)).toBe("handler");
    const lock = await state.acquireLock(key, 1000);
    expect(lock).not.toBeNull();
    if (lock) {
      await state.releaseLock(lock);
    }
    await state.disconnect();
  });

  it("does not make requests without a cursor or while another worker owns the lock", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const { state, synchronizer } = await setup(fetch);
    const lock = await state.acquireLock(key, 60_000);
    await expect(synchronizer.sync()).rejects.toThrow("already running");
    if (lock) {
      await state.releaseLock(lock);
    }
    await state.delete(`${key}:cursor`);
    await expect(synchronizer.sync()).rejects.toThrow("watch()");
    expect(fetch).not.toHaveBeenCalled();
    await state.disconnect();
  });

  it("stops checkpointing if the mailbox lease is lost during dispatch", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) =>
        Promise.resolve(
          Response.json(
            String(input).includes("/history?") ? history() : message()
          )
        )
      );
    const { state, synchronizer, dispatch } = await setup(fetch);
    vi.spyOn(state, "extendLock").mockResolvedValue(false);
    dispatch.mockImplementation(() => vi.advanceTimersByTimeAsync(15_000));
    await expect(synchronizer.sync()).rejects.toThrow("lost its lease");
    expect(await state.get(`${key}:cursor`)).toBe("9007199254740993");
    expect(await state.get(`${key}:delivered:message`)).toBeNull();
    await state.disconnect();
  });
});
