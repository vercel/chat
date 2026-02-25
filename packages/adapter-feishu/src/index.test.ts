import crypto from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type { Logger } from "chat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFeishuAdapter, FeishuAdapter } from "./index";
import { FeishuFormatConverter } from "./markdown";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const originalEnv = {
  FEISHU_APP_ID: process.env.FEISHU_APP_ID,
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET,
  FEISHU_ENCRYPT_KEY: process.env.FEISHU_ENCRYPT_KEY,
  FEISHU_VERIFICATION_TOKEN: process.env.FEISHU_VERIFICATION_TOKEN,
};

function unsetEnv(
  key:
    | "FEISHU_APP_ID"
    | "FEISHU_APP_SECRET"
    | "FEISHU_ENCRYPT_KEY"
    | "FEISHU_VERIFICATION_TOKEN"
): void {
  Reflect.deleteProperty(process.env, key);
}

function restoreFeishuEnv(): void {
  if (originalEnv.FEISHU_APP_ID === undefined) {
    unsetEnv("FEISHU_APP_ID");
  } else {
    process.env.FEISHU_APP_ID = originalEnv.FEISHU_APP_ID;
  }

  if (originalEnv.FEISHU_APP_SECRET === undefined) {
    unsetEnv("FEISHU_APP_SECRET");
  } else {
    process.env.FEISHU_APP_SECRET = originalEnv.FEISHU_APP_SECRET;
  }

  if (originalEnv.FEISHU_ENCRYPT_KEY === undefined) {
    unsetEnv("FEISHU_ENCRYPT_KEY");
  } else {
    process.env.FEISHU_ENCRYPT_KEY = originalEnv.FEISHU_ENCRYPT_KEY;
  }

  if (originalEnv.FEISHU_VERIFICATION_TOKEN === undefined) {
    unsetEnv("FEISHU_VERIFICATION_TOKEN");
  } else {
    process.env.FEISHU_VERIFICATION_TOKEN =
      originalEnv.FEISHU_VERIFICATION_TOKEN;
  }
}

function createTestAdapter(overrides?: {
  userName?: string;
  verificationToken?: string;
  encryptKey?: string;
}): FeishuAdapter {
  return new FeishuAdapter({
    appId: "test-app-id",
    appSecret: "test-app-secret",
    verificationToken: overrides?.verificationToken,
    encryptKey: overrides?.encryptKey,
    logger: mockLogger,
    userName: overrides?.userName,
  });
}

