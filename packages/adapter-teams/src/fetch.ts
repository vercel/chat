import type { LookupAddress, LookupAllOptions } from "node:dns";
import { lookup as resolve } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request as secure } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { NetworkError } from "@chat-adapter/shared";

const LIMIT = 25 * 1024 * 1024;
const REDIRECTS = 5;
const TIMEOUT = 15_000;
const STATUSES = new Set([301, 302, 303, 307, 308]);
const BRACKETS = /^\[|\]$/g;
const HOSTS = [
  "sharepoint.com",
  "sharepoint.cn",
  "sharepoint.us",
  "sharepoint-mil.us",
  "dps.mil",
] as const;
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

type Resolver = (
  hostname: string,
  options: LookupAllOptions
) => Promise<LookupAddress[]>;

type Transport = (url: URL) => Promise<IncomingMessage>;

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

function refusal(): NetworkError {
  return new NetworkError(
    "teams",
    "Refusing to fetch an internal attachment URL"
  );
}

function trusted(hostname: string): boolean {
  return HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`)
  );
}

export function resolver(query: Resolver = resolve): LookupFunction {
  return (hostname, options, callback) => {
    query(hostname, { ...options, all: true }).then(
      (addresses) => {
        if (
          addresses.length === 0 ||
          addresses.some(({ address, family }) => blocked(address, family))
        ) {
          callback(refusal(), "", 0);
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

export const lookup = resolver();

export function validate(value: string | URL): URL {
  const url = value instanceof URL ? value : new URL(value);
  const hostname = url.hostname.replace(BRACKETS, "");
  const family = isIP(hostname);
  if (family && blocked(hostname, family)) {
    throw refusal();
  }
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    !trusted(hostname)
  ) {
    throw new NetworkError(
      "teams",
      "Refusing to fetch an untrusted attachment URL"
    );
  }
  return url;
}

function open(url: URL): Promise<IncomingMessage> {
  return new Promise((fulfill, reject) => {
    const request = secure(
      url,
      {
        agent: false,
        lookup,
        signal: AbortSignal.timeout(TIMEOUT),
      },
      fulfill
    );
    request.on("error", reject);
    request.end();
  });
}

export async function read(
  response: IncomingMessage,
  limit = LIMIT
): Promise<Buffer> {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    response.destroy();
    throw new NetworkError("teams", "Attachment exceeds the download limit");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      response.destroy();
      throw new NetworkError("teams", "Attachment exceeds the download limit");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

export async function download(
  value: string,
  transport: Transport = open
): Promise<Buffer> {
  let url = validate(value);
  for (let redirects = 0; redirects <= REDIRECTS; redirects += 1) {
    const response = await transport(url);
    const status = response.statusCode ?? 0;
    if (STATUSES.has(status)) {
      const location = response.headers.location;
      response.destroy();
      if (!location) {
        throw new NetworkError("teams", "Attachment redirect has no location");
      }
      if (redirects === REDIRECTS) {
        throw new NetworkError("teams", "Too many attachment redirects");
      }
      url = validate(new URL(location, url));
      continue;
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      throw new NetworkError(
        "teams",
        `Failed to fetch file: ${status} ${response.statusMessage ?? ""}`.trim()
      );
    }
    return read(response);
  }
  throw new NetworkError("teams", "Too many attachment redirects");
}
