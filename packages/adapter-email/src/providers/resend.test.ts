import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { resend } from "./resend";

const WHSEC_PREFIX = /^whsec_/;

function makeSvixHeaders(
  body: string,
  secret: string,
  overrides: { id?: string; timestamp?: string } = {}
) {
  const id = overrides.id ?? "msg_test";
  const timestamp =
    overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
  const secretBytes = Buffer.from(secret.replace(WHSEC_PREFIX, ""), "base64");
  const signed = `${id}.${timestamp}.${body}`;
  const sig = createHmac("sha256", secretBytes)
    .update(signed, "utf8")
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${sig}`,
  };
}

const TEST_SECRET = `whsec_${randomBytes(24).toString("base64")}`;

describe("resend", () => {
  it("returns no transport or inbound when no credentials are set", () => {
    const originalApi = process.env.RESEND_API_KEY;
    const originalSecret = process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_API_KEY = "";
    process.env.RESEND_WEBHOOK_SECRET = "";
    try {
      const p = resend();
      expect(p.transport).toBeUndefined();
      expect(p.inbound).toBeUndefined();
    } finally {
      if (originalApi !== undefined) {
        process.env.RESEND_API_KEY = originalApi;
      }
      if (originalSecret !== undefined) {
        process.env.RESEND_WEBHOOK_SECRET = originalSecret;
      }
    }
  });

  it("exports both transport and inbound when credentials are present", () => {
    const p = resend({
      apiKey: "test_key",
      webhookSecret: TEST_SECRET,
      fetch: vi.fn(),
    });
    expect(p.transport?.name).toBe("resend");
    expect(p.inbound?.name).toBe("resend");
  });

  describe("transport.send", () => {
    it("posts to /emails with composed headers", async () => {
      const fetchImpl = vi.fn(
        async () =>
          new Response(JSON.stringify({ id: "abc-123" }), { status: 200 })
      );
      const provider = resend({
        apiKey: "test_key",
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      const result = await provider.transport?.send({
        from: { address: "bot@x.com", name: "Bot" },
        to: ["user@x.com"],
        subject: "Hi",
        html: "<p>Hi</p>",
        text: "Hi",
        messageId: "out-1@x.com",
        threadRootMessageId: "out-1@x.com",
        inReplyTo: "in-1@x.com",
        references: ["root@x.com", "in-1@x.com"],
      });
      expect(result?.providerMessageId).toBe("abc-123");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] ?? [];
      expect(url).toBe("https://api.resend.com/emails");
      const init2 = init as {
        method: string;
        headers: Record<string, string>;
        body: string;
      };
      expect(init2.method).toBe("POST");
      expect(init2.headers.Authorization).toBe("Bearer test_key");
      const body = JSON.parse(init2.body);
      expect(body.from).toBe("Bot <bot@x.com>");
      expect(body.to).toEqual(["user@x.com"]);
      expect(body.headers["Message-ID"]).toBe("<out-1@x.com>");
      expect(body.headers["In-Reply-To"]).toBe("<in-1@x.com>");
      expect(body.headers.References).toBe("<root@x.com> <in-1@x.com>");
    });

    it("encodes attachments as base64", async () => {
      const fetchImpl = vi.fn(
        async () => new Response(JSON.stringify({ id: "id" }), { status: 200 })
      );
      const provider = resend({
        apiKey: "k",
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      await provider.transport?.send({
        from: { address: "bot@x.com" },
        to: ["user@x.com"],
        subject: "Hi",
        html: "",
        text: "",
        messageId: "m@x",
        threadRootMessageId: "m@x",
        attachments: [
          {
            filename: "f.txt",
            content: Buffer.from("hello", "utf8"),
            contentType: "text/plain",
          },
        ],
      });
      const body = JSON.parse(
        (fetchImpl.mock.calls[0]?.[1] as { body: string }).body
      );
      expect(body.attachments).toEqual([
        {
          filename: "f.txt",
          content: Buffer.from("hello", "utf8").toString("base64"),
          content_type: "text/plain",
        },
      ]);
    });

    it("throws AuthenticationError on 401", async () => {
      const fetchImpl = vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "bad key" }), {
            status: 401,
          })
      );
      const provider = resend({
        apiKey: "k",
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      await expect(
        provider.transport?.send({
          from: { address: "bot@x.com" },
          to: ["user@x.com"],
          subject: "x",
          html: "",
          text: "",
          messageId: "m@x",
          threadRootMessageId: "m@x",
        })
      ).rejects.toThrow("bad key");
    });
  });

  describe("inbound.parse", () => {
    it("returns null for non email.received events", async () => {
      const fetchImpl = vi.fn();
      const provider = resend({
        apiKey: "k",
        webhookSecret: TEST_SECRET,
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      const body = JSON.stringify({ type: "email.delivered", data: {} });
      const result = await provider.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(result).toBeNull();
    });

    it("fetches the received email and returns a normalized payload", async () => {
      const detail = {
        id: "e1",
        message_id: "<inbound-1@example.com>",
        from: "Alice <alice@example.com>",
        to: ["bot@yourdomain.com"],
        cc: [],
        bcc: [],
        reply_to: [],
        subject: "Hello",
        created_at: "2026-04-01T00:00:00Z",
        text: "Plain body",
        html: "<p>HTML body</p>",
        headers: {
          "In-Reply-To": "<root@example.com>",
          References: "<root@example.com> <prev@example.com>",
        },
        attachments: [
          {
            id: "a1",
            filename: "doc.pdf",
            content_type: "application/pdf",
            content_disposition: null,
            content_id: null,
          },
        ],
      };
      const fetchImpl = vi.fn(
        async () => new Response(JSON.stringify(detail), { status: 200 })
      );
      const provider = resend({
        apiKey: "k",
        webhookSecret: TEST_SECRET,
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      const body = JSON.stringify({
        type: "email.received",
        created_at: "2026-04-01T00:00:00Z",
        data: {
          email_id: "e1",
          message_id: "<inbound-1@example.com>",
          from: "Alice <alice@example.com>",
          to: ["bot@yourdomain.com"],
          subject: "Hello",
        },
      });
      const result = await provider.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(result?.messageId).toBe("inbound-1@example.com");
      expect(result?.inReplyTo).toBe("root@example.com");
      expect(result?.references).toEqual([
        "root@example.com",
        "prev@example.com",
      ]);
      expect(result?.from).toEqual({
        address: "alice@example.com",
        name: "Alice",
      });
      expect(result?.subject).toBe("Hello");
      expect(result?.text).toBe("Plain body");
      expect(result?.html).toBe("<p>HTML body</p>");
      expect(result?.attachments).toEqual([
        { filename: "doc.pdf", contentType: "application/pdf" },
      ]);
    });

    it("throws a ValidationError when the webhook body is not valid JSON", async () => {
      const provider = resend({
        apiKey: "k",
        webhookSecret: TEST_SECRET,
        fetch: vi.fn(),
      });
      await expect(
        provider.inbound?.parse(
          new Request("https://x", { method: "POST", body: "not json" }),
          "not json"
        )
      ).rejects.toThrow("Resend webhook body is not valid JSON");
    });

    it("falls back to envelope.data when the Receiving API omits fields", async () => {
      const detail = {
        id: "e1",
        message_id: "",
        from: "",
        to: ["bot@yourdomain.com"],
        cc: [],
        bcc: [],
        reply_to: [],
        subject: "Hello",
        // omit created_at to test fallback to envelope.created_at
        text: null,
        html: null,
        headers: {},
        attachments: [],
      };
      const fetchImpl = vi.fn(
        async () => new Response(JSON.stringify(detail), { status: 200 })
      );
      const provider = resend({
        apiKey: "k",
        webhookSecret: TEST_SECRET,
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      const body = JSON.stringify({
        type: "email.received",
        created_at: "2026-04-01T00:00:00Z",
        data: {
          email_id: "e1",
          message_id: "<envelope-msg@x>",
          from: "envelope@x",
          to: ["bot@yourdomain.com"],
          subject: "Hello",
        },
      });
      const result = await provider.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(result?.messageId).toBe("envelope-msg@x");
      expect(result?.from).toEqual({ address: "envelope@x" });
      expect(result?.text).toBeUndefined();
      expect(result?.html).toBeUndefined();
      expect(result?.receivedAt.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    });

    it("surfaces errors from the Receiving API", async () => {
      const fetchImpl = vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "not found" }), {
            status: 404,
          })
      );
      const provider = resend({
        apiKey: "k",
        webhookSecret: TEST_SECRET,
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      const body = JSON.stringify({
        type: "email.received",
        created_at: "2026-04-01T00:00:00Z",
        data: {
          email_id: "missing",
          message_id: "<m@x>",
          from: "x@x",
          to: ["bot@x"],
          subject: "Hi",
        },
      });
      await expect(
        provider.inbound?.parse(
          new Request("https://x", { method: "POST", body }),
          body
        )
      ).rejects.toThrow("Resend retrieve received email");
    });
  });

  describe("inbound.verifySignature", () => {
    it("returns false when svix headers are missing", () => {
      const provider = resend({
        apiKey: "k",
        webhookSecret: TEST_SECRET,
        fetch: vi.fn(),
      });
      expect(
        provider.inbound?.verifySignature(
          new Request("https://x", { method: "POST", body: "{}" }),
          "{}"
        )
      ).toBe(false);
    });

    it("returns true when signature is valid", () => {
      const provider = resend({
        apiKey: "k",
        webhookSecret: TEST_SECRET,
        fetch: vi.fn(),
      });
      const body = "{}";
      const headers = makeSvixHeaders(body, TEST_SECRET);
      const req = new Request("https://x", {
        method: "POST",
        headers,
        body,
      });
      expect(provider.inbound?.verifySignature(req, body)).toBe(true);
    });
  });
});
