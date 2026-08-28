import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { NetworkError } from "@chat-adapter/shared";
import { describe, expect, it, vi } from "vitest";
import { download } from "./fetch";

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

describe("Messenger attachment fetch", () => {
  it.each([
    "https://cdn.fbsbx.com/file",
    "https://lookaside.fbsbx.com/file",
    "https://scontent.xx.fbcdn.net/file",
    "https://SContent.XX.FBCDN.NET/file",
  ])("downloads from Meta CDN URL %s", async (url) => {
    const transport = vi.fn(async () => response("media"));

    await expect(download(url, transport)).resolves.toEqual(
      Buffer.from("media")
    );
  });

  it.each([
    "https://example.com/file",
    "https://fbcdn.net.attacker.example/file",
    "https://cdn.fbsbx.com./file",
    "http://cdn.fbsbx.com/file",
    "https://127.0.0.1/file",
    "https://2130706433/file",
  ])("rejects untrusted attachment URL %s", async (url) => {
    const transport = vi.fn(async () => response("media"));

    await expect(download(url, transport)).rejects.toThrow(NetworkError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects redirects away from Meta CDN hosts", async () => {
    const transport = vi.fn(async () =>
      response("", 302, { location: "https://example.com/file" })
    );

    await expect(
      download("https://cdn.fbsbx.com/file", transport)
    ).rejects.toThrow("Refusing to fetch an untrusted attachment URL");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("normalizes transport failures", async () => {
    const transport = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(
      download("https://cdn.fbsbx.com/file", transport)
    ).rejects.toMatchObject({
      adapter: "messenger",
      message: "Failed to download Messenger attachment",
    });
  });

  it("rejects unsuccessful responses", async () => {
    const transport = vi.fn(async () =>
      response("missing", 404, {}, "Not Found")
    );

    await expect(
      download("https://cdn.fbsbx.com/file", transport)
    ).rejects.toMatchObject({
      adapter: "messenger",
      message: "Failed to fetch file: 404 Not Found",
    });
  });

  it("uses Messenger network errors", async () => {
    await expect(download("https://example.com/file")).rejects.toMatchObject({
      adapter: "messenger",
      message: "Refusing to fetch an untrusted attachment URL",
    });
  });
});
