import fs from "node:fs";
import path from "node:path";
import { readProjectJson, writeProjectJson } from "./fs.js";

const paths = [
  "src/app/api/chat/route.ts",
  "src/app/api/discord/gateway/route.ts",
  "src/lib/auth-stub.ts",
  "vercel.json",
] as const;

type File = (typeof paths)[number];

export interface State {
  files: File[];
  version: 1;
}

const file = ".chat-sdk.json";
const allowed = new Set<string>(paths);

const isFile = (value: unknown): value is File =>
  typeof value === "string" && allowed.has(value);

export const readState = (projectDir: string): State => {
  if (!fs.existsSync(path.join(projectDir, file))) {
    return { files: [], version: 1 };
  }

  try {
    const state = readProjectJson<Partial<State>>(projectDir, file);
    if (
      state.version !== 1 ||
      !Array.isArray(state.files) ||
      !state.files.every(isFile)
    ) {
      return { files: [], version: 1 };
    }
    return { files: state.files, version: 1 };
  } catch {
    return { files: [], version: 1 };
  }
};

export const writeState = (
  projectDir: string,
  files: readonly File[]
): void => {
  writeProjectJson(projectDir, file, { files, version: 1 });
};
