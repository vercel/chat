import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
} from "./cards";
import type { StateAdapter } from "./types";

const CALLBACK_TOKEN_PREFIX = "__cb:";
const CALLBACK_CACHE_KEY_PREFIX = "chat:callback:";
const CALLBACK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredCallback {
  originalValue?: string;
  url: string;
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
  stateAdapter: StateAdapter
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
          url: el.callbackUrl,
          originalValue: el.value,
        };
        await stateAdapter.set(
          `${CALLBACK_CACHE_KEY_PREFIX}${token}`,
          stored,
          CALLBACK_TTL_MS
        );

        const processed: ButtonElement = {
          type: "button",
          id: el.id,
          label: el.label,
          style: el.style,
          disabled: el.disabled,
          value: encodeCallbackValue(token),
          actionType: el.actionType,
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
  stateAdapter: StateAdapter
): Promise<CardChild[]> {
  const result: CardChild[] = [];
  for (const child of children) {
    if (child.type === "actions") {
      result.push(await processActionsElement(child, stateAdapter));
    } else if (child.type === "section" && "children" in child) {
      result.push({
        ...child,
        children: await processChildren(child.children, stateAdapter),
      });
    } else {
      result.push(child);
    }
  }
  return result;
}

export async function processCardCallbackUrls(
  card: CardElement,
  stateAdapter: StateAdapter
): Promise<CardElement> {
  if (!hasCallbackButtons(card.children)) {
    return card;
  }

  return {
    ...card,
    children: await processChildren(card.children, stateAdapter),
  };
}

export async function resolveCallbackUrl(
  token: string,
  stateAdapter: StateAdapter
): Promise<{ url: string; originalValue?: string } | null> {
  const stored = await stateAdapter.get<StoredCallback | string>(
    `${CALLBACK_CACHE_KEY_PREFIX}${token}`
  );
  if (!stored) {
    return null;
  }
  if (typeof stored === "string") {
    return { url: stored };
  }
  return stored;
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
