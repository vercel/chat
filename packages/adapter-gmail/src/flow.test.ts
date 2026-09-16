import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type Thread } from "chat";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGmailMessage } from "./format";
import { gmailChannel } from "./ids";
import { createGmailAdapter } from "./index";

const mailbox = "agent@example.com";
const audience = "https://example.com/gmail";
const subscription = "projects/project/subscriptions/mail";
const service = "push@project.iam.gserviceaccount.com";
const label = "Label_123";

describe("Gmail authenticated delivery through Chat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    false,
    true,
  ])("verifies delivery, applies replyAll=%s and suppresses redelivery", async (replyAll) => {
    const keys = await generateKeyPair("RS256");
    const jwk = await exportJWK(keys.publicKey);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json({
          keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }],
        })
      )
    );
    const token = await new SignJWT({ email: service, email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer("https://accounts.google.com")
      .setAudience(audience)
      .setSubject("123")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keys.privateKey);
    const source = {
      id: "original",
      threadId: "thread",
      internalDate: "1788481753000",
      labelIds: [label],
      raw: Buffer.from(
        "From: sender@example.com\r\nReply-To: replies@example.com\r\nTo: agent@example.com, visible@example.com\r\nCc: colleague@example.com\r\nBcc: hidden@example.com\r\nSubject: review\r\nMessage-ID: <original@example.com>\r\n\r\nplease review"
      ).toString("base64url"),
    };
    const send = vi.fn();
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
                  labelsAdded: [
                    {
                      message: { id: "original", threadId: "thread" },
                      labelIds: [label],
                    },
                  ],
                },
              ],
            })
          );
        }
        if (url.pathname.endsWith("/messages/original")) {
          return Promise.resolve(Response.json(source));
        }
        if (url.pathname.endsWith("/messages/send")) {
          send(options?.body);
          return Promise.resolve(
            Response.json({ id: "sent", threadId: "thread" })
          );
        }
        throw new Error(`Unexpected Gmail request ${url.pathname}`);
      });
    const state = createMemoryState();
    const gmail = createGmailAdapter({
      mailbox,
      labelId: label,
      accessToken: "token",
      pubsubAudience: audience,
      pubsubServiceAccountEmail: service,
      subscription,
      replyAll,
      fetch,
    });
    const bot = new Chat({ userName: "agent", adapters: { gmail }, state });
    const handler = vi.fn(async (thread: Thread) => {
      await thread.post("reviewed");
      await thread.postEphemeral("owner@example.com", "private approval", {
        fallbackToDM: true,
      });
    });
    bot.onNewMention(handler);
    await bot.initialize();
    await state.set(`${gmailChannel(mailbox)}:sync:${label}:cursor`, "100");
    const request = (account = mailbox, authorization = token) =>
      new Request(audience, {
        method: "POST",
        headers: { authorization: `Bearer ${authorization}` },
        body: JSON.stringify({
          subscription,
          message: {
            messageId: "notification",
            data: Buffer.from(
              JSON.stringify({ emailAddress: account, historyId: "200" })
            ).toString("base64"),
          },
        }),
      });
    try {
      expect(
        (await bot.webhooks.gmail(request(mailbox, "forged"))).status
      ).toBe(401);
      expect(fetch).not.toHaveBeenCalled();
      expect(
        (await bot.webhooks.gmail(request("another@example.com"))).status
      ).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
      expect((await bot.webhooks.gmail(request())).status).toBe(204);
      expect((await bot.webhooks.gmail(request())).status).toBe(204);
      expect(handler).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledTimes(2);
      const body = JSON.parse(String(send.mock.calls[0][0])) as {
        raw: string;
        threadId: string;
      };
      const reply = await parseGmailMessage({ ...source, raw: body.raw });
      expect(reply.email.inReplyTo).toBe("<original@example.com>");
      expect(reply.email.to?.[0].address).toBe("replies@example.com");
      expect(reply.email.to?.map((value) => value.address)).toEqual(
        replyAll
          ? ["replies@example.com", "visible@example.com"]
          : ["replies@example.com"]
      );
      expect(reply.email.cc?.map((value) => value.address)).toEqual(
        replyAll ? ["colleague@example.com"] : undefined
      );
      expect(reply.email.bcc).toBeUndefined();
      expect(body.threadId).toBe("thread");
      const privateBody = JSON.parse(String(send.mock.calls[1][0])) as {
        raw: string;
        threadId?: string;
      };
      const privateReply = await parseGmailMessage({
        ...source,
        raw: privateBody.raw,
      });
      expect(privateBody.threadId).toBe("thread");
      expect(privateReply.email.to?.map((value) => value.address)).toEqual([
        "owner@example.com",
      ]);
      expect(privateReply.email.cc).toBeUndefined();
      expect(privateReply.email.bcc).toBeUndefined();
      expect(privateReply.email.inReplyTo).toBe("<original@example.com>");
      expect(privateReply.email.references).toBe("<original@example.com>");
      expect(privateReply.email.subject).toBe("review");
      expect(privateReply.text.trim()).toBe(
        "(private only)\n\nprivate approval"
      );
      expect(
        await state.get(`${gmailChannel(mailbox)}:sync:${label}:cursor`)
      ).toBe("200");
    } finally {
      await state.disconnect();
    }
  });
});
