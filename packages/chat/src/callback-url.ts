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
