import { describe, expect, it } from "vitest";
import { replaceBareMentions } from "./mentions";

// Render a bare @name as a generic <@name> token (the Discord/Slack shape).
const toToken = (text: string): string =>
  replaceBareMentions(text, (_mention, name) => `<@${name}>`);

describe("replaceBareMentions", () => {
  describe("bare mentions", () => {
    it("converts a mention at the start of the string", () => {
      expect(toToken("@alice hi")).toBe("<@alice> hi");
    });

    it("converts a mention after whitespace", () => {
      expect(toToken("hey @alice")).toBe("hey <@alice>");
    });

    it("converts a mention that follows a period", () => {
      expect(toToken("read the docs.@everyone please")).toBe(
        "read the docs.<@everyone> please"
      );
    });

    it("converts multiple mentions in one string", () => {
      expect(toToken("ping @one and @two")).toBe("ping <@one> and <@two>");
    });

    it("leaves a lone @ with no following word untouched", () => {
      expect(toToken("price @ $5")).toBe("price @ $5");
    });
  });

  describe("emails and handles", () => {
    it("does not turn an email address into a mention", () => {
      expect(toToken("Contact me at user@example.com")).toBe(
        "Contact me at user@example.com"
      );
    });

    it("leaves word@word handles intact", () => {
      expect(toToken("ping support@vercel.com now")).toBe(
        "ping support@vercel.com now"
      );
    });
  });

  describe("urls", () => {
    it("does not mangle an @handle inside an https url", () => {
      expect(toToken("see https://github.com/@vercel here")).toBe(
        "see https://github.com/@vercel here"
      );
    });

    it("does not mangle an @handle inside an http url", () => {
      expect(toToken("http://example.com/@team")).toBe(
        "http://example.com/@team"
      );
    });

    it("does not mangle an @handle inside a schemeless host path", () => {
      expect(toToken("twitter.com/@jack")).toBe("twitter.com/@jack");
    });
  });

  describe("code", () => {
    it("leaves a mention inside an inline code span untouched", () => {
      expect(toToken("run `ping @here` now")).toBe("run `ping @here` now");
    });

    it("leaves a mention inside a fenced code block untouched", () => {
      expect(toToken("```\nping @here\n```")).toBe("```\nping @here\n```");
    });

    it("still converts a mention outside the code span", () => {
      expect(toToken("`code` then @alice")).toBe("`code` then <@alice>");
    });
  });

  describe("existing tokens", () => {
    it("does not double-wrap an already-formatted mention", () => {
      expect(toToken("ping <@123> now")).toBe("ping <@123> now");
    });

    it("leaves other angle-bracket tokens untouched", () => {
      expect(toToken("see <at>bob</at>")).toBe("see <at>bob</at>");
    });
  });

  describe("replacer contract", () => {
    it("passes the full mention and the bare name", () => {
      const seen: Array<{ mention: string; name: string }> = [];
      replaceBareMentions("hey @alice", (mention, name) => {
        seen.push({ mention, name });
        return mention;
      });
      expect(seen).toEqual([{ mention: "@alice", name: "alice" }]);
    });

    it("uses the replacer's return value verbatim", () => {
      const result = replaceBareMentions(
        "hey @alice",
        (_mention, name) => `<at>${name}</at>`
      );
      expect(result).toBe("hey <at>alice</at>");
    });
  });
});
