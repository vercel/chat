import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
} from "./cards";
import type { StateAdapter } from "./types";

const CALLBACK_TOKEN_PREFIX = "__cb:";
const CALLBACK_CACHE_KEY_PREFIX = "chat:callback:";
const CALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CALLBACK_LOCK_TTL_MS = 10_000;
const CALLBACK_RECEIPT_KEY_PREFIX = "chat:callback-receipt:";
// Covers the gap between the click and the receiving workflow step running,
// including queue delay. Receivers delete receipts once they act on them.
const CALLBACK_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const CALLBACK_RECEIPT_NONCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface StoredCallback {
  actionId: string;
  originalValue?: string;
  scope: CallbackScope;
  url: string;
}

interface CallbackContext {
  actionId: string;
  channelId?: string;
  threadId?: string;
}

interface CallbackScope {
  id: string;
  type: "channel" | "thread";
}

/**
 * Server-side record of a button click that Chat POSTed to a callback URL.
 * Built from the adapter-verified action event, never from the POST body, so
 * the receiver can trust who clicked and which button.
 */
export interface CallbackReceipt {
  actionId: string;
  messageId?: string;
  threadId?: string;
  url: string;
  user: { id: string; name?: string };
}

export function encodeCallbackValue(token: string): string {
  return `${CALLBACK_TOKEN_PREFIX}${token}`;
}

export function decodeCallbackValue(value: string | undefined): {
  callbackToken: string | undefined;
} {
  if (!value?.startsWith(CALLBACK_TOKEN_PREFIX)) {
    return { callbackToken: undefined };
  }
  return { callbackToken: value.slice(CALLBACK_TOKEN_PREFIX.length) };
}

function generateToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

async function processActionsElement(
  actions: ActionsElement,
  stateAdapter: StateAdapter,
  scope: CallbackScope
): Promise<ActionsElement> {
  return {
    type: "actions",
    children: await Promise.all(
      actions.children.map(async (el) => {
        if (el.type !== "button" || !el.callbackUrl) {
          return el;
        }

        const token = generateToken();
        const stored: StoredCallback = {
          actionId: el.id,
          url: el.callbackUrl,
          originalValue: el.value,
          scope,
        };
        await stateAdapter.set(
          `${CALLBACK_CACHE_KEY_PREFIX}${token}`,
          stored,
          CALLBACK_TTL_MS
        );

        // Keep every other button field so new ones (like tooltip) are not
        // silently dropped; only the callback URL is replaced by the token.
        const { callbackUrl: _callbackUrl, ...rest } = el;
        const processed: ButtonElement = {
          ...rest,
          value: encodeCallbackValue(token),
        };
        return processed;
      })
    ),
  };
}

function hasCallbackButtons(children: CardChild[]): boolean {
  for (const child of children) {
    if (child.type === "actions") {
      for (const el of child.children) {
        if (el.type === "button" && el.callbackUrl) {
          return true;
        }
      }
    }
    if (
      child.type === "section" &&
      "children" in child &&
      hasCallbackButtons(child.children)
    ) {
      return true;
    }
  }
  return false;
}

async function processChildren(
  children: CardChild[],
  stateAdapter: StateAdapter,
  scope: CallbackScope
): Promise<CardChild[]> {
  const result: CardChild[] = [];
  for (const child of children) {
    if (child.type === "actions") {
      result.push(await processActionsElement(child, stateAdapter, scope));
    } else if (child.type === "section" && "children" in child) {
      result.push({
        ...child,
        children: await processChildren(child.children, stateAdapter, scope),
      });
    } else {
      result.push(child);
    }
  }
  return result;
}

export async function processCardCallbackUrls(
  card: CardElement,
  stateAdapter: StateAdapter,
  scope: CallbackScope
): Promise<CardElement> {
  if (!hasCallbackButtons(card.children)) {
    return card;
  }

  return {
    ...card,
    children: await processChildren(card.children, stateAdapter, scope),
  };
}

