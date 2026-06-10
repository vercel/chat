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

  // npm-packlist silently drops files named .gitignore from published
  // tarballs, so the template must ship them under the rename-on-copy name.
  it("contains no file named .gitignore at any depth", () => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name));
        } else if (entry.name === ".gitignore") {
          found.push(path.join(dir, entry.name));
        }
      }
    };
    walk(templateDir());
    expect(found).toEqual([]);
    expect(fs.existsSync(path.join(templateDir(), "gitignore"))).toBe(true);
  });
});
