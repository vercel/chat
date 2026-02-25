/**
 * Tests for buffer conversion utilities.
 */

import { describe, expect, it } from "vitest";
import { bufferToDataUri, toBuffer, toBufferSync } from "./buffer-utils";
import { ValidationError } from "./errors";

const DATA_URI_PNG_PREFIX = /^data:image\/png;base64,/;

// ============================================================================
// toBuffer Tests
// ============================================================================

describe("toBuffer", () => {
  it("returns Buffer unchanged", async () => {
    const input = Buffer.from("hello");
    const result = await toBuffer(input, { platform: "slack" });
    expect(result).toBe(input);
  });

  it("converts ArrayBuffer to Buffer", async () => {
    const input = new ArrayBuffer(5);
    new Uint8Array(input).set([104, 101, 108, 108, 111]); // "hello"
    const result = await toBuffer(input, { platform: "slack" });
    expect(result).toBeInstanceOf(Buffer);
    expect(result?.toString()).toBe("hello");
  });

  it("converts Blob to Buffer", async () => {
    const input = new Blob(["hello"], { type: "text/plain" });
    const result = await toBuffer(input, { platform: "slack" });
    expect(result).toBeInstanceOf(Buffer);
    expect(result?.toString()).toBe("hello");
  });

  it("throws ValidationError for unsupported type by default", async () => {
    await expect(toBuffer("string", { platform: "slack" })).rejects.toThrow(
      ValidationError
    );
    await expect(toBuffer(123, { platform: "slack" })).rejects.toThrow(
      ValidationError
    );
    await expect(toBuffer({}, { platform: "slack" })).rejects.toThrow(
      ValidationError
    );
    await expect(toBuffer(null, { platform: "slack" })).rejects.toThrow(
      ValidationError
    );
  });

  it("returns null for unsupported type when throwOnUnsupported is false", async () => {
    const result = await toBuffer("string", {
      platform: "teams",
      throwOnUnsupported: false,
    });
    expect(result).toBeNull();
  });

  it("includes platform in error message", async () => {
    try {
      await toBuffer("invalid", { platform: "slack" });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).adapter).toBe("slack");
    }
  });
});

// ============================================================================
// toBufferSync Tests
// ============================================================================

describe("toBufferSync", () => {
  it("returns Buffer unchanged", () => {
    const input = Buffer.from("hello");
    const result = toBufferSync(input, { platform: "slack" });
    expect(result).toBe(input);
  });

  it("converts ArrayBuffer to Buffer", () => {
    const input = new ArrayBuffer(5);
    new Uint8Array(input).set([104, 101, 108, 108, 111]); // "hello"
    const result = toBufferSync(input, { platform: "slack" });
    expect(result).toBeInstanceOf(Buffer);
    expect(result?.toString()).toBe("hello");
  });

  it("throws ValidationError for Blob by default", () => {
    const input = new Blob(["hello"]);
    expect(() => toBufferSync(input, { platform: "slack" })).toThrow(
      ValidationError
    );
  });

  it("returns null for Blob when throwOnUnsupported is false", () => {
    const input = new Blob(["hello"]);
    const result = toBufferSync(input, {
      platform: "slack",
      throwOnUnsupported: false,
    });
    expect(result).toBeNull();
  });

  it("throws ValidationError for unsupported type by default", () => {
    expect(() => toBufferSync("string", { platform: "slack" })).toThrow(
      ValidationError
    );
  });

  it("returns null for unsupported type when throwOnUnsupported is false", () => {
    const result = toBufferSync("string", {
      platform: "teams",
      throwOnUnsupported: false,
    });
    expect(result).toBeNull();
  });
});

// ============================================================================
// bufferToDataUri Tests
// ============================================================================

describe("bufferToDataUri", () => {
  it("converts buffer to data URI with default mime type", () => {
    const buffer = Buffer.from("hello");
    const result = bufferToDataUri(buffer);
    expect(result).toBe("data:application/octet-stream;base64,aGVsbG8=");
  });

  it("converts buffer to data URI with custom mime type", () => {
    const buffer = Buffer.from("hello");
    const result = bufferToDataUri(buffer, "text/plain");
    expect(result).toBe("data:text/plain;base64,aGVsbG8=");
  });

  it("handles image mime types", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    const result = bufferToDataUri(buffer, "image/png");
    expect(result).toMatch(DATA_URI_PNG_PREFIX);
  });

  it("handles empty buffer", () => {
    const buffer = Buffer.alloc(0);
    const result = bufferToDataUri(buffer);
    expect(result).toBe("data:application/octet-stream;base64,");
  });
});
