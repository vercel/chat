import type { MessageData } from "./message";
import { createTestMessage as _createTestMessage } from "./mock-adapter";
import type { Author } from "./types";

export {
  createMockAdapter,
  createMockState,
  createTestThread,
  type MockStateAdapter,
  mockLogger,
} from "./mock-adapter";

let messageCounter = 0;

/** Create a test message with sensible defaults. Only `text` is required. Extra properties are spread as MessageData overrides. */
export function createTestMessage(
  opts: {
    text: string;
    id?: string;
    author?: Partial<Author>;
    raw?: unknown;
    edited?: boolean;
  } & Omit<
    Partial<MessageData>,
    "text" | "id" | "author" | "raw" | "formatted"
  >
) {
  const { text, id, author, raw, edited, ...rest } = opts;
  return _createTestMessage(id ?? `msg-${++messageCounter}`, text, {
    raw: raw ?? {},
    metadata: edited != null ? { dateSent: new Date(), edited } : undefined,
    author: author
      ? {
          userId: author.userId ?? "U000",
          userName: author.userName ?? "testuser",
          fullName: author.fullName ?? "Test User",
          isBot: author.isBot ?? false,
          isMe: author.isMe ?? false,
        }
      : undefined,
    ...rest,
  });
}
