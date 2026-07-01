/**
 * Base error class for create-chat-sdk failures that should be presented to
 * users without a stack trace.
 */
class CreateChatSdkError extends Error {
  /**
   * Create a user-facing CLI error.
   *
   * @param message - Human-readable error message.
   */
  constructor(message: string) {
    super(message);
    this.name = "CreateChatSdkError";
  }
}

/**
 * Error thrown when adapter CLI flags cannot be resolved to a valid selection.
 */
export class AdapterSelectionError extends CreateChatSdkError {
  /**
   * Create an adapter-selection error.
   *
   * @param message - Human-readable error message.
   */
  constructor(message: string) {
    super(message);
    this.name = "AdapterSelectionError";
  }
}
