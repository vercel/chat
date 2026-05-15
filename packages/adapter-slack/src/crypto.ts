// Re-export shared token encryption helpers. Slack-specific call sites import
// from "./crypto" historically; now they all delegate to @chat-adapter/shared
// so the same primitives are reused across adapters (Linear, etc.).
export {
  decodeKey,
  decryptToken,
  type EncryptedTokenData,
  encryptToken,
  isEncryptedTokenData,
} from "@chat-adapter/shared";
