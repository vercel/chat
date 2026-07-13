/**
 * Bookmarks API round-trip via the emulator HTTP surface.
 * The Slack adapter does not expose bookmarks yet; this verifies the
 * emulator store and scopes used by integration tests.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  addBookmarkViaApi,
  createSlackEmulator,
  listBookmarksViaApi,
  type SlackEmulatorHandle,
} from "./utils";

describe("Slack emulator: bookmarks API", () => {
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

  it("adds and lists channel bookmarks in the emulator store", async () => {
    const { bookmarkId } = await addBookmarkViaApi(emulator, {
      channelId: emulator.channelId,
      title: "Runbook",
      link: "https://example.com/runbook",
    });

    const stored = emulator.slackStore.bookmarks.findOneBy(
      "bookmark_id",
      bookmarkId
    );
    expect(stored?.title).toBe("Runbook");
    expect(stored?.link).toBe("https://example.com/runbook");
    expect(stored?.channel_id).toBe(emulator.channelId);

    const listed = await listBookmarksViaApi(emulator, emulator.channelId);
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bookmarkId,
          title: "Runbook",
          link: "https://example.com/runbook",
        }),
      ])
    );
  });
});
