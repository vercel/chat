import { describe, expect, it, vi } from "vitest";
import { inbound } from "./inbound";

describe("inbound", () => {
  it("returns no transport or inbound when no credentials are set", () => {
    const originalApi = process.env.INBOUND_API_KEY;
    const originalToken = process.env.INBOUND_VERIFICATION_TOKEN;
    process.env.INBOUND_API_KEY = "";
    process.env.INBOUND_VERIFICATION_TOKEN = "";
    try {
      const p = inbound();
      expect(p.transport).toBeUndefined();
      expect(p.inbound).toBeUndefined();
    } finally {
      if (originalApi !== undefined) {
        process.env.INBOUND_API_KEY = originalApi;
      }
      if (originalToken !== undefined) {
        process.env.INBOUND_VERIFICATION_TOKEN = originalToken;
      }
    }
  });

  it("exports transport when apiKey is provided", () => {
    const p = inbound({ apiKey: "test_key", fetch: vi.fn() });
    expect(p.transport?.name).toBe("inbound");
    expect(p.inbound).toBeUndefined();
  });

  it("exports inbound handler when verificationToken is provided", () => {
    const p = inbound({
      verificationToken: "tok_123",
      fetch: vi.fn(),
    });
    expect(p.inbound?.name).toBe("inbound");
    expect(p.transport).toBeUndefined();
  });

  it("exports both when apiKey and verificationToken are provided", () => {
    const p = inbound({
      apiKey: "k",
      verificationToken: "tok",
      fetch: vi.fn(),
    });
    expect(p.transport?.name).toBe("inbound");
    expect(p.inbound?.name).toBe("inbound");
  });

  describe("transport.send", () => {
    it("POSTs to /api/e2/emails with composed RFC-822 headers", async () => {
      const fetchImpl = vi.fn(
        async () =>
          new Response(JSON.stringify({ id: "inbnd_1", message_id: "<m@x>" }), {
            status: 200,
          })
      );
      const p = inbound({
        apiKey: "test_key",
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      const result = await p.transport?.send({
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
      expect(result?.providerMessageId).toBe("inbnd_1");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] ?? [];
      expect(url).toBe("https://inbound.new/api/e2/emails");
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
      expect(body.subject).toBe("Hi");
      expect(body.html).toBe("<p>Hi</p>");
      expect(body.text).toBe("Hi");
      expect(body.headers["Message-ID"]).toBe("<out-1@x.com>");
      expect(body.headers["In-Reply-To"]).toBe("<in-1@x.com>");
      expect(body.headers.References).toBe("<root@x.com> <in-1@x.com>");
    });

    it("omits optional headers when threading info is absent", async () => {
      const fetchImpl = vi.fn(
        async () => new Response(JSON.stringify({ id: "x" }), { status: 200 })
      );
      const p = inbound({
        apiKey: "k",
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      await p.transport?.send({
        from: { address: "bot@x.com" },
        to: ["u@x.com"],
        subject: "Hi",
        html: "",
        text: "",
        messageId: "m@x",
        threadRootMessageId: "m@x",
      });
      const body = JSON.parse(
        (fetchImpl.mock.calls[0]?.[1] as { body: string }).body
      );
      expect(body.headers["In-Reply-To"]).toBeUndefined();
      expect(body.headers.References).toBeUndefined();
      expect(body.headers["Message-ID"]).toBe("<m@x>");
    });

    it("encodes attachments as base64 with content_type", async () => {
      const fetchImpl = vi.fn(
        async () => new Response(JSON.stringify({ id: "id" }), { status: 200 })
      );
      const p = inbound({
        apiKey: "k",
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      await p.transport?.send({
        from: { address: "bot@x.com" },
        to: ["u@x.com"],
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
          new Response(JSON.stringify({ error: "no" }), { status: 401 })
      );
      const p = inbound({
        apiKey: "k",
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      await expect(
        p.transport?.send({
          from: { address: "bot@x.com" },
          to: ["u@x.com"],
          subject: "x",
          html: "",
          text: "",
          messageId: "m@x",
          threadRootMessageId: "m@x",
        })
      ).rejects.toThrow("Inbound send email");
    });
  });

  describe("inbound.verifySignature", () => {
    it("returns false when token header is missing", () => {
      const p = inbound({ verificationToken: "tok_123", fetch: vi.fn() });
      expect(
        p.inbound?.verifySignature(
          new Request("https://x", { method: "POST", body: "{}" }),
          "{}"
        )
      ).toBe(false);
    });

    it("returns false when token mismatches", () => {
      const p = inbound({ verificationToken: "tok_123", fetch: vi.fn() });
      const req = new Request("https://x", {
        method: "POST",
        headers: { "x-webhook-verification-token": "wrong" },
        body: "{}",
      });
      expect(p.inbound?.verifySignature(req, "{}")).toBe(false);
    });

    it("returns true when token matches", () => {
      const p = inbound({ verificationToken: "tok_123", fetch: vi.fn() });
      const req = new Request("https://x", {
        method: "POST",
        headers: { "x-webhook-verification-token": "tok_123" },
        body: "{}",
      });
      expect(p.inbound?.verifySignature(req, "{}")).toBe(true);
    });
  });

  describe("inbound.parse", () => {
    it("returns null for non email.received events", async () => {
      const p = inbound({ verificationToken: "tok", fetch: vi.fn() });
      const body = JSON.stringify({
        event: "email.delivered",
        timestamp: "2026-01-01T00:00:00Z",
        email: { id: "x", messageId: "<x@y>" },
      });
      const out = await p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(out).toBeNull();
    });

    it("parses an email.received payload into the normalized shape", async () => {
      const p = inbound({
        apiKey: "k",
        verificationToken: "tok",
        fetch: vi.fn() as unknown as typeof globalThis.fetch,
      });
      const payload = {
        event: "email.received",
        timestamp: "2026-01-15T10:30:00Z",
        email: {
          id: "inbnd_abc",
          messageId: "<inbound-1@sender.com>",
          recipient: "support@yourdomain.com",
          subject: "Help",
          receivedAt: "2026-01-15T10:30:00Z",
          parsedData: {
            messageId: "<inbound-1@sender.com>",
            date: "2026-01-15T10:30:00Z",
            subject: "Help",
            from: {
              text: "Alice <alice@sender.com>",
              addresses: [{ name: "Alice", address: "alice@sender.com" }],
            },
            to: {
              text: "support@yourdomain.com",
              addresses: [{ name: null, address: "support@yourdomain.com" }],
            },
            cc: null,
            bcc: null,
            replyTo: null,
            textBody: "Plain body",
            htmlBody: "<p>HTML</p>",
            inReplyTo: "<root@x.com>",
            references: "<root@x.com> <mid@x.com>",
            attachments: [
              {
                filename: "doc.pdf",
                contentType: "application/pdf",
                size: 1234,
                contentId: "<cid>",
                contentDisposition: "attachment",
                downloadUrl: "https://inbound.new/api/e2/attachments/x.pdf",
              },
            ],
          },
        },
      };
      const body = JSON.stringify(payload);
      const result = await p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(result?.messageId).toBe("inbound-1@sender.com");
      expect(result?.from).toEqual({
        address: "alice@sender.com",
        name: "Alice",
      });
      expect(result?.to).toEqual(["support@yourdomain.com"]);
      expect(result?.subject).toBe("Help");
      expect(result?.text).toBe("Plain body");
      expect(result?.html).toBe("<p>HTML</p>");
      expect(result?.inReplyTo).toBe("root@x.com");
      expect(result?.references).toEqual(["root@x.com", "mid@x.com"]);
      expect(result?.attachments).toHaveLength(1);
      expect(result?.attachments?.[0]).toMatchObject({
        filename: "doc.pdf",
        contentType: "application/pdf",
        size: 1234,
        url: "https://inbound.new/api/e2/attachments/x.pdf",
      });
      expect(typeof result?.attachments?.[0]?.fetchData).toBe("function");
    });

    it("falls back to headers.references when parsedData.references is missing", async () => {
      const p = inbound({ verificationToken: "tok", fetch: vi.fn() });
      const body = JSON.stringify({
        event: "email.received",
        timestamp: "2026-01-15T10:30:00Z",
        email: {
          id: "inbnd_x",
          messageId: "<m@x>",
          parsedData: {
            messageId: "<m@x>",
            headers: {
              "In-Reply-To": "<parent@x>",
              References: "<root@x> <parent@x>",
            },
          },
        },
      });
      const result = await p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(result?.inReplyTo).toBe("parent@x");
      expect(result?.references).toEqual(["root@x", "parent@x"]);
    });

    it("handles a `references` array form", async () => {
      const p = inbound({ verificationToken: "tok", fetch: vi.fn() });
      const body = JSON.stringify({
        event: "email.received",
        timestamp: "2026-01-15T10:30:00Z",
        email: {
          id: "inbnd_x",
          messageId: "<m@x>",
          parsedData: {
            messageId: "<m@x>",
            references: ["<a@x>", "<b@x>"],
          },
        },
      });
      const result = await p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(result?.references).toEqual(["a@x", "b@x"]);
    });

    it("throws a ValidationError when the webhook body is not valid JSON", () => {
      const p = inbound({ verificationToken: "tok", fetch: vi.fn() });
      expect(() =>
        p.inbound?.parse(
          new Request("https://x", { method: "POST", body: "not json" }),
          "not json"
        )
      ).toThrow("Inbound webhook body is not valid JSON");
    });

    it("parses cc addresses when present", async () => {
      const p = inbound({ verificationToken: "tok", fetch: vi.fn() });
      const body = JSON.stringify({
        event: "email.received",
        timestamp: "2026-01-15T10:30:00Z",
        email: {
          id: "inbnd_cc",
          messageId: "<m@x>",
          parsedData: {
            messageId: "<m@x>",
            cc: {
              text: "manager@x.com",
              addresses: [{ name: null, address: "manager@x.com" }],
            },
          },
        },
      });
      const result = await p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(result?.cc).toEqual(["manager@x.com"]);
    });

    it("falls back to unknown@unknown when no usable from address is present", async () => {
      const p = inbound({ verificationToken: "tok", fetch: vi.fn() });
      const body = JSON.stringify({
        event: "email.received",
        timestamp: "2026-01-15T10:30:00Z",
        email: {
          id: "inbnd_x",
          messageId: "<m@x>",
          parsedData: {
            messageId: "<m@x>",
            from: {
              text: "",
              addresses: [{ name: "Display", address: "" }],
            },
          },
        },
      });
      const result = await p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(result?.from).toEqual({ address: "unknown@unknown" });
    });

    it("surfaces errors from the attachment download endpoint", async () => {
      const fetchImpl = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })
      );
      const p = inbound({
        apiKey: "k",
        verificationToken: "tok",
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      const body = JSON.stringify({
        event: "email.received",
        timestamp: "2026-01-15T10:30:00Z",
        email: {
          id: "inbnd_x",
          messageId: "<m@x>",
          parsedData: {
            messageId: "<m@x>",
            attachments: [
              {
                filename: "f.bin",
                contentType: "application/octet-stream",
                downloadUrl: "https://inbound.new/api/e2/attachments/f.bin",
              },
            ],
          },
        },
      });
      const result = await p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      await expect(result?.attachments?.[0]?.fetchData?.()).rejects.toThrow(
        "Inbound download attachment"
      );
    });

    it("returns an empty messageId when both parsedData.messageId and email.messageId are missing", () => {
      const p = inbound({ verificationToken: "tok", fetch: vi.fn() });
      const body = JSON.stringify({
        event: "email.received",
        timestamp: "2026-01-15T10:30:00Z",
        email: {
          id: "inbnd_x",
          // messageId omitted entirely
          parsedData: {
            // parsed.messageId omitted too
            subject: "no msgid",
          },
        },
      });
      const result = p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(result?.messageId).toBe("");
    });

    it("falls back to top-level email.messageId when parsedData is absent", () => {
      const p = inbound({ verificationToken: "tok", fetch: vi.fn() });
      const body = JSON.stringify({
        event: "email.received",
        timestamp: "2026-01-15T10:30:00Z",
        email: {
          id: "inbnd_x",
          messageId: "<from-top@x>",
          // no parsedData at all
        },
      });
      const result = p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(result?.messageId).toBe("from-top@x");
    });

    it("returns undefined fetchData when downloadUrl is missing", async () => {
      const p = inbound({ verificationToken: "tok", fetch: vi.fn() });
      const body = JSON.stringify({
        event: "email.received",
        timestamp: "2026-01-15T10:30:00Z",
        email: {
          id: "inbnd_x",
          messageId: "<m@x>",
          parsedData: {
            messageId: "<m@x>",
            attachments: [
              {
                filename: "f.bin",
                contentType: "application/octet-stream",
                // no downloadUrl
              },
            ],
          },
        },
      });
      const result = await p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(result?.attachments?.[0]?.fetchData).toBeUndefined();
    });

    it("downloads attachments without Authorization when apiKey is not configured", async () => {
      const fetchImpl = vi.fn(
        async () => new Response(new Uint8Array([7]).buffer, { status: 200 })
      );
      const p = inbound({
        // no apiKey — only token configured (inbound-only setup)
        verificationToken: "tok",
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      const body = JSON.stringify({
        event: "email.received",
        timestamp: "2026-01-15T10:30:00Z",
        email: {
          id: "inbnd_x",
          messageId: "<m@x>",
          parsedData: {
            messageId: "<m@x>",
            attachments: [
              {
                filename: "f.bin",
                contentType: "application/octet-stream",
                downloadUrl: "https://inbound.new/api/e2/attachments/f.bin",
              },
            ],
          },
        },
      });
      const result = await p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      await result?.attachments?.[0]?.fetchData?.();
      const init = fetchImpl.mock.calls[0]?.[1] as {
        headers: Record<string, string>;
      };
      expect(init.headers.Authorization).toBeUndefined();
    });

    it("returns an unnamed first address when the address object has no name", () => {
      const p = inbound({ verificationToken: "tok", fetch: vi.fn() });
      const body = JSON.stringify({
        event: "email.received",
        timestamp: "2026-01-15T10:30:00Z",
        email: {
          id: "inbnd_x",
          messageId: "<m@x>",
          parsedData: {
            messageId: "<m@x>",
            from: {
              text: "alice@x.com",
              addresses: [{ name: null, address: "alice@x.com" }],
            },
          },
        },
      });
      const result = p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      expect(result?.from).toEqual({ address: "alice@x.com" });
    });

    it("attachment fetchData downloads with Authorization", async () => {
      const fetchImpl = vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 })
      );
      const p = inbound({
        apiKey: "k",
        verificationToken: "tok",
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      });
      const body = JSON.stringify({
        event: "email.received",
        timestamp: "2026-01-15T10:30:00Z",
        email: {
          id: "inbnd_x",
          messageId: "<m@x>",
          parsedData: {
            messageId: "<m@x>",
            attachments: [
              {
                filename: "f.bin",
                contentType: "application/octet-stream",
                downloadUrl: "https://inbound.new/api/e2/attachments/f.bin",
              },
            ],
          },
        },
      });
      const result = await p.inbound?.parse(
        new Request("https://x", { method: "POST", body }),
        body
      );
      const buf = await result?.attachments?.[0]?.fetchData?.();
      expect(buf?.equals(Buffer.from([1, 2, 3]))).toBe(true);
      const [url, init] = fetchImpl.mock.calls[0] ?? [];
      expect(url).toBe("https://inbound.new/api/e2/attachments/f.bin");
      expect(
        (init as { headers: Record<string, string> }).headers.Authorization
      ).toBe("Bearer k");
    });
  });
});