export async function resolveCallbackUrl(
  token: string,
  stateAdapter: StateAdapter,
  context?: CallbackContext
): Promise<StoredCallback | null> {
  const key = `${CALLBACK_CACHE_KEY_PREFIX}${token}`;
  const lock = await stateAdapter.acquireLock(key, CALLBACK_LOCK_TTL_MS);
  if (!lock) {
    return null;
  }

  try {
    const stored = await stateAdapter.get<StoredCallback>(key);
    if (
      !stored ||
      typeof stored !== "object" ||
      typeof stored.actionId !== "string" ||
      typeof stored.url !== "string" ||
      (stored.originalValue !== undefined &&
        typeof stored.originalValue !== "string") ||
      !stored.scope ||
      typeof stored.scope.id !== "string" ||
      (stored.scope.type !== "channel" && stored.scope.type !== "thread")
    ) {
      return null;
    }

    const scopeId =
      stored.scope.type === "channel" ? context?.channelId : context?.threadId;
    if (stored.actionId !== context?.actionId || stored.scope.id !== scopeId) {
      return null;
    }

    await stateAdapter.delete(key);
    return stored;
  } finally {
    await stateAdapter.releaseLock(lock);
  }
}

/**
 * Store a receipt for a button click and return the nonce that identifies it.
 * Write it before POSTing so the receiver can always find it.
 */
export async function createCallbackReceipt(
  stateAdapter: StateAdapter,
  receipt: CallbackReceipt
): Promise<string> {
  const nonce = crypto.randomUUID();
  await stateAdapter.set(
    `${CALLBACK_RECEIPT_KEY_PREFIX}${nonce}`,
    receipt,
    CALLBACK_RECEIPT_TTL_MS
  );
  return nonce;
}

function isCallbackReceipt(value: unknown): value is CallbackReceipt {
  if (!value || typeof value !== "object") {
    return false;
  }
  const receipt = value as Record<string, unknown>;
  const user = receipt.user as Record<string, unknown> | null | undefined;
  return (
    typeof receipt.actionId === "string" &&
    typeof receipt.url === "string" &&
    (receipt.threadId === undefined || typeof receipt.threadId === "string") &&
    (receipt.messageId === undefined ||
      typeof receipt.messageId === "string") &&
    !!user &&
    typeof user === "object" &&
    typeof user.id === "string" &&
    (user.name === undefined || typeof user.name === "string")
  );
}

/**
 * Check that a value has the shape of a receipt nonce. Pure, so receivers can
 * reject junk before doing any I/O.
 */
export function isCallbackReceiptNonce(value: unknown): value is string {
  return (
    typeof value === "string" && CALLBACK_RECEIPT_NONCE_PATTERN.test(value)
  );
}

/**
 * Look up and verify a click receipt without consuming it, so a retried
 * reader sees the same result. Receivers enforce single use themselves and
 * call `deleteCallbackReceipt` once they act on the click. Returns null when
 * the nonce is malformed or unknown, or the receipt was issued for another
 * URL or thread.
 */
export async function readCallbackReceipt(
  stateAdapter: StateAdapter,
  nonce: string,
  expected: { threadId: string; url: string }
): Promise<CallbackReceipt | null> {
  if (!isCallbackReceiptNonce(nonce)) {
    return null;
  }

  const receipt = await stateAdapter.get<unknown>(
    `${CALLBACK_RECEIPT_KEY_PREFIX}${nonce}`
  );
  if (
    !isCallbackReceipt(receipt) ||
    receipt.url !== expected.url ||
    receipt.threadId !== expected.threadId
  ) {
    return null;
  }
  return receipt;
}

export async function deleteCallbackReceipt(
  stateAdapter: StateAdapter,
  nonce: string
): Promise<void> {
  if (!isCallbackReceiptNonce(nonce)) {
    return;
  }
  await stateAdapter.delete(`${CALLBACK_RECEIPT_KEY_PREFIX}${nonce}`);
}

/**
 * Put back a token that `resolveCallbackUrl` consumed, so its button works
 * again after the click could not be delivered.
 */
export async function restoreCallbackToken(
  stateAdapter: StateAdapter,
  token: string,
  stored: StoredCallback
): Promise<void> {
  await stateAdapter.set(
    `${CALLBACK_CACHE_KEY_PREFIX}${token}`,
    stored,
    CALLBACK_TTL_MS
  );
}

export async function postToCallbackUrl(
  callbackUrl: string,
  payload: Record<string, unknown>
): Promise<{ error?: unknown; status?: number }> {
  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      return {
        error: new Error(
          `Callback URL returned ${response.status}: ${await response.text().catch(() => "")}`
        ),
        status: response.status,
      };
    }
    return { status: response.status };
  } catch (error) {
    return { error };
  }
}
