import { describe, expect, it } from "vitest";
import {
  composeGmailMessage,
  extractGmailContinuation,
  parseGmailMessage,
} from "./format";

const raw = (content: string) => ({
  id: "abc123",
  threadId: "def456",
  internalDate: "1788481753000",
  labelIds: ["INBOX"],
  raw: Buffer.from(content).toString("base64url"),
});

describe("Gmail email primitives", () => {
  it("opts into reply-all without copying the mailbox or hidden recipients", async () => {
    const source = await parseGmailMessage(
      raw(
        [
          "From: sender@example.com",
          "Reply-To: replies@example.com",
          "To: Agent@example.com, visible@example.com, replies@example.com, CaseSensitive@example.com, casesensitive@example.com",
          "Cc: visible@example.com, colleague@example.com",
          "Bcc: hidden@example.com",
          "Subject: review",
          "Message-ID: <original@example.com>",
          "",
          "review",
        ].join("\r\n")
      )
    );
    const continuation = extractGmailContinuation(source, "agent@example.com", {
      replyAll: true,
    });
    const output = await parseGmailMessage({
      ...raw(""),
      raw: composeGmailMessage({
        from: "agent@example.com",
        continuation,
        text: "reviewed",
      }),
    });
    expect(output.email.to?.map((value) => value.address)).toEqual([
      "replies@example.com",
      "visible@example.com",
      "CaseSensitive@example.com",
      "casesensitive@example.com",
    ]);
    expect(output.email.cc?.map((value) => value.address)).toEqual([
      "colleague@example.com",
    ]);
    expect(output.email.bcc).toBeUndefined();
    expect(output.email.inReplyTo).toBe("<original@example.com>");
    const privateReply = await parseGmailMessage({
      ...raw(""),
      raw: composeGmailMessage({
        from: "agent@example.com",
        continuation,
        to: [{ address: "selected@example.com" }],
        cc: [],
        text: "(private only) Please sign in",
      }),
    });
    expect(privateReply.email.to?.map((value) => value.address)).toEqual([
      "selected@example.com",
    ]);
    expect(privateReply.email.cc).toBeUndefined();
    expect(privateReply.email.bcc).toBeUndefined();
    expect(privateReply.email.subject).toBe("review");
    expect(privateReply.email.inReplyTo).toBe("<original@example.com>");
    expect(continuation.cc?.map((value) => value.address)).toEqual([
      "colleague@example.com",
    ]);
  });
  it("preserves case-sensitive external recipient addresses", async () => {
    const output = await parseGmailMessage({
      ...raw(""),
      raw: composeGmailMessage({
        from: "agent@example.com",
        to: [{ address: "CaseSensitive@example.com" }],
        text: "hello",
      }),
    });
    expect(output.email.to?.[0].address).toBe("CaseSensitive@example.com");
  });
  it("preserves Unicode, MIME attachments, subject and native reply headers", async () => {
    const source = await parseGmailMessage(
      raw(
        [
          "From: Sender <sender@example.com>",
          "Reply-To: replies@example.com",
          "To: agent@example.com",
          "Cc: other@example.com",
          "Subject: =?UTF-8?B?UmV2aWV3IOKckw==?=",
          "Message-ID: <original@example.com>",
          "References: <parent@example.com>",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "please review",
          "",
        ].join("\r\n")
      )
    );
    const continuation = extractGmailContinuation(source, "agent@example.com");
    expect(continuation.to).toEqual([
      { address: "replies@example.com", name: "" },
    ]);
    expect(continuation.threadId).toBe("def456");
    const reply = await parseGmailMessage({
      ...raw(""),
      raw: composeGmailMessage({
        from: "agent@example.com",
        continuation,
        text: "reviewed \u2713",
        attachments: [
          {
            filename: "result.txt",
            mimeType: "text/plain",
            data: Buffer.from("result"),
          },
        ],
      }),
    });
    expect(reply.text.trim()).toBe("reviewed \u2713");
    expect(reply.email.subject).toBe(source.email.subject);
    expect(reply.email.inReplyTo).toBe("<original@example.com>");
    expect(reply.email.references).toContain("<parent@example.com>");
    expect(reply.email.cc).toBeUndefined();
    expect(Buffer.from(reply.attachments[0].data).toString()).toBe("result");
    expect(JSON.parse(JSON.stringify(continuation))).toEqual(continuation);
  });

  it("extracts text from HTML without fetching external images", async () => {
    const message = await parseGmailMessage(
      raw(
        "From: a@example.com\r\nContent-Type: text/html\r\n\r\n<p>Hello <strong>world</strong></p>"
      )
    );
    expect(message.text).toBe("Hello world");
  });

  it("does not treat a forwarded message attachment as the outer sender", async () => {
    const source = composeGmailMessage({
      from: "employee@example.com",
      to: [{ address: "agent@example.com" }],
      subject: "handoff",
      text: "please review",
      attachments: [
        {
          filename: "forwarded.eml",
          mimeType: "message/rfc822",
          data: Buffer.from(
            "From: outsider@example.com\r\n\r\nexternal request"
          ),
        },
      ],
    });
    const parsed = await parseGmailMessage({ ...raw(""), raw: source });
    expect(parsed.email.from?.address).toBe("employee@example.com");
    expect(parsed.attachments[0].mimeType).toBe("message/rfc822");
  });

  it("rejects header injection and missing reply identity", async () => {
    expect(() =>
      composeGmailMessage({
        from: "agent@example.com",
        to: [{ address: "a@example.com" }],
        subject: "hello\r\nBcc: evil@example.com",
        text: "test",
      })
    ).toThrow();
    const message = await parseGmailMessage(
      raw("From: a@example.com\r\n\r\nhello")
    );
    expect(() =>
      extractGmailContinuation(message, "agent@example.com")
    ).toThrow();
  });
});