function createWebhookRequest(body: string): Request {
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function createMessageEventPayload(overrides?: {
  token?: string;
  senderType?: "user" | "app";
}): {
  schema: string;
  header: {
    app_id: string;
    create_time: string;
    event_id: string;
    event_type: string;
    tenant_key: string;
    token: string;
  };
  event: {
    message: {
      chat_id: string;
      chat_type: string;
      content: string;
      create_time: string;
      message_id: string;
      message_type: string;
    };
    sender: {
      sender_id: { open_id: string };
      sender_type: "user" | "app";
    };
  };
} {
  return {
    schema: "2.0",
    header: {
      app_id: "test-app-id",
      create_time: "1234567890",
      event_id: "ev_test_123",
      event_type: "im.message.receive_v1",
      tenant_key: "test-tenant",
      token: overrides?.token ?? "test-token",
    },
    event: {
      message: {
        chat_id: "oc_test123",
        chat_type: "group",
        content: JSON.stringify({ text: "Hello world" }),
        create_time: "1700000000000",
        message_id: "om_msg_001",
        message_type: "text",
      },
      sender: {
        sender_id: { open_id: "ou_user_001" },
        sender_type: overrides?.senderType ?? "user",
      },
    },
  };
}

function encryptPayload(payload: object, encryptKey: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(encryptKey);
  const key = hash.digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}

function computeSignature(
  timestamp: string,
  nonce: string,
  encryptKey: string,
  body: string
): string {
  return crypto
    .createHash("sha256")
    .update(timestamp + nonce + encryptKey + body)
    .digest("hex");
}

afterEach(() => {
  restoreFeishuEnv();
  vi.restoreAllMocks();
});

describe("createFeishuAdapter", () => {
  it("creates a FeishuAdapter instance when appId and appSecret are provided", () => {
    const adapter = createFeishuAdapter({
      appId: "test-app-id",
      appSecret: "test-app-secret",
      logger: mockLogger,
    });

    expect(adapter).toBeInstanceOf(FeishuAdapter);
    expect(adapter.name).toBe("feishu");
  });

  it("sets default userName to 'bot'", () => {
    const adapter = createFeishuAdapter({
      appId: "test-app-id",
      appSecret: "test-app-secret",
      logger: mockLogger,
    });

    expect(adapter.userName).toBe("bot");
  });

  it("uses provided userName", () => {
    const adapter = createFeishuAdapter({
      appId: "test-app-id",
      appSecret: "test-app-secret",
      logger: mockLogger,
      userName: "custombot",
    });

    expect(adapter.userName).toBe("custombot");
  });

  it("throws ValidationError when appId is missing", () => {
    unsetEnv("FEISHU_APP_ID");

    expect(() =>
      createFeishuAdapter({
        appSecret: "test-app-secret",
        logger: mockLogger,
      })
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when appSecret is missing", () => {
    unsetEnv("FEISHU_APP_SECRET");

    expect(() =>
      createFeishuAdapter({
        appId: "test-app-id",
        logger: mockLogger,
      })
    ).toThrow(ValidationError);
  });

  it("falls back to FEISHU_APP_ID and FEISHU_APP_SECRET env vars", () => {
    process.env.FEISHU_APP_ID = "env-app-id";
    process.env.FEISHU_APP_SECRET = "env-app-secret";

    const adapter = createFeishuAdapter({ logger: mockLogger });

    expect(adapter).toBeInstanceOf(FeishuAdapter);
    expect(adapter.name).toBe("feishu");
  });

  it("reads encryptKey and verificationToken from config", () => {
    const adapter = createFeishuAdapter({
      appId: "test-app-id",
      appSecret: "test-app-secret",
      encryptKey: "config-encrypt-key",
      verificationToken: "config-verification-token",
      logger: mockLogger,
    });

    expect(Reflect.get(adapter, "encryptKey")).toBe("config-encrypt-key");
    expect(Reflect.get(adapter, "verificationToken")).toBe(
      "config-verification-token"
    );
  });

  it("reads encryptKey and verificationToken from env vars", () => {
    process.env.FEISHU_APP_ID = "env-app-id";
    process.env.FEISHU_APP_SECRET = "env-app-secret";
    process.env.FEISHU_ENCRYPT_KEY = "env-encrypt-key";
    process.env.FEISHU_VERIFICATION_TOKEN = "env-verification-token";

    const adapter = createFeishuAdapter({ logger: mockLogger });

    expect(Reflect.get(adapter, "encryptKey")).toBe("env-encrypt-key");
    expect(Reflect.get(adapter, "verificationToken")).toBe(
      "env-verification-token"
    );
  });
});

describe("encodeThreadId", () => {
  const adapter = createTestAdapter();

  it("encodes chatId and messageId", () => {
    expect(
      adapter.encodeThreadId({
        chatId: "oc_xxx",
        messageId: "om_xxx",
      })
    ).toBe("feishu:oc_xxx:om_xxx");
  });
});

describe("decodeThreadId", () => {
  const adapter = createTestAdapter();

  it("decodes valid thread ID", () => {
    expect(adapter.decodeThreadId("feishu:oc_xxx:om_xxx")).toEqual({
      chatId: "oc_xxx",
      messageId: "om_xxx",
    });
  });

  it("throws ValidationError for invalid format", () => {
    expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("feishu:oc_xxx")).toThrow(
      ValidationError
    );
    expect(() => adapter.decodeThreadId("slack:oc_xxx:om_xxx")).toThrow(
      ValidationError
    );
  });
});

describe("channelIdFromThreadId", () => {
  const adapter = createTestAdapter();

  it("returns feishu:chatId", () => {
    expect(adapter.channelIdFromThreadId("feishu:oc_xxx:om_xxx")).toBe(
      "feishu:oc_xxx"
    );
  });
});

describe("isDM", () => {
  const adapter = createTestAdapter();

  it("returns true when messageId is dm", () => {
    expect(adapter.isDM("feishu:oc_xxx:dm")).toBe(true);
  });

  it("returns false when messageId is not dm", () => {
    expect(adapter.isDM("feishu:oc_xxx:om_xxx")).toBe(false);
  });
});

describe("handleWebhook", () => {
  it("returns 400 for invalid JSON body", async () => {
    const adapter = createTestAdapter();
    const request = createWebhookRequest("not valid json");

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid JSON");
  });

  it("returns challenge response for URL verification", async () => {
    const adapter = createTestAdapter();
    const request = createWebhookRequest(
      JSON.stringify({ challenge: "test-challenge-token" })
    );

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      challenge: "test-challenge-token",
    });
  });

  it("returns 401 when verification token does not match", async () => {
    const adapter = createTestAdapter({ verificationToken: "expected-token" });
    const request = createWebhookRequest(
      JSON.stringify(createMessageEventPayload({ token: "wrong-token" }))
    );

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Invalid token");
  });

  it("accepts valid verification token", async () => {
    const adapter = createTestAdapter({ verificationToken: "test-token" });
    const request = createWebhookRequest(
      JSON.stringify({
        schema: "2.0",
        header: {
          app_id: "test-app-id",
          create_time: "1234567890",
          event_id: "ev_test_999",
          event_type: "im.chat.member.bot.added_v1",
          tenant_key: "test-tenant",
          token: "test-token",
        },
      })
    );

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("handles im.message.receive_v1 and calls chat.handleIncomingMessage", async () => {
    const adapter = createTestAdapter({ verificationToken: "test-token" });
    const handleIncomingMessage = vi.fn(async () => {});
    Object.defineProperty(adapter, "chat", {
      value: { handleIncomingMessage },
      writable: true,
    });

    const request = createWebhookRequest(
      JSON.stringify(createMessageEventPayload({ token: "test-token" }))
    );

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(handleIncomingMessage).toHaveBeenCalledTimes(1);
    expect(handleIncomingMessage).toHaveBeenCalledWith(
      adapter,
      "feishu:oc_test123:om_msg_001",
      expect.objectContaining({
        id: "om_msg_001",
        text: "Hello world",
      })
    );
  });

  it("skips bot messages where sender_type is app", async () => {
    const adapter = createTestAdapter({ verificationToken: "test-token" });
    const handleIncomingMessage = vi.fn(async () => {});
    Object.defineProperty(adapter, "chat", {
      value: { handleIncomingMessage },
      writable: true,
    });

    const request = createWebhookRequest(
      JSON.stringify(
        createMessageEventPayload({
          token: "test-token",
          senderType: "app",
        })
      )
    );

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });
});

describe("handleWebhook - encrypted events", () => {
  it("decrypts an encrypted event payload and processes it", async () => {
    const encryptKey = "test-encrypt-key-123";
    const adapter = createTestAdapter({
      verificationToken: "test-token",
      encryptKey,
    });
    const handleIncomingMessage = vi.fn(async () => {});
    Object.defineProperty(adapter, "chat", {
      value: { handleIncomingMessage },
      writable: true,
    });

    const eventPayload = createMessageEventPayload({ token: "test-token" });
    const encrypted = encryptPayload(eventPayload, encryptKey);
    const body = JSON.stringify({ encrypt: encrypted });

    // Create request with signature headers
    const timestamp = "1700000000";
    const nonce = "test-nonce-abc";
    const signature = computeSignature(timestamp, nonce, encryptKey, body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lark-request-timestamp": timestamp,
        "x-lark-request-nonce": nonce,
        "x-lark-signature": signature,
      },
      body,
    });

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(handleIncomingMessage).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when encrypted event received but no encryptKey configured", async () => {
    const adapter = createTestAdapter(); // No encryptKey
    const body = JSON.stringify({ encrypt: "some-encrypted-data" });
    const request = createWebhookRequest(body);

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Encryption key not configured");
  });

  it("returns 400 when decryption fails due to wrong key", async () => {
    const adapter = createTestAdapter({ encryptKey: "wrong-key" });
    // Encrypt with a different key
    const eventPayload = createMessageEventPayload();
    const encrypted = encryptPayload(eventPayload, "correct-key");
    const body = JSON.stringify({ encrypt: encrypted });
    const request = createWebhookRequest(body);

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Decryption failed");
  });
});

