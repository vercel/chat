import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readState, writeState } from "./state.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "create-chat-sdk-state-"));
});

afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

describe("generated file state", () => {
  it("reads and writes valid state", () => {
    writeState(dir, ["vercel.json"]);
    expect(readState(dir)).toEqual({
      files: ["vercel.json"],
      version: 1,
    });
  });

  it.each([
    '{"version":2,"files":[]}',
    '{"version":1,"files":"vercel.json"}',
    '{"version":1,"files":[1]}',
    '{"version":1,"files":["../../outside"]}',
    "{",
  ])("ignores invalid state", (content) => {
    fs.writeFileSync(path.join(dir, ".chat-sdk.json"), content);
    expect(readState(dir)).toEqual({ files: [], version: 1 });
  });
});
