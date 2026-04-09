import type { MessageData } from "./message";
import { createTestMessage as _createTestMessage } from "./mock-adapter";
import type { Author } from "./types";

export {
  createTestThread,
  type CreateTestThreadOptions,
  type MockStateAdapter,
  type TestThread,
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
  const overrides: Partial<MessageData> = { raw: raw ?? {}, ...rest };
  if (edited != null) {
    overrides.metadata = { dateSent: new Date(), edited };
  }
  if (author) {
    overrides.author = {
      userId: author.userId ?? "U000",
      userName: author.userName ?? "testuser",
      fullName: author.fullName ?? "Test User",
      isBot: author.isBot ?? false,
      isMe: author.isMe ?? false,
    };
  }
  return _createTestMessage(id ?? `msg-${++messageCounter}`, text, overrides);
}
