import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, ConsoleLogger, type Message, type Thread } from "chat";
import { convert } from "html-to-text";
import { describe, expect, it, vi } from "vitest";
import { gmailChannel } from "./ids";
import { createGmailAdapter } from "./index";
import { GmailSynchronizer } from "./sync";
import type { GmailRawMessage } from "./types";

vi.mock("html-to-text", { spy: true });

const mailbox = "agent@example.com";
const label = "Label_123";
const key = `${gmailChannel(mailbox)}:sync:${label}`;
const references = [
  { id: "large", threadId: "first" },
  { id: "healthy", threadId: "second" },
];

function transport(raw: string, expired = false) {
  return vi.fn<typeof globalThis.fetch>().mockImplementation((input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/history")) {
      return Promise.resolve(
        expired
          ? new Response(null, { status: 404 })
          : Response.json({
              historyId: "200",
              history: [
                {
                  id: "150",
                  messagesAdded: references.map((message) => ({ message })),
                },
              ],
            })
      );
    }
    if (url.pathname.endsWith("/profile")) {
      return Promise.resolve(
        Response.json({ emailAddress: mailbox, historyId: "200" })
      );
    }
    if (url.pathname.endsWith("/messages")) {
      return Promise.resolve(Response.json({ messages: references }));
    }
    const reference = references.find(({ id }) =>
      url.pathname.endsWith(`/messages/${id}`)
    );
    if (!reference) {
      throw new Error("Unexpected Gmail request");
    }
    return Promise.resolve(
      Response.json({
        ...reference,
        labelIds: [label],
        ...(url.searchParams.get("format") === "raw"
          ? {
              internalDate: "1788481753000",
              raw:
                reference.id === "large"
                  ? raw
                  : Buffer.from(
                      "From: sender@example.com\r\nMessage-ID: <healthy@example.com>\r\n\r\nhealthy"
                    ).toString("base64url"),
            }
          : {}),
      })
    );
  });
}

