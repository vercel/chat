import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("sends the ephemeral fallback only to the requested recipient as a new email", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ id: "sent", threadId: "private" }));
    const gmail = createGmailAdapter({ ...config, fetch, replyAll: true });
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
      expect(result).toMatchObject({ usedFallback: true });
      const raw = result?.raw as {
        email: {
          to: { address: string }[];
          cc?: unknown;
          bcc?: unknown;
          inReplyTo?: unknown;
          references?: unknown;
        };
      };
      expect(raw.email.to.map((value) => value.address)).toEqual([
        "CaseSensitive@example.com",
      ]);
      expect(raw.email.cc).toBeUndefined();
      expect(raw.email.bcc).toBeUndefined();
      expect(raw.email.inReplyTo).toBeUndefined();
      expect(raw.email.references).toBeUndefined();
      expect(
        JSON.parse(String(fetch.mock.calls[0][1]?.body)).threadId
      ).toBeUndefined();
      expect(fetch).toHaveBeenCalledOnce();
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
