/**
 * Test utilities for the XChat adapter.
 *
 * Provides helpers for creating test adapters with real chat-xdk WASM crypto
 * using the deterministic sdk_vectors.json fixture keys.
 *
 * Fixture crypto loads the wasm `Chat` directly from the package's `pkg/`
 * build, because the public JS API exposes only the Juicebox-backed
 * `createChat()` and cannot import raw fixture keys.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ChatWithJuicebox } from "@xdevplatform/chat-xdk";
import type { ChatInstance, Logger } from "chat";
import { vi } from "vitest";
import { XchatAdapter } from "./index";
import type { XchatAdapterConfig } from "./types";

// ── Fixture data ────────────────────────────────────────────────────

const VECTORS_PATH = resolve(
  fileURLToPath(import.meta.url),
  "../../../tests/fixtures/sdk_vectors.json"
);

export interface SdkVectors {
  conversation_key_b64: string;
  event_conversation_id: string;
  event_conversation_key_version: string;
  event_message_b64: string;
  event_message_text: string;
  event_sender_id: string;
  event_signing_key_version: string;
  identity_private_b64: string;
  identity_public_b64: string;
  identity_public_key_signature_b64: string;
  message_utf8: string;
  plaintext_b64: string;
  private_keys_concat_b64: string;
  signature_b64: string;
  signing_private_b64: string;
  signing_public_b64: string;
}

export function loadVectors(): SdkVectors {
  return JSON.parse(readFileSync(VECTORS_PATH, "utf-8"));
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

export { b64ToBytes };

// ── Test constants ──────────────────────────────────────────────────

export const TEST_USER_ID = "12345";
export const TEST_OTHER_USER_ID = "67890";
export const TEST_CONVERSATION_ID = `${TEST_USER_ID}-${TEST_OTHER_USER_ID}`;
export const TEST_CANONICAL_CONVERSATION_ID = `${TEST_USER_ID}:${TEST_OTHER_USER_ID}`;
export const TEST_THREAD_ID = `xchat:${TEST_CONVERSATION_ID}`;
const TEST_SIGNING_KEY_VERSION = "1";
export const TEST_PIN = "2580";

// ── Mock logger ─────────────────────────────────────────────────────

export const mockLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => mockLogger,
};

// ── Mock ChatInstance ───────────────────────────────────────────────

export function createMockChatInstance(): Record<string, unknown> {
  return {
    processMessage: vi.fn(),
    processReaction: vi.fn(),
    processAction: vi.fn(),
    processModalSubmit: vi.fn(),
    processModalClose: vi.fn(),
    processSlashCommand: vi.fn(),
    processMemberJoinedChannel: vi.fn(),
    processAssistantThreadStarted: vi.fn(),
    processAssistantContextChanged: vi.fn(),
    processAppHomeOpened: vi.fn(),
    getState: vi.fn(),
    getUserName: () => "test-bot",
    getLogger: () => mockLogger,
    handleIncomingMessage: vi.fn(),
  };
}

// ── Wasm Chat loaded from pkg/ ──────────────────────────────────────

interface WasmChat {
  decryptConversationKey: (...args: unknown[]) => unknown;
  decryptEvent: (...args: unknown[]) => unknown;
  decryptEvents: (...args: unknown[]) => unknown;
  encryptMessage(params: unknown): {
    messageId: string;
    encryptedContent: string;
    encodedEventSignature: string;
  };
  extractConversationKeys: (...args: unknown[]) => unknown;
  getPublicKeys(): unknown;
  importKeys(keys: Uint8Array, version?: string): void;
  prepareConversationKeyChange(params: unknown): {
    participantKeys: Array<{ userId: string; encryptedKey: string }>;
  };
  setIdentity(userId: string, signingKeyVersion: string): void;
  setRejectUnverified(reject: boolean): void;
}

async function loadWasmChat(): Promise<WasmChat> {
  if (typeof globalThis.crypto === "undefined") {
    const { webcrypto } = await import("node:crypto");
    (globalThis as { crypto: Crypto }).crypto = webcrypto as Crypto;
  }

  const require = createRequire(import.meta.url);
  const entry = require.resolve("@xdevplatform/chat-xdk");
  const pkgDir = dirname(entry);
  const wasmMod = await import(
    pathToFileURL(join(pkgDir, "pkg/chat_xdk_wasm.js")).href
  );
  const init = wasmMod.default || wasmMod.init || wasmMod.__wbindgen_init;
  if (typeof init !== "function") {
    throw new Error("WASM init function not found in chat_xdk_wasm");
  }
  const wasmBytes = readFileSync(join(pkgDir, "pkg/chat_xdk_wasm_bg.wasm"));
  await init({ module_or_path: wasmBytes });
  return new wasmMod.Chat() as WasmChat;
}

/**
 * Real wasm crypto engine loaded with fixture keys (not via public createChat).
 */
