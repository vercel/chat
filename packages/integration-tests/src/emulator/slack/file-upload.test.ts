/**
 * External file upload flow via files.getUploadURLExternal and
 * files.completeUploadExternal against the emulator store.
 */

import { uploadSlackFiles } from "@chat-adapter/slack/api";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createSlackEmulator,
  EMULATOR_BOT_TOKEN,
  type SlackEmulatorHandle,
} from "./utils";

function resolveFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

describe("Slack emulator: external file upload", () => {
  let emulator: SlackEmulatorHandle;

  beforeAll(async () => {
    emulator = await createSlackEmulator();
  });

  afterAll(async () => {
    await emulator.close();
  });

  afterEach(() => {
    emulator.reset();
  });

  it("uploads a file and shares it to a channel", async () => {
    const content = "hello from emulator upload test";
    // The emulator builds upload URLs from its configured baseUrl, which is
    // `http://localhost:0` when the server binds to port 0. Rewrite upload
    // requests to the actual listening origin from createSlackEmulator().
    const fetchWithUploadHostFix: typeof fetch = (input, init) => {
      const url = resolveFetchUrl(input);
      if (url.includes("/upload/v1/")) {
        const fileId = url.split("/upload/v1/").pop()?.split("?")[0];
        if (fileId) {
          return fetch(`${emulator.baseUrl}/upload/v1/${fileId}`, init);
        }
      }
      return fetch(input, init);
    };

    const { fileIds } = await uploadSlackFiles(
      [
        {
          data: Buffer.from(content),
          filename: "notes.txt",
          title: "Release notes",
        },
      ],
      {
        apiUrl: emulator.apiUrl,
        token: EMULATOR_BOT_TOKEN,
        channelId: emulator.channelId,
        initialComment: "Uploaded via external flow",
        fetch: fetchWithUploadHostFix,
      }
    );

    expect(fileIds).toHaveLength(1);
    const fileId = fileIds[0];
    expect(fileId).toBeTruthy();

    const file = emulator.slackStore.files.findOneBy("file_id", fileId);
    expect(file?.name).toBe("notes.txt");
    expect(file?.user).toBe(emulator.botUserId);

    const session = emulator.slackStore.fileUploadSessions.findOneBy(
      "file_id",
      fileId
    );
    expect(session?.uploaded).toBe(true);
    expect(session?.completed).toBe(true);

    const shared = emulator.slackStore.messages
      .all()
      .filter(
        (m) =>
          m.channel_id === emulator.channelId &&
          m.subtype === "file_share" &&
          m.files?.some((f) => f.file_id === fileId)
      );
    expect(shared.length).toBeGreaterThan(0);
  });
});
