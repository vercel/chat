import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveTemplateDir, templateDir } from "./template.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "template-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveTemplateDir", () => {
  it("returns the first existing candidate", () => {
    const missing = path.join(tmpDir, "missing");
    const existing = path.join(tmpDir, "template");
    fs.mkdirSync(existing);
    expect(resolveTemplateDir([missing, existing])).toBe(existing);
  });

  it("throws when no candidate exists", () => {
    expect(() => resolveTemplateDir([path.join(tmpDir, "missing")])).toThrow(
      "Could not find create-chat-sdk template directory"
    );
  });
});

describe("templateDir", () => {
  it("finds the package template", () => {
    expect(fs.existsSync(templateDir())).toBe(true);
  });
});