export async function createTestCryptoEngine(): Promise<WasmChat> {
  const vectors = loadVectors();
  const chat = await loadWasmChat();
  // The version-aware import records the registered key version; the session
  // identity supplies senderId + signingKeyVersion defaults for encryption.
  chat.importKeys(
    b64ToBytes(vectors.private_keys_concat_b64),
    TEST_SIGNING_KEY_VERSION
  );
  chat.setIdentity(TEST_USER_ID, TEST_SIGNING_KEY_VERSION);
  return chat;
}

/**
 * Wrap fixture wasm Chat as a ChatWithJuicebox stand-in for mocked createChat.
 * unlock/setup are no-ops — keys are already imported.
 */
function asJuiceboxStub(engine: WasmChat): ChatWithJuicebox {
  return new Proxy(engine as object, {
    get(target, prop, receiver) {
      if (prop === "unlock" || prop === "setup") {
        return async () => engine.getPublicKeys();
      }
      if (
        prop === "delete" ||
        prop === "changePin" ||
        prop === "updateConfig" ||
        prop === "free"
      ) {
        return async () => undefined;
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as ChatWithJuicebox;
}

// ── Create adapter with real crypto (Juicebox path, mocked createChat) ─

/**
 * Stubbed XDK client injected into test adapters. Methods are plain vitest
 * mocks and tests freely reassign or add entries, so the groups are typed as
 * permissive records rather than mirroring the real client surface.
 */
export interface MockXdkClient {
  chat: Record<string, ReturnType<typeof vi.fn>>;
  users: Record<string, ReturnType<typeof vi.fn>>;
}

/**
 * Create and initialize an XchatAdapter with real wasm crypto.
 *
 * Wires a Juicebox-shaped stub (fixture keys already imported) and an XDK
 * client without calling createChat — unit tests stay offline and avoid
 * spying on ESM exports.
 */
export async function createInitializedTestAdapter(
  configOverrides: Partial<XchatAdapterConfig> = {}
): Promise<{
  adapter: XchatAdapter;
  mockChat: ReturnType<typeof createMockChatInstance>;
  /** Access the internal XDK client for mocking API calls */
  getXdkClient: () => MockXdkClient;
  restore: () => void;
}> {
  const mockChat = createMockChatInstance();
  const engine = await createTestCryptoEngine();

  const adapter = new XchatAdapter({
    accessToken: "test-token",
    userId: TEST_USER_ID,
    pin: TEST_PIN,
    userName: "test-bot",
    logger: mockLogger,
    // These fixtures drive the decrypt and delivery path, not webhook
    // authentication, so they opt out of the signature check.
    disableWebhookVerification: true,
    ...configOverrides,
  });

  const internals = adapter as unknown as {
    chat: ChatInstance | null;
    xdkClient: unknown;
    cryptoEngine: ChatWithJuicebox | null;
    _cryptoStatus: string;
    signingKeyVersion: string | null;
  };

  internals.chat = mockChat as unknown as ChatInstance;
  const xdkClient: MockXdkClient = {
    users: {
      getPublicKey: vi.fn().mockResolvedValue({ data: [] }),
    },
    chat: {
      addConversationKeys: vi.fn(),
      deleteMessages: vi.fn(),
      getConversationEvents: vi.fn(),
      markConversationRead: vi
        .fn()
        .mockResolvedValue({ data: { success: true } }),
      sendMessage: vi.fn(),
      sendTypingIndicator: vi.fn(),
      mediaDownload: vi.fn(),
      mediaUploadInitialize: vi.fn(),
      mediaUploadAppend: vi.fn(),
      mediaUploadFinalize: vi.fn(),
    },
  };
  internals.xdkClient = xdkClient;
  internals.cryptoEngine = asJuiceboxStub(engine);
  internals.signingKeyVersion = TEST_SIGNING_KEY_VERSION;
  internals._cryptoStatus = "ready";

  return {
    adapter,
    mockChat,
    getXdkClient: () => xdkClient,
    restore: () => undefined,
  };
}
