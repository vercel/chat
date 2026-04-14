import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
} from "./cards";
import type { StateAdapter } from "./types";

const CALLBACK_TOKEN_PREFIX = "__cb:";
const CALLBACK_CACHE_KEY_PREFIX = "chat:callback:";
const CALLBACK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Encode a callback token into a button's value field.
 * Format: `__cb:{token}` or `__cb:{token}|{originalValue}`
 */
export function encodeCallbackValue(
  token: string,
  originalValue?: string
): string {
  if (originalValue != null && originalValue !== "") {
    return `${CALLBACK_TOKEN_PREFIX}${token}|${originalValue}`;
  }
  return `${CALLBACK_TOKEN_PREFIX}${token}`;
}

/**
 * Check if a value contains an encoded callback token and extract the
 * original value and token.
 */
export function decodeCallbackValue(value: string | undefined): {
  callbackToken: string | undefined;
  originalValue: string | undefined;
} {
  if (!value?.startsWith(CALLBACK_TOKEN_PREFIX)) {
    return { callbackToken: undefined, originalValue: value };
  }
  const rest = value.slice(CALLBACK_TOKEN_PREFIX.length);
  const pipeIdx = rest.indexOf("|");
  if (pipeIdx === -1) {
    return { callbackToken: rest, originalValue: undefined };
  }
  return {
    callbackToken: rest.slice(0, pipeIdx),
    originalValue: rest.slice(pipeIdx + 1),
  };
}

function generateToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Walk a CardElement tree and process any buttons that have `callbackUrl`.
 * For each such button:
 *   1. Generate a unique token
 *   2. Store `token -> callbackUrl` in the StateAdapter
 *   3. Encode the token into the button's `value` field
 *   4. Remove `callbackUrl` from the element
 *
 * Returns a shallow-cloned card with modified buttons (original is not mutated).
 */
export async function processCardCallbackUrls(
  card: CardElement,
  stateAdapter: StateAdapter
): Promise<CardElement> {
  let hasCallbacks = false;
  for (const child of card.children) {
    if (child.type === "actions") {
      for (const el of child.children) {
        if (el.type === "button" && el.callbackUrl) {
          hasCallbacks = true;
          break;
        }
      }
    }
    if (hasCallbacks) {
      break;
    }
  }
  if (!hasCallbacks) {
    return card;
  }

  const newChildren: CardChild[] = [];
  for (const child of card.children) {
    if (child.type !== "actions") {
      newChildren.push(child);
      continue;
    }

    const newActions: ActionsElement = {
      type: "actions",
      children: await Promise.all(
        child.children.map(async (el) => {
          if (el.type !== "button" || !el.callbackUrl) {
            return el;
          }

          const token = generateToken();
          await stateAdapter.set(
            `${CALLBACK_CACHE_KEY_PREFIX}${token}`,
            el.callbackUrl,
            CALLBACK_TTL_MS
          );

          const processed: ButtonElement = {
            type: "button",
            id: el.id,
            label: el.label,
            style: el.style,
            disabled: el.disabled,
            value: encodeCallbackValue(token, el.value),
          };
          return processed;
        })
      ),
    };
    newChildren.push(newActions);
  }

  return { ...card, children: newChildren };
}

/**
 * Look up a callback URL from its token.
 */
export async function resolveCallbackUrl(
  token: string,
  stateAdapter: StateAdapter
): Promise<string | null> {
  return stateAdapter.get<string>(`${CALLBACK_CACHE_KEY_PREFIX}${token}`);
}

/**
 * POST action data to a callback URL. Errors are caught and returned
 * so the caller can log them without interrupting the action flow.
 */
export async function postToCallbackUrl(
  callbackUrl: string,
  payload: Record<string, unknown>
): Promise<{ error?: unknown }> {
  try {
    await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return {};
  } catch (error) {
    return { error };
  }
}