describe("handleWebhook - signature verification", () => {
  it("accepts a request with valid signature", async () => {
    const encryptKey = "test-encrypt-key";
    const adapter = createTestAdapter({
      verificationToken: "test-token",
      encryptKey,
    });

    const payload = createMessageEventPayload({ token: "test-token" });
    const body = JSON.stringify(payload);
    const timestamp = "1700000000";
    const nonce = "nonce123";
    const signature = computeSignature(timestamp, nonce, encryptKey, body);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lark-request-timestamp": timestamp,
        "x-lark-request-nonce": nonce,
        "x-lark-signature": signature,
      },
      body,
    });

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
  });

  it("returns 401 for invalid signature", async () => {
    const encryptKey = "test-encrypt-key";
    const adapter = createTestAdapter({
      verificationToken: "test-token",
      encryptKey,
    });

    const payload = createMessageEventPayload({ token: "test-token" });
    const body = JSON.stringify(payload);
    const timestamp = "1700000000";
    const nonce = "nonce123";

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lark-request-timestamp": timestamp,
        "x-lark-request-nonce": nonce,
        "x-lark-signature": "invalid-signature-value",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Invalid signature");
  });

  it("returns 401 when signature headers are absent but encryptKey is configured", async () => {
    const encryptKey = "test-encrypt-key";
    const adapter = createTestAdapter({
      verificationToken: "test-token",
      encryptKey,
    });

    const payload = createMessageEventPayload({ token: "test-token" });
    const body = JSON.stringify(payload);

    // No signature headers
    const request = createWebhookRequest(body);

    const response = await adapter.handleWebhook(request);

    // Should reject — missing signature headers when encryptKey is configured
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Missing signature headers");
  });

  it("uses timing-safe comparison for signature verification", async () => {
    const encryptKey = "test-encrypt-key";
    const adapter = createTestAdapter({
      verificationToken: "test-token",
      encryptKey,
    });

    const payload = createMessageEventPayload({ token: "test-token" });
    const body = JSON.stringify(payload);

    const timestamp = "1700000000";
    const nonce = "test-nonce";
    // Compute valid signature
    const content = timestamp + nonce + encryptKey + body;
    const validSignature = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");

    // Valid signature should pass
    const validRequest = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lark-request-timestamp": timestamp,
        "x-lark-request-nonce": nonce,
        "x-lark-signature": validSignature,
      },
      body,
    });

    const validResponse = await adapter.handleWebhook(validRequest);
    expect(validResponse.status).toBe(200);

    // Signature with different length should fail (caught by timingSafeEqual try/catch)
    const shortRequest = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lark-request-timestamp": timestamp,
        "x-lark-request-nonce": nonce,
        "x-lark-signature": "short",
      },
      body,
    });

    const shortResponse = await adapter.handleWebhook(shortRequest);
    expect(shortResponse.status).toBe(401);
  });
});

