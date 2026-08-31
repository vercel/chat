import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { NetworkError } from "@chat-adapter/shared";
import { describe, expect, it, vi } from "vitest";
import { downloadInstagramAttachment } from "./fetch";

function response(
  body: string,
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

describe("Instagram attachment fetch", () => {
  it.each([
    "https://scontent.cdninstagram.com/file",
    "https://lookaside.fbsbx.com/file",
    "https://scontent.xx.fbcdn.net/file",
  ])("downloads from Meta CDN URL %s", async (url) => {
    const transport = vi.fn(async () => response("media"));

    await expect(downloadInstagramAttachment(url, transport)).resolves.toEqual(
      Buffer.from("media")
    );
  });

  it.each([
    "https://example.com/file",
    "https://cdninstagram.com.attacker.example/file",
    "https://scontent.cdninstagram.com./file",
    "http://scontent.cdninstagram.com/file",
    "https://127.0.0.1/file",
  ])("rejects untrusted attachment URL %s", async (url) => {
    const transport = vi.fn(async () => response("media"));

    await expect(downloadInstagramAttachment(url, transport)).rejects.toThrow(
      NetworkError
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects redirects away from Meta CDN hosts", async () => {
    const transport = vi.fn(async () =>
      response("", 302, { location: "https://example.com/file" })
    );

    await expect(
      downloadInstagramAttachment(
        "https://scontent.cdninstagram.com/file",
        transport
      )
    ).rejects.toThrow("Refusing to fetch an untrusted attachment URL");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("uses Instagram network errors", async () => {
    await expect(
      downloadInstagramAttachment("https://example.com/file")
    ).rejects.toMatchObject({
      adapter: "instagram",
      message: "Refusing to fetch an untrusted attachment URL",
    });
  });
});
