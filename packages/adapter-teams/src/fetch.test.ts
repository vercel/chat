import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { NetworkError } from "@chat-adapter/shared";
import { describe, expect, it, vi } from "vitest";
import { download, lookup, read, resolver, validate } from "./fetch";

function response(
  body: string,
  status = 200,
  headers: IncomingMessage["headers"] = {}
): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(body)]), {
    headers,
    statusCode: status,
    statusMessage: "OK",
  }) as IncomingMessage;
}

describe("Teams attachment fetch", () => {
  it.each([
    "contoso.sharepoint.com",
    "CONTOSO.SHAREPOINT.COM",
    "contoso.sharepoint.cn",
    "contoso.sharepoint.us",
    "contoso.sharepoint-mil.us",
    "tenant.dps.mil",
  ])("accepts Microsoft file host %s", (hostname) => {
    expect(validate(`https://${hostname}/file`)).toBeInstanceOf(URL);
  });

  it.each([
    "https://files.example.com/file",
    "https://sharepoint.com.attacker.example/file",
    "https://contoso.sharepoint.com./file",
    "http://contoso.sharepoint.com/file",
    "https://contoso.sharepoint.com:8443/file",
  ])("rejects untrusted file URL %s", (url) => {
    expect(() => validate(url)).toThrow(
      "Refusing to fetch an untrusted attachment URL"
    );
  });

  it.each([
    "https://127.0.0.1/file",
    "https://2130706433/file",
    "https://[::1]/file",
  ])("rejects internal file URL %s with a network error", (url) => {
    expect(() => validate(url)).toThrow(NetworkError);
    expect(() => validate(url)).toThrow(
      "Refusing to fetch an internal attachment URL"
    );
  });

  it("returns the validated DNS results to the socket", async () => {
    const addresses = [
      { address: "93.184.216.34", family: 4 as const },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const },
    ];
    const query = vi.fn(async () => addresses);
    const guarded = resolver(query);

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
    const guarded = resolver(async () => [
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

  it("rejects hostnames that resolve to internal addresses", async () => {
    await expect(
      new Promise<void>((fulfill, reject) => {
        lookup("localhost", { all: true }, (error) => {
          if (error) {
            reject(error);
            return;
          }
          fulfill();
        });
      })
    ).rejects.toThrow("Refusing to fetch an internal attachment URL");
  });

  it("rejects redirects to internal addresses", async () => {
    const transport = vi.fn(async () =>
      response("", 302, {
        location: "http://169.254.169.254/latest/meta-data",
      })
    );

    await expect(
      download("https://contoso.sharepoint.com/file", transport)
    ).rejects.toThrow("Refusing to fetch an internal attachment URL");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("stops reading attachments at the download limit", async () => {
    const message = Object.assign(
      Readable.from([Buffer.from("abc"), Buffer.from("def")]),
      { headers: {} }
    ) as IncomingMessage;

    await expect(read(message, 5)).rejects.toThrow(
      "Attachment exceeds the download limit"
    );
  });
});
