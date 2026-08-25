import type { LookupAddress, LookupAllOptions } from "node:dns";
import { lookup as resolve } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request as secure } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { pipeline, type Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { NetworkError } from "./errors";

const LIMIT = 25 * 1024 * 1024;
const REDIRECTS = 5;
const TIMEOUT = 30_000;
const STATUSES = new Set([301, 302, 303, 307, 308]);
const BRACKETS = /^\[|\]$/g;
const IPV4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;
const IPV6 = [
  ["::", 3],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["4000::", 2],
  ["8000::", 1],
] as const;
const DECODERS: Record<string, () => Transform> = {
  br: createBrotliDecompress,
  deflate: createInflate,
  gzip: createGunzip,
  "x-gzip": createGunzip,
};

type Resolver = (
  hostname: string,
  options: LookupAllOptions
) => Promise<LookupAddress[]>;

/**
 * Issues one request and resolves with the raw response. Downloads pass an
 * AbortSignal carrying the overall deadline; honor it so timeouts propagate.
 * Supply your own transport to route downloads through a proxy or custom
 * egress.
 */
export type AttachmentTransport = (
  url: URL,
  signal: AbortSignal
) => Promise<IncomingMessage>;

export interface DownloadAttachmentOptions {
  /** Adapter name used to tag thrown errors, e.g. "teams". */
  adapter: string;
  /** Extra request headers merged over the defaults. */
  headers?: Record<string, string>;
  /** Maximum decoded body size in bytes. Defaults to 25 MB. */
  limit?: number;
  /** Maximum redirects to follow. Defaults to 5. */
  redirects?: number;
  /**
   * Overall deadline in milliseconds covering every redirect hop and the
   * body read. Defaults to 30 seconds.
   */
  timeoutMs?: number;
  /** Replaces the built-in DNS-pinned HTTPS transport. */
  transport?: AttachmentTransport;
}

function blocklist(
  ranges: readonly (readonly [string, number])[],
  family: "ipv4" | "ipv6"
): BlockList {
  const list = new BlockList();
  for (const [address, prefix] of ranges) {
    list.addSubnet(address, prefix, family);
  }
  return list;
}

const BLOCKED4 = blocklist(IPV4, "ipv4");
const BLOCKED6 = blocklist(IPV6, "ipv6");

function blocked(address: string, family: number): boolean {
  if (family !== 4 && family !== 6) {
    return true;
  }
  return family === 6
    ? BLOCKED6.check(address, "ipv6")
    : BLOCKED4.check(address, "ipv4");
}

function refusal(adapter: string): NetworkError {
  return new NetworkError(
    adapter,
    "Refusing to fetch an internal attachment URL"
  );
}

export function createResolver(
  adapter: string,
  query: Resolver = resolve
): LookupFunction {
  return (hostname, options, callback) => {
    query(hostname, { ...options, all: true }).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(
            new NetworkError(adapter, "Could not resolve the attachment host"),
            "",
            0
          );
          return;
        }
        if (addresses.some(({ address, family }) => blocked(address, family))) {
          callback(refusal(adapter), "", 0);
          return;
        }
        if (options.all) {
          callback(null, addresses);
          return;
        }
        const [address] = addresses;
        callback(null, address.address, address.family);
      },
      (error: unknown) => {
        callback(
          error instanceof Error ? error : new Error(String(error)),
          "",
          0
        );
      }
    );
  };
}

export function validateAttachmentUrl(
  value: string | URL,
  adapter: string
): URL {
  const url = value instanceof URL ? value : new URL(value);
  const hostname = url.hostname.replace(BRACKETS, "");
  const family = isIP(hostname);
  if (family && blocked(hostname, family)) {
    throw refusal(adapter);
  }
  if (url.protocol !== "https:") {
    throw new NetworkError(
      adapter,
      "Refusing to fetch an untrusted attachment URL"
    );
  }
  return url;
}

function createTransport(
  adapter: string,
  headers?: Record<string, string>
): AttachmentTransport {
  const lookup = createResolver(adapter);
  return (url, signal) =>
    new Promise((fulfill, reject) => {
      const request = secure(
        url,
        {
          agent: false,
          headers: {
            "accept-encoding": "gzip, deflate, br",
            "user-agent": "Vercel.ChatSDK",
            ...headers,
          },
          lookup,
          signal,
        },
        fulfill
      );
      request.on("error", reject);
      request.end();
    });
}

export async function readAttachmentBody(
  response: IncomingMessage,
  adapter: string,
  limit = LIMIT
): Promise<Buffer> {
  const header =
    response.headers["content-encoding"]?.trim().toLowerCase() || "identity";
  const decode = header === "identity" ? undefined : DECODERS[header];
  if (header !== "identity" && !decode) {
    response.destroy();
    throw new NetworkError(
      adapter,
      `Unsupported attachment encoding: ${header}`
    );
  }
  const declared = decode
    ? Number.NaN
    : Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    response.destroy();
    throw new NetworkError(adapter, "Attachment exceeds the download limit");
  }
  const source = decode
    ? pipeline(response, decode(), () => undefined)
    : response;
  if (Number.isFinite(declared)) {
    const body = Buffer.allocUnsafe(declared);
    let offset = 0;
    for await (const chunk of source) {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (offset + piece.length > declared) {
        response.destroy();
        throw new NetworkError(
          adapter,
          "Attachment body exceeds its declared length"
        );
      }
      piece.copy(body, offset);
      offset += piece.length;
    }
    return offset === declared ? body : body.subarray(0, offset);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += piece.length;
    if (size > limit) {
      response.destroy();
      throw new NetworkError(adapter, "Attachment exceeds the download limit");
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks, size);
}

/**
 * Downloads an untrusted attachment URL with SSRF protection: HTTPS only,
 * private and internal addresses refused (both as literals and after DNS
 * resolution), redirects revalidated, the decoded body capped at
 * options.limit, and the whole operation bounded by options.timeoutMs.
 */
export async function downloadAttachment(
  value: string,
  options: DownloadAttachmentOptions
): Promise<Buffer> {
  const {
    adapter,
    headers,
    limit = LIMIT,
    redirects = REDIRECTS,
    timeoutMs = TIMEOUT,
    transport,
  } = options;
  const send = transport ?? createTransport(adapter, headers);
  const signal = AbortSignal.timeout(timeoutMs);
  let url = validateAttachmentUrl(value, adapter);
  try {
    for (let hop = 0; hop <= redirects; hop += 1) {
      const response = await send(url, signal);
      const status = response.statusCode ?? 0;
      if (STATUSES.has(status)) {
        const location = response.headers.location;
        response.destroy();
        if (!location) {
          throw new NetworkError(
            adapter,
            "Attachment redirect has no location"
          );
        }
        if (hop === redirects) {
          throw new NetworkError(adapter, "Too many attachment redirects");
        }
        url = validateAttachmentUrl(new URL(location, url), adapter);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        throw new NetworkError(
          adapter,
          `Failed to fetch file: ${status} ${response.statusMessage ?? ""}`.trim()
        );
      }
      return await readAttachmentBody(response, adapter, limit);
    }
    throw new NetworkError(adapter, "Too many attachment redirects");
  } catch (error) {
    if (signal.aborted && !(error instanceof NetworkError)) {
      throw new NetworkError(
        adapter,
        "Timed out fetching the attachment",
        error instanceof Error ? error : undefined
      );
    }
    throw error;
  }
}
