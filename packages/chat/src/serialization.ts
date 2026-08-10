/**
 * Workflow-safe Chat class serialization exports.
 *
 * This entrypoint deliberately excludes the `Chat` runtime and its Node-only
 * conversation context. Keeping these classes in a separate tsup entry makes
 * their automatic Workflow serializer registration safe to load in the
 * sandboxed workflow bundle.
 */

export {
  ChannelImpl,
  type SerializedChannel,
} from "./channel";
export {
  Message,
  type MessageData,
  type SerializedMessage,
} from "./message";
export { reviver } from "./reviver";
export { type SerializedThread, ThreadImpl } from "./thread";