describe("parseMessage", () => {
  const adapter = createTestAdapter();

  it("parses a text message correctly", () => {
    const rawMessage = {
      message_id: "om_msg_001",
      chat_id: "oc_chat_001",
      content: JSON.stringify({ text: "Hello Feishu" }),
      msg_type: "text",
      create_time: "1700000000000",
      sender: {
        id: "ou_user_001",
        sender_type: "user",
      },
    };

    const message = adapter.parseMessage(rawMessage);

    expect(message.id).toBe("om_msg_001");
    expect(message.threadId).toBe("feishu:oc_chat_001:om_msg_001");
    expect(message.text).toBe("Hello Feishu");
    expect(message.author.userId).toBe("ou_user_001");
    expect(message.author.userName).toBe("ou_user_001");
    expect(message.author.fullName).toBe("ou_user_001");
    expect(message.author.isBot).toBe(false);
  });

  it("uses root_id for threaded replies", () => {
    const rawMessage = {
      message_id: "om_reply_001",
      root_id: "om_root_001",
      chat_id: "oc_chat_001",
      content: JSON.stringify({ text: "Reply" }),
      msg_type: "text",
      create_time: "1700000000000",
      sender: {
        id: "ou_user_001",
        sender_type: "user",
      },
    };

    const message = adapter.parseMessage(rawMessage);

    expect(message.threadId).toBe("feishu:oc_chat_001:om_root_001");
  });

  it("returns empty text for non-text message types", () => {
    const rawMessage = {
      message_id: "om_img_001",
      chat_id: "oc_chat_001",
      content: JSON.stringify({ image_key: "img_123" }),
      msg_type: "image",
      create_time: "1700000000000",
      sender: {
        id: "ou_user_001",
        sender_type: "user",
      },
    };

    const message = adapter.parseMessage(rawMessage);

    expect(message.text).toBe("");
  });

  it("handles invalid JSON content gracefully", () => {
    const rawMessage = {
      message_id: "om_bad_001",
      chat_id: "oc_chat_001",
      content: "{not valid json",
      msg_type: "text",
      create_time: "1700000000000",
      sender: {
        id: "ou_user_001",
        sender_type: "user",
      },
    };

    expect(() => adapter.parseMessage(rawMessage)).not.toThrow();
    expect(adapter.parseMessage(rawMessage).text).toBe("");
  });

  it("sets edited metadata from update_time", () => {
    const rawMessage = {
      message_id: "om_edit_001",
      chat_id: "oc_chat_001",
      content: JSON.stringify({ text: "Updated" }),
      msg_type: "text",
      create_time: "1700000000000",
      update_time: "1700000060000",
      sender: {
        id: "ou_user_001",
        sender_type: "user",
      },
    };

    const message = adapter.parseMessage(rawMessage);

    expect(message.metadata?.edited).toBe(true);
    expect(message.metadata?.editedAt).toEqual(new Date(1700000060000));
  });

  it("marks author as bot when sender_type is app", () => {
    const rawMessage = {
      message_id: "om_bot_001",
      chat_id: "oc_chat_001",
      content: JSON.stringify({ text: "Bot says hi" }),
      msg_type: "text",
      create_time: "1700000000000",
      sender: {
        id: "ou_bot_001",
        sender_type: "app",
      },
    };

    const message = adapter.parseMessage(rawMessage);

    expect(message.author.isBot).toBe(true);
  });
});

describe("renderFormatted", () => {
  const adapter = createTestAdapter();

  it("renders AST via formatConverter.fromAst", () => {
    const fromAstSpy = vi.spyOn(FeishuFormatConverter.prototype, "fromAst");
    const ast = {
      type: "root" as const,
      children: [
        {
          type: "paragraph" as const,
          children: [
            {
              type: "strong" as const,
              children: [{ type: "text" as const, value: "bold" }],
            },
          ],
        },
      ],
    };

    const result = adapter.renderFormatted(ast);

    expect(result).toBe("**bold**");
    expect(fromAstSpy).toHaveBeenCalledWith(ast);
  });
});

describe("startTyping", () => {
  const adapter = createTestAdapter();

  it("is a no-op and does not throw", async () => {
    await expect(
      adapter.startTyping("feishu:oc_xxx:om_xxx")
    ).resolves.toBeUndefined();
  });
});

describe("name", () => {
  it("returns feishu", () => {
    const adapter = createTestAdapter();
    expect(adapter.name).toBe("feishu");
  });
});
