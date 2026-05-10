import { describe, expect, it } from "vitest";
import {
  buildReferencesChain,
  decodeEmailThreadId,
  emailDomainOf,
  encodeEmailThreadId,
  findThreadRoot,
  generateMessageId,
  MAX_REFERENCES_CHAIN,
  parseReferencesHeader,
  replySubject,
  stripAngleBrackets,
  wrapAngleBrackets,
} from "./threading";

const UUID_AT_DOMAIN = /^[0-9a-f-]{36}@yourdomain\.com$/;

describe("generateMessageId", () => {
  it("produces uuid@domain", () => {
    const id = generateMessageId("yourdomain.com");
    expect(id).toMatch(UUID_AT_DOMAIN);
  });

  it("rejects empty domain", () => {
    expect(() => generateMessageId("")).toThrow("messageIdDomain is required");
  });
});

describe("stripAngleBrackets / wrapAngleBrackets", () => {
  it("removes angle brackets when present", () => {
    expect(stripAngleBrackets("<abc@example.com>")).toBe("abc@example.com");
  });

  it("leaves plain values untouched", () => {
    expect(stripAngleBrackets("abc@example.com")).toBe("abc@example.com");
  });

  it("handles whitespace", () => {
    expect(stripAngleBrackets("  <abc@example.com>  ")).toBe("abc@example.com");
  });

  it("wraps without double-wrapping", () => {
    expect(wrapAngleBrackets("abc@example.com")).toBe("<abc@example.com>");
    expect(wrapAngleBrackets("<abc@example.com>")).toBe("<abc@example.com>");
  });
});

describe("parseReferencesHeader", () => {
  it("returns empty for missing header", () => {
    expect(parseReferencesHeader(undefined)).toEqual([]);
    expect(parseReferencesHeader("")).toEqual([]);
  });

  it("parses a whitespace-separated chain of <id> tokens", () => {
    const header = "<a@x>\r\n <b@x>\t<c@x>";
    expect(parseReferencesHeader(header)).toEqual(["a@x", "b@x", "c@x"]);
  });

  it("falls back to whitespace splitting when angle brackets are missing", () => {
    expect(parseReferencesHeader("a@x b@x")).toEqual(["a@x", "b@x"]);
  });
});

describe("findThreadRoot", () => {
  it("prefers the first References entry", () => {
    expect(
      findThreadRoot({
        references: ["root@x", "second@x"],
        inReplyTo: "different@x",
      })
    ).toBe("root@x");
  });

  it("falls back to In-Reply-To", () => {
    expect(findThreadRoot({ inReplyTo: "parent@x" })).toBe("parent@x");
  });

  it("returns null when neither header is present", () => {
    expect(findThreadRoot({})).toBeNull();
  });

  it("ignores empty References array", () => {
    expect(findThreadRoot({ references: [], inReplyTo: "parent@x" })).toBe(
      "parent@x"
    );
  });

  it("skips an empty first entry in References and falls back to In-Reply-To", () => {
    expect(findThreadRoot({ references: [""], inReplyTo: "parent@x" })).toBe(
      "parent@x"
    );
  });
});

describe("buildReferencesChain", () => {
  it("appends parent to previous chain", () => {
    expect(buildReferencesChain(["root@x"], "parent@x")).toEqual([
      "root@x",
      "parent@x",
    ]);
  });

  it("strips angle brackets from inputs", () => {
    expect(buildReferencesChain(["<root@x>"], "<parent@x>")).toEqual([
      "root@x",
      "parent@x",
    ]);
  });

  it("preserves root and tail when chain exceeds the cap", () => {
    const previous = Array.from({ length: 30 }, (_, i) => `m${i}@x`);
    const chain = buildReferencesChain(previous, "parent@x");
    expect(chain).toHaveLength(MAX_REFERENCES_CHAIN);
    expect(chain[0]).toBe("m0@x");
    expect(chain.at(-1)).toBe("parent@x");
    // Tail should be the last MAX-1 entries from combined
    expect(chain[1]).toBe(`m${30 - (MAX_REFERENCES_CHAIN - 2)}@x`);
  });
});

describe("encodeEmailThreadId / decodeEmailThreadId", () => {
  it("roundtrips a root-only thread", () => {
    const data = { rootMessageId: "abc:def@example.com" };
    const encoded = encodeEmailThreadId(data);
    expect(encoded.startsWith("email:")).toBe(true);
    expect(decodeEmailThreadId(encoded)).toEqual(data);
  });

  it("roundtrips a thread with a participant address", () => {
    const data = {
      rootMessageId: "abc@example.com",
      participantAddress: "user+tag@example.com",
    };
    const encoded = encodeEmailThreadId(data);
    expect(decodeEmailThreadId(encoded)).toEqual(data);
  });

  it("rejects invalid prefixes", () => {
    expect(() => decodeEmailThreadId("notemail:foo")).toThrow(
      "Invalid email thread ID"
    );
    expect(() => decodeEmailThreadId("email:")).toThrow(
      "Invalid email thread ID"
    );
  });

  it("rejects an empty root segment after the prefix", () => {
    expect(() => decodeEmailThreadId("email::xxx")).toThrow(
      "Invalid email thread ID format"
    );
  });

  it("rejects a root segment that base64url-decodes to empty", () => {
    // `===` is valid base64url padding-only input that decodes to an
    // empty string; the adapter rejects it as an unusable root.
    expect(() => decodeEmailThreadId("email:===")).toThrow(
      "Invalid email thread ID encoding"
    );
  });

  it("rejects an empty participant segment", () => {
    const root = Buffer.from("root@x.com").toString("base64url");
    expect(() => decodeEmailThreadId(`email:${root}:`)).toThrow(
      "Invalid email thread ID format"
    );
  });

  it("rejects too many colon-separated segments", () => {
    const root = Buffer.from("root@x.com").toString("base64url");
    const addr = Buffer.from("user@x.com").toString("base64url");
    expect(() => decodeEmailThreadId(`email:${root}:${addr}:extra`)).toThrow(
      "Invalid email thread ID format"
    );
  });
});

describe("emailDomainOf", () => {
  it("returns the domain portion", () => {
    expect(emailDomainOf("user@example.com")).toBe("example.com");
  });

  it("returns null for malformed addresses", () => {
    expect(emailDomainOf("noatsign")).toBeNull();
    expect(emailDomainOf("user@")).toBeNull();
  });
});

describe("replySubject", () => {
  it("prepends Re: when missing", () => {
    expect(replySubject("Hello")).toBe("Re: Hello");
  });

  it("does not double-prefix", () => {
    expect(replySubject("Re: Hello")).toBe("Re: Hello");
    expect(replySubject("RE: Hello")).toBe("RE: Hello");
  });

  it("handles empty input", () => {
    expect(replySubject("")).toBe("Re:");
    expect(replySubject(undefined)).toBe("Re:");
  });
});
