import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  createResolver,
  downloadAttachment,
  readAttachmentBody,
  validateAttachmentUrl,
} from "./download";
import { NetworkError } from "./errors";

function response(
  body: string | Buffer,
  status = 200,
  headers: IncomingMessage["headers"] = {},
  statusMessage = "OK"
): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(body)]), {
    headers,
    statusCode: status,
    statusMessage,
  }) as IncomingMessage;
}

describe("guarded attachment downloads", () => {
  it.each([
    "files.example.com",
    "contoso.sharepoint.com",
    "CONTOSO.SHAREPOINT.COM",
    "cdn.example.net:8443",
  ])("accepts public HTTPS host %s", (host) => {
    expect(
      validateAttachmentUrl(`https://${host}/file`, "test")
    ).toBeInstanceOf(URL);
  });

  it.each([
    "http://files.example.com/file",
    "ftp://files.example.com/file",
    "file:///etc/passwd",
  ])("rejects non-HTTPS URL %s", (url) => {
    expect(() => validateAttachmentUrl(url, "test")).toThrow(
      "Refusing to fetch an untrusted attachment URL"
    );
  });

  it.each([
    "https://127.0.0.1/file",
    "https://2130706433/file",
    "https://[::1]/file",
    "https://169.254.169.254/file",
    "https://10.0.0.1/file",
  ])("rejects internal file URL %s with a network error", (url) => {
    expect(() => validateAttachmentUrl(url, "test")).toThrow(NetworkError);
    expect(() => validateAttachmentUrl(url, "test")).toThrow(
      "Refusing to fetch an internal attachment URL"
    );
  });

  it("returns the validated DNS results to the socket", async () => {
    const addresses = [
      { address: "93.184.216.34", family: 4 as const },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const },
    ];
    const query = vi.fn(async () => addresses);
    const guarded = createResolver("test", query);

    const result = await new Promise<unknown>((fulfill, reject) => {
      guarded("files.example.com", { all: true }, (error, resolved) => {
        if (error) {
          reject(error);
          return;
        }
        fulfill(resolved);
      });
    });

    expect(query).toHaveBeenCalledWith("files.example.com", { all: true });
    expect(result).toEqual(addresses);
  });

  it("rejects mixed public and internal DNS results", async () => {
    const guarded = createResolver("test", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);

    await expect(
      new Promise<void>((fulfill, reject) => {
        guarded("files.example.com", { all: true }, (error) => {
          if (error) {
            reject(error);
            return;
          }
          fulfill();
        });
      })
    ).rejects.toThrow("Refusing to fetch an internal attachment URL");
  });

  it("reports an empty DNS result as a resolution failure, not a refusal", async () => {
    const guarded = createResolver("test", async () => []);

    await expect(
      new Promise<void>((fulfill, reject) => {
        guarded("gone.example.com", { all: true }, (error) => {
          if (error) {
            reject(error);
            return;
          }
          fulfill();
        });
      })
    ).rejects.toThrow("Could not resolve the attachment host");
  });

  it("rejects hostnames that resolve to internal addresses", async () => {
    const guarded = createResolver("test");

    await expect(
      new Promise<void>((fulfill, reject) => {
        guarded("localhost", { all: true }, (error) => {
          if (error) {
            reject(error);
            return;
          }
          fulfill();
        });
      })
    ).rejects.toThrow("Refusing to fetch an internal attachment URL");
  });

  it.each([
    "https://fbsbx.com/file",
    "https://cdn.fbsbx.com/file",
    "https://SContent.XX.FBCDN.NET/file",
  ])("accepts allowlisted host URL %s", (url) => {
    expect(
      validateAttachmentUrl(url, "test", ["fbsbx.com", "FBCDN.net"])
    ).toBeInstanceOf(URL);
  });

  it.each([
    "https://example.com/file",
    "https://fbsbx.com.attacker.example/file",
    "https://cdn.fbsbx.com./file",
  ])("rejects off-allowlist URL %s", (url) => {
    expect(() =>
      validateAttachmentUrl(url, "test", ["fbsbx.com", "fbcdn.net"])
    ).toThrow("Refusing to fetch an untrusted attachment URL");
  });

  it("applies the host allowlist to redirect targets", async () => {
    const transport = vi.fn(async () =>
      response("", 302, { location: "https://example.com/file" })
    );

    await expect(
      downloadAttachment("https://cdn.fbsbx.com/file", {
        adapter: "test",
        hosts: ["fbsbx.com"],
        transport,
      })
    ).rejects.toThrow("Refusing to fetch an untrusted attachment URL");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("follows redirects between allowlisted hosts", async () => {
    const transport = vi
      .fn<(url: URL, signal: AbortSignal) => Promise<IncomingMessage>>()
      .mockResolvedValueOnce(
        response("", 302, { location: "https://scontent.xx.fbcdn.net/file" })
      )
      .mockResolvedValueOnce(response("media"));

    await expect(
      downloadAttachment("https://lookaside.fbsbx.com/file", {
        adapter: "test",
        hosts: ["fbsbx.com", "fbcdn.net"],
        transport,
      })
    ).resolves.toEqual(Buffer.from("media"));
  });

  it("rejects redirects to internal addresses", async () => {
    const transport = vi.fn(async () =>
      response("", 302, {
        location: "https://169.254.169.254/latest/meta-data",
      })
    );

    await expect(
      downloadAttachment("https://contoso.sharepoint.com/file", {
        adapter: "test",
        transport,
      })
    ).rejects.toThrow("Refusing to fetch an internal attachment URL");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("follows redirects to other public HTTPS hosts", async () => {
    const transport = vi
      .fn<(url: URL, signal: AbortSignal) => Promise<IncomingMessage>>()
      .mockResolvedValueOnce(
        response("", 302, { location: "https://cdn.example.net/file" })
      )
      .mockResolvedValueOnce(response("file contents"));

    await expect(
      downloadAttachment("https://contoso.sharepoint.com/file", {
        adapter: "test",
        transport,
      })
    ).resolves.toEqual(Buffer.from("file contents"));
    expect(transport).toHaveBeenLastCalledWith(
      new URL("https://cdn.example.net/file"),
      expect.any(AbortSignal)
    );
  });

  it("rejects redirect chains past the redirect limit", async () => {
    const transport = vi.fn(async () =>
      response("", 302, { location: "https://cdn.example.net/file" })
    );

    await expect(
      downloadAttachment("https://files.example.com/file", {
        adapter: "test",
        redirects: 1,
        transport,
      })
    ).rejects.toThrow("Too many attachment redirects");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("rejects redirects without a location header", async () => {
    const transport = vi.fn(async () => response("", 302));

    await expect(
      downloadAttachment("https://files.example.com/file", {
        adapter: "test",
        transport,
      })
    ).rejects.toThrow("Attachment redirect has no location");
  });

  it("rejects error statuses", async () => {
    const transport = vi.fn(async () => response("", 404, {}, "Not Found"));

    await expect(
      downloadAttachment("https://files.example.com/file", {
        adapter: "test",
        transport,
      })
    ).rejects.toThrow("Failed to fetch file: 404 Not Found");
  });

  it("times out slow downloads with a distinct error", async () => {
    const transport = (_url: URL, signal: AbortSignal) =>
      new Promise<IncomingMessage>((_fulfill, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });

    await expect(
      downloadAttachment("https://files.example.com/file", {
        adapter: "test",
        timeoutMs: 20,
        transport,
      })
    ).rejects.toThrow("Timed out fetching the attachment");
  });

  it("decodes gzip response bodies", async () => {
    const transport = vi.fn(async () =>
      response(gzipSync(Buffer.from("file contents")), 200, {
        "content-encoding": "gzip",
      })
    );

    await expect(
      downloadAttachment("https://files.example.com/file", {
        adapter: "test",
        transport,
      })
    ).resolves.toEqual(Buffer.from("file contents"));
  });

  it("applies the download limit to decompressed bytes", async () => {
    const transport = vi.fn(async () =>
      response(gzipSync(Buffer.alloc(64 * 1024)), 200, {
        "content-encoding": "gzip",
      })
    );

    await expect(
      downloadAttachment("https://files.example.com/file", {
        adapter: "test",
        limit: 1024,
        transport,
      })
    ).rejects.toThrow("Attachment exceeds the download limit");
  });

  it("rejects unsupported content encodings", async () => {
    const transport = vi.fn(async () =>
      response("payload", 200, { "content-encoding": "zstd" })
    );

    await expect(
      downloadAttachment("https://files.example.com/file", {
        adapter: "test",
        transport,
      })
    ).rejects.toThrow("Unsupported attachment encoding: zstd");
  });

  it("stops reading attachments at the download limit", async () => {
    const message = Object.assign(
      Readable.from([Buffer.from("abc"), Buffer.from("def")]),
      { headers: {} }
    ) as IncomingMessage;

    await expect(readAttachmentBody(message, "test", 5)).rejects.toThrow(
      "Attachment exceeds the download limit"
    );
  });

  it("rejects declared sizes over the limit before reading", async () => {
    const message = response("abcdef", 200, { "content-length": "10" });

    await expect(readAttachmentBody(message, "test", 5)).rejects.toThrow(
      "Attachment exceeds the download limit"
    );
  });

  it("reads declared-size bodies into a single buffer", async () => {
    const message = Object.assign(
      Readable.from([Buffer.from("abc"), Buffer.from("def")]),
      { headers: { "content-length": "6" } }
    ) as IncomingMessage;

    await expect(readAttachmentBody(message, "test")).resolves.toEqual(
      Buffer.from("abcdef")
    );
  });

  it("rejects bodies that exceed their declared length", async () => {
    const message = Object.assign(Readable.from([Buffer.from("abcdef")]), {
      headers: { "content-length": "4" },
    }) as IncomingMessage;

    await expect(readAttachmentBody(message, "test")).rejects.toThrow(
      "Attachment body exceeds its declared length"
    );
  });
});