describe("Gmail per-message failures", () => {
  it.each([
    { rescan: false, failure: false },
    { rescan: true, failure: false },
    { rescan: false, failure: true },
    { rescan: true, failure: true },
  ])("continues delivering after HTML conversion and acknowledges retries (rescan: $rescan, failure: $failure)", async ({
    rescan,
    failure,
  }) => {
    const html = `<html><body>${"<span>".repeat(20_000)}nested${"</span>".repeat(20_000)}</body></html>`;
    const fetch = transport(
      Buffer.from(
        `From: sender@example.com\r\nMessage-ID: <original@example.com>\r\nContent-Type: text/html\r\n\r\n${html}`
      ).toString("base64url"),
      rescan
    );
    const state = createMemoryState();
    const logger = new ConsoleLogger("silent");
    const report = vi.spyOn(logger, "error");
    const subscription = "projects/project/subscriptions/mail";
    const gmail = createGmailAdapter({
      mailbox,
      labelId: label,
      accessToken: "test",
      subscription,
      webhookVerifier: () => true,
      fetch,
      logger,
    });
    const bot = new Chat({
      userName: "agent",
      adapters: { gmail },
      state,
      logger,
    });
    const delivered: string[] = [];
    bot.onNewMention((_thread, message) => {
      delivered.push(message.raw.message.id);
      return Promise.resolve();
    });
    const push = () =>
      gmail.handleWebhook(
        new Request("https://example.com/gmail", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            subscription,
            message: {
              messageId: "notification",
              data: Buffer.from(
                JSON.stringify({ emailAddress: mailbox, historyId: "200" })
              ).toString("base64"),
            },
          }),
        })
      );
    await bot.initialize();
    try {
      await state.set(`${key}:cursor`, "100");
      if (failure) {
        vi.mocked(convert).mockImplementationOnce(() => {
          throw new RangeError("private conversion details");
        });
      }
      expect((await push()).status).toBe(204);
      expect(delivered).toEqual(failure ? ["healthy"] : ["large", "healthy"]);
      expect(await state.get(`${key}:cursor`)).toBe("200");
      expect(await state.get(`${key}:delivered:healthy`)).toBe(true);
      expect(await state.get(`${key}:failed:large`)).toBe(
        failure ? "format" : null
      );
      expect(await state.get(`${key}:delivered:large`)).toBe(
        failure ? null : true
      );
      if (failure) {
        expect(report).toHaveBeenCalledWith(
          "Gmail message failed; automatic replay disabled",
          { messageId: "large", threadId: "first", reason: "format" }
        );
      }
      fetch.mockClear();
      expect((await push()).status).toBe(204);
      expect(delivered).toEqual(failure ? ["healthy"] : ["large", "healthy"]);
      expect(await state.get(`${key}:cursor`)).toBe("200");
      expect(
        fetch.mock.calls.some(([input]) =>
          String(input).includes("/messages/large")
        )
      ).toBe(false);
    } finally {
      await state.disconnect();
    }
  });

  it("cancels an oversized response stream and continues without parsing it", async () => {
    const cancel = vi.fn();
    const base = transport("");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input, options) => {
        const url = new URL(String(input));
        if (
          url.pathname.endsWith("/messages/large") &&
          url.searchParams.get("format") === "raw"
        ) {
          return Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array(40 * 1024 * 1024 + 1));
                },
                cancel,
              })
            )
          );
        }
        return base(input, options);
      });
    const state = createMemoryState();
    await state.connect();
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const sync = new GmailSynchronizer(
      { mailbox, token: "test", fetch },
      label,
      state,
      dispatch
    );
    try {
      await state.set(`${key}:cursor`, "100");
      await sync.sync();
      expect(cancel).toHaveBeenCalledOnce();
      expect(await state.get(`${key}:failed:large`)).toBe("size");
      expect(dispatch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.objectContaining({ id: "healthy" }),
        })
      );
    } finally {
      await state.disconnect();
    }
  });

  it.each([
    401, 429, 503,
  ])("does not quarantine an API failure or advance the cursor (HTTP %s)", async (status) => {
    const base = transport(
      Buffer.from("From: sender@example.com\r\n\r\nbody").toString("base64url")
    );
    let rejected = true;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input, options) => {
        if (rejected && String(input).includes("/messages/large")) {
          return Promise.resolve(new Response(null, { status }));
        }
        return base(input, options);
      });
    const state = createMemoryState();
    await state.connect();
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const sync = new GmailSynchronizer(
      { mailbox, token: "test", fetch },
      label,
      state,
      dispatch
    );
    try {
      await state.set(`${key}:cursor`, "100");
      await expect(sync.sync()).rejects.toMatchObject({ status });
      expect(await state.get(`${key}:failed:large`)).toBeNull();
      expect(await state.get(`${key}:cursor`)).toBe("100");
      expect(dispatch).not.toHaveBeenCalled();
      rejected = false;
      await sync.sync();
      expect(await state.get(`${key}:delivered:large`)).toBe(true);
      expect(await state.get(`${key}:delivered:healthy`)).toBe(true);
      expect(await state.get(`${key}:cursor`)).toBe("200");
    } finally {
      await state.disconnect();
    }
  });

  it("does not dispatch an older selected email after the newest one fails", async () => {
    const base = transport(
      Buffer.from(`Subject: ${"a".repeat(65_536)}\r\n\r\nbody`).toString(
        "base64url"
      )
    );
    const old = { id: "old", threadId: "first" };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input, options) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/history")) {
          return Promise.resolve(
            Response.json({
              historyId: "200",
              history: [
                {
                  id: "150",
                  messagesAdded: [old, ...references].map((message) => ({
                    message,
                  })),
                },
              ],
            })
          );
        }
        if (url.pathname.endsWith("/threads/first")) {
          return Promise.resolve(
            Response.json({ id: "first", messages: [old, references[0]] })
          );
        }
        return base(input, options);
      });
    const state = createMemoryState();
    await state.connect();
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const sync = new GmailSynchronizer(
      { mailbox, token: "test", fetch },
      label,
      state,
      dispatch
    );
    try {
      await state.set(`${key}:cursor`, "100");
      await sync.sync();
      await sync.sync();
      expect(
        fetch.mock.calls.some(([input]) =>
          String(input).includes("/messages/old")
        )
      ).toBe(false);
      expect(await state.get(`${key}:failed:large`)).toBe("format");
      expect(dispatch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.objectContaining({ id: "healthy" }),
        })
      );
    } finally {
      await state.disconnect();
    }
  });

  it("does not advance if recording the failure fails", async () => {
    const state = createMemoryState();
    await state.connect();
    const report = vi.fn();
    const sync = new GmailSynchronizer(
      {
        mailbox,
        token: "test",
        fetch: transport(
          Buffer.from(`Subject: ${"a".repeat(65_536)}\r\n\r\nbody`).toString(
            "base64url"
          )
        ),
      },
      label,
      state,
      vi.fn(),
      report
    );
    try {
      await state.set(`${key}:cursor`, "100");
      vi.spyOn(state, "set").mockRejectedValueOnce(
        new Error("state unavailable")
      );
      await expect(sync.sync()).rejects.toThrow("state unavailable");
      expect(await state.get(`${key}:cursor`)).toBe("100");
      expect(report).not.toHaveBeenCalled();
    } finally {
      await state.disconnect();
    }
  });
  it.each([
    false,
    true,
  ])("continues past oversized mail and preserves its failed outcome (rescan: %s)", async (expired) => {
    const raw = Buffer.alloc(25 * 1024 * 1024 + 1, 97).toString("base64url");
    const fetch = transport(raw, expired);
    const state = createMemoryState();
    await state.connect();
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const report = vi.fn();
    const sync = new GmailSynchronizer(
      { mailbox, token: "test", fetch },
      label,
      state,
      dispatch,
      report
    );
    try {
      await state.set(`${key}:cursor`, "100");
      await sync.sync();
      expect(dispatch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.objectContaining({ id: "healthy" }),
        })
      );
      expect(await state.get(`${key}:failed:large`)).toBe("size");
      expect(await state.get(`${key}:delivered:large`)).toBeNull();
      expect(await state.get(`${key}:cursor`)).toBe("200");
      expect(report).toHaveBeenCalledExactlyOnceWith(references[0], "size");
      fetch.mockClear();
      await sync.sync();
      expect(
        fetch.mock.calls.some(([input]) =>
          String(input).includes("/messages/large")
        )
      ).toBe(false);
      expect(dispatch).toHaveBeenCalledOnce();
    } finally {
      await state.disconnect();
    }
  });

  it("continues after a MIME parser limit is exceeded", async () => {
    const raw = Buffer.from(
      `Subject: ${"a".repeat(65_536)}\r\n\r\nbody`
    ).toString("base64url");
    const state = createMemoryState();
    await state.connect();
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const sync = new GmailSynchronizer(
      { mailbox, token: "test", fetch: transport(raw) },
      label,
      state,
      dispatch
    );
    try {
      await state.set(`${key}:cursor`, "100");
      await sync.sync();
      expect(await state.get(`${key}:failed:large`)).toBe("format");
      expect(dispatch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.objectContaining({ id: "healthy" }),
        })
      );
    } finally {
      await state.disconnect();
    }
  });

  it("records a failed Chat handoff without replaying side effects or claiming delivery", async () => {
    const state = createMemoryState();
    const logger = new ConsoleLogger("silent");
    const report = vi.spyOn(logger, "error");
    const sent: string[] = [];
    const base = transport(
      Buffer.from(
        "From: sender@example.com\r\nMessage-ID: <original@example.com>\r\n\r\nfirst"
      ).toString("base64url")
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input, options) => {
        if (new URL(String(input)).pathname.endsWith("/messages/send")) {
          const payload = JSON.parse(String(options?.body)) as {
            threadId: string;
          };
          sent.push(payload.threadId);
          return Promise.resolve(
            Response.json({
              id: `sent-${payload.threadId}`,
              threadId: payload.threadId,
            })
          );
        }
        return base(input, options);
      });
    const gmail = createGmailAdapter({
      mailbox,
      labelId: label,
      accessToken: "test",
      pubsubAudience: "https://example.com/gmail",
      pubsubServiceAccountEmail: "push@project.iam.gserviceaccount.com",
      subscription: "projects/project/subscriptions/mail",
      fetch,
      logger,
    });
    const bot = new Chat({
      userName: "agent",
      adapters: { gmail },
      state,
      logger,
    });
    const handler = vi.fn(
      async (thread: Thread, message: Message<GmailRawMessage>) => {
        await thread.post("reviewed");
        if (message.raw.message.id === "large") {
          throw new Error("private handler details");
        }
      }
    );
    bot.onNewMention(handler);
    await bot.initialize();
    try {
      await state.set(`${key}:cursor`, "100");
      await gmail.sync();
      expect(await state.get(`${key}:failed:large`)).toBe("handler");
      expect(await state.get(`${key}:delivered:large`)).toBeNull();
      expect(await state.get(`${key}:delivered:healthy`)).toBe(true);
      expect(report).toHaveBeenCalledWith(
        "Gmail message failed; automatic replay disabled",
        {
          messageId: "large",
          threadId: "first",
          reason: "handler",
        }
      );
      expect(sent).toEqual(["first", "second"]);
      await gmail.sync();
      expect(sent).toEqual(["first", "second"]);
      expect(await state.get(`${key}:cursor`)).toBe("200");
    } finally {
      await state.disconnect();
    }
  });
});
