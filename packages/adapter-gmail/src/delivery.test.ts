import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGmailMessage } from "./format";
import { createGmailAdapter } from "./index";

const config = {
  mailbox: "agent@example.com",
  labelId: "Label_123",
  accessToken: "token",
  pubsubAudience: "https://example.com/gmail",
  pubsubServiceAccountEmail: "push@project.iam.gserviceaccount.com",
  subscription: "projects/project/subscriptions/mail",
};

function notification(
  emailAddress = config.mailbox,
  subscription = config.subscription
) {
  return new Request("https://example.com/gmail", {
    method: "POST",
    body: JSON.stringify({
      subscription,
      message: {
        messageId: "notification",
        data: Buffer.from(
          JSON.stringify({ emailAddress, historyId: "123" })
        ).toString("base64"),
      },
    }),
  });
}

describe("Gmail private delivery and custom verification", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    { environment: "true", replyAll: undefined, copied: true },
    { environment: "TRUE", replyAll: undefined, copied: false },
    { environment: "false", replyAll: true, copied: true },
    { environment: "true", replyAll: false, copied: false },
  ])("applies explicit reply configuration before environment: %j", async ({
    environment,
    replyAll,
    copied,
  }) => {
    vi.stubEnv("GMAIL_REPLY_ALL", environment);
    const source = {
      id: "original",
      threadId: "thread",
      internalDate: "1788481753000",
      labelIds: ["Label_123"],
      raw: Buffer.from(
        "From: sender@example.com\r\nTo: agent@example.com\r\nCc: colleague@example.com\r\nMessage-ID: <original@example.com>\r\n\r\nreview"
      ).toString("base64url"),
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((_input, options) =>
        Promise.resolve(
          Response.json(
            options?.method === "POST"
              ? { id: "sent", threadId: "thread" }
              : source
          )
        )
      );
    const gmail = createGmailAdapter({ ...config, fetch, replyAll });
    const thread = gmail.encodeThreadId({
      mailbox: config.mailbox,
      threadId: "thread",
    });
    const message = gmail.encodeThreadId({
      mailbox: config.mailbox,
      threadId: "original",
    });
    const result = await gmail.reply(thread, message, "reviewed");
    expect(result.raw.email.cc?.map((value) => value.address)).toEqual(
      copied ? ["colleague@example.com"] : undefined
    );
  });
  it("explains that me is not a mailbox address before network access", () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(() =>
      createGmailAdapter({ ...config, mailbox: "me", fetch })
    ).toThrow('"me"');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])("keeps private replies threaded with replyAll=%s", async (replyAll) => {
    const source = {
      id: "original",
      threadId: "group",
      internalDate: "1788481753000",
      labelIds: ["Label_123"],
      raw: Buffer.from(
        `From: sender@example.com\r\nReply-To: replies@example.com\r\nTo: agent@example.com\r\n${replyAll ? "Cc: colleague@example.com\r\nBcc: hidden@example.com\r\n" : ""}Subject: Access to GitHub\r\nMessage-ID: <original@example.com>\r\nReferences: <first@example.com>\r\n\r\noriginal request`
      ).toString("base64url"),
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input, options) => {
        const url = new URL(String(input));
        if (options?.method === "POST") {
          return Promise.resolve(
            Response.json({ id: "sent", threadId: "group" })
          );
        }
        if (url.pathname.endsWith("/threads/group")) {
          return Promise.resolve(
            Response.json({
              id: "group",
              messages: [{ id: "original", threadId: "group" }],
            })
          );
        }
        return Promise.resolve(Response.json(source));
      });
    const gmail = createGmailAdapter({ ...config, fetch, replyAll });
    const state = createMemoryState();
    const bot = new Chat({ userName: "agent", adapters: { gmail }, state });
    await bot.initialize();
    try {
      const thread = bot.thread(
        gmail.encodeThreadId({ mailbox: config.mailbox, threadId: "group" })
      );
      await expect(
        thread.postEphemeral("CaseSensitive@example.com", "approval", {
          fallbackToDM: false,
        })
      ).resolves.toBeNull();
      expect(fetch).not.toHaveBeenCalled();
      const result = await thread.postEphemeral(
        "CaseSensitive@example.com",
        "approval",
        { fallbackToDM: true }
      );
      expect(result).toMatchObject({ usedFallback: true, threadId: thread.id });
      const raw = result?.raw as {
        email: {
          to: { address: string }[];
          cc?: unknown;
          bcc?: unknown;
          inReplyTo?: unknown;
          references?: unknown;
          subject?: string;
          text?: string;
        };
      };
      expect(raw.email.to.map((value) => value.address)).toEqual([
        "CaseSensitive@example.com",
      ]);
      expect(raw.email.cc).toBeUndefined();
      expect(raw.email.bcc).toBeUndefined();
      expect(raw.email.subject).toBe("Access to GitHub");
      expect(raw.email.inReplyTo).toBe("<original@example.com>");
      expect(raw.email.references).toBe(
        "<first@example.com> <original@example.com>"
      );
      expect(raw.email.text?.trim()).toBe("(private only)\n\napproval");
      const sent = fetch.mock.calls.find(
        ([, options]) => options?.method === "POST"
      );
      expect(JSON.parse(String(sent?.[1]?.body)).threadId).toBe("group");
      await thread.reply(
        gmail.encodeThreadId({ mailbox: config.mailbox, threadId: "original" }),
        "You're all good to go"
      );
      const body = JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body));
      const publicReply = await parseGmailMessage({ ...source, raw: body.raw });
      expect(publicReply.email.to?.map((value) => value.address)).toEqual([
        "replies@example.com",
      ]);
      expect(publicReply.email.cc?.map((value) => value.address)).toEqual(
        replyAll ? ["colleague@example.com"] : undefined
      );
      expect(publicReply.email.bcc).toBeUndefined();
      expect(publicReply.text.trim()).toBe("You're all good to go");
      expect(publicReply.email.references).toBe(
        "<first@example.com> <original@example.com>"
      );
    } finally {
      await state.disconnect();
    }
  });

  it("requires fallback consent even when called directly", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const gmail = createGmailAdapter({ ...config, fetch });
    const thread = gmail.encodeThreadId({
      mailbox: config.mailbox,
      threadId: "group",
    });
    await expect(
      gmail.postEphemeral(thread, "person@example.com", "private")
    ).resolves.toBeNull();
    await expect(
      gmail.postEphemeral(thread, "person@example.com", "private", {
        fallbackToDM: false,
      })
    ).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      gmail.postEphemeral(
        thread,
        "person@example.com\r\nBcc: attacker@example.com",
        "private",
        { fallbackToDM: true }
      )
    ).rejects.toThrow();
    const other = createGmailAdapter({
      ...config,
      mailbox: "other@example.com",
    });
    await expect(
      gmail.postEphemeral(
        other.encodeThreadId({
          mailbox: "other@example.com",
          threadId: "group",
        }),
        "person@example.com",
        "private",
        { fallbackToDM: true }
      )
    ).rejects.toThrow("another Gmail mailbox");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses a new private email for a channel or recipient route", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() =>
        Promise.resolve(Response.json({ id: "sent", threadId: "private" }))
      );
    const gmail = createGmailAdapter({ ...config, fetch, replyAll: true });
    const state = createMemoryState();
    const bot = new Chat({ userName: "agent", adapters: { gmail }, state });
    await bot.initialize();
    try {
      const route = await gmail.openDM("original@example.com");
      const channel = bot.channel(gmail.channelIdFromThreadId(route));
      await expect(
        channel.postEphemeral("selected@example.com", "private", {
          fallbackToDM: false,
        })
      ).resolves.toBeNull();
      expect(fetch).not.toHaveBeenCalled();
      for (const target of [channel, bot.thread(route)]) {
        const result = await target.postEphemeral(
          "selected@example.com",
          {
            markdown: "private",
            files: [
              {
                filename: "approval.txt",
                data: Buffer.from("approval"),
                mimeType: "text/plain",
              },
            ],
          },
          { fallbackToDM: true }
        );
        expect(result).toMatchObject({
          usedFallback: true,
          threadId: gmail.encodeThreadId({
            mailbox: config.mailbox,
            threadId: "private",
          }),
        });
        const body = JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body));
        expect(body.threadId).toBeUndefined();
        const parsed = await parseGmailMessage({
          id: "sent",
          threadId: "private",
          internalDate: "1788481753000",
          labelIds: ["SENT"],
          raw: body.raw,
        });
        expect(parsed.email.to?.map((value) => value.address)).toEqual([
          "selected@example.com",
        ]);
        expect(parsed.email.cc).toBeUndefined();
        expect(parsed.email.bcc).toBeUndefined();
        expect(parsed.email.subject).toBe("Private message");
        expect(parsed.email.inReplyTo).toBeUndefined();
        expect(parsed.text.trim()).toBe("(private only)\n\nprivate");
        expect(Buffer.from(parsed.attachments[0].data).toString()).toBe(
          "approval"
        );
      }
    } finally {
      await state.disconnect();
    }
  });

  it("creates a mailbox-scoped recipient route without sending or creating a draft", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ id: "sent", threadId: "private" }));
    const gmail = createGmailAdapter({ ...config, fetch });
    const route = await gmail.openDM("CaseSensitive@example.com");
    expect(gmail.decodeThreadId(route)).toEqual({
      mailbox: config.mailbox,
      recipient: "CaseSensitive@example.com",
    });
    expect(gmail.isDM(route)).toBe(true);
    expect(() => gmail.decodeThreadId(`${route}=`)).toThrow();
    expect(() => gmail.decodeThreadId(`${route}!`)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(gmail.fetchMessages(route)).resolves.toEqual({ messages: [] });
    await expect(gmail.fetchThread(route)).resolves.toMatchObject({
      isDM: true,
      metadata: { recipient: "CaseSensitive@example.com" },
    });
    await expect(gmail.fetchMessage(route, "sent")).rejects.toThrow(
      "native Gmail thread"
    );
    await gmail.postMessage(route, "private");
    expect(fetch).toHaveBeenCalledOnce();
    const another = createGmailAdapter({
      ...config,
      mailbox: "another@example.com",
    });
    await expect(another.postMessage(route, "private")).rejects.toThrow(
      "another Gmail mailbox"
    );
    await expect(
      gmail.openDM("person@example.com\r\nBcc: attacker@example.com")
    ).rejects.toThrow();
  });

  it("uses a custom verifier without requiring native JWT configuration", async () => {
    const webhookVerifier = vi.fn(async (request: Request) => {
      await request.text();
      return true;
    });
    const gmail = createGmailAdapter({
      ...config,
      pubsubAudience: undefined,
      pubsubServiceAccountEmail: undefined,
      webhookVerifier,
    });
    const sync = vi.spyOn(gmail, "sync").mockResolvedValue();
    expect((await gmail.handleWebhook(notification())).status).toBe(204);
    expect(webhookVerifier).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledOnce();
  });

  it("still requires native authentication configuration without an override", () => {
    expect(() =>
      createGmailAdapter({
        ...config,
        pubsubAudience: "",
        pubsubServiceAccountEmail: "",
      })
    ).toThrow("webhookVerifier");
  });

  it("bounds custom-verifier bodies before calling consumer code", async () => {
    const webhookVerifier = vi.fn(() => true);
    const gmail = createGmailAdapter({ ...config, webhookVerifier });
    const sync = vi.spyOn(gmail, "sync").mockResolvedValue();
    const response = await gmail.handleWebhook(
      new Request("https://example.com/gmail", {
        method: "POST",
        body: "x".repeat(32_769),
      })
    );
    expect(response.status).toBe(400);
    expect(webhookVerifier).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it.each([
    false,
    null,
    undefined,
    0,
    "",
  ])("rejects a falsy custom verifier result: %s", async (result) => {
    const gmail = createGmailAdapter({
      ...config,
      webhookVerifier: () => result,
    });
    const sync = vi.spyOn(gmail, "sync").mockResolvedValue();
    expect((await gmail.handleWebhook(notification())).status).toBe(401);
    expect(sync).not.toHaveBeenCalled();
  });

  it("rejects a throwing custom verifier before synchronization", async () => {
    const gmail = createGmailAdapter({
      ...config,
      webhookVerifier: () => {
        throw new Error("secret");
      },
    });
    const sync = vi.spyOn(gmail, "sync").mockResolvedValue();
    const response = await gmail.handleWebhook(notification());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("secret");
    expect(sync).not.toHaveBeenCalled();
  });

  it("keeps mailbox, subscription, method and payload checks with a custom verifier", async () => {
    const gmail = createGmailAdapter({
      ...config,
      webhookVerifier: () => true,
    });
    const sync = vi.spyOn(gmail, "sync").mockResolvedValue();
    expect(
      (await gmail.handleWebhook(notification("other@example.com"))).status
    ).toBe(403);
    expect(
      (
        await gmail.handleWebhook(
          notification(config.mailbox, "projects/project/subscriptions/other")
        )
      ).status
    ).toBe(403);
    expect(
      (await gmail.handleWebhook(new Request("https://example.com/gmail")))
        .status
    ).toBe(405);
    expect(
      (
        await gmail.handleWebhook(
          new Request("https://example.com/gmail", {
            method: "POST",
            body: "invalid",
          })
        )
      ).status
    ).toBe(400);
    expect(sync).not.toHaveBeenCalled();
  });
});
